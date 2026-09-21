do $$
declare u uuid:=gen_random_uuid(); r jsonb; loc uuid; main uuid; pack uuid; shift uuid; sub uuid; day date:=(now() at time zone 'Africa/Johannesburg')::date;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'tracking-upgrade@test.invalid','{}');perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 r:=public.create_business('Tracking upgrade','Shop');loc:=(r->>'store_id')::uuid;
 main:=public.create_product(loc,'Upgrade main','UPGRADE-MAIN',null,null,2,3);
 pack:=public.create_bulk_product(loc,main,'Legacy cases',6,'CASE-LEGACY',null,12,18,gen_random_uuid());
 perform public.receive_stock(loc,null,null,null,jsonb_build_array(jsonb_build_object('product_id',pack,'quantity',3)));
 shift:=public.open_cash_up(loc,day,50);r:=public.cash_up_summary(loc,day);sub:=public.submit_cash_up(shift,50,'{}',r->>'count_token','',gen_random_uuid());perform public.review_cash_up(shift,sub,'APPROVE','');
 reset role;
end $$;
