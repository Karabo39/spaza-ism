do $$
declare u uuid:=gen_random_uuid(); biz uuid; loc uuid; p uuid; res jsonb; sold numeric;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'report-history-owner@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  res:=public.create_business('History test','Shop');biz:=(res->>'business_id')::uuid;loc:=(res->>'store_id')::uuid;
  p:=public.create_product(loc,'Soap','HISTORY-SOAP',null,null,5,10);perform public.receive_stock(loc,null,null,null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',3,'unit_cost',5)));
  perform public.complete_sale(loc,'CASH',null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)));
  update public.products set cost_price=50,selling_price=60 where id=p;
  if (select count(*) from public.product_price_history where product_id=p)<>2 then raise exception 'ASSERT price creation and change recorded';end if;
  res:=public.profit_summary(loc,current_date,current_date);
  if (res->>'gross_profit')::numeric<>5 or (res->>'estimated_cost_movements')::numeric<>0 then raise exception 'ASSERT sale uses original cost snapshot, got %',res;end if;
  select sold_qty into sold from public.product_sales_summary(loc,current_date,current_date) where product_id=p;
  if sold<>1 then raise exception 'ASSERT sales summary quantity';end if;
  reset role;raise exception 'TESTS_PASSED';
end $$;
