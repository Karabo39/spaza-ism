-- =====================================================================
-- 0009_read_models.sql
-- Reporting read-models. Views use security_invoker so the caller's RLS
-- applies (they only ever see their own stores). Plus efficient summary
-- RPCs so pages don't pull whole tables into the browser.
-- =====================================================================

create or replace view public.v_product_stock
with (security_invoker = on) as
select
  p.id, p.business_id, p.store_id, p.name, p.sku, p.unit,
  p.cost_price, p.selling_price, p.min_stock_level, p.reorder_level,
  p.track_expiry, p.is_active, p.category_id, p.default_supplier_id,
  coalesce(s.quantity, 0) as quantity,
  round(coalesce(s.quantity, 0) * p.cost_price, 2) as stock_value,
  round(coalesce(s.quantity, 0) * p.selling_price, 2) as retail_value,
  c.name as category_name,
  sup.name as supplier_name,
  case
    when coalesce(s.quantity, 0) <= 0 then 'out'
    when coalesce(s.quantity, 0) <= p.min_stock_level then 'low'
    when coalesce(s.quantity, 0) <= p.reorder_level then 'reorder'
    else 'ok'
  end as stock_status,
  greatest(p.reorder_level - coalesce(s.quantity, 0), 0) as suggested_reorder
from public.products p
left join public.stock s on s.product_id = p.id and s.store_id = p.store_id
left join public.categories c on c.id = p.category_id
left join public.suppliers sup on sup.id = p.default_supplier_id;

grant select on public.v_product_stock to authenticated;

-- Credit customers with account + computed available credit.
create or replace view public.v_credit_customers
with (security_invoker = on) as
select
  cu.id as customer_id, cu.business_id, cu.store_id, cu.name, cu.phone, cu.email, cu.is_active,
  ca.id as credit_account_id, ca.credit_limit, ca.balance,
  greatest(ca.credit_limit - ca.balance, 0) as available_credit,
  (ca.balance > ca.credit_limit and ca.credit_limit > 0) as over_limit
from public.customers cu
join public.credit_accounts ca on ca.customer_id = cu.id;

grant select on public.v_credit_customers to authenticated;

-- Efficient dashboard counters in one round-trip.
create or replace function public.dashboard_summary(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare v jsonb;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'stock_value', coalesce((select sum(quantity * cost_price) from public.v_product_stock where store_id = p_store and is_active), 0),
    'retail_value', coalesce((select sum(quantity * selling_price) from public.v_product_stock where store_id = p_store and is_active), 0),
    'product_count', (select count(*) from public.products where store_id = p_store and is_active),
    'low_count', (select count(*) from public.v_product_stock where store_id = p_store and is_active and stock_status = 'low'),
    'out_count', (select count(*) from public.v_product_stock where store_id = p_store and is_active and stock_status = 'out'),
    'reorder_count', (select count(*) from public.v_product_stock where store_id = p_store and is_active and stock_status in ('low','out','reorder')),
    'outstanding_credit', coalesce((select sum(balance) from public.credit_accounts where store_id = p_store and balance > 0), 0),
    'credit_customers', (select count(*) from public.credit_accounts where store_id = p_store and balance > 0),
    'over_limit', (select count(*) from public.v_credit_customers where store_id = p_store and over_limit),
    'expiring_30', (select count(*) from public.stock_batches where store_id = p_store and quantity > 0 and expiry_date is not null and expiry_date <= current_date + 30 and expiry_date >= current_date),
    'expired', (select count(*) from public.stock_batches where store_id = p_store and quantity > 0 and expiry_date is not null and expiry_date < current_date)
  ) into v;
  return v;
end $$;
grant execute on function public.dashboard_summary(uuid) to authenticated;

-- Customer statement: full ledger with running balance (already stored).
create or replace function public.customer_statement(p_customer uuid)
returns table(id uuid, created_at timestamptz, txn_type app.credit_txn_type, amount numeric, balance_after numeric, note text)
language sql stable security definer set search_path = public, app as $$
  select ct.id, ct.created_at, ct.txn_type, ct.amount, ct.balance_after, ct.note
  from public.credit_transactions ct
  join public.credit_accounts ca on ca.id = ct.credit_account_id
  where ca.customer_id = p_customer and app.has_store_access(ca.store_id)
  order by ct.created_at;
$$;
grant execute on function public.customer_statement(uuid) to authenticated;
revoke execute on function public.dashboard_summary(uuid) from public, anon;
revoke execute on function public.customer_statement(uuid) from public, anon;
