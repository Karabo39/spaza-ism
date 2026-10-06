-- Existing explicit Online Orders grants become independent of standard Orders.
update public.module_catalog set parent_key=null where key='orders_online';
insert into public.module_catalog(key,label,minimum_role,parent_key,requires)
values('reports_online','Online Orders report','employee','reports','{orders_online}');

create function app_private.online_report(p_store uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; start_at timestamptz; end_at timestamptz;
begin
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'INVALID_DATE_RANGE';end if;
 start_at:=p_from::timestamp at time zone 'Africa/Johannesburg';end_at:=(p_to+1)::timestamp at time zone 'Africa/Johannesburg';
 with orders as materialized (
  select o.*,so.customer_id,coalesce(nullif(lower(c.email::text),''),nullif(regexp_replace(c.phone,'[^0-9]','','g'),''),c.id::text) identity,
   case when so.status='CANCELLED' then 'CANCELLED' when d.status is not null and d.status not in ('CREATED','PENDING') then d.status else o.status end final_status,
   coalesce(i.discount,0) discount,i.goods_issued_at
  from public.online_orders o join public.sales_orders so on so.id=o.order_id join public.customers c on c.id=so.customer_id
  left join public.sales_invoices i on i.id=o.invoice_id left join public.order_deliveries d on d.invoice_id=i.id
  where o.store_id=p_store and o.created_at>=start_at and o.created_at<end_at
 ), status_rows as (select final_status status,count(*) count,sum(total) value from orders group by final_status),
 customers as (select distinct identity from orders),
 repeat_customers as (
  select distinct c.identity from customers c where exists(select 1 from public.online_orders old join public.sales_orders s on s.id=old.order_id join public.customers cu on cu.id=s.customer_id
   where old.store_id=p_store and old.created_at<start_at and coalesce(nullif(lower(cu.email::text),''),nullif(regexp_replace(cu.phone,'[^0-9]','','g'),''),cu.id::text)=c.identity)
 ), products as (
  select l.product_id,l.product_name product,sum(l.quantity) quantity,sum(l.net_total) value from orders o join public.sales_invoice_items l on l.invoice_id=o.invoice_id
  where o.goods_issued_at is not null group by l.product_id,l.product_name order by sum(l.quantity) desc,l.product_id limit 50
 )
 select jsonb_build_object('from',p_from,'to',p_to,'metrics',jsonb_build_object(
 'total_orders',count(*),'order_value',coalesce(sum(total),0),'online_sales',coalesce(sum(total) filter(where goods_issued_at is not null),0),
 'completed_orders',count(*) filter(where final_status in ('DELIVERED','COLLECTED')),'completed_value',coalesce(sum(total) filter(where final_status in ('DELIVERED','COLLECTED')),0),
 'pending_orders',count(*) filter(where final_status not in ('DELIVERED','COLLECTED','CANCELLED','EXPIRED')),'pending_value',coalesce(sum(total) filter(where final_status not in ('DELIVERED','COLLECTED','CANCELLED','EXPIRED')),0),
 'cancelled_orders',count(*) filter(where final_status in ('CANCELLED','EXPIRED')),'cancelled_value',coalesce(sum(total) filter(where final_status in ('CANCELLED','EXPIRED')),0),
 'paid_orders',count(*) filter(where payment_confirmed_at is not null),'paid_value',coalesce(sum(total) filter(where payment_confirmed_at is not null),0),
 'unpaid_orders',count(*) filter(where payment_confirmed_at is null and final_status not in ('CANCELLED','EXPIRED')),'unpaid_value',coalesce(sum(total) filter(where payment_confirmed_at is null and final_status not in ('CANCELLED','EXPIRED')),0),
 'deliveries',count(*) filter(where fulfilment='DELIVERY'),'collections',count(*) filter(where fulfilment='COLLECTION'),
 'delivery_fees',coalesce(sum(delivery_fee) filter(where payment_confirmed_at is not null),0),'discounts',coalesce(sum(discount),0),
 'tax',coalesce(sum(total-round(total/(1+tax_percent/100),2)) filter(where goods_issued_at is not null),0),
 'average_order_value',coalesce(round(avg(total),2),0),'new_customers',(select count(*) from customers)-(select count(*) from repeat_customers),'returning_customers',(select count(*) from repeat_customers),
 'refund_count',(select count(*) from public.customer_refunds r join public.goods_returns gr on gr.id=r.return_id join public.online_orders oo on oo.invoice_id=gr.invoice_id where oo.store_id=p_store and r.created_at>=start_at and r.created_at<end_at),
 'refunds',(select coalesce(sum(r.amount),0) from public.customer_refunds r join public.goods_returns gr on gr.id=r.return_id join public.online_orders oo on oo.invoice_id=gr.invoice_id where oo.store_id=p_store and r.created_at>=start_at and r.created_at<end_at)),
 'statuses',(select coalesce(jsonb_agg(to_jsonb(s) order by status),'[]') from status_rows s),
 'products',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from products p)) into result from orders;
 return result;
