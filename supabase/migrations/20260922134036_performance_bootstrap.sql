-- One RLS-enforced read for page bootstrap. Never cache permissions across requests.
create function public.session_bootstrap() returns jsonb
language sql stable security invoker set search_path='' as $$
 with member_rows as materialized (
   select m.id,m.business_id,m.role,b.name business_name,b.currency
   from public.memberships m join public.businesses b on b.id=m.business_id
   where m.user_id=(select auth.uid()) and m.is_active
 ), payload as (
   select jsonb_build_object(
     'setup_required',coalesce((public.my_employee_setup()->>'required')::boolean,false),
     'full_name',(select full_name from public.profiles where id=(select auth.uid())),
     'has_membership',exists(select 1 from member_rows),
     'stores',coalesce((select jsonb_agg(jsonb_build_object(
       'id',s.id,'name',s.name,'business_id',s.business_id,'business_name',m.business_name,
       'role',m.role,'currency',coalesce(s.currency,m.currency),'location_type',s.location_type,
       'permissions',g.permissions) order by s.location_type,s.name,s.id)
       from public.stores s join member_rows m on m.business_id=s.business_id
       left join public.store_module_access g on g.membership_id=m.id and g.store_id=s.id
       where s.is_active),'[]'::jsonb)
   ) value
 ) select value||jsonb_build_object('revision',md5(value::text)) from payload
 where (select auth.uid()) is not null;
$$;
revoke all on function public.session_bootstrap() from public,anon;
grant execute on function public.session_bootstrap() to authenticated;

-- Lightweight change detection avoids rerendering the current page every minute.
create function public.session_access_revision() returns text
language sql stable security invoker set search_path='' as $$
 select public.session_bootstrap()->>'revision';
$$;
revoke all on function public.session_access_revision() from public,anon;
grant execute on function public.session_access_revision() to authenticated;
