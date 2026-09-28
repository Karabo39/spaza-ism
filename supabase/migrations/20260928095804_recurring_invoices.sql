
create table public.recurring_invoices (
 id uuid primary key, business_id uuid not null references public.businesses(id), store_id uuid not null,
 customer_id uuid not null references public.customers(id), title text not null check(length(title) between 1 and 120),
 frequency text not null check(frequency in ('DAILY','WEEKLY','MONTHLY')),
 start_date date not null, next_date date not null, end_date date, anchor_day int not null check(anchor_day between 1 and 31),
 due_days int not null check(due_days between 0 and 365), terms text not null check(terms in ('CASH','CARD_EFT','CREDIT')),
 tax_percent numeric(5,2) not null check(tax_percent between 0 and 100), items jsonb not null,
 recipient text not null check(length(recipient)<=254), auto_email boolean not null default false,
 active boolean not null default false, configured_by uuid not null references auth.users(id),
 version bigint not null default 1, last_error text, last_run_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(store_id,business_id) references public.stores(id,business_id),
 check(next_date>=start_date), check(end_date is null or end_date>=start_date)
);
create index recurring_due on public.recurring_invoices(next_date,id) where active;
create index recurring_store on public.recurring_invoices(store_id,created_at desc,id);
create function app.can_manage_recurring(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and app.has_store_role(p_store,'manager') and app.has_module(p_store,'invoices')
 and app.has_module(p_store,'invoices_create_from_order') and app.has_module(p_store,'invoices_view_invoices')
 and app.has_module(p_store,'orders_recent')
$$;
revoke all on function app.can_manage_recurring(uuid) from public,anon;
grant execute on function app.can_manage_recurring(uuid) to authenticated;
alter table public.recurring_invoices enable row level security;
revoke all on public.recurring_invoices from public,anon,authenticated;
grant select on public.recurring_invoices to authenticated;
create policy recurring_read on public.recurring_invoices for select to authenticated using(app.can_manage_recurring(store_id));

alter table public.sales_invoices add column recurring_schedule_id uuid references public.recurring_invoices(id),
 add column billing_period date, add column invoice_date date,
 add column customer_snapshot jsonb;
create unique index invoice_recurring_period on public.sales_invoices(recurring_schedule_id,billing_period) where recurring_schedule_id is not null;
create function app_private.snapshot_invoice_customer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.customer_snapshot:=(select jsonb_build_object('name',c.name,'phone',c.phone,'email',c.email,'address',c.address,'customer_type',c.customer_type) from public.customers c where c.id=new.customer_id and c.store_id=new.store_id);
 if new.customer_snapshot is null then raise exception 'CUSTOMER_REQUIRED';end if;
 new.invoice_date:=coalesce(new.invoice_date,(now() at time zone 'Africa/Johannesburg')::date);
 return new;
end $$;
revoke all on function app_private.snapshot_invoice_customer() from public,anon,authenticated;
create trigger invoice_customer_snapshot before insert on public.sales_invoices for each row execute function app_private.snapshot_invoice_customer();

create function public.save_recurring_invoice(p_store uuid,p_id uuid,p_expected bigint,p_details jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.recurring_invoices%rowtype; c public.customers%rowtype; product public.products%rowtype; item jsonb; lines jsonb:='[]';
 q numeric; price numeric; d date; next_d date; end_d date; freq text; terms text; mail text; title text; tax numeric; days int; active boolean; automatic boolean;
begin
 if not app.can_manage_recurring(p_store) or not exists(select 1 from public.stores where id=p_store and is_active and location_type='store') then raise exception 'FORBIDDEN';end if;
 if p_id is null or p_expected is null or p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'INVALID_RECURRING_INVOICE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,2809));
 select * into old from public.recurring_invoices where id=p_id for update;
 if old.id is not null and (old.store_id<>p_store or old.version<>p_expected) then raise exception 'SCHEDULE_CHANGED';end if;
 if old.id is null and p_expected<>0 then raise exception 'SCHEDULE_CHANGED';end if;
 select * into c from public.customers where id=(p_details->>'customer_id')::uuid and store_id=p_store and is_active and not is_once_off;
 if c.id is null then raise exception 'CUSTOMER_REQUIRED';end if;
 d:=(p_details->>'start_date')::date;next_d:=(p_details->>'next_date')::date;end_d:=nullif(p_details->>'end_date','')::date;
 freq:=p_details->>'frequency';terms:=p_details->>'terms';mail:=btrim(p_details->>'recipient');title:=btrim(p_details->>'title');
 tax:=(p_details->>'tax_percent')::numeric;days:=(p_details->>'due_days')::int;active:=(p_details->>'active')::boolean;automatic:=(p_details->>'auto_email')::boolean;
 if d is null or next_d is null or next_d<d or freq is null or freq not in ('DAILY','WEEKLY','MONTHLY') or terms is null or terms not in ('CASH','CARD_EFT','CREDIT')
 or title is null or length(title) not between 1 and 120 or tax is null or tax::text in ('NaN','Infinity','-Infinity') or tax not between 0 and 100 or days is null or days not between 0 and 365
 or active is null or automatic is null or (end_d is not null and (end_d<d or (active and next_d>end_d)))
 or mail is null or length(mail)>254 or (mail<>'' and mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (automatic and mail='') then raise exception 'INVALID_RECURRING_INVOICE';end if;
 if terms='CREDIT' and not c.credit_enabled then raise exception 'CUSTOMER_CREDIT_DISABLED';end if;
 if jsonb_typeof(p_details->'items') is distinct from 'array' or jsonb_array_length(p_details->'items') not between 1 and 100 then raise exception 'NO_ITEMS';end if;
 for item in select value from jsonb_array_elements(p_details->'items') loop
  select * into product from public.products where id=(item->>'product_id')::uuid and store_id=p_store and is_active and bulk_parent_id is null;
  if product.id is null then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  q:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;
  if q is null or q<=0 or q>999999999 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) or price is null or price<0 or price>999999999 or price::text in ('NaN','Infinity','-Infinity') or price<>round(price,2) then raise exception 'INVALID_RECURRING_ITEM';end if;
  if exists(select 1 from jsonb_array_elements(lines) l where l->>'product_id'=product.id::text) then raise exception 'DUPLICATE_PRODUCT';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'unit',product.unit,'quantity',q,'unit_price',price));
 end loop;
 if old.id is not null and exists(select 1 from public.sales_invoices where recurring_schedule_id=p_id and billing_period>=next_d) then raise exception 'BILLING_PERIOD_ALREADY_GENERATED';end if;
 insert into public.recurring_invoices(id,business_id,store_id,customer_id,title,frequency,start_date,next_date,end_date,anchor_day,due_days,terms,tax_percent,items,recipient,auto_email,active,configured_by)
 values(p_id,c.business_id,p_store,c.id,title,freq,d,next_d,end_d,extract(day from d),days,terms,round(tax,2),lines,mail,automatic,active,auth.uid())
 on conflict(id) do update set customer_id=excluded.customer_id,title=excluded.title,frequency=excluded.frequency,start_date=excluded.start_date,next_date=excluded.next_date,end_date=excluded.end_date,anchor_day=excluded.anchor_day,due_days=excluded.due_days,terms=excluded.terms,tax_percent=excluded.tax_percent,items=excluded.items,recipient=excluded.recipient,auto_email=excluded.auto_email,active=excluded.active,configured_by=excluded.configured_by,version=old.version+1,updated_at=clock_timestamp(),last_error=null;
 perform app.audit('recurring.save','recurring_invoices',p_id,c.business_id,p_store,to_jsonb(old),(select to_jsonb(r) from public.recurring_invoices r where id=p_id));
 return p_id;
