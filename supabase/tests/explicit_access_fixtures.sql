-- Test-only fixtures for older workflows. Permissions formerly implied by a role
-- are now explicitly assigned; production migrations never load this schema.
create schema if not exists app_test;
grant usage on schema app_test to authenticated;
create table if not exists app_test.member_roles(id uuid primary key, legacy_role text);
create or replace function app_test.permissions(p_role text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(key,minimum_role<>'owner' and (p_role='manager' or key not in ('products_manage','stock_take_approve','cash_up_manage','credit_manage','credit_override','invoices_manage','orders_approve','returns_manage','goods_in_cost','reports_financial','settings_manage','operations_approve','goods_out_receipt_settings','goods_out_override','check_stock_costs','adjust','imports','audit','settings','dashboard_adjust','warehouse_disable','dashboard_invoicing','invoices_summary','invoices_invoiced','invoices_paid','invoices_outstanding','invoices_overdue','invoices_credit_notes','invoices_month_to_date','warehouse','goods_in_new_stock','goods_in_receive_transfer','goods_out_change_price'))) from public.module_catalog;
$$;
create or replace function app_test.add_member_by_email(p_business uuid,p_email text,p_role text) returns uuid language plpgsql set search_path='' as $$
declare mid uuid;begin mid:=public.add_member_by_email(p_business,p_email,case when p_role='manager' then 'employee' else p_role end);insert into app_test.member_roles values(mid,p_role) on conflict(id) do update set legacy_role=excluded.legacy_role;return mid;end $$;
create or replace function app_test.set_member_locations(p_member uuid,p_stores uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin perform public.set_member_locations(p_member,p_stores);
 insert into public.store_module_access(membership_id,store_id,permissions,version)
 select p_member,sm.store_id,app_test.permissions(coalesce((select legacy_role from app_test.member_roles where id=p_member),'employee')),0
 from public.store_memberships sm where membership_id=p_member on conflict do nothing;
end $$;
create or replace function app_test.set_store_module_access(p_member uuid,p_store uuid,p_permissions jsonb,p_expected bigint) returns bigint language plpgsql security definer set search_path='' as $$
begin return public.set_store_module_access(p_member,p_store,coalesce((select permissions from public.store_module_access where membership_id=p_member and store_id=p_store),'{}')||p_permissions,p_expected);end $$;
create or replace function app_test.seed_assigned_user(p_user uuid,p_business uuid,p_legacy_role text default 'employee') returns void language plpgsql security definer set search_path='' as $$
begin insert into public.store_module_access(membership_id,store_id,permissions,version) select m.id,sm.store_id,app_test.permissions(p_legacy_role),0 from public.memberships m join public.store_memberships sm on sm.membership_id=m.id where m.user_id=p_user and m.business_id=p_business on conflict(membership_id,store_id) do update set permissions=excluded.permissions;end $$;
