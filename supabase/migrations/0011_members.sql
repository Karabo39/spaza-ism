-- =====================================================================
-- 0011_members.sql
-- Owner-only: add an existing user to the business by their email.
-- (The invitee must already have an account.) Role changes and
-- activation are done via direct memberships UPDATE (owner RLS policy).
-- =====================================================================
create or replace function public.add_member_by_email(p_business uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = public, app, auth as $$
declare v_uid uuid; v_mid uuid; v_role app.membership_role;
begin
  if not app.has_business_role(p_business, 'owner') then raise exception 'FORBIDDEN'; end if;
  v_role := lower(p_role)::app.membership_role;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_uid is null then raise exception 'USER_NOT_FOUND: no account exists for that email'; end if;

  insert into public.memberships (business_id, user_id, role, is_active)
  values (p_business, v_uid, v_role, true)
  on conflict (business_id, user_id)
    do update set role = excluded.role, is_active = true
  returning id into v_mid;

  perform app.audit('member.add','membership',v_mid,p_business,null,null,
    jsonb_build_object('email',p_email,'role',v_role));
  return v_mid;
end $$;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;
revoke execute on function public.add_member_by_email(uuid, text, text) from public, anon;
