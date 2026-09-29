-- Delivery documents are operational records; payment and stock keep their existing ledgers.
insert into public.module_catalog(key,label,minimum_role,parent_key,requires)
values('orders_deliveries','Manage deliveries','employee','orders',array['orders_recent']);
alter table public.businesses add column document_address text, add column document_phone text, add column document_email text;
alter table public.sales_orders add column delivery_required boolean not null default false,
 add column delivery_details jsonb not null default '{}', add column delivery_version bigint not null default 0,
 add column cancelled_at timestamptz, add column cancelled_by uuid references auth.users(id);
create index sales_orders_cancelled_by on public.sales_orders(cancelled_by);
create table public.order_deliveries (
 sequence bigint generated always as identity unique, id uuid primary key default gen_random_uuid(), invoice_id uuid not null unique references public.sales_invoices(id),
 business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
 reference text not null unique default ('DN-'||upper(replace(gen_random_uuid()::text,'-',''))),
 status text not null default 'PENDING' check(status in ('PENDING','OUT_FOR_DELIVERY','FAILED','RESCHEDULED','DELIVERED','CANCELLED')),
 original_date date not null, scheduled_date date not null, snapshot jsonb not null,
 driver_name text,vehicle_registration text,delivery_reference text,comments text,
 delivered_at timestamptz,confirmed_at timestamptz,confirmed_by uuid references auth.users(id),received_by text,receiver_phone text,
 cancelled_at timestamptz,cancelled_by uuid references auth.users(id),cancellation_reason text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version bigint not null default 1
);
create index order_deliveries_queue on public.order_deliveries(store_id,status,scheduled_date,id);
create index order_deliveries_business on public.order_deliveries(business_id);
create index order_deliveries_confirmed_by on public.order_deliveries(confirmed_by);
create index order_deliveries_cancelled_by on public.order_deliveries(cancelled_by);
create table public.delivery_events (
 id bigint generated always as identity primary key,delivery_id uuid not null references public.order_deliveries(id),
 store_id uuid not null references public.stores(id),action text not null,actor_id uuid references auth.users(id),actor_name text not null,
 created_at timestamptz not null default clock_timestamp(),before_data jsonb,after_data jsonb,notes text,
 request_id uuid unique,request_payload jsonb
);
create index delivery_events_history on public.delivery_events(delivery_id,id);
create index delivery_events_store on public.delivery_events(store_id);
create index delivery_events_actor on public.delivery_events(actor_id);
alter table public.order_deliveries enable row level security;
alter table public.delivery_events enable row level security;
revoke all on public.order_deliveries,public.delivery_events from public,anon,authenticated;
grant select on public.order_deliveries,public.delivery_events to authenticated;
create policy delivery_read on public.order_deliveries for select to authenticated using(app.has_module(store_id,'orders_deliveries'));
create policy delivery_event_read on public.delivery_events for select to authenticated using(app.has_module(store_id,'orders_deliveries'));
create trigger delivery_events_immutable before update or delete on public.delivery_events for each row execute function app.block_mutation();
create function app_private.delivery_event(p_id uuid,p_action text,p_before jsonb,p_after jsonb,p_notes text default null,p_request uuid default null,p_payload jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare d public.order_deliveries%rowtype;
begin
 select * into d from public.order_deliveries where id=p_id;
 insert into public.delivery_events(delivery_id,store_id,action,actor_id,actor_name,before_data,after_data,notes,request_id,request_payload)
 values(d.id,d.store_id,p_action,auth.uid(),coalesce((select full_name from public.profiles where id=auth.uid()),'System'),p_before,p_after,p_notes,p_request,p_payload);
 perform app.audit('delivery.'||p_action,'order_deliveries',d.id,d.business_id,d.store_id,p_before,p_after);
end $$;
revoke all on function app_private.delivery_event(uuid,text,jsonb,jsonb,text,uuid,jsonb) from public,anon,authenticated;
create function app_private.ensure_delivery(p_invoice uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.v_invoice_balances%rowtype;o public.sales_orders%rowtype;b public.businesses%rowtype;c public.customers%rowtype;s public.stores%rowtype;did uuid;doc jsonb;
begin
 if not exists(select 1 from public.sales_invoices inv join public.sales_orders ord on ord.id=inv.order_id where inv.id=p_invoice and ord.delivery_required and ord.status<>'CANCELLED') then return null;end if;
 select * into i from public.v_invoice_balances where id=p_invoice;
 select * into o from public.sales_orders where id=i.order_id;
 if not o.delivery_required or o.status='CANCELLED' or i.status<>'PAID' or i.credits>0 then return null;end if;
 select id into did from public.order_deliveries where invoice_id=i.id;if did is not null then return did;end if;
 select * into b from public.businesses where id=i.business_id;
 select * into s from public.stores where id=i.store_id;
 select * into c from public.customers where id=i.customer_id;
 doc:=jsonb_build_object('business_name',i.business_name,'business_address',coalesce(b.document_address,s.address,''),
 'business_phone',coalesce(b.document_phone,''),'business_email',coalesce(b.document_email,''),'store_name',s.name,
 'order_id',o.id,'order_reference',o.reference,'invoice_reference',i.reference,'customer_id',c.id,'customer_name',i.customer_name,
 'company_name',case when c.customer_type='BUSINESS' then c.name else '' end,'customer_code',c.id,
 'delivery_address',o.delivery_details->>'address','contact_number',o.delivery_details->>'phone',
 'items',(select jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'description',l.product_name,'sku',p.sku,'barcode',(select barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,barcode limit 1),
 'unit',l.unit,'ordered_quantity',l.quantity,'delivery_quantity',l.quantity,'remarks','') order by l.id) from public.sales_invoice_items l join public.products p on p.id=l.product_id where l.invoice_id=i.id));
 insert into public.order_deliveries(invoice_id,business_id,store_id,original_date,scheduled_date,snapshot,comments)
 values(i.id,i.business_id,i.store_id,(o.delivery_details->>'date')::date,(o.delivery_details->>'date')::date,doc,o.delivery_details->>'notes')
 on conflict(invoice_id) do nothing returning id into did;
 if did is not null then perform app_private.delivery_event(did,'generated',null,jsonb_build_object('status','PENDING','date',o.delivery_details->>'date'),o.delivery_details->>'notes');end if;
 return coalesce(did,(select id from public.order_deliveries where invoice_id=i.id));
