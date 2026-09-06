do $$
declare u uuid:=gen_random_uuid(); res jsonb; biz uuid; loc uuid; p uuid; sale uuid; req uuid:=gen_random_uuid(); payload jsonb; q numeric; blocked boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'card-owner@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true); set local role authenticated;
  res:=public.create_business('Card test','Shop'); biz:=(res->>'business_id')::uuid; loc:=(res->>'store_id')::uuid;
  p:=public.create_product(loc,'Milk','CARDMILK',null,null,10,15,0,0,'each',true);
  perform public.receive_stock(loc,null,null,null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',4,'expiry_date','2028-01-01')));
  payload:=jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2));
  sale:=public.complete_sale(loc,'CARD_EFT',null,payload,false,null,req,'SLIP-123');
  if sale<>public.complete_sale(loc,'CARD_EFT',null,payload,false,null,req,'SLIP-123') then raise exception 'ASSERT sale retry returns same receipt'; end if;
  select quantity into q from public.stock where product_id=p and store_id=loc;
  if q<>2 then raise exception 'ASSERT card reduces stock once'; end if;
  select sum(quantity) into q from public.stock_batches where product_id=p;
  if q<>2 then raise exception 'ASSERT sale reduces expiry batches'; end if;
  if exists(select 1 from public.credit_transactions where business_id=biz) then raise exception 'ASSERT card creates no debt'; end if;
  if not exists(select 1 from public.goods_out where id=sale and sale_type='CARD_EFT' and payment_reference='SLIP-123' and total_amount=30) then raise exception 'ASSERT card reconciliation data'; end if;
  blocked:=false;
  begin perform public.complete_sale(loc,'CASH',null,payload,false,null,req,'SLIP-123'); exception when others then if sqlerrm<>'REQUEST_CONFLICT' then raise; end if; blocked:=true; end;
  if not blocked then raise exception 'ASSERT changed request rejected'; end if;
  blocked:=false;
  begin perform public.receive_stock(loc,null,null,null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1))); exception when others then if sqlerrm<>'EXPIRY_REQUIRED' then raise; end if; blocked:=true; end;
  if not blocked then raise exception 'ASSERT required expiry'; end if;
  if exists(select 1 from public.reconcile_stock(loc) where diff<>0) then raise exception 'ASSERT card reconciles'; end if;
  reset role; raise exception 'TESTS_PASSED';
end $$;