end $$;
revoke all on function public.save_recurring_invoice(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_recurring_invoice(uuid,uuid,bigint,jsonb) to authenticated;

create function public.set_recurring_active(p_id uuid,p_expected bigint,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.recurring_invoices%rowtype;
begin
 select * into r from public.recurring_invoices where id=p_id for update;
 if r.id is null or not app.can_manage_recurring(r.store_id) then raise exception 'FORBIDDEN';end if;
 if p_active is null or r.version is distinct from p_expected then raise exception 'SCHEDULE_CHANGED';end if;
 if p_active and r.end_date is not null and r.next_date>r.end_date then raise exception 'SCHEDULE_ENDED';end if;
 update public.recurring_invoices set active=p_active,version=version+1,configured_by=auth.uid(),updated_at=clock_timestamp() where id=p_id;
 perform app.audit('recurring.active','recurring_invoices',p_id,r.business_id,r.store_id,jsonb_build_object('active',r.active),jsonb_build_object('active',p_active));
end $$;
revoke all on function public.set_recurring_active(uuid,bigint,boolean) from public,anon;
grant execute on function public.set_recurring_active(uuid,bigint,boolean) to authenticated;

create function app_private.next_recurring_date(p_date date,p_frequency text,p_anchor int) returns date language sql immutable set search_path='' as $$
 select case p_frequency when 'DAILY' then p_date+1 when 'WEEKLY' then p_date+7 else
 (date_trunc('month',p_date)+interval '1 month')::date+least(p_anchor,extract(day from date_trunc('month',p_date)+interval '2 months'-interval '1 day')::int)-1 end
$$;
revoke all on function app_private.next_recurring_date(date,text,int) from public,anon,authenticated;
create table public.recurring_invoice_deliveries (
 invoice_id uuid primary key references public.sales_invoices(id),store_id uuid not null references public.stores(id),
 recipient text not null,state text not null default 'PENDING' check(state in ('PENDING','PROCESSING','SENT','UNCERTAIN','FAILED')),
 token uuid,provider text, last_error text,created_at timestamptz not null default now(),sent_at timestamptz
);
alter table public.recurring_invoice_deliveries enable row level security;
revoke all on public.recurring_invoice_deliveries from public,anon,authenticated;
grant select on public.recurring_invoice_deliveries to authenticated;
create policy recurring_delivery_read on public.recurring_invoice_deliveries for select to authenticated using(app.can_manage_recurring(store_id));

-- Only the private scheduler may run a saved mandate. It rechecks the configuring user's
-- current membership and module access; revoked access stops generation. No client can supply an actor.
create function app_private.generate_recurring_invoice(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.recurring_invoices%rowtype;c public.customers%rowtype; oid uuid;iid uuid;item jsonb;d date;balance numeric;lim numeric;claims text:=current_setting('request.jwt.claims',true);sub text:=current_setting('request.jwt.claim.sub',true);
begin
 select * into r from public.recurring_invoices where id=p_id for update;
 if r.id is null or not r.active or r.next_date>(now() at time zone 'Africa/Johannesburg')::date or (r.end_date is not null and r.next_date>r.end_date) then return null;end if;
 perform set_config('request.jwt.claim.sub',r.configured_by::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',r.configured_by,'role','authenticated')::text,true);
 if not app.can_manage_recurring(r.store_id) then raise exception 'SCHEDULE_ACCESS_REVOKED';end if;
 select * into c from public.customers where id=r.customer_id and store_id=r.store_id and is_active and not is_once_off for share;
 if c.id is null then raise exception 'CUSTOMER_REQUIRED';end if;
 if not exists(select 1 from public.stores where id=r.store_id and is_active and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE';end if;
 if r.terms='CREDIT' and not c.credit_enabled then raise exception 'CUSTOMER_CREDIT_DISABLED';end if;
 d:=r.next_date;
 select id into iid from public.sales_invoices where recurring_schedule_id=r.id and billing_period=d;
 if iid is null then
  oid:=gen_random_uuid();
  insert into public.sales_orders(id,business_id,store_id,customer_id,customer_name,status,confirmed_at,created_by,request_id,request_payload,note,quoted_tax_percent)
  values(oid,r.business_id,r.store_id,c.id,c.name,'CONFIRMED',now(),r.configured_by,gen_random_uuid(),jsonb_build_object('recurring',r.id,'period',d),'Recurring: '||r.title,r.tax_percent);
  for item in select value from jsonb_array_elements(r.items) loop
   if not exists(select 1 from public.products where id=(item->>'product_id')::uuid and store_id=r.store_id and is_active and bulk_parent_id is null) then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
   insert into public.sales_order_items(order_id,product_id,product_name,unit,quantity,unit_price,line_total)
   values(oid,(item->>'product_id')::uuid,item->>'name',item->>'unit',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2));
  end loop;
  iid:=app_private.create_sales_invoice(oid,d+r.due_days,r.terms,0,'Recurring: '||r.title||' | Billing period '||d);
  update public.sales_invoices set recurring_schedule_id=r.id,billing_period=d,invoice_date=d where id=iid;
  if r.terms='CREDIT' then
   select a.balance,a.credit_limit into balance,lim from public.credit_accounts a where customer_id=c.id for update;
   if balance+(select total from public.sales_invoices where id=iid)>lim then raise exception 'RECURRING_CREDIT_LIMIT_EXCEEDED';end if;
  end if;
  perform app_private.issue_sales_invoice(iid);
  if r.auto_email then insert into public.recurring_invoice_deliveries(invoice_id,store_id,recipient) values(iid,r.store_id,r.recipient) on conflict do nothing;end if;
  perform app.audit('recurring.generate','sales_invoices',iid,r.business_id,r.store_id,null,jsonb_build_object('schedule',r.id,'period',d,'automatic',true));
 end if;
 update public.recurring_invoices set next_date=app_private.next_recurring_date(d,r.frequency,r.anchor_day),active=(r.end_date is null or app_private.next_recurring_date(d,r.frequency,r.anchor_day)<=r.end_date),last_run_at=clock_timestamp(),last_error=null,version=version+1 where id=r.id;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);
 return iid;
end $$;
revoke all on function app_private.generate_recurring_invoice(uuid) from public,anon,authenticated;
create function app_private.run_recurring_invoices() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;n int:=0;failed int:=0;msg text;
begin
 for r in select id from public.recurring_invoices where active and (last_error is null or last_run_at<now()-interval '1 hour') and next_date<=(now() at time zone 'Africa/Johannesburg')::date and (end_date is null or next_date<=end_date) order by next_date,id limit 50 for update skip locked loop
  begin
   if app_private.generate_recurring_invoice(r.id) is not null then n:=n+1;end if;
  exception when others then
   failed:=failed+1;msg:=case when sqlstate='P0001' then sqlerrm else 'GENERATION_FAILED' end;
   update public.recurring_invoices set last_error=msg,last_run_at=clock_timestamp() where id=r.id;
  end;
 end loop;
 return jsonb_build_object('generated',n,'failed',failed);
end $$;
revoke all on function app_private.run_recurring_invoices() from public,anon,authenticated;
-- Five-minute bounded runs catch up missed periods without long transactions or duplicates.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('recurring-invoice-generation','*/5 * * * *','select app_private.run_recurring_invoices()');
 end if;
end $$;

alter table public.recurring_invoice_deliveries add column claimed_at timestamptz;
create function public.claim_recurring_deliveries(p_limit int default 10) returns jsonb language plpgsql security definer set search_path='' as $$
declare j record; result jsonb:='[]';t uuid;claims text:=current_setting('request.jwt.claims',true);sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if coalesce(nullif(claims,'')::jsonb->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 update public.recurring_invoice_deliveries set state='UNCERTAIN',last_error='Delivery confirmation missing. Review before sending again.' where state='PROCESSING' and claimed_at<now()-interval '15 minutes';
 for j in select d.*,r.configured_by from public.recurring_invoice_deliveries d join public.sales_invoices i on i.id=d.invoice_id join public.recurring_invoices r on r.id=i.recurring_schedule_id where d.state='PENDING' order by d.created_at,d.invoice_id limit greatest(1,least(coalesce(p_limit,10),10)) for update of d skip locked loop
  perform set_config('request.jwt.claim.sub',j.configured_by::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',j.configured_by,'role','authenticated')::text,true);
  if not app.can_manage_recurring(j.store_id) or not exists(select 1 from public.sales_invoices where id=j.invoice_id and state='ISSUED') then
   update public.recurring_invoice_deliveries set state='FAILED',last_error='Invoice cancelled or schedule author no longer has access.' where invoice_id=j.invoice_id;
  else
   t:=gen_random_uuid();update public.recurring_invoice_deliveries set state='PROCESSING',token=t,claimed_at=now() where invoice_id=j.invoice_id;
   result:=result||jsonb_build_array((select jsonb_build_object('id',i.id,'token',t,'recipient',j.recipient,'reference',i.reference,'business',i.business_name,'store',i.store_name,'customer',i.customer_snapshot,'date',i.invoice_date,'due',i.due_date,'currency',i.currency,'subtotal',i.subtotal,'tax_percent',i.tax_percent,'tax',i.tax_amount,'total',i.total,'lines',(select jsonb_agg(jsonb_build_object('name',l.product_name,'quantity',l.quantity,'price',l.unit_price,'total',l.line_total) order by l.id) from public.sales_invoice_items l where l.invoice_id=i.id)) from public.sales_invoices i where i.id=j.invoice_id));
  end if;
 end loop;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);
 return result;
end $$;
create function public.complete_recurring_delivery(p_invoice uuid,p_token uuid,p_provider text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 update public.recurring_invoice_deliveries set state=case when nullif(p_provider,'') is null then 'UNCERTAIN' else 'SENT' end,provider=p_provider,sent_at=case when nullif(p_provider,'') is not null then now() end,last_error=case when nullif(p_provider,'') is null then 'Delivery unconfirmed. Review before sending again.' end where invoice_id=p_invoice and token=p_token and state='PROCESSING';
 if not found then raise exception 'INVALID_RESERVATION';end if;
end $$;
revoke all on function public.claim_recurring_deliveries(int),public.complete_recurring_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_recurring_deliveries(int),public.complete_recurring_delivery(uuid,uuid,text) to service_role;
-- Keep the existing durable SMTP reservation; add one service-only delivery kind.
do $$ declare definition text;begin
 select pg_get_functiondef('public.smtp_delivery(text,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'notification-[0-9a-f-]{36}|employee-invitation','recurring-[0-9a-f-]{36}|notification-[0-9a-f-]{36}|employee-invitation');
 execute definition;
end $$;
-- Revoking customer credit also prevents unpaid goods issue on an already-created invoice.
do $$ declare definition text;begin
 select pg_get_functiondef('app_private.issue_invoice_goods(uuid,boolean,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'if b.outstanding>0 then','if b.outstanding>0 then if exists(select 1 from public.customers where id=i.customer_id and not credit_enabled) then raise exception ''CUSTOMER_CREDIT_DISABLED'';end if;');
 execute definition;
end $$;

do $$ declare definition text;begin
 select pg_get_viewdef('public.v_invoice_balances'::regclass,true) into definition;
 definition:=replace(definition,'i.invoiced_by_name','i.invoiced_by_name, i.recurring_schedule_id, i.billing_period, i.invoice_date, i.customer_snapshot');
 execute 'create or replace view public.v_invoice_balances with (security_invoker=true) as '||definition;
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into definition;
 definition:=regexp_replace(definition,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''customer_recurring_v1'',true,');
 if definition not like '%customer_recurring_v1%' then raise exception 'Release contract pattern changed';end if;
 execute definition;
end $$;
