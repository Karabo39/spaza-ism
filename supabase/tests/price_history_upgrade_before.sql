create temp table price_history_upgrade_fixture(product_id uuid,history_id uuid);
do $$ declare u uuid:=gen_random_uuid(); res jsonb; p uuid; hid uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'history-upgrade@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  res:=public.create_business('Historical shop','Shop');p:=public.create_product((res->>'store_id')::uuid,'Historical product','HIST-UPGRADE',null,null,5,10);
  update public.products set cost_price=7,selling_price=12 where id=p;
  select id into hid from public.price_history where product_id=p;
  reset role;insert into price_history_upgrade_fixture values(p,hid);
end $$;
