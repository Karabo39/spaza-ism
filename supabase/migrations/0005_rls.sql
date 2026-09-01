-- =====================================================================
-- 0005_rls.sql
-- Row Level Security. Principle:
--   * Members can SELECT their business/store data.
--   * Reference tables (products, customers, suppliers, categories,
--     barcodes, stock-take working rows) are writable by members.
--   * Stock/credit/transaction/ledger tables are SELECT-only for clients.
--     Their rows are written exclusively by SECURITY DEFINER RPCs (0006),
--     which run as the table owner and bypass RLS. This is the guarantee
--     that the frontend can never mutate stock or credit balances.
-- =====================================================================

-- Schema + helper execution access for API roles.
grant usage on schema app to anon, authenticated, service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;
alter default privileges in schema app grant execute on functions to anon, authenticated, service_role;

-- Does the current user share any business with p_user?
create or replace function app.shares_business(p_user uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.business_id = b.business_id
    where a.user_id = auth.uid() and a.is_active
      and b.user_id = p_user and b.is_active
  );
$$;

-- Enable RLS everywhere in public.
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','stores','profiles','memberships','categories','suppliers',
    'products','product_barcodes','price_history','stock','stock_batches',
    'stock_movements','goods_in','goods_in_items','customers','credit_accounts',
    'credit_transactions','goods_out','goods_out_items','stock_adjustments',
    'stock_takes','stock_take_items','supplier_invoices','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- Base privileges (RLS still governs row visibility on top of these).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------- businesses ----------------
drop policy if exists sel_businesses on public.businesses;
create policy sel_businesses on public.businesses for select to authenticated
  using (app.is_business_member(id));
drop policy if exists upd_businesses on public.businesses;
create policy upd_businesses on public.businesses for update to authenticated
  using (app.has_business_role(id,'owner')) with check (app.has_business_role(id,'owner'));

-- ---------------- stores ----------------
drop policy if exists sel_stores on public.stores;
create policy sel_stores on public.stores for select to authenticated
  using (app.is_business_member(business_id));
drop policy if exists ins_stores on public.stores;
create policy ins_stores on public.stores for insert to authenticated
  with check (app.has_business_role(business_id,'manager'));
drop policy if exists upd_stores on public.stores;
create policy upd_stores on public.stores for update to authenticated
  using (app.has_business_role(business_id,'manager'))
  with check (app.has_business_role(business_id,'manager'));

-- ---------------- profiles ----------------
drop policy if exists sel_profiles on public.profiles;
create policy sel_profiles on public.profiles for select to authenticated
  using (id = auth.uid() or app.shares_business(id));
drop policy if exists ins_profiles on public.profiles;
create policy ins_profiles on public.profiles for insert to authenticated
  with check (id = auth.uid());
drop policy if exists upd_profiles on public.profiles;
create policy upd_profiles on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------- memberships ----------------
drop policy if exists sel_memberships on public.memberships;
create policy sel_memberships on public.memberships for select to authenticated
  using (app.is_business_member(business_id));
drop policy if exists ins_memberships on public.memberships;
create policy ins_memberships on public.memberships for insert to authenticated
  with check (app.has_business_role(business_id,'owner'));
drop policy if exists upd_memberships on public.memberships;
create policy upd_memberships on public.memberships for update to authenticated
  using (app.has_business_role(business_id,'owner'))
  with check (app.has_business_role(business_id,'owner'));
drop policy if exists del_memberships on public.memberships;
create policy del_memberships on public.memberships for delete to authenticated
  using (app.has_business_role(business_id,'owner'));

-- ---------------- member-writable reference tables ----------------
-- categories
drop policy if exists sel_categories on public.categories;
create policy sel_categories on public.categories for select to authenticated
  using (app.is_business_member(business_id));
drop policy if exists ins_categories on public.categories;
create policy ins_categories on public.categories for insert to authenticated
  with check (app.is_business_member(business_id));
drop policy if exists upd_categories on public.categories;
create policy upd_categories on public.categories for update to authenticated
  using (app.is_business_member(business_id)) with check (app.is_business_member(business_id));

-- suppliers
drop policy if exists sel_suppliers on public.suppliers;
create policy sel_suppliers on public.suppliers for select to authenticated
  using (app.is_business_member(business_id));
drop policy if exists ins_suppliers on public.suppliers;
create policy ins_suppliers on public.suppliers for insert to authenticated
  with check (app.is_business_member(business_id));
drop policy if exists upd_suppliers on public.suppliers;
create policy upd_suppliers on public.suppliers for update to authenticated
  using (app.is_business_member(business_id)) with check (app.is_business_member(business_id));

-- products
drop policy if exists sel_products on public.products;
create policy sel_products on public.products for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists ins_products on public.products;
create policy ins_products on public.products for insert to authenticated
  with check (app.has_store_access(store_id));
drop policy if exists upd_products on public.products;
create policy upd_products on public.products for update to authenticated
  using (app.has_store_access(store_id)) with check (app.has_store_access(store_id));

