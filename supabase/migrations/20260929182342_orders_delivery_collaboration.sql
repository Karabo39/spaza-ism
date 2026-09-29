-- Created deliveries are operational drafts, not authority to release stock.
alter table public.order_deliveries drop constraint order_deliveries_status_check;
alter table public.order_deliveries add constraint order_deliveries_status_check check(status in ('CREATED','PENDING','OUT_FOR_DELIVERY','FAILED','RESCHEDULED','DELIVERED','CANCELLED'));
alter table public.order_deliveries alter column original_date drop not null;
alter table public.order_deliveries alter column scheduled_date drop not null;
alter table public.sales_invoices add column revision integer not null default 0;

CREATE OR REPLACE FUNCTION app_private.ensure_delivery(p_invoice uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i public.v_invoice_balances%rowtype;o public.sales_orders%rowtype;b public.businesses%rowtype;c public.customers%rowtype;s public.stores%rowtype;did uuid;doc jsonb;
begin
 if not exists(select 1 from public.sales_invoices inv join public.sales_orders ord on ord.id=inv.order_id where inv.id=p_invoice and ord.delivery_required and ord.status<>'CANCELLED') then return null;end if;
 select * into i from public.v_invoice_balances where id=p_invoice;
 select * into o from public.sales_orders where id=i.order_id;
 if not o.delivery_required or o.status='CANCELLED' or i.state in ('CANCELLED','VOID') or (coalesce(o.delivery_details->>'auto_created','false')<>'true' and i.status<>'PAID') or i.credits>0 then return null;end if;
 select id into did from public.order_deliveries where invoice_id=i.id;if did is not null then return did;end if;
 select * into b from public.businesses where id=i.business_id;
 select * into s from public.stores where id=i.store_id;
 select * into c from public.customers where id=i.customer_id;
 doc:=jsonb_build_object('business_name',i.business_name,'business_address',coalesce(b.document_address,s.address,''),
 'business_phone',coalesce(b.document_phone,''),'business_email',coalesce(b.document_email,''),'store_name',s.name,
 'order_id',o.id,'order_reference',o.reference,'invoice_reference',i.reference,'customer_id',c.id,'customer_name',i.customer_name,
 'company_name',case when c.customer_type='BUSINESS' then c.name else '' end,'customer_code',c.id,
 'delivery_address',coalesce(o.delivery_details->>'address',c.address,''),'contact_number',coalesce(o.delivery_details->>'phone',c.phone,''),
 'items',(select jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'description',l.product_name,'sku',p.sku,'barcode',(select barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,barcode limit 1),
 'unit',l.unit,'ordered_quantity',l.quantity,'delivery_quantity',l.quantity,'remarks','') order by l.id) from public.sales_invoice_items l join public.products p on p.id=l.product_id where l.invoice_id=i.id));
 insert into public.order_deliveries(invoice_id,business_id,store_id,original_date,scheduled_date,snapshot,comments,status)
 values(i.id,i.business_id,i.store_id,(o.delivery_details->>'date')::date,(o.delivery_details->>'date')::date,doc,o.delivery_details->>'notes',case when o.delivery_details->>'auto_created'='true' then 'CREATED' else 'PENDING' end)
 on conflict(invoice_id) do nothing returning id into did;
 if did is not null then perform app_private.delivery_event(did,'generated',null,jsonb_build_object('status',(select status from public.order_deliveries where id=did),'date',o.delivery_details->>'date'),o.delivery_details->>'notes');end if;
 return coalesce(did,(select id from public.order_deliveries where invoice_id=i.id));
end $function$;

