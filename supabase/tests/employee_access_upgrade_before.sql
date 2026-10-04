-- Run immediately before the explicit-permission migration, in a rollback transaction.
create temporary table employee_upgrade_locations(b uuid,s uuid,s2 uuid,staff uuid,manager uuid,owner_id uuid);
create temporary table employee_upgrade_expected(uid uuid,store_id uuid,key text,allowed boolean);
do $$
declare u uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); mgr uuid:=gen_random_uuid();b uuid;s uuid;s2 uuid;em uuid;mm uuid;result jsonb;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'upgrade-o@test.invalid','{}'),(e,'upgrade-e@test.invalid','{}'),(mgr,'upgrade-m@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 result:=public.create_business('Permission upgrade','First');b:=(result->>'business_id')::uuid;s:=(result->>'store_id')::uuid;s2:=public.create_location(b,'Second','store');
 em:=public.add_member_by_email(b,'upgrade-e@test.invalid','employee');mm:=public.add_member_by_email(b,'upgrade-m@test.invalid','manager');
 perform public.set_member_locations(em,array[s,s2]);perform public.set_member_locations(mm,array[s,s2]);
 perform public.set_store_module_access(mm,s,'{"goods_out":false,"orders_new":false,"settings":false}',0);
 perform public.set_store_module_access(em,s,'{"goods_out":true,"goods_out_change_price":true,"invoices":false}',0);
 insert into employee_upgrade_locations values(b,s,s2,e,mgr,u);
 insert into employee_upgrade_expected select who.uid,loc.id,c.key,app.member_has_module(who.uid,loc.id,c.key) from (values(u),(e),(mgr))who(uid) cross join (values(s),(s2))loc(id) cross join public.module_catalog c;
end $$;
