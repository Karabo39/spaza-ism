-- =====================================================================
-- 0010_report_rpcs.sql
-- Aggregated sales summary powering fast/slow-moving reports.
-- =====================================================================
create or replace function public.product_sales_summary(
  p_store uuid, p_from date default null, p_to date default null)
returns table(product_id uuid, name text, sold_qty numeric, sold_value numeric, current_qty numeric)
language sql stable security definer set search_path = public, app as $$
  select p.id, p.name,
         coalesce(sales.q, 0) as sold_qty,
         coalesce(sales.v, 0) as sold_value,
         coalesce(st.quantity, 0) as current_qty
  from public.products p
  left join public.stock st on st.product_id = p.id and st.store_id = p_store
  left join (
    select goi.product_id, sum(goi.quantity) q, sum(goi.line_total) v
    from public.goods_out_items goi
    join public.goods_out go on go.id = goi.goods_out_id
    where go.store_id = p_store
      and (p_from is null or (go.created_at at time zone 'UTC')::date >= p_from)
      and (p_to is null or (go.created_at at time zone 'UTC')::date <= p_to)
    group by goi.product_id
  ) sales on sales.product_id = p.id
  where p.store_id = p_store and p.is_active and app.has_store_access(p_store);
$$;
grant execute on function public.product_sales_summary(uuid, date, date) to authenticated;
revoke execute on function public.product_sales_summary(uuid, date, date) from public, anon;
