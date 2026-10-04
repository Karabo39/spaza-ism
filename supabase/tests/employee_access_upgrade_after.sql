do $$
declare r record;new_user uuid:=gen_random_uuid();mid uuid;
begin
 if exists(select 1 from employee_upgrade_expected e where e.allowed is distinct from app.member_has_module(e.uid,e.store_id,e.key)) then raise exception 'ASSERT existing effective grants changed during migration';end if;
 select * into r from employee_upgrade_locations;
 if (select role from public.memberships where user_id=r.manager and business_id=r.b)<>'employee' then raise exception 'ASSERT manager not converted';end if;
 if not app.member_has_module(r.manager,r.s2,'cash_up_manage') or app.member_has_module(r.staff,r.s2,'cash_up_manage') then raise exception 'ASSERT approval grants conversion';end if;
 insert into auth.users(id,email,raw_user_meta_data) values(new_user,'upgrade-new@test.invalid','{}');
 mid:=public.add_member_by_email(r.b,'upgrade-new@test.invalid','employee');perform public.set_member_locations(mid,array[r.s]);
 if exists(select 1 from public.module_catalog c where app.member_has_module(new_user,r.s,c.key)) then raise exception 'ASSERT new employees inherit access';end if;
 begin update public.memberships set role='manager' where id=mid;raise exception 'ASSERT obsolete manager role accepted';exception when others then if sqlerrm<>'USE_OWNER_OR_EMPLOYEE' then raise;end if;end;
end $$;
