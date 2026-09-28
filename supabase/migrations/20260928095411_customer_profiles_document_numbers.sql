-- New references are business-wide, per document kind and South African calendar day.
create table app_private.document_sequences (
 business_id uuid not null references public.businesses(id), kind text not null,
 day date not null, value bigint not null check(value>0), primary key(business_id,kind,day)
);
alter table app_private.document_sequences enable row level security;
revoke all on app_private.document_sequences from public,anon,authenticated;
create function app_private.assign_document_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare n bigint; d date:=(statement_timestamp() at time zone 'Africa/Johannesburg')::date;
begin
 if tg_op='UPDATE' then
  if new.reference is distinct from old.reference then raise exception 'DOCUMENT_REFERENCE_LOCKED';end if;
  return new;
 end if;
 insert into app_private.document_sequences as seq values(new.business_id,tg_argv[0],d,1)
 on conflict(business_id,kind,day) do update set value=seq.value+1 returning value into n;
 new.reference:=tg_argv[0]||'-'||to_char(d,'YYYYMMDD')||'-'||lpad(n::text,greatest(3,length(n::text)),'0');
 return new;
end $$;
revoke all on function app_private.assign_document_reference() from public,anon,authenticated;
do $$ declare t text; k text;begin
 for t,k in values ('sales_orders','ORD'),('sales_invoices','INV'),('goods_returns','RET'),('sales_quotes','QUO') loop
  execute format('alter table public.%I drop constraint %I',t,t||'_reference_key');
  execute format('alter table public.%I add unique(business_id,reference)',t);
  execute format('create trigger document_reference before insert or update of reference on public.%I for each row execute function app_private.assign_document_reference(%L)',t,k);
 end loop;
end $$;

alter table public.customers
 add column customer_type text not null default 'INDIVIDUAL' check(customer_type in ('INDIVIDUAL','BUSINESS')),
 add column credit_enabled boolean not null default true,
 add column street text, add column suburb text, add column town text,
 add column province text, add column postal_code text, add column country text;
-- Keep existing integrations and credit eligibility unchanged. The new UI creates cash-only customers by default.
create function app_private.guard_customer_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if length(new.name)>200 or nullif(btrim(new.name),'') is null or length(new.phone)>50 or length(new.email)>254
 or (nullif(new.email,'') is not null and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 or greatest(length(new.street),length(new.suburb),length(new.town),length(new.province),length(new.country))>200 or length(new.postal_code)>30 then raise exception 'INVALID_CUSTOMER_PROFILE';end if;
 if tg_op='UPDATE' and new.credit_enabled is distinct from old.credit_enabled and auth.uid() is not null and not app.has_store_role(old.store_id,'manager') then raise exception 'FORBIDDEN';end if;
 if tg_op='UPDATE' then new.updated_at:=clock_timestamp();end if;
 return new;
end $$;
revoke all on function app_private.guard_customer_profile() from public,anon,authenticated;
create trigger zz_customer_profile_guard before insert or update on public.customers for each row execute function app_private.guard_customer_profile();
create or replace function app.guard_once_off_credit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_table_name='sales_invoices' and to_jsonb(new)->>'terms'='CREDIT') or (tg_table_name='goods_out' and to_jsonb(new)->>'sale_type'='CREDIT') then
  if exists(select 1 from public.customers where id=new.customer_id and is_once_off) then raise exception 'REGISTERED_CREDIT_CUSTOMER_REQUIRED';end if;
  if exists(select 1 from public.customers where id=new.customer_id and not credit_enabled) then raise exception 'CUSTOMER_CREDIT_DISABLED';end if;
 end if;return new;
end $$;
create function public.update_customer_profile(p_customer uuid,p_expected timestamptz,p_details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare c public.customers%rowtype;
begin
 select * into c from public.customers where id=p_customer for update;
 if auth.uid() is null or c.id is null or not app.has_module(c.store_id,'credit') or not app.has_store_access(c.store_id) then raise exception 'FORBIDDEN';end if;
 if c.updated_at is distinct from p_expected then raise exception 'CUSTOMER_CHANGED';end if;
 if jsonb_typeof(p_details)<>'object' or p_details is null then raise exception 'INVALID_CUSTOMER_PROFILE';end if;
 update public.customers set name=btrim(p_details->>'name'),phone=nullif(btrim(p_details->>'phone'),''),email=nullif(btrim(p_details->>'email'),''),
 customer_type=p_details->>'customer_type',credit_enabled=coalesce((p_details->>'credit_enabled')::boolean,c.credit_enabled),
 street=nullif(btrim(p_details->>'street'),''),suburb=nullif(btrim(p_details->>'suburb'),''),town=nullif(btrim(p_details->>'town'),''),
 province=nullif(btrim(p_details->>'province'),''),postal_code=nullif(btrim(p_details->>'postal_code'),''),country=nullif(btrim(p_details->>'country'),''),
 address=coalesce(nullif(concat_ws(', ',nullif(btrim(p_details->>'street'),''),nullif(btrim(p_details->>'suburb'),''),nullif(btrim(p_details->>'town'),''),nullif(btrim(p_details->>'province'),''),nullif(btrim(p_details->>'postal_code'),''),nullif(btrim(p_details->>'country'),'')),''),c.address),updated_at=clock_timestamp() where id=c.id;
 perform app.audit('customer.profile','customers',c.id,c.business_id,c.store_id,to_jsonb(c),(select to_jsonb(x) from public.customers x where id=c.id));
end $$;
revoke all on function public.update_customer_profile(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.update_customer_profile(uuid,timestamptz,jsonb) to authenticated;
create or replace view public.v_credit_customers with(security_invoker=true) as
 select cu.id customer_id,cu.business_id,cu.store_id,cu.name,cu.phone,cu.email,cu.is_active,
 ca.id credit_account_id,ca.credit_limit,ca.balance,greatest(ca.credit_limit-ca.balance,0) available_credit,
 (ca.balance>ca.credit_limit and ca.credit_limit>0) over_limit,
 cu.address,cu.customer_type,cu.credit_enabled
 from public.customers cu join public.credit_accounts ca on ca.customer_id=cu.id where not cu.is_once_off;

update public.module_catalog set label='Customers' where key='credit';
