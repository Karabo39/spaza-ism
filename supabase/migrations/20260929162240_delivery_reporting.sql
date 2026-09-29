-- Delivery numbering is allocated transactionally per business and local calendar day.
create table app_private.delivery_number_counters (
 business_id uuid not null references public.businesses(id), number_date date not null,
 last_number bigint not null check(last_number>0), primary key(business_id,number_date)
);
alter table app_private.delivery_number_counters enable row level security;
revoke all on app_private.delivery_number_counters from public,anon,authenticated;
alter table public.order_deliveries drop constraint order_deliveries_reference_key;
alter table public.order_deliveries add constraint delivery_business_reference unique(business_id,reference);
alter table public.order_deliveries alter column reference drop default;
create function app_private.number_delivery() returns trigger language plpgsql security definer set search_path='' as $$
declare day date;n bigint;
begin
 day:=(new.created_at at time zone (select timezone from public.stores where id=new.store_id))::date;
 insert into app_private.delivery_number_counters(business_id,number_date,last_number) values(new.business_id,day,1)
 on conflict(business_id,number_date) do update set last_number=delivery_number_counters.last_number+1 returning last_number into n;
 -- A minimum of three digits; never truncate or block payments after 999 notes.
 new.reference:='DNN-'||to_char(day,'YYYYMMDD')||'-'||lpad(n::text,greatest(3,length(n::text)),'0');return new;
end $$;
revoke all on function app_private.number_delivery() from public,anon,authenticated;
create trigger number_delivery before insert on public.order_deliveries for each row execute function app_private.number_delivery();

-- Driver and vehicle are optional free-text fields, including when dispatching.
do $$ declare source text;begin
 select pg_get_functiondef('public.process_delivery(uuid,bigint,text,jsonb,uuid)'::regprocedure) into source;
 if position('DELIVERY_DRIVER_REQUIRED' in source)=0 then raise exception 'DELIVERY_DEFINITION_CHANGED';end if;
 source:=replace(source,'if nullif(btrim(d.driver_name),'''') is null or nullif(btrim(d.vehicle_registration),'''') is null then raise exception ''DELIVERY_DRIVER_REQUIRED'';end if;','');execute source;
end $$;

insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values
 ('reports_delivery','View Delivery Report','employee','reports','{}'),
 ('reports_delivery_print','Print Delivery Report','employee','reports',array['reports_delivery']),
 ('reports_delivery_excel','Export Delivery Report to Excel','employee','reports',array['reports_delivery']),
 ('reports_delivery_pdf','Export Delivery Report to PDF','employee','reports',array['reports_delivery']);
create index delivery_report_created on public.order_deliveries(store_id,created_at,sequence);

-- Private, reusable base selection. The public entry point validates every store first.
create function app_private.delivery_report_rows(p_stores uuid[],p_filters jsonb,p_until bigint)
returns table(sequence bigint,delivery_id uuid,order_id uuid,invoice_id uuid,delivery_number text,order_number text,invoice_number text,
 customer_name text,customer_contact text,store_id uuid,store_name text,driver_name text,vehicle_registration text,
 order_date date,delivery_date date,scheduled_date date,delivery_status text,order_total numeric,currency text,payment_status text,
 received_by text,comments text,cancellation_reason text,confirmed_by uuid,delivered_at timestamptz)
language sql stable set search_path='' as $$
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
$$;
revoke all on function app_private.delivery_report_rows(uuid[],jsonb,bigint) from public,anon,authenticated;

create function public.delivery_report(p_stores uuid[],p_filters jsonb default '{}',p_after bigint default null,p_until bigint default null,p_limit integer default 50,p_mode text default 'view')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare permission text;b uuid;watermark bigint;result jsonb;totals jsonb;
begin
 permission:=case p_mode when 'view' then 'reports_delivery' when 'print' then 'reports_delivery_print' when 'xlsx' then 'reports_delivery_excel' when 'pdf' then 'reports_delivery_pdf' end;
 if auth.uid() is null or permission is null or coalesce(cardinality(p_stores),0) not between 1 and 100 then raise exception 'FORBIDDEN';end if;
 select business_id into b from public.stores where id=p_stores[1];
 if b is null or exists(select 1 from unnest(p_stores) x(id) left join public.stores s on s.id=x.id where s.id is null or s.business_id<>b or not app.has_module(s.id,permission)) then raise exception 'FORBIDDEN';end if;
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or length(p_filters::text)>3000 or p_limit is null or p_limit not between 1 and 200
 or coalesce(p_filters->>'date_field','delivery') not in ('delivery','order','scheduled','delivered')
 or coalesce(p_filters->>'status','') not in ('','PENDING','SCHEDULED','OUT_FOR_DELIVERY','DELIVERED','RESCHEDULED','FAILED','CANCELLED')
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
 'pending',count(*) filter(where delivery_status='PENDING'),'scheduled',count(*) filter(where delivery_status='SCHEDULED'),
 'out_for_delivery',count(*) filter(where delivery_status='OUT_FOR_DELIVERY'),'rescheduled',count(*) filter(where delivery_status='RESCHEDULED'),
 'failed',count(*) filter(where delivery_status='FAILED'),'cancelled',count(*) filter(where delivery_status='CANCELLED'),
 'values',coalesce((select jsonb_agg(to_jsonb(v)) from (select currency,sum(order_total) total from filtered group by currency order by currency)v),'[]'::jsonb)) into totals from filtered;
 end if;
 return result||jsonb_build_object('summary',totals,'generated_at',now());
end $$;
revoke all on function public.delivery_report(uuid[],jsonb,bigint,bigint,integer,text) from public,anon;
grant execute on function public.delivery_report(uuid[],jsonb,bigint,bigint,integer,text) to authenticated;
do $$ declare source text;begin
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into source;
 source:=regexp_replace(source,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''delivery_reporting_v1'',true,');execute source;
end $$;