create function public.create_delivery_invoice(p_order uuid,p_due date,p_discount numeric default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.sales_orders%rowtype; iid uuid;
begin
 perform app.require_module((select store_id from public.sales_orders where id=p_order),array['invoices','invoices_create_from_order']);
 select * into o from public.sales_orders where id=p_order for update;
 if o.id is null or o.status<>'CONFIRMED' then raise exception 'ORDER_NOT_CONFIRMED';end if;
 if exists(select 1 from public.sales_invoices where order_id=o.id) and coalesce(o.delivery_details->>'auto_created','false')<>'true' then raise exception 'REQUEST_CONFLICT';end if;
 update public.sales_orders set delivery_required=true,delivery_details=delivery_details||jsonb_build_object('auto_created',true),delivery_version=delivery_version+case when delivery_details->>'auto_created'='true' then 0 else 1 end where id=o.id;
 iid:=app_private.create_sales_invoice(p_order,p_due,'CASH',p_discount,null);
 perform app_private.ensure_delivery(iid);
 return iid;
end $$;
revoke all on function public.create_delivery_invoice(uuid,date,numeric) from public,anon;
grant execute on function public.create_delivery_invoice(uuid,date,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.delivery_page(p_store uuid, p_queue text DEFAULT 'all'::text, p_date date DEFAULT NULL::date, p_after bigint DEFAULT NULL::bigint, p_customer uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare today date;
begin
 if not app.has_module(p_store,'orders_deliveries') then raise exception 'FORBIDDEN';end if;
 if p_queue not in ('created','current','scheduled','completed','cancelled','all') then raise exception 'INVALID_DELIVERY_QUEUE';end if;
 select (now() at time zone timezone)::date into today from public.stores where id=p_store;
 -- Page base delivery rows without loading item snapshots or history.
 return (select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by x.sequence desc),'[]'::jsonb)) from (
 select d.id,d.sequence,d.reference,case when d.status='PENDING' and d.scheduled_date>today then 'SCHEDULED' else d.status end as status,d.scheduled_date,d.original_date,d.version,d.driver_name,d.cancellation_reason,d.cancelled_at,
 i.order_id,d.snapshot->>'order_reference' as order_reference,d.snapshot->>'customer_name' as customer_name,
 d.snapshot->>'contact_number' as contact_number,d.snapshot->>'delivery_address' as delivery_address
 from public.order_deliveries d join public.sales_invoices i on i.id=d.invoice_id
 where d.store_id=p_store and (p_after is null or d.sequence<p_after) and (p_date is null or d.scheduled_date=p_date)
 and (p_customer is null or i.customer_id=p_customer)
 and case p_queue when 'created' then d.status='CREATED' when 'current' then (d.status in ('OUT_FOR_DELIVERY','FAILED') or (d.status='PENDING' and d.scheduled_date<=today))
 when 'scheduled' then d.status='RESCHEDULED' or (d.status='PENDING' and d.scheduled_date>today)
 when 'completed' then d.status='DELIVERED' when 'cancelled' then d.status='CANCELLED' else true end
 order by d.sequence desc limit 51) x);
end $function$;

