create view public.v_return_report with(security_invoker=true) as
select r.id,r.business_id,r.store_id,r.reference,r.invoice_id,r.sale_id,r.customer_id,r.status,r.reason,r.inspection,r.created_at,r.amount,
  coalesce(items.description,'') items,coalesce(items.quantity,0) quantity,coalesce(items.actions,'') inventory_actions,
  coalesce(refunds.amount,0) refunded,coalesce(credits.amount,0) allocated_credit
from public.goods_returns r
left join lateral(select string_agg(i.quantity::text||' × '||i.product_name,'; ' order by i.product_name) description,sum(i.quantity) quantity,string_agg(distinct i.inventory_action,', ') actions from public.goods_return_items i where i.return_id=r.id) items on true
left join lateral(select sum(f.amount) amount from public.customer_refunds f where f.return_id=r.id) refunds on true
left join lateral(select sum(c.amount) amount from public.store_credit_allocations c where c.return_id=r.id) credits on true;
create view public.v_stock_take_variance with(security_invoker=true) as
select i.id,t.id stock_take_id,t.business_id,t.store_id,t.created_at,t.status,p.name product_name,i.product_id,i.system_qty,i.counted_qty,i.variance,i.counted,i.counted_at,i.counted_expiry,i.counted_by
from public.stock_take_items i join public.stock_takes t on t.id=i.stock_take_id join public.products p on p.id=i.product_id;
revoke all on public.v_return_report,public.v_stock_take_variance from public,anon;
grant select on public.v_return_report,public.v_stock_take_variance to authenticated;

-- Payment terms and actual receipts are separate filters: a credit invoice may
-- be settled by cash, Card/EFT, store credit, or a mixture of methods.
create view public.v_invoice_payment_report with(security_invoker=true) as
select b.*,array(select distinct e.method from public.invoice_entries e
  where e.invoice_id=b.id and e.kind='PAYMENT' and e.method is not null
  order by e.method) payment_methods
from public.v_invoice_balances b;
revoke all on public.v_invoice_payment_report from public,anon;
grant select on public.v_invoice_payment_report to authenticated;