-- product_barcodes
drop policy if exists sel_barcodes on public.product_barcodes;
create policy sel_barcodes on public.product_barcodes for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists ins_barcodes on public.product_barcodes;
create policy ins_barcodes on public.product_barcodes for insert to authenticated
  with check (app.has_store_access(store_id));
drop policy if exists upd_barcodes on public.product_barcodes;
create policy upd_barcodes on public.product_barcodes for update to authenticated
  using (app.has_store_access(store_id)) with check (app.has_store_access(store_id));

-- customers
drop policy if exists sel_customers on public.customers;
create policy sel_customers on public.customers for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists ins_customers on public.customers;
create policy ins_customers on public.customers for insert to authenticated
  with check (app.has_store_access(store_id));
drop policy if exists upd_customers on public.customers;
create policy upd_customers on public.customers for update to authenticated
  using (app.has_store_access(store_id)) with check (app.has_store_access(store_id));

-- supplier_invoices (member can record)
drop policy if exists sel_supplier_invoices on public.supplier_invoices;
create policy sel_supplier_invoices on public.supplier_invoices for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists ins_supplier_invoices on public.supplier_invoices;
create policy ins_supplier_invoices on public.supplier_invoices for insert to authenticated
  with check (app.has_store_access(store_id));

-- stock_takes + items are interactive working data (member writable);
-- finalization/approval is enforced inside the RPC.
drop policy if exists sel_stock_takes on public.stock_takes;
create policy sel_stock_takes on public.stock_takes for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists ins_stock_takes on public.stock_takes;
create policy ins_stock_takes on public.stock_takes for insert to authenticated
  with check (app.has_store_access(store_id));
drop policy if exists upd_stock_takes on public.stock_takes;
create policy upd_stock_takes on public.stock_takes for update to authenticated
  using (app.has_store_access(store_id)) with check (app.has_store_access(store_id));

drop policy if exists sel_stock_take_items on public.stock_take_items;
create policy sel_stock_take_items on public.stock_take_items for select to authenticated
  using (exists (select 1 from public.stock_takes st
    where st.id = stock_take_id and app.has_store_access(st.store_id)));
drop policy if exists ins_stock_take_items on public.stock_take_items;
create policy ins_stock_take_items on public.stock_take_items for insert to authenticated
  with check (exists (select 1 from public.stock_takes st
    where st.id = stock_take_id and app.has_store_access(st.store_id)));
drop policy if exists upd_stock_take_items on public.stock_take_items;
create policy upd_stock_take_items on public.stock_take_items for update to authenticated
  using (exists (select 1 from public.stock_takes st
    where st.id = stock_take_id and app.has_store_access(st.store_id)))
  with check (exists (select 1 from public.stock_takes st
    where st.id = stock_take_id and app.has_store_access(st.store_id)));

-- ---------------- SELECT-only tables (writes via RPC/trigger only) ------
-- price_history
drop policy if exists sel_price_history on public.price_history;
create policy sel_price_history on public.price_history for select to authenticated
  using (app.has_store_access(store_id));

-- stock
drop policy if exists sel_stock on public.stock;
create policy sel_stock on public.stock for select to authenticated
  using (app.has_store_access(store_id));

-- stock_batches
drop policy if exists sel_stock_batches on public.stock_batches;
create policy sel_stock_batches on public.stock_batches for select to authenticated
  using (app.has_store_access(store_id));

-- stock_movements
drop policy if exists sel_stock_movements on public.stock_movements;
create policy sel_stock_movements on public.stock_movements for select to authenticated
  using (app.has_store_access(store_id));

-- goods_in + items
drop policy if exists sel_goods_in on public.goods_in;
create policy sel_goods_in on public.goods_in for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists sel_goods_in_items on public.goods_in_items;
create policy sel_goods_in_items on public.goods_in_items for select to authenticated
  using (exists (select 1 from public.goods_in g
    where g.id = goods_in_id and app.has_store_access(g.store_id)));

-- goods_out + items
drop policy if exists sel_goods_out on public.goods_out;
create policy sel_goods_out on public.goods_out for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists sel_goods_out_items on public.goods_out_items;
create policy sel_goods_out_items on public.goods_out_items for select to authenticated
  using (exists (select 1 from public.goods_out g
    where g.id = goods_out_id and app.has_store_access(g.store_id)));

-- credit accounts + ledger
drop policy if exists sel_credit_accounts on public.credit_accounts;
create policy sel_credit_accounts on public.credit_accounts for select to authenticated
  using (app.has_store_access(store_id));
drop policy if exists sel_credit_transactions on public.credit_transactions;
create policy sel_credit_transactions on public.credit_transactions for select to authenticated
  using (app.has_store_access(store_id));

-- stock_adjustments
drop policy if exists sel_stock_adjustments on public.stock_adjustments;
create policy sel_stock_adjustments on public.stock_adjustments for select to authenticated
  using (app.has_store_access(store_id));

-- audit_logs (managers+ may review)
drop policy if exists sel_audit_logs on public.audit_logs;
create policy sel_audit_logs on public.audit_logs for select to authenticated
  using (app.has_business_role(business_id,'manager'));