CREATE OR REPLACE FUNCTION public.process_delivery(p_id uuid, p_expected bigint, p_action text, p_details jsonb, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.order_deliveries%rowtype;prior public.delivery_events%rowtype;i public.v_invoice_balances%rowtype;oid uuid;old jsonb;payload jsonb;reason text;notes text;new_date date;item jsonb;
begin
 if p_request is null or p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'INVALID_DELIVERY_REQUEST';end if;
 select inv.order_id into oid from public.order_deliveries v join public.sales_invoices inv on inv.id=v.invoice_id where v.id=p_id;
 if oid is null then raise exception 'FORBIDDEN';end if;
 perform 1 from public.sales_orders where id=oid for update;
 perform 1 from public.sales_invoices where order_id=oid for update;
 select * into d from public.order_deliveries where id=p_id for update;
 if not app.has_module(d.store_id,'orders_deliveries') or (p_action='cancel_order' and not app.has_store_role(d.store_id,'manager')) then raise exception 'FORBIDDEN';end if;
 payload:=jsonb_build_object('delivery',p_id,'actor',auth.uid(),'action',p_action,'details',p_details,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,2909));
 select * into prior from public.delivery_events where request_id=p_request;
 if prior.id is not null then if prior.request_payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return p_id;end if;
 if d.version is distinct from p_expected then raise exception 'DELIVERY_CHANGED';end if;
 if d.status in ('DELIVERED','CANCELLED') then raise exception 'DELIVERY_CLOSED';end if;
 select * into i from public.v_invoice_balances where id=d.invoice_id;
 old:=to_jsonb(d);notes:=nullif(btrim(p_details->>'notes'),'');
 if length(notes)>2000 or length(p_details->>'driver_name')>150 or length(p_details->>'vehicle_registration')>50 or length(p_details->>'delivery_reference')>150 or length(p_details->>'received_by')>150 or length(p_details->>'receiver_phone')>80 then raise exception 'DELIVERY_DETAILS_TOO_LONG';end if;
 if p_action='update' then
  if d.status not in ('CREATED','PENDING','RESCHEDULED','FAILED') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if nullif(btrim(p_details->>'address'),'') is null or nullif(btrim(p_details->>'phone'),'') is null or length(p_details->>'address')>1000 or length(p_details->>'phone')>80 then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if jsonb_typeof(p_details->'remarks') is distinct from 'object' then raise exception 'INVALID_DELIVERY_REMARKS';end if;
  for item in select value from jsonb_array_elements(d.snapshot->'items') loop
   if length(p_details->'remarks'->>(item->>'id'))>500 then raise exception 'DELIVERY_DETAILS_TOO_LONG';end if;
  end loop;
  update public.order_deliveries set driver_name=btrim(p_details->>'driver_name'),vehicle_registration=btrim(p_details->>'vehicle_registration'),delivery_reference=btrim(p_details->>'delivery_reference'),comments=notes,
  snapshot=snapshot||jsonb_build_object('delivery_address',btrim(p_details->>'address'),'contact_number',btrim(p_details->>'phone'),
  'items',(select jsonb_agg(l||jsonb_build_object('remarks',coalesce(p_details->'remarks'->>(l->>'id'),''))) from jsonb_array_elements(d.snapshot->'items') l)) where id=d.id;
 elsif p_action='dispatch' then
  if d.status not in ('CREATED','PENDING','RESCHEDULED','FAILED') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if i.status<>'PAID' or i.credits>0 then raise exception 'DELIVERY_PAYMENT_REQUIRED';end if;
  if d.scheduled_date is null then raise exception 'DELIVERY_SCHEDULE_REQUIRED';end if;
  if nullif(btrim(d.snapshot->>'delivery_address'),'') is null or nullif(btrim(d.snapshot->>'contact_number'),'') is null then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if i.goods_issued_at is null then raise exception 'DELIVERY_RELEASE_GOODS_FIRST';end if;
  
  update public.order_deliveries set status='OUT_FOR_DELIVERY' where id=d.id;
 elsif p_action='complete' then
  if d.status<>'OUT_FOR_DELIVERY' then raise exception 'INVALID_DELIVERY_STATE';end if;
  if i.status<>'PAID' or i.credits>0 then raise exception 'DELIVERY_PAYMENT_REQUIRED';end if;
  if d.scheduled_date is null then raise exception 'DELIVERY_SCHEDULE_REQUIRED';end if;
  if nullif(btrim(d.snapshot->>'delivery_address'),'') is null or nullif(btrim(d.snapshot->>'contact_number'),'') is null then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if nullif(btrim(p_details->>'received_by'),'') is null then raise exception 'DELIVERY_RECIPIENT_REQUIRED';end if;
  update public.order_deliveries set status='DELIVERED',delivered_at=clock_timestamp(),confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),received_by=btrim(p_details->>'received_by'),receiver_phone=btrim(p_details->>'receiver_phone'),comments=notes where id=d.id;
 elsif p_action='fail' then
  if d.status<>'OUT_FOR_DELIVERY' or notes is null then raise exception 'DELIVERY_FAILURE_REASON_REQUIRED';end if;
  update public.order_deliveries set status='FAILED',comments=notes where id=d.id;
 elsif p_action in ('schedule','reschedule') then
  if p_action='schedule' and d.status<>'CREATED' then raise exception 'INVALID_DELIVERY_STATE';end if;
  new_date:=nullif(p_details->>'date','')::date;
  if new_date is null or new_date<(now() at time zone (select timezone from public.stores where id=d.store_id))::date then raise exception 'DELIVERY_DATE_IN_PAST';end if;
  if d.status='OUT_FOR_DELIVERY' then perform app_private.delivery_event(d.id,'failed',jsonb_build_object('status',d.status),jsonb_build_object('status','FAILED'),'Attempt rescheduled. '||coalesce(notes,''));end if;
  update public.order_deliveries set status='RESCHEDULED',original_date=coalesce(original_date,new_date),scheduled_date=new_date,comments=notes where id=d.id;
 elsif p_action in ('cancel','cancel_order') then
  reason:=p_details->>'reason';
  if reason is null or reason not in ('Customer Rejected Order','Customer No Longer Wants Order','Customer Unavailable','Incorrect Delivery Address','Order Damaged','Items Unavailable/Out of Stock','Duplicate Order','Customer Cancelled Order','Payment Issue','Delivery Area Not Supported','Delivery Attempt Failed','Order Expired','Other') or (reason='Other' and notes is null) then raise exception 'DELIVERY_CANCELLATION_REASON_REQUIRED';end if;
  update public.order_deliveries set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_reason=reason,comments=notes where id=d.id;
  if p_action='cancel_order' then
   update public.sales_orders set status='CANCELLED',cancellation_reason=reason||coalesce(': '||notes,'') where id=oid;
   perform app.audit('order.cancel','sales_orders',oid,d.business_id,d.store_id,null,jsonb_build_object('delivery',d.id,'reason',reason,'notes',notes,'financial_reversal',false));
  end if;
 else raise exception 'INVALID_DELIVERY_ACTION';end if;
 update public.order_deliveries set version=version+1,updated_at=clock_timestamp() where id=d.id;
 perform app_private.delivery_event(d.id,p_action,old,(select to_jsonb(v) from public.order_deliveries v where v.id=d.id),notes,p_request,payload);
 return d.id;
