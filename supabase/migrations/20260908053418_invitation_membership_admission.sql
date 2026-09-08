-- Membership creation now requires invitation acceptance. Keep the legacy
-- helper for trusted maintenance, but remove all browser execution rights.
revoke all on function public.add_member_by_email(uuid,text,text) from public,anon,authenticated;
revoke insert,update on public.memberships from public,anon,authenticated;
grant update(role,is_active) on public.memberships to authenticated;
drop policy if exists ins_memberships on public.memberships;