end $$;
revoke all on function app_private.ensure_delivery(uuid) from public,anon,authenticated;
create function app_private.delivery_payment_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin if tg_table_name='invoice_entries' then perform app_private.ensure_delivery(new.invoice_id);else perform app_private.ensure_delivery(new.id);end if;return new;end $$;
revoke all on function app_private.delivery_payment_changed() from public,anon,authenticated;
create trigger delivery_payment_changed after insert on public.invoice_entries for each row execute function app_private.delivery_payment_changed();
create trigger delivery_invoice_issued after update of state on public.sales_invoices for each row when(new.state='ISSUED') execute function app_private.delivery_payment_changed();
create function public.configure_order_delivery(p_order uuid,p_expected bigint,p_required boolean,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.sales_orders%rowtype;iid uuid;did uuid;details jsonb;
begin
 select * into o from public.sales_orders where id=p_order for update;
 if o.id is null or not app.has_module(o.store_id,'orders_deliveries') then raise exception 'FORBIDDEN';end if;
 if o.status='CANCELLED' then raise exception 'ORDER_CANCELLED';end if;
 select id into iid from public.sales_invoices where order_id=o.id for update;
 select id into did from public.order_deliveries where invoice_id=iid;
 if did is not null then raise exception 'DELIVERY_ALREADY_GENERATED';end if;
 if p_required is null or p_details is null or jsonb_typeof(p_details)<>'object' or o.delivery_version is distinct from p_expected then raise exception 'DELIVERY_CHANGED';end if;
 details:=jsonb_build_object('date',p_details->>'date','address',btrim(p_details->>'address'),'phone',btrim(p_details->>'phone'),'notes',btrim(p_details->>'notes'));
 if p_required and (nullif(details->>'date','') is null or nullif(details->>'address','') is null or nullif(details->>'phone','') is null) then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
 if length(details->>'address')>1000 or length(details->>'phone')>80 or length(details->>'notes')>2000 then raise exception 'DELIVERY_DETAILS_TOO_LONG';end if;
 if p_required and (details->>'date')::date < (now() at time zone (select timezone from public.stores where id=o.store_id))::date then raise exception 'DELIVERY_DATE_IN_PAST';end if;
 update public.sales_orders set delivery_required=p_required,delivery_details=details,delivery_version=delivery_version+1 where id=o.id;
 perform app.audit('delivery.requirement','sales_orders',o.id,o.business_id,o.store_id,jsonb_build_object('required',o.delivery_required,'details',o.delivery_details),jsonb_build_object('required',p_required,'details',details));
 if iid is not null then return app_private.ensure_delivery(iid);end if;return null;
end $$;
revoke all on function public.configure_order_delivery(uuid,bigint,boolean,jsonb) from public,anon;
grant execute on function public.configure_order_delivery(uuid,bigint,boolean,jsonb) to authenticated;
create function public.delivery_detail(p_order uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.sales_orders%rowtype;d public.order_deliveries%rowtype;c public.customers%rowtype;i public.v_invoice_balances%rowtype;
begin
 select * into o from public.sales_orders where id=p_order;
 if o.id is null or not app.has_module(o.store_id,'orders_deliveries') then raise exception 'FORBIDDEN';end if;
 select * into i from public.v_invoice_balances where order_id=o.id;
 select * into d from public.order_deliveries where invoice_id=i.id;
 select * into c from public.customers where id=o.customer_id;
 return jsonb_build_object('order',jsonb_build_object('id',o.id,'reference',o.reference,'status',o.status,'required',o.delivery_required,'details',o.delivery_details,'version',o.delivery_version),
 'customer',jsonb_build_object('name',c.name,'phone',c.phone,'address',c.address),
 'payment_status',i.status,'goods_issued_at',i.goods_issued_at,'invoice_id',i.id,'delivery',case when d.id is null then null else to_jsonb(d) end,
 'timezone',(select timezone from public.stores where id=o.store_id));
end $$;
revoke all on function public.delivery_detail(uuid) from public,anon;
grant execute on function public.delivery_detail(uuid) to authenticated;
create function public.delivery_page(p_store uuid,p_queue text default 'current',p_date date default null,p_after bigint default null,p_customer uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date;
begin
 if not app.has_module(p_store,'orders_deliveries') then raise exception 'FORBIDDEN';end if;
 if p_queue not in ('current','scheduled','completed','cancelled','all') then raise exception 'INVALID_DELIVERY_QUEUE';end if;
 select (now() at time zone timezone)::date into today from public.stores where id=p_store;
 -- Page base delivery rows without loading item snapshots or history.
 return (select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by x.sequence desc),'[]'::jsonb)) from (
 select d.id,d.sequence,d.reference,d.status,d.scheduled_date,d.original_date,d.version,d.driver_name,d.cancellation_reason,d.cancelled_at,
 i.order_id,d.snapshot->>'order_reference' as order_reference,d.snapshot->>'customer_name' as customer_name,
 d.snapshot->>'contact_number' as contact_number,d.snapshot->>'delivery_address' as delivery_address
 from public.order_deliveries d join public.sales_invoices i on i.id=d.invoice_id
 where d.store_id=p_store and (p_after is null or d.sequence<p_after) and (p_date is null or d.scheduled_date=p_date)
 and (p_customer is null or i.customer_id=p_customer)
 and case p_queue when 'current' then d.status in ('PENDING','OUT_FOR_DELIVERY','FAILED') and d.scheduled_date<=today
 when 'scheduled' then d.status='RESCHEDULED' or (d.status='PENDING' and d.scheduled_date>today)
 when 'completed' then d.status='DELIVERED' when 'cancelled' then d.status='CANCELLED' else true end
 order by d.sequence desc limit 51) x);