end $function$;

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

      'delivery_id',d.id,'delivery_status',d.status,'status',case when i.state in ('CANCELLED','VOID') then 'INVOICE_CANCELLED' when o.status='CANCELLED' then 'CANCELLED' when d.status='DELIVERED' then 'COMPLETED' when d.status='CANCELLED' then 'DELIVERY_CANCELLED' when o.delivery_required and d.id is not null then case d.status when 'CREATED' then 'DELIVERY_CREATED' when 'OUT_FOR_DELIVERY' then 'OUT_FOR_DELIVERY' when 'RESCHEDULED' then 'DELIVERY_RESCHEDULED' when 'FAILED' then 'DELIVERY_FAILED' else 'PENDING_DELIVERY' end when o.delivery_required and i.id is not null then 'AWAITING_DELIVERY_PAYMENT'

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

    left join public.v_invoice_balances i on i.order_id=o.id and i.store_id=p_store left join public.order_deliveries d on d.invoice_id=i.id

  ) summary),'[]'::jsonb);

end;

$function$;

CREATE OR REPLACE FUNCTION public.delivery_report(p_stores uuid[], p_filters jsonb DEFAULT '{}'::jsonb, p_after bigint DEFAULT NULL::bigint, p_until bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50, p_mode text DEFAULT 'view'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare permission text;b uuid;watermark bigint;result jsonb;totals jsonb;
begin
 permission:=case p_mode when 'view' then 'reports_delivery' when 'print' then 'reports_delivery_print' when 'xlsx' then 'reports_delivery_excel' when 'pdf' then 'reports_delivery_pdf' end;
 if auth.uid() is null or permission is null or coalesce(cardinality(p_stores),0) not between 1 and 100 then raise exception 'FORBIDDEN';end if;
 select business_id into b from public.stores where id=p_stores[1];
 if b is null or exists(select 1 from unnest(p_stores) x(id) left join public.stores s on s.id=x.id where s.id is null or s.business_id<>b or not app.has_module(s.id,permission)) then raise exception 'FORBIDDEN';end if;
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or length(p_filters::text)>3000 or p_limit is null or p_limit not between 1 and 200
 or coalesce(p_filters->>'date_field','delivery') not in ('delivery','order','scheduled','delivered')
 or coalesce(p_filters->>'status','') not in ('','CREATED','PENDING','SCHEDULED','OUT_FOR_DELIVERY','DELIVERED','RESCHEDULED','FAILED','CANCELLED')
 or coalesce(p_filters->>'payment_status','') not in ('','DRAFT','VOID','ISSUED','UNPAID','PARTIALLY_PAID','PAID','OVERDUE','CREDITED')
 or (nullif(p_filters->>'from','')::date > nullif(p_filters->>'to','')::date) then raise exception 'INVALID_REPORT_FILTERS';end if;
 select coalesce(p_until,max(d.sequence),0) into watermark from public.order_deliveries d where d.store_id=any(p_stores);
 -- History is enriched only after choosing a bounded page of authorised base rows.
 with selected as materialized (
 select * from app_private.delivery_report_rows(p_stores,p_filters,watermark) r where p_after is null or r.sequence<p_after order by r.sequence desc limit p_limit+1
 ), visible as (select * from selected order by sequence desc limit p_limit)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(v)-'confirmed_by'||jsonb_build_object(
 'attempt_count',(select count(*) from public.delivery_events e where e.delivery_id=v.delivery_id and e.action='dispatch'),
 'rescheduled_date',(select e.after_data->>'scheduled_date' from public.delivery_events e where e.delivery_id=v.delivery_id and e.action='reschedule' order by e.id desc limit 1),
 'failure_reason',(select e.notes from public.delivery_events e where e.delivery_id=v.delivery_id and e.action in ('fail','failed') order by e.id desc limit 1),
 'confirmed_by',(select e.actor_name from public.delivery_events e where e.delivery_id=v.delivery_id and e.action='complete' order by e.id desc limit 1)) order by v.sequence desc) from visible v),'[]'::jsonb),
 'next',case when (select count(*) from selected)>p_limit then (select min(sequence) from visible) else null end,'until',watermark) into result;
 if p_after is null then
 with filtered as materialized (select delivery_status,order_total,currency from app_private.delivery_report_rows(p_stores,p_filters,watermark))
 select jsonb_build_object('total',count(*),'delivered',count(*) filter(where delivery_status='DELIVERED'),
 'created',count(*) filter(where delivery_status='CREATED'),'pending',count(*) filter(where delivery_status='PENDING'),'scheduled',count(*) filter(where delivery_status='SCHEDULED'),
 'out_for_delivery',count(*) filter(where delivery_status='OUT_FOR_DELIVERY'),'rescheduled',count(*) filter(where delivery_status='RESCHEDULED'),
 'failed',count(*) filter(where delivery_status='FAILED'),'cancelled',count(*) filter(where delivery_status='CANCELLED'),
 'values',coalesce((select jsonb_agg(to_jsonb(v)) from (select currency,sum(order_total) total from filtered group by currency order by currency)v),'[]'::jsonb)) into totals from filtered;
 end if;
 return result||jsonb_build_object('summary',totals,'generated_at',now());
