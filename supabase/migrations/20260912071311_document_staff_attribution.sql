-- Names are captured at creation. Older rows explicitly remain unrecorded.
alter table public.sales_orders add column ordered_by_name text;
alter table public.sales_invoices add column invoiced_by_name text, add column ordered_by_name text;
create function app.capture_document_staff() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.created_by is distinct from old.created_by or new.ordered_by_name is distinct from old.ordered_by_name then raise exception 'IMMUTABLE_DOCUMENT_STAFF';end if;
  if tg_table_name='sales_invoices' then
   if new.invoiced_by_name is distinct from old.invoiced_by_name then raise exception 'IMMUTABLE_DOCUMENT_STAFF';end if;
  end if;
  return new;
 end if;
 if new.created_by is distinct from auth.uid() or auth.uid() is null then raise exception 'FORBIDDEN';end if;
 if tg_table_name='sales_orders' then
  new.ordered_by_name:=coalesce(nullif((select full_name from public.profiles where id=auth.uid()),''),'Team member');
 else
  new.invoiced_by_name:=coalesce(nullif((select full_name from public.profiles where id=auth.uid()),''),'Team member');
  new.ordered_by_name:=(select ordered_by_name from public.sales_orders where id=new.order_id);
 end if;
 return new;
end $$;
revoke all on function app.capture_document_staff() from public,anon,authenticated;
create trigger document_staff before insert or update on public.sales_orders for each row execute function app.capture_document_staff();
create trigger document_staff before insert or update on public.sales_invoices for each row execute function app.capture_document_staff();

create or replace view public.v_invoice_balances with (security_invoker=true) as  SELECT i.id,
    i.business_id,
    i.store_id,
    i.order_id,
    i.customer_id,
    i.customer_name,
    i.business_name,
    i.store_name,
    i.currency,
    i.salesperson,
    i.created_by,
    i.reference,
    i.state,
    i.terms,
    i.subtotal,
    i.discount,
    i.tax_percent,
    i.tax_amount,
    i.total,
    i.due_date,
    i.note,
    i.cancellation_reason,
    i.created_at,
    i.issued_at,
    i.goods_issued_at,
    i.goods_issued_by,
    i.authorized_by,
    COALESCE(e.debits, 0::numeric) AS debits,
    COALESCE(e.credits, 0::numeric) AS credits,
    COALESCE(e.paid, 0::numeric) AS paid,
        CASE
            WHEN i.state = 'ISSUED'::text THEN i.total + COALESCE(e.debits, 0::numeric) - COALESCE(e.credits, 0::numeric) - COALESCE(e.paid, 0::numeric)
            ELSE 0::numeric
        END AS outstanding,
        CASE
            WHEN i.state <> 'ISSUED'::text THEN i.state
            WHEN COALESCE(e.credits, 0::numeric) >= (i.total + COALESCE(e.debits, 0::numeric)) AND COALESCE(e.credits, 0::numeric) > 0::numeric THEN 'CREDITED'::text
            WHEN (i.total + COALESCE(e.debits, 0::numeric) - COALESCE(e.credits, 0::numeric) - COALESCE(e.paid, 0::numeric)) <= 0::numeric THEN 'PAID'::text
            WHEN i.due_date < (now() AT TIME ZONE 'Africa/Johannesburg'::text)::date THEN 'OVERDUE'::text
            WHEN COALESCE(e.paid, 0::numeric) > 0::numeric THEN 'PARTIALLY_PAID'::text
            ELSE 'UNPAID'::text
        END AS status,
    i.ordered_by_name, i.invoiced_by_name
   FROM sales_invoices i
     LEFT JOIN LATERAL ( SELECT sum(invoice_entries.amount) FILTER (WHERE invoice_entries.kind = 'DEBIT_NOTE'::text) AS debits,
            sum(invoice_entries.amount) FILTER (WHERE invoice_entries.kind = 'CREDIT_NOTE'::text) AS credits,
            sum(invoice_entries.amount) FILTER (WHERE invoice_entries.kind = 'PAYMENT'::text) AS paid
           FROM invoice_entries
          WHERE invoice_entries.invoice_id = i.id) e ON true;
create or replace view public.v_invoice_payment_report with (security_invoker=true) as  SELECT id,
    business_id,
    store_id,
    order_id,
    customer_id,
    customer_name,
    business_name,
    store_name,
    currency,
    salesperson,
    created_by,
    reference,
    state,
    terms,
    subtotal,
    discount,
    tax_percent,
    tax_amount,
    total,
    due_date,
    note,
    cancellation_reason,
    created_at,
    issued_at,
    goods_issued_at,
    goods_issued_by,
    authorized_by,
    debits,
    credits,
    paid,
    outstanding,
    status,
    ARRAY( SELECT DISTINCT e.method
           FROM invoice_entries e
          WHERE e.invoice_id = b.id AND e.kind = 'PAYMENT'::text AND e.method IS NOT NULL
          ORDER BY e.method) AS payment_methods,
    b.ordered_by_name, b.invoiced_by_name
   FROM v_invoice_balances b;
