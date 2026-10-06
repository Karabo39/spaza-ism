-- Notification documents now use bounded, report-specific rows rather than one text blob.
-- Bounded order-detail rows for scheduled Online Orders documents; summary recipients retain their report permission gate.
create function app_private.scheduled_online_order_rows(p_store uuid,p_from date,p_to date) returns jsonb
language sql stable security definer set search_path='' as $$
 with bounds as (select p_from::timestamp at time zone 'Africa/Johannesburg' lo,(p_to+1)::timestamp at time zone 'Africa/Johannesburg' hi), eligible as materialized (
  select o.order_id,o.created_at,o.total,o.payment_confirmed_at,o.status,o.fulfilment,so.reference,so.customer_name
  from public.online_orders o join public.sales_orders so on so.id=o.order_id,bounds
  where o.store_id=p_store and o.created_at>=lo and o.created_at<hi
 ), rows as (
  select e.reference order_number,e.customer_name customer,e.created_at order_date,
   coalesce((select left(string_agg(li.quantity::text||' x '||li.product_name,', ' order by li.id),1800) from public.sales_order_items li where li.order_id=e.order_id),'') items,
   e.total,case when e.payment_confirmed_at is null then 'Unpaid' else 'Paid' end payment_status,
   case when so.status='CANCELLED' then 'Cancelled' else replace(e.status,'_',' ') end order_status
  from eligible e join public.sales_orders so on so.id=e.order_id order by e.created_at desc,e.order_id limit 100
 ) select jsonb_build_object('count',(select count(*) from eligible),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from rows r),'[]'))
$$;
revoke all on function app_private.scheduled_online_order_rows(uuid,date,date) from public,anon,authenticated;