end $function$;

CREATE OR REPLACE FUNCTION app_private.delivery_report_rows(p_stores uuid[], p_filters jsonb, p_until bigint)
 RETURNS TABLE(sequence bigint, delivery_id uuid, order_id uuid, invoice_id uuid, delivery_number text, order_number text, invoice_number text, customer_name text, customer_contact text, store_id uuid, store_name text, driver_name text, vehicle_registration text, order_date date, delivery_date date, scheduled_date date, delivery_status text, order_total numeric, currency text, payment_status text, received_by text, comments text, cancellation_reason text, confirmed_by uuid, delivered_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select d.sequence,d.id,o.id,i.id,d.reference,o.reference,i.reference,
 d.snapshot->>'customer_name',d.snapshot->>'contact_number',d.store_id,s.name,d.driver_name,d.vehicle_registration,
 (o.created_at at time zone s.timezone)::date,(d.created_at at time zone s.timezone)::date,d.scheduled_date,
 case when d.status='PENDING' and d.scheduled_date>(now() at time zone s.timezone)::date then 'SCHEDULED' else d.status end,
 i.total,i.currency,i.status,d.received_by,d.comments,d.cancellation_reason,d.confirmed_by,d.delivered_at
 from public.order_deliveries d join public.stores s on s.id=d.store_id
 join public.v_invoice_balances i on i.id=d.invoice_id join public.sales_orders o on o.id=i.order_id
 where d.store_id=any(p_stores) and d.sequence<=p_until
 and (nullif(p_filters->>'customer','') is null or strpos(lower(d.snapshot->>'customer_name'),lower(p_filters->>'customer'))>0)
 and (nullif(p_filters->>'driver','') is null or strpos(lower(coalesce(d.driver_name,'')),lower(p_filters->>'driver'))>0)
 and (nullif(p_filters->>'delivery_number','') is null or strpos(lower(d.reference),lower(p_filters->>'delivery_number'))>0)
 and (nullif(p_filters->>'order_number','') is null or strpos(lower(o.reference),lower(p_filters->>'order_number'))>0)
 and (nullif(p_filters->>'invoice_number','') is null or strpos(lower(i.reference),lower(p_filters->>'invoice_number'))>0)
 and (nullif(p_filters->>'payment_status','') is null or i.status=p_filters->>'payment_status')
 and (nullif(p_filters->>'status','') is null or
  case when d.status='PENDING' and d.scheduled_date>(now() at time zone s.timezone)::date then 'SCHEDULED' else d.status end=p_filters->>'status')
 and (nullif(p_filters->>'from','') is null or
  case p_filters->>'date_field' when 'order' then (o.created_at at time zone s.timezone)::date when 'scheduled' then d.scheduled_date when 'delivered' then (d.delivered_at at time zone s.timezone)::date else (d.created_at at time zone s.timezone)::date end >= (p_filters->>'from')::date)
 and (nullif(p_filters->>'to','') is null or
  case p_filters->>'date_field' when 'order' then (o.created_at at time zone s.timezone)::date when 'scheduled' then d.scheduled_date when 'delivered' then (d.delivered_at at time zone s.timezone)::date else (d.created_at at time zone s.timezone)::date end <= (p_filters->>'to')::date)
$function$;

create table public.invoice_revisions (
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.sales_invoices(id),
 store_id uuid not null references public.stores(id),revision integer not null,request_id uuid not null unique,payload jsonb not null,
 before_data jsonb not null,after_data jsonb not null,reason text not null,amount_change numeric not null,
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),unique(invoice_id,revision)
);
create index invoice_revisions_store on public.invoice_revisions(store_id);
create index invoice_revisions_actor on public.invoice_revisions(actor_id);
alter table public.invoice_revisions enable row level security;
revoke all on public.invoice_revisions from public,anon,authenticated;
grant select on public.invoice_revisions to authenticated;
create policy invoice_revision_read on public.invoice_revisions for select to authenticated using(app.has_module(store_id,'invoices_view_invoices'));
create trigger invoice_revision_immutable before update or delete on public.invoice_revisions for each row execute function app.block_mutation();