end $$;
revoke all on function app_private.online_report(uuid,date,date) from public,anon,authenticated;
create function public.online_orders_report(p_store uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin if not app.has_module(p_store,'reports_online') then raise exception 'FORBIDDEN';end if; return app_private.online_report(p_store,p_from,p_to);end $$;
revoke all on function public.online_orders_report(uuid,date,date) from public,anon;
grant execute on function public.online_orders_report(uuid,date,date) to authenticated;

create table public.report_schedules(
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),created_by uuid not null references auth.users(id),
 name text not null check(length(btrim(name)) between 1 and 120),kind text not null check(kind in ('DAILY_SALES','LOW_STOCK','OUT_OF_STOCK','OUTSTANDING_PAYMENTS','OVERDUE_INVOICES','STOCK_MOVEMENTS','MOVING_PRODUCTS','CASH_UP','ONLINE_ORDERS','BUSINESS_PERFORMANCE','UPCOMING_EXPIRY','STOCK_TAKE_COMPLETED')),
 frequency text not null check(frequency in ('DAILY','WEEKLY','MONTHLY')),send_time time not null,
 weekday integer not null default 1 check(weekday between 0 and 6),monthday integer not null default 1 check(monthday between 1 and 28),
 recipients text[] not null check(cardinality(recipients) between 1 and 20),active boolean not null default false,
 last_sent_at timestamptz,next_send_at timestamptz not null,version bigint not null default 1,updated_at timestamptz not null default now()
);
create index report_schedules_due on public.report_schedules(next_send_at,id) where active;
create table public.report_schedule_deliveries(
 id uuid primary key default gen_random_uuid(),schedule_id uuid not null references public.report_schedules(id),due_at timestamptz not null,schedule_version bigint not null,
 recipient text not null,payload jsonb not null,state text not null default 'PENDING' check(state in ('PENDING','CLAIMED','SENT','FAILED','SKIPPED')),
 attempts integer not null default 0,claimed_at timestamptz,sent_at timestamptz,provider_id text,error text,
 unique(schedule_id,due_at,recipient)
);
create index report_schedule_delivery_due on public.report_schedule_deliveries(schedule_id,due_at,state);
alter table public.report_schedules enable row level security;
alter table public.report_schedule_deliveries enable row level security;
revoke all on public.report_schedules,public.report_schedule_deliveries from public,anon,authenticated;
grant select on public.report_schedules,public.report_schedule_deliveries to authenticated;
create policy schedules_read on public.report_schedules for select to authenticated using(app.has_module(store_id,'settings_manage'));
create policy scheduled_deliveries_read on public.report_schedule_deliveries for select to authenticated using(exists(select 1 from public.report_schedules s where s.id=schedule_id and app.has_module(s.store_id,'settings_manage')));

create function app_private.report_permission(p_kind text) returns text language sql immutable set search_path='' as $$
 select case p_kind when 'ONLINE_ORDERS' then 'reports_online' when 'CASH_UP' then 'cash_up_manage' when 'BUSINESS_PERFORMANCE' then 'reports_financial' when 'OUTSTANDING_PAYMENTS' then 'invoices_view_invoices' when 'OVERDUE_INVOICES' then 'invoices_view_invoices' when 'LOW_STOCK' then 'check_stock' when 'OUT_OF_STOCK' then 'check_stock' when 'UPCOMING_EXPIRY' then 'expiry' when 'STOCK_TAKE_COMPLETED' then 'stock_take' else 'reports' end
