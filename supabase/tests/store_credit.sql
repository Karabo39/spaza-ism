do $$
declare u uuid:=gen_random_uuid(); biz uuid; loc uuid; c uuid; p uuid; res jsonb; oid uuid; original uuid; target uuid; line uuid; rid uuid; aid uuid; req uuid:=gen_random_uuid(); blocked boolean; bal numeric;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'allocation-owner@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  res:=public.create_business('Allocation test','Shop');biz:=(res->>'business_id')::uuid;loc:=(res->>'store_id')::uuid;
  insert into public.customers(business_id,store_id,name) values(biz,loc,'Credit allocation') returning id into c;
  p:=public.create_product(loc,'Soap','ALLOC-SOAP',null,null,5,10);perform public.receive_stock(loc,null,null,null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',5)));
  oid:=public.create_sales_order(loc,c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)),gen_random_uuid());perform public.process_sales_order(oid,'confirm');original:=public.create_sales_invoice(oid,current_date,'CASH');perform public.issue_sales_invoice(original);perform public.post_invoice_entry(original,'PAYMENT',10,gen_random_uuid(),'CASH');perform public.issue_invoice_goods(original);
  select id into line from public.sales_invoice_items where invoice_id=original;
  rid:=public.submit_goods_return('invoice',original,jsonb_build_array(jsonb_build_object('item_id',line,'quantity',1,'condition','GOOD','action','RETURN_TO_STOCK')),'Exchange','Checked',gen_random_uuid());perform public.process_goods_return(rid,true);
  oid:=public.create_sales_order(loc,c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2)),gen_random_uuid());perform public.process_sales_order(oid,'confirm');target:=public.create_sales_invoice(oid,current_date,'CASH');perform public.issue_sales_invoice(target);
  select balance into bal from public.credit_accounts where customer_id=c;
  if bal<>10 then raise exception 'ASSERT net customer debt before allocation'; end if;
  aid:=public.allocate_return_credit(rid,target,10,req);
  if aid<>public.allocate_return_credit(rid,target,10,req) then raise exception 'ASSERT allocation retry'; end if;
  if (select balance from public.credit_accounts where customer_id=c)<>bal then raise exception 'ASSERT allocation preserves net debt'; end if;
  if (select outstanding from public.v_invoice_balances where id=target)<>10 or (select outstanding from public.v_invoice_balances where id=original)<>0 then raise exception 'ASSERT both invoices reconcile'; end if;
  blocked:=false;begin perform public.allocate_return_credit(rid,target,1,gen_random_uuid());exception when others then if sqlerrm<>'CREDIT_EXCEEDS_AVAILABLE' then raise; end if;blocked:=true;end;
  if not blocked then raise exception 'ASSERT allocation capped'; end if;
  blocked:=false;begin perform public.record_customer_refund(rid,1,'CASH','Already allocated',gen_random_uuid());exception when others then if sqlerrm<>'REFUND_EXCEEDS_AVAILABLE_CREDIT' then raise; end if;blocked:=true;end;
  if not blocked then raise exception 'ASSERT allocated credit cannot refund'; end if;
  res:=public.invoice_summary(loc);if (res->>'outstanding')::numeric<>10 then raise exception 'ASSERT dashboard outstanding'; end if;
  res:=public.invoice_monthly_reconciliation(loc,current_date);
  if (res->>'closing')::numeric<>10 or (res->>'cash_received')::numeric<>10 or (res->>'store_credit_received')::numeric<>10 then raise exception 'ASSERT monthly reconciliation'; end if;
  if (res->>'opening')::numeric+(res->>'invoiced')::numeric+(res->>'debits')::numeric-(res->>'credit_notes')::numeric-(res->>'voided')::numeric-(res->>'cash_received')::numeric-(res->>'card_received')::numeric-(res->>'store_credit_received')::numeric<>(res->>'closing')::numeric then raise exception 'ASSERT reconciliation formula'; end if;
  reset role;raise exception 'TESTS_PASSED';
end $$;