CREATE OR REPLACE FUNCTION app.protect_posted_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$

begin

 if tg_op='DELETE' then raise exception 'INVOICE_DELETE_FORBIDDEN';end if;

 if old.state='ISSUED' and old.goods_issued_at is null and new.revision=old.revision+1
 and (to_jsonb(new)-array['revision','subtotal','discount','tax_amount','total'])=(to_jsonb(old)-array['revision','subtotal','discount','tax_amount','total'])
 and exists(select 1 from public.invoice_revisions r where r.invoice_id=old.id and r.revision=new.revision
 and r.before_data->'invoice'=to_jsonb(old) and r.after_data->'totals'=jsonb_build_object('subtotal',new.subtotal,'discount',new.discount,'tax_amount',new.tax_amount,'total',new.total)) then return new;end if;
 if old.state='ISSUED' and old.goods_issued_at is null and new.terms='CREDIT' and old.terms<>'CREDIT'

   and (to_jsonb(new)-'terms')=(to_jsonb(old)-'terms')

   and exists(select 1 from public.customers where id=old.customer_id and is_active and not is_once_off) then return new;end if;

 if old.state<>'DRAFT' and (to_jsonb(new)-array['state','cancellation_reason','goods_issued_at','goods_issued_by','authorized_by'])

   is distinct from (to_jsonb(old)-array['state','cancellation_reason','goods_issued_at','goods_issued_by','authorized_by']) then raise exception 'POSTED_INVOICE_IMMUTABLE';end if;

 return new;

end $function$;