CREATE OR REPLACE FUNCTION public.order_workflow_summary(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
begin perform app.require_module(p_store,array['orders_recent']);
  perform app.require_module(p_store,array['orders']);
  return coalesce((select jsonb_agg(row_data order by created_at desc,id desc) from (
    select o.id,o.created_at,to_jsonb(o) || jsonb_build_object(
      'status',case when o.status='CANCELLED' then 'CANCELLED'
        when i.state='ISSUED' and i.goods_issued_at is not null and i.outstanding<=0 then 'COMPLETED'
        when i.state='ISSUED' and i.goods_issued_at is not null then 'AWAITING_PAYMENT'
        when i.state='ISSUED' and i.outstanding<=0 then 'READY_FOR_COLLECTION'
        when i.id is not null then 'INVOICED' else o.status end,
      'can_cancel',o.status<>'CANCELLED' and (i.id is null or
        (i.state in ('DRAFT','ISSUED') and i.goods_issued_at is null and not exists(
          select 1 from public.invoice_entries e where e.invoice_id=i.id and e.kind<>'ISSUE'))),
      'invoice',case when i.id is null then null else jsonb_build_object(
        'invoiced_by_name',i.invoiced_by_name,'id',i.id,'reference',i.reference,'state',i.state,'status',i.status,
        'total',i.total,'paid',i.paid,'credits',i.credits,'outstanding',i.outstanding,
        'goods_issued_at',i.goods_issued_at,'terms',i.terms) end) as row_data
    from (select * from public.sales_orders where store_id=p_store
      order by created_at desc,id desc limit 200) o
    left join public.v_invoice_balances i on i.order_id=o.id and i.store_id=p_store
  ) summary),'[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.app_schema_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object('checkout_receipts_v1',to_regprocedure('public.complete_checkout(uuid,jsonb,jsonb,uuid,uuid,boolean,boolean,uuid,text)') is not null,'document_staff_v1',exists(select 1 from pg_attribute where attrelid='public.sales_invoices'::regclass and attname='invoiced_by_name'),'detailed_permissions_v1',exists(select 1 from pg_attribute where attrelid=to_regclass('public.module_catalog') and attname='parent_key' and not attisdropped),'product_description_v1',to_regprocedure('public.create_product_with_description(uuid,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,boolean,text)') is not null,
    'store_currency_v1', to_regprocedure('public.set_store_currency(uuid,text)') is not null and to_regprocedure('public.create_order_with_contact(uuid,uuid,jsonb,uuid,text,jsonb)') is not null,
    'document_email_v1', to_regprocedure('public.prepare_document_email(text,uuid,uuid,text,text)') is not null,
    'invoice_refinements_v1', to_regprocedure('public.returnable_documents(uuid,text)') is not null and to_regprocedure('public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint,jsonb)') is not null and to_regprocedure('public.use_invoice_customer_credit(uuid,uuid)') is not null,
    'cash_shifts_v1', to_regprocedure('public.start_next_cash_shift(uuid,numeric,text,uuid)') is not null,
    'batch_expiry_v1', to_regprocedure('app.take_sellable_batches(uuid,uuid,numeric)') is not null and to_regclass('public.v_product_catalog') is not null,
    'employee_invitations_v1', to_regprocedure('public.accept_employee_invitation(uuid,text,text,text,text)') is not null and to_regprocedure('public.my_employee_setup()') is not null,
    'document_workflows_v1', to_regprocedure('public.convert_quote(uuid,jsonb,bigint)') is not null and to_regprocedure('public.return_refund_summary(uuid)') is not null and to_regprocedure('public.stock_export(uuid,text,text)') is not null and to_regprocedure('public.download_purchase_order(uuid)') is not null,
    'order_workflow_v1', to_regprocedure('public.order_workflow_summary(uuid)') is not null,
    'brd_v102', to_regprocedure('public.invoice_summary(uuid)') is not null
      and exists(select 1 from pg_attribute where attrelid=to_regclass('public.stores') and attname='location_type' and not attisdropped),
    'module_access_v1', to_regprocedure('public.my_module_access(uuid)') is not null
      and to_regprocedure('public.set_store_module_access(uuid,uuid,jsonb,bigint)') is not null,
    'cash_up_v1', to_regprocedure('public.cash_up_summary(uuid,date)') is not null
      and to_regprocedure('public.submit_cash_up(uuid,numeric,jsonb,text,text,uuid)') is not null
  ));
$function$
;
