-- Both entry points lock order then invoice, so cancellation cannot race invoice
-- creation or leave the order confirmed after its invoice has been voided.
create or replace function public.cancel_sales_invoice(p_invoice uuid,p_reason text)
returns text language plpgsql security definer set search_path=public,app as $$
declare i public.sales_invoices%rowtype; eid uuid; nextstate text;
begin
  select * into i from public.sales_invoices where id=p_invoice;
  if not found or not app.has_store_role(i.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  perform 1 from public.sales_orders where id=i.order_id for update;
  select * into i from public.sales_invoices where id=p_invoice for update;
  nextstate:=i.state;
  if i.state not in ('CANCELLED','VOID') then
    if i.goods_issued_at is not null or exists(select 1 from public.invoice_entries where invoice_id=i.id and kind<>'ISSUE') then raise exception 'USE_CREDIT_NOTE_OR_RETURN'; end if;
    nextstate:=case when i.state='DRAFT' then 'CANCELLED' else 'VOID' end;
    if nextstate='VOID' then
      insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,reason,performed_by,request_id,request_payload)
        values(i.id,i.business_id,i.store_id,'VOID',i.total,p_reason,auth.uid(),gen_random_uuid(),'{}') returning id into eid;
      perform app.post_customer_entry(i.customer_id,-i.total,'ADJUSTMENT','invoice_entries',eid,'Void '||i.reference||': '||p_reason);
    end if;
    update public.sales_invoices set state=nextstate,cancellation_reason=p_reason where id=i.id;
    perform app.audit('invoice.cancel','sales_invoices',i.id,i.business_id,i.store_id,null,jsonb_build_object('reason',p_reason,'state',nextstate,'order',i.order_id));
  end if;
  update public.sales_orders set status='CANCELLED',cancellation_reason=p_reason where id=i.order_id and status<>'CANCELLED';
  if found then perform app.audit('order.cancel','sales_orders',i.order_id,i.business_id,i.store_id,null,jsonb_build_object('reason',p_reason,'invoice',i.id)); end if;
  return nextstate;
end $$;

create or replace function public.process_sales_order(p_order uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path=public,app as $$
declare o public.sales_orders%rowtype; invoice uuid;
begin
  select * into o from public.sales_orders where id=p_order for update;
  if not found or not app.has_store_access(o.store_id) then raise exception 'FORBIDDEN'; end if;
  if p_action='confirm' then
    if o.status='CONFIRMED' then return o.status; end if;
    if o.status<>'DRAFT' then raise exception 'INVALID_ORDER_STATE'; end if;
    update public.sales_orders set status='CONFIRMED',confirmed_at=now() where id=o.id;
  elsif p_action='cancel' then
    if o.status='CANCELLED' then return o.status; end if;
    if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
    select id into invoice from public.sales_invoices where order_id=o.id;
    if found then
      -- Reuses manager authorization, payment/goods checks and ledger reversal.
      perform public.cancel_sales_invoice(invoice,p_reason);
      return 'CANCELLED';
    end if;
    update public.sales_orders set status='CANCELLED',cancellation_reason=p_reason where id=o.id;
  else raise exception 'INVALID_ACTION'; end if;
  perform app.audit('order.'||p_action,'sales_orders',o.id,o.business_id,o.store_id,null,jsonb_build_object('reason',p_reason));
  return (select status from public.sales_orders where id=o.id);
end $$;

-- Invoker rights preserve the existing owner/assigned-manager audit policy.
create index if not exists idx_movements_reference_id on public.stock_movements(reference_id);
create view public.v_audit_activity with(security_invoker=true) as
select a.*,p.full_name actor_name,s.name location_name,
  coalesce(items.names,'') stock_items
from public.audit_logs a
left join public.profiles p on p.id=a.actor_id
left join public.stores s on s.id=a.store_id
left join lateral (
  select string_agg(distinct name,', ' order by name) names from (
    select product.name from public.stock_movements m join public.products product on product.id=m.product_id where m.reference_id=a.entity_id
    union select name from public.products where id=a.entity_id and a.entity_type in ('product','products')
    union select name from public.products where store_id=a.store_id and id::text in (a.after_data->>'product_id',a.after_data->>'pack',a.after_data->>'unit',a.before_data->>'product_id')
    union select product_name from public.goods_return_items where return_id=a.entity_id
    union select product_name from public.sales_invoice_items where invoice_id=a.entity_id
    union select product_name from public.sales_order_items where order_id=a.entity_id
    union select source_name||' → '||destination_name from public.stock_transfer_items where transfer_id=a.entity_id
    union select product.name from public.stock_take_items ti join public.products product on product.id=ti.product_id where ti.stock_take_id=a.entity_id and ti.counted
  ) names
) items on true;
revoke all on public.v_audit_activity from public,anon;
grant select on public.v_audit_activity to authenticated;
