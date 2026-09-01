-- =====================================================================
-- rpc_integration.sql
-- Self-contained integration test for the stock/credit engine. It
-- simulates three authenticated users (via SET ROLE + JWT claims),
-- exercises every workflow RPC, RLS isolation, and the authorization
-- rules, then RAISES 'TESTS_PASSED' to roll the whole thing back so the
-- database is left untouched.
--
-- Run against a database that has migrations 0001–0011 applied:
--   psql "$DATABASE_URL" -f supabase/tests/rpc_integration.sql
-- Expected result: ERROR ... TESTS_PASSED  (any other error = failure).
--
-- Covers: onboarding, tenant isolation, goods-in, cash sale, credit sale,
-- credit-limit block (no state leak), manager override, partial payment,
-- insufficient-stock block, manager-only adjustment, ledger⇄stock
-- reconciliation, append-only ledger (RLS + trigger), duplicate barcode,
-- employee authorization limits, cross-tenant RPC denial.
-- =====================================================================
do $$
declare
  uA uuid := '11111111-1111-1111-1111-111111111111';
  uC uuid := '22222222-2222-2222-2222-222222222222';
  uB uuid := '33333333-3333-3333-3333-333333333333';
  bizA uuid; storeA uuid; res jsonb;
  pidMilk uuid; pidBread uuid; custJohn uuid;
  q numeric; bal numeric; ok boolean; c int;
begin
  insert into auth.users (instance_id,id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous)
  values ('00000000-0000-0000-0000-000000000000',uA,'authenticated','authenticated','a@x.io',now(),now(),'{}','{}',false,false),
         ('00000000-0000-0000-0000-000000000000',uC,'authenticated','authenticated','c@x.io',now(),now(),'{}','{}',false,false),
         ('00000000-0000-0000-0000-000000000000',uB,'authenticated','authenticated','b@x.io',now(),now(),'{}','{}',false,false);
  perform set_config('request.jwt.claims', json_build_object('sub',uA,'role','authenticated')::text, true);
  set local role authenticated;

  res := public.create_business('Biz A','Store A');
  bizA := (res->>'business_id')::uuid; storeA := (res->>'store_id')::uuid;
  pidMilk := public.create_product(storeA,'Milk','1001',null,null,12,20,5,10,'each',false);
  pidBread:= public.create_product(storeA,'Bread','1002',null,null,9,15,4,8,'each',false);

  perform public.receive_stock(storeA,null,'INV-1',null,
    jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',10,'unit_cost',12),
                      jsonb_build_object('product_id',pidBread,'quantity',8,'unit_cost',9)));
  select quantity into q from public.stock where product_id=pidMilk and store_id=storeA;
  if q<>10 then raise exception 'ASSERT milk=10 got %',q; end if;

  perform public.complete_sale(storeA,'CASH',null,jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',3)),false,null);
  select quantity into q from public.stock where product_id=pidMilk and store_id=storeA;
  if q<>7 then raise exception 'ASSERT milk after cash=7 got %',q; end if;

  insert into public.customers (business_id,store_id,name) values (bizA,storeA,'John') returning id into custJohn;
  perform public.set_credit_limit(custJohn,100);
  perform public.complete_sale(storeA,'CREDIT',custJohn,jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',2)),false,null);
  select balance into bal from public.credit_accounts where customer_id=custJohn;
  if bal<>40 then raise exception 'ASSERT bal=40 got %',bal; end if;

  ok:=false;
  begin perform public.complete_sale(storeA,'CREDIT',custJohn,jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',4)),false,null);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT credit limit should block'; end if;
  select balance into bal from public.credit_accounts where customer_id=custJohn;
  if bal<>40 then raise exception 'ASSERT bal still 40, got %',bal; end if;
  select quantity into q from public.stock where product_id=pidMilk and store_id=storeA;
  if q<>5 then raise exception 'ASSERT milk still 5 after blocked, got %',q; end if;

  perform public.complete_sale(storeA,'CREDIT',custJohn,jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',4)),true,null);
  select balance into bal from public.credit_accounts where customer_id=custJohn;
  if bal<>120 then raise exception 'ASSERT bal=120 got %',bal; end if;

  perform public.record_credit_payment(custJohn,50,null);
  select balance into bal from public.credit_accounts where customer_id=custJohn;
  if bal<>70 then raise exception 'ASSERT bal=70 got %',bal; end if;

  ok:=false;
  begin perform public.complete_sale(storeA,'CASH',null,jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',5)),false,null);
  exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT insufficient stock should block'; end if;

  perform public.adjust_stock(storeA,pidBread,6,'DAMAGED',null);
  select quantity into q from public.stock where product_id=pidBread and store_id=storeA;
  if q<>6 then raise exception 'ASSERT bread=6 got %',q; end if;

  select count(*) into c from public.reconcile_stock(storeA) where diff<>0;
  if c<>0 then raise exception 'ASSERT reconcile diffs=%',c; end if;

  update public.stock_movements set reason='x' where product_id=pidMilk;
  select count(*) into c from public.stock_movements where reason='x';
  if c<>0 then raise exception 'ASSERT ledger unchanged via RLS, changed=%',c; end if;

  ok:=false;
  begin insert into public.product_barcodes(product_id,store_id,barcode) values (pidBread,storeA,'1001'); exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT duplicate barcode blocked'; end if;

  insert into public.memberships(business_id,user_id,role) values (bizA,uC,'employee');
  perform set_config('request.jwt.claims', json_build_object('sub',uC,'role','authenticated')::text, true);
  ok:=false; begin perform public.adjust_stock(storeA,pidBread,10,'OTHER',null); exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT employee adjust forbidden'; end if;
  ok:=false; begin perform public.complete_sale(storeA,'CREDIT',custJohn,jsonb_build_array(jsonb_build_object('product_id',pidBread,'quantity',3)),true,null); exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT employee override forbidden'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',uB,'role','authenticated')::text, true);
  perform public.create_business('Biz B','Store B');
  select count(*) into c from public.products where store_id=storeA; if c<>0 then raise exception 'ASSERT isolation products %',c; end if;
  select count(*) into c from public.stock where store_id=storeA; if c<>0 then raise exception 'ASSERT isolation stock %',c; end if;
  ok:=false; begin perform public.receive_stock(storeA,null,'X',null,jsonb_build_array(jsonb_build_object('product_id',pidMilk,'quantity',1))); exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT intruder receive forbidden'; end if;

  reset role;
  ok:=false;
  begin update public.stock_movements set reason='x' where product_id=pidMilk; exception when others then ok:=true; end;
  if not ok then raise exception 'ASSERT trigger blocks owner ledger update'; end if;

  raise exception 'TESTS_PASSED';
end $$;