create function public.amend_invoice_items(p_invoice uuid,p_expected integer,p_items jsonb,p_discount numeric,p_reason text,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
<<revision_values>>
declare i public.sales_invoices%rowtype; d public.order_deliveries%rowtype; old_doc jsonb; new_items jsonb:='[]';
 prev public.invoice_revisions%rowtype; payload jsonb; row jsonb; product public.products%rowtype; qty numeric; price numeric; subtotal numeric:=0; tax numeric; total numeric; change numeric; rid uuid:=gen_random_uuid();accum numeric:=0;allocated numeric:=0;net numeric;oid uuid;
begin
 select order_id into oid from public.sales_invoices where id=p_invoice;
 perform 1 from public.sales_orders where id=oid for update;
 select * into i from public.sales_invoices where id=p_invoice for update;
 if i.id is null or not app.has_store_role(i.store_id,'manager') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(i.store_id,array['invoices','invoices_view_invoices']);
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 payload:=jsonb_build_object('actor',auth.uid(),'invoice',p_invoice,'expected',p_expected,'items',p_items,'discount',p_discount,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,3009));
 select * into prev from public.invoice_revisions where request_id=p_request;
 if found then if prev.payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return prev.id;end if;
 if i.revision is distinct from p_expected then raise exception 'INVOICE_CHANGED';end if;
 if i.goods_issued_at is not null or i.state not in ('DRAFT','ISSUED') or exists(select 1 from public.sales_orders where id=oid and status='CANCELLED') then raise exception 'INVOICE_AMENDMENT_CLOSED';end if;
 if exists(select 1 from public.invoice_entries where invoice_id=i.id and kind in ('CREDIT_NOTE','DEBIT_NOTE','VOID')) then raise exception 'INVOICE_ADJUSTMENTS_EXIST';end if;
 select * into d from public.order_deliveries where invoice_id=i.id for update;
 if d.status in ('OUT_FOR_DELIVERY','DELIVERED','CANCELLED') then raise exception 'DELIVERY_CLOSED';end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'REASON_REQUIRED';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'INVALID_ITEMS';end if;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_PRODUCT';end if;
 old_doc:=jsonb_build_object('invoice',to_jsonb(i),'items',(select jsonb_agg(to_jsonb(l) order by l.product_id) from public.sales_invoice_items l where invoice_id=i.id));
 for row in select value from jsonb_array_elements(p_items) loop
  select * into product from public.products where id=(row->>'product_id')::uuid and store_id=i.store_id and is_active;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  qty:=(row->>'quantity')::numeric;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty<>round(qty,3) then raise exception 'INVALID_QUANTITY';end if;
  select unit_price into price from public.sales_invoice_items where invoice_id=i.id and product_id=product.id;
  price:=coalesce(price,product.selling_price);
  if row ? 'unit_price' and (row->>'unit_price')::numeric is distinct from price then raise exception 'INVOICE_PRICE_CHANGED';end if;
  subtotal:=subtotal+round(qty*price,2);
  new_items:=new_items||jsonb_build_array(jsonb_build_object('product_id',product.id,'product_name',product.name,'unit',product.unit,'quantity',qty,'unit_price',price,'line_total',round(qty*price,2),'cost_price',product.cost_price));
 end loop;
 if p_discount is null or p_discount::text in ('NaN','Infinity','-Infinity') or p_discount<0 or p_discount>subtotal then raise exception 'INVALID_DISCOUNT';end if;
 p_discount:=round(p_discount,2);tax:=round((subtotal-p_discount)*i.tax_percent/100,2);total:=subtotal-p_discount+tax;change:=total-i.total;
 insert into public.invoice_revisions(id,invoice_id,store_id,revision,request_id,payload,before_data,after_data,reason,amount_change,actor_id)
 values(rid,i.id,i.store_id,i.revision+1,p_request,payload,old_doc,jsonb_build_object('items',new_items,'totals',jsonb_build_object('subtotal',subtotal,'discount',p_discount,'tax_amount',tax,'total',total)),btrim(p_reason),change,auth.uid());
 update public.sales_invoices set subtotal=revision_values.subtotal,discount=p_discount,tax_amount=tax,total=revision_values.total,revision=revision+1 where id=i.id;
 delete from public.sales_invoice_items where invoice_id=i.id;
 for row in select value from jsonb_array_elements(new_items) loop
  accum:=accum+(row->>'line_total')::numeric;
  net:=case when subtotal=0 then 0 else round(total*accum/subtotal,2)-allocated end;allocated:=allocated+net;
  insert into public.sales_invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,line_total,net_total,cost_price)
  values(i.id,(row->>'product_id')::uuid,row->>'product_name',row->>'unit',(row->>'quantity')::numeric,(row->>'unit_price')::numeric,(row->>'line_total')::numeric,net,(row->>'cost_price')::numeric);
 end loop;
 if i.state='ISSUED' and change<>0 then perform app.post_customer_entry(i.customer_id,change,'ADJUSTMENT', 'invoice_revisions',rid,'Invoice revision '||i.reference||': '||btrim(p_reason));end if;
 if d.id is not null then
  update public.order_deliveries set snapshot=snapshot||jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'description',l.product_name,'sku',p.sku,'barcode',(select barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,barcode limit 1),'unit',l.unit,'ordered_quantity',l.quantity,'delivery_quantity',l.quantity,'remarks',coalesce((select x->>'remarks' from jsonb_array_elements(d.snapshot->'items')x where x->>'product_id'=l.product_id::text limit 1),'')) order by l.id) from public.sales_invoice_items l join public.products p on p.id=l.product_id where l.invoice_id=i.id)),version=version+1,updated_at=clock_timestamp() where id=d.id;
  perform app_private.delivery_event(d.id,'items_amended',to_jsonb(d),(select to_jsonb(v) from public.order_deliveries v where v.id=d.id),p_reason);
 end if;
 perform app.audit('invoice.amend_items','sales_invoices',i.id,i.business_id,i.store_id,old_doc,jsonb_build_object('revision',i.revision+1,'total',total,'amount_change',change,'reason',p_reason));
 if i.state='ISSUED' then
 perform app_private.queue_customer_document(i.customer_id,i.store_id,auth.uid(),'invoices_view_invoices','invoice-revision:'||rid,
 app_private.customer_invoice_document(i.id)||jsonb_build_object('type','Revised invoice','summary','Revision '||(i.revision+1)||': '||p_reason));
 end if;
 return rid;