create or replace function app_private.scheduled_report_data(p_store uuid,p_kind text,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare body jsonb;start_at timestamptz:=p_from::timestamp at time zone 'Africa/Johannesburg';end_at timestamptz:=(p_to+1)::timestamp at time zone 'Africa/Johannesburg';
begin
 if p_kind='ONLINE_ORDERS' then body:=app_private.online_report(p_store,p_from,p_to)||app_private.scheduled_online_order_rows(p_store,p_from,p_to); return body;end if;
 if p_kind in ('LOW_STOCK','OUT_OF_STOCK') then
  with stock_levels as materialized (
   select p.id,p.name product,p.sku,app_private.online_available(p.id) quantity,p.min_stock_level,p.reorder_level,st.name store
   from public.products p join public.stores st on st.id=p.store_id where p.store_id=p_store and p.is_active and p.tracking_type<>'SALES_ONLY'
  ), eligible as (select * from stock_levels where case when p_kind='OUT_OF_STOCK' then quantity<=0 else quantity<=greatest(min_stock_level,reorder_level) end)
  select jsonb_build_object('count',count(*),'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select product,sku,quantity,min_stock_level,reorder_level,store from eligible order by product,id limit 100)x)) into body from eligible;
 elsif p_kind in ('OUTSTANDING_PAYMENTS','OVERDUE_INVOICES') then
  with invoices as materialized (
   select i.reference,i.customer_name customer,coalesce(i.invoice_date,i.issued_at::date) invoice_date,i.due_date,i.total,
    greatest(0,(now() at time zone 'Africa/Johannesburg')::date-i.due_date) days_overdue,b.paid,b.outstanding,b.status
   from public.sales_invoices i join public.v_invoice_balances b on b.id=i.id where i.store_id=p_store and i.state='ISSUED'
  ),eligible as (select * from invoices where outstanding>0 and (p_kind='OUTSTANDING_PAYMENTS' or due_date<(now() at time zone 'Africa/Johannesburg')::date))
  select jsonb_build_object('count',count(*),'metrics',jsonb_build_object('outstanding',coalesce(sum(outstanding),0)),'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select customer,reference,invoice_date,due_date,total,paid,outstanding,status,days_overdue from eligible order by due_date,reference limit 100)x)) into body from eligible;
 elsif p_kind='STOCK_MOVEMENTS' then
  with movement as (
   select m.product_id,
    coalesce(sum(m.quantity_delta) filter(where m.movement_type='GOODS_IN'),0) stock_received,
    -coalesce(sum(m.quantity_delta) filter(where m.movement_type in ('SALE_CASH','SALE_CREDIT')),0) stock_sold,
    coalesce(sum(abs(m.quantity_delta)) filter(where m.movement_type in ('TRANSFER_IN','TRANSFER_OUT')),0) stock_transferred,
    coalesce(sum(m.quantity_delta) filter(where m.movement_type in ('ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE','STOCK_TAKE','DAMAGED','EXPIRED')),0) stock_adjusted,
    coalesce(sum(m.quantity_delta) filter(where m.movement_type='RETURN_IN'),0) stock_returned
   from public.stock_movements m where m.store_id=p_store and m.created_at>=start_at and m.created_at<end_at group by m.product_id
  ), rows as (
   select p.id,p.name product,p.sku,coalesce(m.stock_received,0) stock_received,coalesce(m.stock_sold,0) stock_sold,
    coalesce(m.stock_transferred,0) stock_transferred,coalesce(m.stock_adjusted,0) stock_adjusted,coalesce(m.stock_returned,0) stock_returned,coalesce(st.quantity,0) closing_stock
   from movement m join public.products p on p.id=m.product_id left join public.stock st on st.product_id=p.id and st.store_id=p_store
   where p.store_id=p_store and (m.stock_received<>0 or m.stock_sold<>0 or m.stock_transferred<>0 or m.stock_adjusted<>0 or m.stock_returned<>0)
  ) select jsonb_build_object('count',(select count(*) from rows),'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select product,sku,stock_received,stock_sold,stock_transferred,stock_adjusted,stock_returned,closing_stock from rows order by product,id limit 100)x)) into body;
 elsif p_kind='MOVING_PRODUCTS' then
  with sales as (
   select li.product_id,li.quantity,li.line_total value from public.goods_out_items li join public.goods_out g on g.id=li.goods_out_id where g.store_id=p_store and g.created_at>=start_at and g.created_at<end_at
   union all select li.product_id,li.quantity,li.net_total from public.sales_invoice_items li join public.sales_invoices i on i.id=li.invoice_id where i.store_id=p_store and i.goods_issued_at>=start_at and i.goods_issued_at<end_at
  ),products as (select p.id,p.name product,p.sku,coalesce(sum(s.quantity),0) quantity,coalesce(sum(s.value),0) value from public.products p left join sales s on s.product_id=p.id where p.store_id=p_store and p.is_active group by p.id),
  rows as ((select 'Top products' category,product,sku,quantity,value from products order by quantity desc,id limit 5) union all (select 'Slow products' category,product,sku,quantity,value from products order by quantity,id limit 5))
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(r)),'[]'),'count',count(*)) into body from rows r;
 elsif p_kind='CASH_UP' then
  select jsonb_build_object('count',count(*),'metrics',jsonb_build_object('expected_cash',coalesce(sum(s.expected),0),'actual_cash',coalesce(sum(s.counted),0),'variance',coalesce(sum(s.variance),0),'card_eft',(select coalesce(sum(amount),0) from (select sp.amount from public.sale_payments sp join public.goods_out g on g.id=sp.sale_id where g.store_id=p_store and g.created_at>=start_at and g.created_at<end_at and sp.method in ('CARD','EFT') union all select amount from public.invoice_entries where store_id=p_store and created_at>=start_at and created_at<end_at and kind='PAYMENT' and method='CARD_EFT')x),'refunds',(select coalesce(sum(amount),0) from public.customer_refunds where store_id=p_store and created_at>=start_at and created_at<end_at)),'rows',coalesce(jsonb_agg(jsonb_build_object('date',c.business_date,'shift',c.shift_number,'status',c.status,'expected',s.expected,'actual',s.counted,'variance',s.variance)),'[]')) into body from public.cash_ups c join public.cash_up_submissions s on s.id=c.latest_submission where c.store_id=p_store and c.business_date between p_from and p_to;
 elsif p_kind='UPCOMING_EXPIRY' then
  select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into body from (select p.name,b.quantity,b.expiry_date from public.stock_batches b join public.products p on p.id=b.product_id where b.store_id=p_store and b.quantity>0 and b.expiry_date between p_to and p_to+30 order by b.expiry_date,b.id limit 100)x;
 elsif p_kind='STOCK_TAKE_COMPLETED' then
  select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into body from (select id,completed_at,note from public.stock_takes where store_id=p_store and status='COMPLETED' and completed_at>=start_at and completed_at<end_at order by completed_at limit 100)x;
 else
  select jsonb_build_object('sales',coalesce(sum(total_amount),0),'credit_sales',coalesce(sum(total_amount) filter(where sale_type='CREDIT'),0),'transactions',count(*)) into body from public.goods_out where store_id=p_store and created_at>=start_at and created_at<end_at;
  body:=body||jsonb_build_object('invoiced', (select coalesce(sum(amount) filter(where kind in ('ISSUE','DEBIT_NOTE')),0) from public.invoice_entries where store_id=p_store and created_at>=start_at and created_at<end_at),
   'cash',(select coalesce(sum(amount),0) from (select sp.amount from public.sale_payments sp join public.goods_out g on g.id=sp.sale_id where g.store_id=p_store and g.created_at>=start_at and g.created_at<end_at and sp.method='CASH' union all select amount from public.invoice_entries where store_id=p_store and created_at>=start_at and created_at<end_at and kind='PAYMENT' and method='CASH')x),
   'card_eft',(select coalesce(sum(amount),0) from (select sp.amount from public.sale_payments sp join public.goods_out g on g.id=sp.sale_id where g.store_id=p_store and g.created_at>=start_at and g.created_at<end_at and sp.method in ('CARD','EFT') union all select amount from public.invoice_entries where store_id=p_store and created_at>=start_at and created_at<end_at and kind='PAYMENT' and method='CARD_EFT')x),
   'refunds',(select coalesce(sum(amount),0) from public.customer_refunds where store_id=p_store and created_at>=start_at and created_at<end_at),
   'discounts',(select coalesce(sum(value),0) from (select discount value from public.sales_invoices where store_id=p_store and created_at>=start_at and created_at<end_at union all select coalesce((snapshot->>'discount')::numeric,0) from public.sale_receipts where store_id=p_store and created_at>=start_at and created_at<end_at)x),
   'orders',(select count(*) from public.sales_orders where store_id=p_store and created_at>=start_at and created_at<end_at));
  body:=body||app_private.report_payments(p_store,p_from,p_to)||jsonb_build_object('invoice_credit_sales',(select coalesce(sum(total),0) from public.sales_invoices where store_id=p_store and terms='CREDIT' and issued_at>=start_at and issued_at<end_at),'recorded_cash_removals',(select coalesce(sum(amount),0) from public.cash_drawer_movements where store_id=p_store and kind='REMOVE' and created_at>=start_at and created_at<end_at));
  if p_kind='BUSINESS_PERFORMANCE' then body:=body||app.profit_data(p_store,p_from,p_to)||jsonb_build_object('recorded_supplier_purchases',(select coalesce(sum(total_cost),0) from public.goods_in where store_id=p_store and created_at>=start_at and created_at<end_at),'previous_period',app.profit_data(p_store,p_from-(p_to-p_from+1),p_from-1));end if;
  body:=body||jsonb_build_object('total_sales',coalesce((body->>'sales')::numeric,0)+case when p_kind='BUSINESS_PERFORMANCE' then 0 else coalesce((body->>'invoiced')::numeric,0) end);
  body:=jsonb_build_object('metrics',body,'count',1);
 end if;
 if p_kind='CASH_UP' then body:=jsonb_set(body,'{metrics}',(body->'metrics')||app_private.report_payments(p_store,p_from,p_to));end if;
 return coalesce(body,'{}')||jsonb_build_object('from',p_from,'to',p_to);
end $$;
revoke all on function app_private.scheduled_report_data(uuid,text,date,date) from public,anon,authenticated;
