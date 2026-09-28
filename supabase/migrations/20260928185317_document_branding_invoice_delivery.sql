alter table public.businesses add column document_logo_path text;
alter table public.businesses add constraint document_logo_scope check(document_logo_path is null or coalesce(app.logo_business(document_logo_path)=id,false));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('document-logos','document-logos',false,2097152,array['image/png']);
create policy document_logo_read on storage.objects for select to authenticated using(bucket_id='document-logos' and app.is_business_member(app.logo_business(name)));
create policy document_logo_insert on storage.objects for insert to authenticated with check(bucket_id='document-logos' and app.has_business_role(app.logo_business(name),'owner'));
create policy document_logo_delete on storage.objects for delete to authenticated using(bucket_id='document-logos' and app.has_business_role(app.logo_business(name),'owner') and not exists(select 1 from public.businesses b where b.document_logo_path=storage.objects.name));
do $$ declare definition text;begin
 select pg_get_functiondef('app.validate_business_logo()'::regprocedure) into definition;
 definition:=replace(replace(replace(replace(definition,'validate_business_logo','validate_document_logo'),'logo_path','document_logo_path'),'business-logos','document-logos'),'''business.logo''','''business.document_logo''');
 execute definition;
end $$;
revoke all on function app.validate_document_logo() from public,anon,authenticated;
create trigger validate_document_logo before insert or update of document_logo_path on public.businesses for each row execute function app.validate_document_logo();
create function public.set_document_logo(p_business uuid,p_path text,p_expected text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_business_role(p_business,'owner') then raise exception 'FORBIDDEN';end if;
 perform 1 from public.businesses where id=p_business for update;
 if (select document_logo_path from public.businesses where id=p_business) is distinct from p_expected then raise exception 'LOGO_CHANGED';end if;
 update public.businesses set document_logo_path=p_path where id=p_business;
end $$;
revoke all on function public.set_document_logo(uuid,text,text) from public,anon;
grant execute on function public.set_document_logo(uuid,text,text) to authenticated;

alter table public.customers add column auto_email_invoices boolean not null default false;
alter table public.customers add constraint customer_email_opt_in check(not auto_email_invoices or (email is not null and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
do $$ declare definition text;begin
 select pg_get_functiondef('public.update_customer_profile(uuid,timestamptz,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'customer_type=p_details','auto_email_invoices=coalesce((p_details->>''auto_email_invoices'')::boolean,c.auto_email_invoices),customer_type=p_details');execute definition;
end $$;

alter table public.recurring_invoices add column send_time time not null default '00:00';
alter table public.recurring_invoice_deliveries add column authorized_by uuid references auth.users(id);
update public.recurring_invoice_deliveries d set authorized_by=r.configured_by from public.sales_invoices i join public.recurring_invoices r on r.id=i.recurring_schedule_id where i.id=d.invoice_id;
create index invoice_delivery_author on public.recurring_invoice_deliveries(authorized_by);
create function app_private.queue_customer_invoice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient text;actor uuid:=auth.uid();
begin
 if new.state='ISSUED' and old.state is distinct from 'ISSUED' then
  select case when r.auto_email then r.recipient when c.auto_email_invoices then c.email end into recipient
  from public.customers c left join public.recurring_invoices r on r.id=new.recurring_schedule_id where c.id=new.customer_id and c.store_id=new.store_id;
  if nullif(recipient,'') is not null and actor is not null then
   insert into public.recurring_invoice_deliveries(invoice_id,store_id,recipient,authorized_by) values(new.id,new.store_id,recipient,actor) on conflict do nothing;
  end if;
 end if;return new;
end $$;
revoke all on function app_private.queue_customer_invoice() from public,anon,authenticated;
create trigger queue_customer_invoice after update of state on public.sales_invoices for each row execute function app_private.queue_customer_invoice();

do $$ declare definition text;begin
 select pg_get_functiondef('public.save_recurring_invoice(uuid,uuid,bigint,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'perform app.audit(''recurring.save''','update public.recurring_invoices set send_time=coalesce(nullif(p_details->>''send_time'','''')::time,old.send_time,''00:00''::time) where id=p_id; perform app.audit(''recurring.save''');execute definition;
 select pg_get_functiondef('app_private.generate_recurring_invoice(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'r.next_date>(now() at time zone ''Africa/Johannesburg'')::date','((r.next_date+r.send_time) at time zone (select timezone from public.stores where id=r.store_id))>now()');execute definition;
 select pg_get_functiondef('app_private.run_recurring_invoices()'::regprocedure) into definition;
 definition:=replace(definition,'select id from public.recurring_invoices where active','select schedule.id from public.recurring_invoices schedule join public.stores s on s.id=schedule.store_id where schedule.active');
 definition:=replace(definition,'next_date<=(now() at time zone ''Africa/Johannesburg'')::date','((next_date+send_time) at time zone s.timezone)<=now()');
 definition:=replace(definition,'order by next_date,id limit 50 for update skip locked','order by next_date,schedule.id limit 50 for update of schedule skip locked');execute definition;
 select pg_get_functiondef('public.claim_recurring_deliveries(int)'::regprocedure) into definition;
 definition:=replace(definition,'select d.*,r.configured_by','select d.*,coalesce(d.authorized_by,r.configured_by) as configured_by');
 definition:=replace(definition,'join public.recurring_invoices r on','left join public.recurring_invoices r on');
 definition:=replace(definition,'not app.can_manage_recurring(j.store_id)','(auth.uid() is null or not app.has_store_access(j.store_id) or not app.has_module(j.store_id,''invoices_view_invoices''))');
 definition:=replace(definition,'''id'',i.id,''token''','''logo_path'',(select document_logo_path from public.businesses where id=i.business_id),''id'',i.id,''token''');execute definition;
end $$;
-- Minute resolution; never before the selected local time. SMTP acceptance may follow later.
create table app_private.manual_invoice_requests (
 id uuid primary key, store_id uuid not null references public.stores(id),schedule_id uuid not null references public.recurring_invoices(id),
 actor uuid not null references auth.users(id),payload jsonb not null,invoice_id uuid not null references public.sales_invoices(id),created_at timestamptz not null default now()
);
alter table app_private.manual_invoice_requests enable row level security;
revoke all on app_private.manual_invoice_requests from public,anon,authenticated;
create index manual_invoice_store on app_private.manual_invoice_requests(store_id);
create index manual_invoice_schedule on app_private.manual_invoice_requests(schedule_id);
create index manual_invoice_actor on app_private.manual_invoice_requests(actor);
create index manual_invoice_document on app_private.manual_invoice_requests(invoice_id);
create function public.send_manual_recurring_invoice(p_store uuid,p_id uuid,p_expected bigint,p_details jsonb,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.recurring_invoices%rowtype;c public.customers%rowtype;prior app_private.manual_invoice_requests%rowtype;
 item jsonb;product public.products%rowtype;oid uuid;iid uuid;today date;q numeric;price numeric;tax numeric;days int;terms text;recipient text;total numeric:=0;balance numeric;lim numeric;seen uuid[]:='{}';
begin
 if not app.can_manage_recurring(p_store) or not exists(select 1 from public.stores where id=p_store and is_active and location_type='store') then raise exception 'FORBIDDEN';end if;
 if p_request is null or p_id is null or p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'INVALID_RECURRING_INVOICE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,2810));
 select * into prior from app_private.manual_invoice_requests where id=p_request;
 if prior.id is not null then
  if prior.store_id<>p_store or prior.schedule_id<>p_id or prior.actor<>auth.uid() or prior.payload<>p_details then raise exception 'REQUEST_CHANGED';end if;return prior.invoice_id;
 end if;
 select * into r from public.recurring_invoices where id=p_id for update;
 if r.id is null then
  perform public.save_recurring_invoice(p_store,p_id,p_expected,p_details||'{"active":false}'::jsonb);
  select * into r from public.recurring_invoices where id=p_id;
 elsif r.store_id<>p_store or r.version is distinct from p_expected then raise exception 'SCHEDULE_CHANGED';end if;
 -- Existing schedule settings, activation and next billing date are never changed.
 select * into c from public.customers where id=(p_details->>'customer_id')::uuid and store_id=p_store and is_active and not is_once_off for share;
 if c.id is null then raise exception 'CUSTOMER_REQUIRED';end if;
 recipient:=btrim(p_details->>'recipient');terms:=p_details->>'terms';tax:=(p_details->>'tax_percent')::numeric;days:=(p_details->>'due_days')::int;
 if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or terms is null or terms not in ('CASH','CARD_EFT','CREDIT') or tax is null or tax::text in ('NaN','Infinity','-Infinity') or tax not between 0 and 100 or days is null or days not between 0 and 365 then raise exception 'INVALID_RECURRING_INVOICE';end if;
 if terms='CREDIT' and not c.credit_enabled then raise exception 'CUSTOMER_CREDIT_DISABLED';end if;
 if jsonb_typeof(p_details->'items') is distinct from 'array' or jsonb_array_length(p_details->'items') not between 1 and 100 then raise exception 'NO_ITEMS';end if;
 today:=(now() at time zone (select timezone from public.stores where id=p_store))::date;
 oid:=gen_random_uuid();
 insert into public.sales_orders(id,business_id,store_id,customer_id,customer_name,status,confirmed_at,created_by,request_id,request_payload,note,quoted_tax_percent)
 values(oid,r.business_id,p_store,c.id,c.name,'CONFIRMED',now(),auth.uid(),gen_random_uuid(),jsonb_build_object('manual_recurring',p_id,'request',p_request),'Additional invoice: '||r.title,tax);
 for item in select value from jsonb_array_elements(p_details->'items') loop
  select * into product from public.products where id=(item->>'product_id')::uuid and store_id=p_store and is_active and bulk_parent_id is null;
  if product.id is null then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  if product.id=any(seen) then raise exception 'DUPLICATE_PRODUCT';end if;seen:=array_append(seen,product.id);
  q:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if q is null or q<=0 or q>999999999 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) or price is null or price<0 or price>999999999 or price::text in ('NaN','Infinity','-Infinity') or price<>round(price,2) then raise exception 'INVALID_RECURRING_ITEM';end if;
  insert into public.sales_order_items(order_id,product_id,product_name,unit,quantity,unit_price,line_total) values(oid,product.id,coalesce((select l->>'name' from jsonb_array_elements(r.items) l where l->>'product_id'=product.id::text),product.name),product.unit,q,price,round(q*price,2));
 end loop;
 iid:=app_private.create_sales_invoice(oid,today+days,terms,0,'Additional manual invoice: '||r.title);
 update public.sales_invoices set recurring_schedule_id=p_id,invoice_date=today where id=iid;
 if terms='CREDIT' then
  select a.balance,a.credit_limit into balance,lim from public.credit_accounts a where customer_id=c.id for update;
  if balance is null or lim is null or balance+(select i.total from public.sales_invoices i where i.id=iid)>lim then raise exception 'RECURRING_CREDIT_LIMIT_EXCEEDED';end if;
 end if;
 perform app_private.issue_sales_invoice(iid);
 insert into public.recurring_invoice_deliveries(invoice_id,store_id,recipient,authorized_by) values(iid,p_store,recipient,auth.uid())
 on conflict(invoice_id) do update set recipient=excluded.recipient,authorized_by=excluded.authorized_by;
 insert into app_private.manual_invoice_requests(id,store_id,schedule_id,actor,payload,invoice_id) values(p_request,p_store,p_id,auth.uid(),p_details,iid);
 perform app.audit('recurring.manual_send','sales_invoices',iid,r.business_id,p_store,null,jsonb_build_object('schedule',p_id,'recipient',recipient,'additional_invoice',true));
 return iid;
end $$;
revoke all on function public.send_manual_recurring_invoice(uuid,uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function public.send_manual_recurring_invoice(uuid,uuid,bigint,jsonb,uuid) to authenticated;
do $$ begin if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.schedule('recurring-invoice-generation','* * * * *','select app_private.run_recurring_invoices()');
 perform cron.alter_job((select jobid from cron.job where jobname='recurring-invoice-email'),schedule:='* * * * *');
end if;end $$;
do $$ declare definition text;begin
 select pg_get_viewdef('public.v_credit_customers'::regclass,true) into definition;
 definition:=replace(definition,'cu.credit_enabled','cu.credit_enabled,cu.auto_email_invoices');execute 'create or replace view public.v_credit_customers with(security_invoker=true) as '||definition;
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into definition;
 definition:=regexp_replace(definition,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''document_delivery_v1'',true,');
 if definition not like '%document_delivery_v1%' then raise exception 'Release contract pattern changed';end if;execute definition;
end $$;