$$;
create function app_private.next_report_send(p_frequency text,p_time time,p_weekday integer,p_monthday integer,p_after timestamptz) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare local_after timestamp:=p_after at time zone 'Africa/Johannesburg';candidate timestamp;
begin
 candidate:=local_after::date+p_time;
 if p_frequency='DAILY' then if candidate<=local_after then candidate:=candidate+interval '1 day';end if;
 elsif p_frequency='WEEKLY' then candidate:=candidate+((p_weekday-extract(dow from candidate)::int+7)%7)*interval '1 day'; if candidate<=local_after then candidate:=candidate+interval '7 days';end if;
 else candidate:=date_trunc('month',local_after)+(p_monthday-1)*interval '1 day'+p_time; if candidate<=local_after then candidate:=candidate+interval '1 month';end if;end if;
 return candidate at time zone 'Africa/Johannesburg';
end $$;

create function public.save_report_schedule(p_store uuid,p_settings jsonb,p_id uuid default null,p_expected bigint default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.report_schedules%rowtype;settings public.report_schedules%rowtype;emails text[];result uuid;
begin
 if not app.has_module(p_store,'settings_manage') then raise exception 'FORBIDDEN';end if;
 if p_id is not null then select * into s from public.report_schedules where id=p_id and store_id=p_store for update;if not found or s.version is distinct from p_expected then raise exception 'ACCESS_CHANGED_REFRESH';end if;end if;
 settings:=jsonb_populate_record(null::public.report_schedules,p_settings);
 if settings.kind is null or not app.has_module(p_store,app_private.report_permission(settings.kind)) then raise exception 'FORBIDDEN';end if;
 if settings.name is null or length(btrim(settings.name)) not between 1 and 120 or settings.frequency is null or settings.frequency not in ('DAILY','WEEKLY','MONTHLY') or settings.send_time is null or settings.active is null or settings.weekday is null or settings.weekday not between 0 and 6 or settings.monthday is null or settings.monthday not between 1 and 28 then raise exception 'INVALID_NOTIFICATION_SETTINGS';end if;
 select array_agg(distinct lower(btrim(x))) into emails from unnest(settings.recipients) x;
 if cardinality(emails) is null or cardinality(emails) not between 1 and 20 or exists(select 1 from unnest(emails) x where length(x)>254 or x !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$') then raise exception 'INVALID_RECIPIENT';end if;
 if p_id is null and (select count(*) from public.report_schedules where store_id=p_store)>=50 then raise exception 'SCHEDULE_LIMIT';end if;
 if p_id is null then
  insert into public.report_schedules(store_id,created_by,name,kind,frequency,send_time,weekday,monthday,recipients,active,next_send_at)
  values(p_store,auth.uid(),btrim(settings.name),settings.kind,settings.frequency,settings.send_time,settings.weekday,settings.monthday,emails,settings.active,app_private.next_report_send(settings.frequency,settings.send_time,settings.weekday,settings.monthday,now())) returning id into result;
 else
  update public.report_schedules set created_by=auth.uid(),name=btrim(settings.name),kind=settings.kind,frequency=settings.frequency,send_time=settings.send_time,weekday=settings.weekday,monthday=settings.monthday,recipients=emails,active=settings.active,
   next_send_at=case when s.frequency=settings.frequency and s.send_time=settings.send_time and s.weekday=settings.weekday and s.monthday=settings.monthday and s.active and settings.active then s.next_send_at else app_private.next_report_send(settings.frequency,settings.send_time,settings.weekday,settings.monthday,now()) end,
   version=version+1,updated_at=now() where id=p_id returning id into result;
  update public.report_schedule_deliveries set state='SKIPPED',error='Schedule edited or deactivated' where schedule_id=p_id and state in ('PENDING','FAILED');
 end if;
 perform app.audit('report.schedule','report_schedules',result,app.store_business(p_store),p_store,to_jsonb(s),p_settings);
 return result;
end $$;
revoke all on function public.save_report_schedule(uuid,jsonb,uuid,bigint) from public,anon;
grant execute on function public.save_report_schedule(uuid,jsonb,uuid,bigint) to authenticated;

-- Keep payment classifications explicit: combined invoice CARD_EFT cannot be split reliably.
create function app_private.report_payments(p_store uuid,p_from date,p_to date) returns jsonb
language sql stable security definer set search_path='' as $$
 with bounds as (select p_from::timestamp at time zone 'Africa/Johannesburg' lo,(p_to+1)::timestamp at time zone 'Africa/Johannesburg' hi),payments as (
  select sp.method,sp.amount from public.sale_payments sp join public.goods_out g on g.id=sp.sale_id,bounds where g.store_id=p_store and g.created_at>=lo and g.created_at<hi
  union all select g.sale_type::text,g.total_amount from public.goods_out g,bounds where g.store_id=p_store and g.sale_type<>'CREDIT' and g.created_at>=lo and g.created_at<hi and not exists(select 1 from public.sale_payments sp where sp.sale_id=g.id)
  union all select method,amount from public.invoice_entries,bounds where store_id=p_store and created_at>=lo and created_at<hi and kind='PAYMENT'
  union all select coalesce(m.method,'UNCLASSIFIED'),-c.amount from public.credit_transactions c left join public.credit_payment_methods m on m.transaction_id=c.id,bounds where c.store_id=p_store and c.txn_type='PAYMENT' and c.reference_table is null and c.created_at>=lo and c.created_at<hi
 ) select jsonb_build_object('cash',coalesce(sum(amount) filter(where method='CASH'),0),'card',coalesce(sum(amount) filter(where method='CARD'),0),'eft',coalesce(sum(amount) filter(where method='EFT'),0),'card_eft_unclassified',coalesce(sum(amount) filter(where method='CARD_EFT'),0),'unclassified_payments',coalesce(sum(amount) filter(where method='UNCLASSIFIED'),0),'card_eft',coalesce(sum(amount) filter(where method in ('CARD','EFT','CARD_EFT')),0)) from payments
$$;
revoke all on function app_private.report_payments(uuid,date,date) from public,anon,authenticated;

-- A single bounded snapshot per task and period; recipient jobs reuse it.
create function app_private.scheduled_report_data(p_store uuid,p_kind text,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare body jsonb;start_at timestamptz:=p_from::timestamp at time zone 'Africa/Johannesburg';end_at timestamptz:=(p_to+1)::timestamp at time zone 'Africa/Johannesburg';
begin
 if p_kind='ONLINE_ORDERS' then return app_private.online_report(p_store,p_from,p_to);end if;
 if p_kind in ('LOW_STOCK','OUT_OF_STOCK') then
  with stock_levels as materialized (
   select p.id,p.name,app_private.online_available(p.id) quantity,p.min_stock_level,p.reorder_level
   from public.products p where p.store_id=p_store and p.is_active and p.tracking_type<>'SALES_ONLY'
  ), eligible as (select * from stock_levels where case when p_kind='OUT_OF_STOCK' then quantity<=0 else quantity<=greatest(min_stock_level,reorder_level) end)
  select jsonb_build_object('count',count(*),'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select name,quantity,min_stock_level,reorder_level from eligible order by name,id limit 100)x)) into body from eligible;
 elsif p_kind in ('OUTSTANDING_PAYMENTS','OVERDUE_INVOICES') then
  with invoices as materialized (
   select i.reference,i.customer_name,i.due_date,greatest(0,p_to-i.due_date) days_overdue,
    i.total-coalesce((select coalesce(sum(e.amount) filter(where e.kind in ('PAYMENT','CREDIT_NOTE')),0)-coalesce(sum(e.amount) filter(where e.kind='DEBIT_NOTE'),0) from public.invoice_entries e where e.invoice_id=i.id),0) outstanding
   from public.sales_invoices i where i.store_id=p_store and i.state not in ('DRAFT','CANCELLED')
  ),eligible as (select * from invoices where outstanding>0 and (p_kind='OUTSTANDING_PAYMENTS' or due_date<p_to))
  select jsonb_build_object('count',count(*),'metrics',jsonb_build_object('outstanding',coalesce(sum(outstanding),0)),'rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from eligible order by due_date,reference limit 100)x)) into body from eligible;
 elsif p_kind='STOCK_MOVEMENTS' then
  select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(to_jsonb(x)),'[]')) into body from (select movement_type,sum(quantity_delta) quantity_change,count(*) entries from public.stock_movements where store_id=p_store and created_at>=start_at and created_at<end_at group by movement_type order by movement_type)x;
 elsif p_kind='MOVING_PRODUCTS' then
  with sales as (
   select li.product_id,li.quantity,li.line_total value from public.goods_out_items li join public.goods_out g on g.id=li.goods_out_id where g.store_id=p_store and g.created_at>=start_at and g.created_at<end_at
   union all select li.product_id,li.quantity,li.net_total from public.sales_invoice_items li join public.sales_invoices i on i.id=li.invoice_id where i.store_id=p_store and i.goods_issued_at>=start_at and i.goods_issued_at<end_at
  ),products as (select p.id,p.name,coalesce(sum(s.quantity),0) quantity,coalesce(sum(s.value),0) value from public.products p left join sales s on s.product_id=p.id where p.store_id=p_store and p.is_active group by p.id),
  rows as ((select 'Top products' category,name,quantity,value from products order by quantity desc,id limit 5) union all (select 'Slow products' category,name,quantity,value from products order by quantity,id limit 5))
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

create or replace function public.claim_notification_deliveries(p_limit integer default 20) returns setof jsonb
language plpgsql security definer set search_path='' as $$
declare s public.report_schedules%rowtype;d public.report_schedule_deliveries%rowtype;body jsonb;date_to date;date_from date;email text;claimed integer:=0;
begin
 perform app_private.require_online_service();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT';end if;
 for s in select * from public.report_schedules where active and next_send_at<=now() order by next_send_at,id for update skip locked loop
  exit when claimed>=p_limit;
  if not app.member_has_module(s.created_by,s.store_id,'settings_manage') or not app.member_has_module(s.created_by,s.store_id,app_private.report_permission(s.kind)) then
   update public.report_schedules set active=false,updated_at=now() where id=s.id;continue;
  end if;
  date_to:=(s.next_send_at at time zone 'Africa/Johannesburg')::date-1;
  if s.frequency='MONTHLY' then date_to:=date_trunc('month',s.next_send_at at time zone 'Africa/Johannesburg')::date-1;end if;
  date_from:=case s.frequency when 'WEEKLY' then date_to-6 when 'MONTHLY' then date_trunc('month',date_to)::date else date_to end;
  if not exists(select 1 from public.report_schedule_deliveries where schedule_id=s.id and due_at=s.next_send_at and schedule_version=s.version) then
   body:=app_private.scheduled_report_data(s.store_id,s.kind,date_from,date_to);
   select body||jsonb_build_object('kind',s.kind,'name',s.name,'store',st.name,'business',b.name,'business_id',b.id,'currency',coalesce(st.currency,b.currency),'notes','Period totals use South African dates. Order value is not cash received. Lists are limited to 100 records; open POS INVENTORY for full detail. Invoice Card/EFT payments are combined where the original payment method was not separated. Supplier purchases and cash removals are not a complete operating-expense ledger; gross profit excludes overhead.') into body from public.stores st join public.businesses b on b.id=st.business_id where st.id=s.store_id;
   foreach email in array s.recipients loop
    insert into public.report_schedule_deliveries(schedule_id,due_at,schedule_version,recipient,payload) values(s.id,s.next_send_at,s.version,email,body)
    on conflict(schedule_id,due_at,recipient) do update set schedule_version=excluded.schedule_version,payload=excluded.payload,state=case when public.report_schedule_deliveries.state='SENT' then 'SENT' else 'PENDING' end,attempts=0,claimed_at=null;
   end loop;
  end if;
  -- Preserve successful deliveries when editing and advance an already-sent recipient set.
  if not exists(select 1 from unnest(s.recipients) r where not exists(select 1 from public.report_schedule_deliveries delivered where delivered.schedule_id=s.id and delivered.due_at=s.next_send_at and delivered.schedule_version=s.version and delivered.recipient=r and delivered.state='SENT')) then
   update public.report_schedules set last_sent_at=now(),next_send_at=app_private.next_report_send(s.frequency,s.send_time,s.weekday,s.monthday,greatest(now(),s.next_send_at)),updated_at=now() where id=s.id;
   continue;
  end if;
  for d in select * from public.report_schedule_deliveries where schedule_id=s.id and due_at=s.next_send_at and schedule_version=s.version and state in ('PENDING','FAILED','CLAIMED') and (claimed_at is null or claimed_at<now()-interval '10 minutes') and attempts<5 order by id for update skip locked loop
   exit when claimed>=p_limit;
   update public.report_schedule_deliveries set state='CLAIMED',claimed_at=now(),attempts=attempts+1,error=null where id=d.id;
   claimed:=claimed+1;return next jsonb_build_object('id',d.id,'recipient',d.recipient,'payload',d.payload);
  end loop;
 end loop;
end $$;
create function public.report_schedules_page(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not app.has_module(p_store,'settings_manage') then raise exception 'FORBIDDEN';end if;
 return (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('last_error',(select d.error from public.report_schedule_deliveries d where d.schedule_id=s.id and d.state='FAILED' order by d.claimed_at desc limit 1)) order by s.name,s.id),'[]') from public.report_schedules s where s.store_id=p_store);
end $$;
revoke all on function public.report_schedules_page(uuid) from public,anon;
grant execute on function public.report_schedules_page(uuid) to authenticated;
create or replace function public.complete_notification_delivery(p_delivery uuid,p_sent boolean,p_provider text default null,p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
declare d public.report_schedule_deliveries%rowtype;s public.report_schedules%rowtype;
begin
 perform app_private.require_online_service();
 select * into d from public.report_schedule_deliveries where id=p_delivery;if not found then raise exception 'DELIVERY_NOT_FOUND';end if;
 select * into s from public.report_schedules where id=d.schedule_id for update;
 select * into d from public.report_schedule_deliveries where id=p_delivery for update;
 if d.state='SENT' then return;end if;
 update public.report_schedule_deliveries set state=case when p_sent then 'SENT' else 'FAILED' end,sent_at=case when p_sent then now() else null end,provider_id=p_provider,error=left(p_error,500) where id=d.id;
 if p_sent and s.version=d.schedule_version and not exists(select 1 from public.report_schedule_deliveries where schedule_id=s.id and due_at=d.due_at and schedule_version=s.version and state<>'SENT') then
  update public.report_schedules set last_sent_at=now(),next_send_at=app_private.next_report_send(s.frequency,s.send_time,s.weekday,s.monthday,greatest(now(),d.due_at)),updated_at=now() where id=s.id;
 end if;
end $$;
create function public.scheduled_notification_authorized(p_delivery uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' and exists(select 1 from public.report_schedule_deliveries d join public.report_schedules s on s.id=d.schedule_id where d.id=p_delivery and d.state='CLAIMED' and s.active and s.version=d.schedule_version and app.member_has_module(s.created_by,s.store_id,'settings_manage') and app.member_has_module(s.created_by,s.store_id,app_private.report_permission(s.kind)))
$$;
revoke all on function public.scheduled_notification_authorized(uuid),public.claim_notification_deliveries(integer),public.complete_notification_delivery(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.scheduled_notification_authorized(uuid),public.claim_notification_deliveries(integer),public.complete_notification_delivery(uuid,boolean,text,text) to service_role;
revoke all on function app_private.report_permission(text),app_private.next_report_send(text,time,integer,integer,timestamptz),app_private.scheduled_report_data(uuid,text,date,date) from public,anon,authenticated;
-- Retire the obsolete UI without leaving two schedulers sending the same reports.
insert into public.report_schedules(store_id,created_by,name,kind,frequency,send_time,recipients,active,next_send_at)
select p.store_id,p.user_id,replace(p.kind,'_',' '),case when p.kind='WEEKLY_PROFIT' then 'BUSINESS_PERFORMANCE' else p.kind end,
case when p.kind='WEEKLY_PROFIT' then 'WEEKLY' else 'DAILY' end,make_time(p.delivery_hour,0,0),array[u.email],true,
app_private.next_report_send(case when p.kind='WEEKLY_PROFIT' then 'WEEKLY' else 'DAILY' end,make_time(p.delivery_hour,0,0),1,1,now())
from public.notification_preferences p join auth.users u on u.id=p.user_id where p.enabled and u.email is not null;
update public.notification_preferences set enabled=false,updated_at=now() where enabled;
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') and to_regclass('vault.secrets') is not null then
  perform cron.schedule('scheduled-report-email','* * * * *',$job$
   select net.http_post(url:='https://uagswjbtipvlyeychfyb.supabase.co/functions/v1/scheduled-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','x-notification-secret',(select decrypted_secret from vault.decrypted_secrets where name='pos_recurring_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=55000);
  $job$);
 end if;
end $$;

-- Hosted builds must not deploy these screens before their database contract exists.
do $$ declare source text;begin
 source:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 source:=regexp_replace(source,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''scheduled_reports_v1'',true,');execute source;
end $$;