end $$;
revoke all on function public.delivery_page(uuid,text,date,bigint,uuid) from public,anon;
grant execute on function public.delivery_page(uuid,text,date,bigint,uuid) to authenticated;
create index order_deliveries_pages on public.order_deliveries(store_id,sequence desc);
create function public.process_delivery(p_id uuid,p_expected bigint,p_action text,p_details jsonb,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
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
  if d.status not in ('PENDING','RESCHEDULED','FAILED') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if nullif(btrim(p_details->>'address'),'') is null or nullif(btrim(p_details->>'phone'),'') is null or length(p_details->>'address')>1000 or length(p_details->>'phone')>80 then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if jsonb_typeof(p_details->'remarks') is distinct from 'object' then raise exception 'INVALID_DELIVERY_REMARKS';end if;
  for item in select value from jsonb_array_elements(d.snapshot->'items') loop
   if length(p_details->'remarks'->>(item->>'id'))>500 then raise exception 'DELIVERY_DETAILS_TOO_LONG';end if;
  end loop;
  update public.order_deliveries set driver_name=btrim(p_details->>'driver_name'),vehicle_registration=btrim(p_details->>'vehicle_registration'),delivery_reference=btrim(p_details->>'delivery_reference'),comments=notes,
  snapshot=snapshot||jsonb_build_object('delivery_address',btrim(p_details->>'address'),'contact_number',btrim(p_details->>'phone'),
  'items',(select jsonb_agg(l||jsonb_build_object('remarks',coalesce(p_details->'remarks'->>(l->>'id'),''))) from jsonb_array_elements(d.snapshot->'items') l)) where id=d.id;
 elsif p_action='dispatch' then
  if d.status not in ('PENDING','RESCHEDULED','FAILED') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if i.status<>'PAID' or i.credits>0 then raise exception 'DELIVERY_PAYMENT_REQUIRED';end if;
  if i.goods_issued_at is null then raise exception 'DELIVERY_RELEASE_GOODS_FIRST';end if;
  if nullif(btrim(d.driver_name),'') is null or nullif(btrim(d.vehicle_registration),'') is null then raise exception 'DELIVERY_DRIVER_REQUIRED';end if;
  update public.order_deliveries set status='OUT_FOR_DELIVERY' where id=d.id;
 elsif p_action='complete' then
  if d.status<>'OUT_FOR_DELIVERY' then raise exception 'INVALID_DELIVERY_STATE';end if;
  if i.status<>'PAID' or i.credits>0 then raise exception 'DELIVERY_PAYMENT_REQUIRED';end if;
  if nullif(btrim(p_details->>'received_by'),'') is null then raise exception 'DELIVERY_RECIPIENT_REQUIRED';end if;
  update public.order_deliveries set status='DELIVERED',delivered_at=clock_timestamp(),confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),received_by=btrim(p_details->>'received_by'),receiver_phone=btrim(p_details->>'receiver_phone'),comments=notes where id=d.id;
 elsif p_action='fail' then
  if d.status<>'OUT_FOR_DELIVERY' or notes is null then raise exception 'DELIVERY_FAILURE_REASON_REQUIRED';end if;
  update public.order_deliveries set status='FAILED',comments=notes where id=d.id;
 elsif p_action='reschedule' then
  new_date:=nullif(p_details->>'date','')::date;
  if new_date is null or new_date<(now() at time zone (select timezone from public.stores where id=d.store_id))::date then raise exception 'DELIVERY_DATE_IN_PAST';end if;
  if d.status='OUT_FOR_DELIVERY' then perform app_private.delivery_event(d.id,'failed',jsonb_build_object('status',d.status),jsonb_build_object('status','FAILED'),'Attempt rescheduled. '||coalesce(notes,''));end if;
  update public.order_deliveries set status='RESCHEDULED',scheduled_date=new_date,comments=notes where id=d.id;
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
end $$;
revoke all on function public.process_delivery(uuid,bigint,text,jsonb,uuid) from public,anon;
grant execute on function public.process_delivery(uuid,bigint,text,jsonb,uuid) to authenticated;
create function app_private.cancel_order_delivery() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.order_deliveries%rowtype;
begin
 if tg_when='BEFORE' then new.cancelled_at:=clock_timestamp();new.cancelled_by:=auth.uid();return new;end if;
 select v.* into d from public.order_deliveries v join public.sales_invoices i on i.id=v.invoice_id where i.order_id=new.id for update of v;
 if d.id is not null and d.status not in ('CANCELLED','DELIVERED') then
  update public.order_deliveries set status='CANCELLED',cancellation_reason=new.cancellation_reason,cancelled_by=auth.uid(),cancelled_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=d.id;
  perform app_private.delivery_event(d.id,'cancel_order',to_jsonb(d),(select to_jsonb(v) from public.order_deliveries v where v.id=d.id),new.cancellation_reason);
 end if;return new;