end $$;
revoke all on function public.amend_invoice_items(uuid,integer,jsonb,numeric,text,uuid) from public,anon;
grant execute on function public.amend_invoice_items(uuid,integer,jsonb,numeric,text,uuid) to authenticated;

create function public.order_current_items(p_order uuid) returns setof public.sales_order_items
language plpgsql stable security definer set search_path='' as $$
declare o public.sales_orders%rowtype;i uuid;
begin
 select * into o from public.sales_orders where id=p_order;
 if o.id is null then raise exception 'FORBIDDEN';end if;
 perform app.require_module(o.store_id,array['orders','orders_recent']);
 select id into i from public.sales_invoices where order_id=o.id;
 if i is null then return query select * from public.sales_order_items where order_id=o.id order by id;
 else return query select l.id,o.id,l.product_id,l.product_name,l.unit,l.quantity,l.unit_price,l.line_total from public.sales_invoice_items l where invoice_id=i order by l.id;end if;
end $$;
revoke all on function public.order_current_items(uuid) from public,anon;
grant execute on function public.order_current_items(uuid) to authenticated;

create function public.invoice_revision_history(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array['invoices','invoices_view_invoices']);
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from (
 select v.id,v.revision,v.reason,v.amount_change,v.created_at,coalesce(p.full_name,'User') as actor,v.before_data,v.after_data from public.invoice_revisions v left join public.profiles p on p.id=v.actor_id where invoice_id=p_invoice order by revision desc limit 100)r),'[]'::jsonb);
end $$;
revoke all on function public.invoice_revision_history(uuid) from public,anon;
grant execute on function public.invoice_revision_history(uuid) to authenticated;

-- The corrected invoice already describes the account adjustment; avoid a second generic email.
do $$declare s text;begin
 s:=pg_get_functiondef('app_private.customer_document_event()'::regprocedure);
 s:=replace(s,'''invoice_entries'',''goods_returns'',''customer_refunds''','''invoice_entries'',''invoice_revisions'',''goods_returns'',''customer_refunds''');execute s;
 s:=pg_get_functiondef('app_private.customer_invoice_document(uuid)'::regprocedure);
 s:=replace(s,'''Subtotal'',i.subtotal','''Revision'',i.revision,''Subtotal'',i.subtotal');execute s;
end $$;

do $$declare s text;begin s:=pg_get_viewdef('public.v_invoice_balances'::regclass,true);s:=replace(s,'i.customer_snapshot','i.customer_snapshot, i.revision');execute 'create or replace view public.v_invoice_balances with(security_invoker=true) as '||s;end $$;

do $$declare s text;begin
 s:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 s:=regexp_replace(s,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''orders_delivery_collaboration_v1'',true,');execute s;
end $$;

-- Keep historical month boundaries correct: draft revisions are already included in ISSUE;
-- issued revisions contribute their signed delta on the actual correction date.
do $$declare s text;begin
 s:=pg_get_functiondef('app_private.invoice_monthly_reconciliation(uuid,date)'::regprocedure);
 s:=replace(s,'return result;',$body$return result || jsonb_build_object(
 'opening',opening+coalesce((select sum(amount_change) from public.invoice_revisions where store_id=p_store and before_data->'invoice'->>'state'='ISSUED' and created_at<start_at),0),
 'closing',closing+coalesce((select sum(amount_change) from public.invoice_revisions where store_id=p_store and before_data->'invoice'->>'state'='ISSUED' and created_at<end_at),0),
 'revisions',coalesce((select sum(amount_change) from public.invoice_revisions where store_id=p_store and before_data->'invoice'->>'state'='ISSUED' and created_at>=start_at and created_at<end_at),0));$body$);execute s;
end $$;
