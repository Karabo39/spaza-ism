-- =====================================================================
-- 0012_perf.sql
-- Performance-advisor remediations:
--  * Covering indexes on join/filter foreign keys used by RLS, reports
--    and cascades. (Pure user-audit FKs like performed_by/actor_id are
--    intentionally left unindexed — the app never joins on them.)
--  * Wrap direct auth.uid() in profiles policies as (select auth.uid())
--    so it is evaluated once per statement, not once per row.
-- (The "unused index" INFO notices reflect an empty database with no
--  query history; those indexes are on the app's real hot paths.)
-- =====================================================================

create index if not exists idx_credit_accounts_business on public.credit_accounts(business_id);
create index if not exists idx_credit_txn_business on public.credit_transactions(business_id);
create index if not exists idx_credit_txn_store on public.credit_transactions(store_id);
create index if not exists idx_customers_business on public.customers(business_id);
create index if not exists idx_goods_in_business on public.goods_in(business_id);
create index if not exists idx_goods_in_items_product on public.goods_in_items(product_id);
create index if not exists idx_goods_out_business on public.goods_out(business_id);
create index if not exists idx_goods_out_items_product on public.goods_out_items(product_id);
create index if not exists idx_price_history_store on public.price_history(store_id);
create index if not exists idx_products_supplier on public.products(default_supplier_id);
create index if not exists idx_adjustments_business on public.stock_adjustments(business_id);
create index if not exists idx_movements_business on public.stock_movements(business_id);
create index if not exists idx_stock_takes_business on public.stock_takes(business_id);
create index if not exists idx_stock_take_items_product on public.stock_take_items(product_id);
create index if not exists idx_supplier_invoices_business on public.supplier_invoices(business_id);
create index if not exists idx_supplier_invoices_store on public.supplier_invoices(store_id);
create index if not exists idx_supplier_invoices_goods_in on public.supplier_invoices(goods_in_id);
create index if not exists idx_audit_store on public.audit_logs(store_id);

-- profiles policies: evaluate auth.uid() once per statement.
drop policy if exists sel_profiles on public.profiles;
create policy sel_profiles on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app.shares_business(id));
drop policy if exists ins_profiles on public.profiles;
create policy ins_profiles on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists upd_profiles on public.profiles;
create policy upd_profiles on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