end $$;
revoke all on function app_private.cancel_order_delivery() from public,anon,authenticated;
create trigger order_cancel_metadata before update of status on public.sales_orders for each row when(new.status='CANCELLED' and old.status is distinct from new.status) execute function app_private.cancel_order_delivery();
create trigger order_cancel_delivery after update of status on public.sales_orders for each row when(new.status='CANCELLED' and old.status is distinct from new.status) execute function app_private.cancel_order_delivery();
create function app_private.guard_cancelled_delivery_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.sales_orders where id=new.order_id and status='CANCELLED') then raise exception 'ORDER_CANCELLED';end if;return new;
end $$;
revoke all on function app_private.guard_cancelled_delivery_order() from public,anon,authenticated;
create trigger guard_cancelled_delivery_order before update of goods_issued_at on public.sales_invoices for each row when(old.goods_issued_at is null and new.goods_issued_at is not null) execute function app_private.guard_cancelled_delivery_order();
create function public.set_document_contact(p_business uuid,p_address text,p_phone text,p_email text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not app.has_business_role(p_business,'owner') then raise exception 'FORBIDDEN';end if;
 if length(p_address)>1000 or length(p_phone)>80 or length(p_email)>254 or (nullif(btrim(p_email),'') is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_CONTACT_DETAILS';end if;
 update public.businesses set document_address=nullif(btrim(p_address),''),document_phone=nullif(btrim(p_phone),''),document_email=nullif(btrim(p_email),'') where id=p_business;
 perform app.audit('business.document_contact','businesses',p_business,p_business,null,null,jsonb_build_object('address',p_address,'phone',p_phone,'email',p_email));
end $$;
revoke all on function public.set_document_contact(uuid,text,text,text) from public,anon;
grant execute on function public.set_document_contact(uuid,text,text,text) to authenticated;
-- Extend existing read-only order summaries without changing collection orders.
do $$ declare source text;begin
 select pg_get_functiondef('public.order_workflow_summary(uuid)'::regprocedure) into source;
 source:=replace(source,'''status'',case when o.status=''CANCELLED'' then ''CANCELLED''','''delivery_id'',d.id,''delivery_status'',d.status,''status'',case when o.status=''CANCELLED'' then ''CANCELLED'' when d.status=''DELIVERED'' then ''COMPLETED'' when d.status=''CANCELLED'' then ''DELIVERY_CANCELLED'' when o.delivery_required and d.id is not null then case d.status when ''OUT_FOR_DELIVERY'' then ''OUT_FOR_DELIVERY'' when ''RESCHEDULED'' then ''DELIVERY_RESCHEDULED'' when ''FAILED'' then ''DELIVERY_FAILED'' else ''PENDING_DELIVERY'' end when o.delivery_required and i.id is not null then ''AWAITING_DELIVERY_PAYMENT''');
 source:=replace(source,'i.store_id=p_store','i.store_id=p_store left join public.order_deliveries d on d.invoice_id=i.id');execute source;
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into source;
 source:=regexp_replace(source,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''delivery_management_v1'',true,');execute source;
end $$;
