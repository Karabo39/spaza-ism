-- Confirmed orders, immutable invoice snapshots and an append-only receivables ledger.
create table public.billing_settings (
  business_id uuid primary key references public.businesses(id),
  tax_percent numeric(5,2) not null default 0 check(tax_percent between 0 and 100),
  return_approval_required boolean not null default true
);
create table public.sales_orders (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  store_id uuid not null, customer_id uuid not null references public.customers(id),
  reference text not null unique default ('ORD-'||upper(replace(gen_random_uuid()::text,'-',''))),
  status text not null default 'DRAFT' check(status in ('DRAFT','CONFIRMED','CANCELLED')),
  customer_name text not null, note text, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), confirmed_at timestamptz, cancellation_reason text,
  request_id uuid not null, request_payload jsonb not null, unique(business_id,request_id),
  foreign key(store_id,business_id) references public.stores(id,business_id)
);
create index sales_orders_location on public.sales_orders(store_id,created_at desc);
create table public.sales_order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.sales_orders(id),
  product_id uuid not null references public.products(id), product_name text not null, unit text not null,
  quantity numeric(14,3) not null check(quantity>0 and quantity::text<>'NaN'),
  unit_price numeric(14,2) not null check(unit_price>=0 and unit_price::text<>'NaN'),
  line_total numeric(14,2) not null check(line_total>=0 and line_total::text<>'NaN'), unique(order_id,product_id)
);
create table public.sales_invoices (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  store_id uuid not null, order_id uuid not null unique references public.sales_orders(id),
  customer_id uuid not null references public.customers(id), customer_name text not null,
  business_name text not null, store_name text not null, currency text not null,
  salesperson text not null, created_by uuid not null references auth.users(id),
  reference text not null unique default ('INV-'||upper(replace(gen_random_uuid()::text,'-',''))),
  state text not null default 'DRAFT' check(state in ('DRAFT','ISSUED','CANCELLED','VOID')),
  terms text not null check(terms in ('CASH','CARD_EFT','CREDIT')),
  subtotal numeric(14,2) not null, discount numeric(14,2) not null check(discount>=0 and discount<=subtotal),
  tax_percent numeric(5,2) not null check(tax_percent between 0 and 100), tax_amount numeric(14,2) not null,
  total numeric(14,2) not null check(total>=0 and total::text<>'NaN'), due_date date not null,
  note text, cancellation_reason text, created_at timestamptz not null default now(), issued_at timestamptz,
  goods_issued_at timestamptz, goods_issued_by uuid references auth.users(id), authorized_by uuid references auth.users(id),
  foreign key(store_id,business_id) references public.stores(id,business_id)
);
create index sales_invoices_location on public.sales_invoices(store_id,created_at desc);
create index sales_invoices_customer on public.sales_invoices(customer_id);
create table public.sales_invoice_items (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.sales_invoices(id),
  product_id uuid not null references public.products(id), product_name text not null, unit text not null,
  quantity numeric(14,3) not null check(quantity>0), unit_price numeric(14,2) not null,
  line_total numeric(14,2) not null, net_total numeric(14,2) not null, cost_price numeric(14,2) not null,
  batches jsonb not null default '[]', unique(invoice_id,product_id)
);
create table public.invoice_entries (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.sales_invoices(id),
  business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
  reference text not null unique default ('DOC-'||upper(replace(gen_random_uuid()::text,'-',''))),
  kind text not null check(kind in ('ISSUE','PAYMENT','CREDIT_NOTE','DEBIT_NOTE','VOID')),
  amount numeric(14,2) not null check(amount>=0 and amount::text<>'NaN'),
  method text check(method in ('CASH','CARD_EFT')), payment_reference text, reason text,
  performed_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  request_id uuid not null, request_payload jsonb not null, unique(business_id,request_id)
);
create index invoice_entries_invoice on public.invoice_entries(invoice_id,created_at);
create trigger invoice_entries_append_only before update or delete on public.invoice_entries for each row execute function app.block_mutation();
create trigger order_items_append_only before update or delete on public.sales_order_items for each row execute function app.block_mutation();
-- No client table writes; every workflow below verifies tenancy internally.
do $$ declare t text; begin
  foreach t in array array['billing_settings','sales_orders','sales_order_items','sales_invoices','sales_invoice_items','invoice_entries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
create policy billing_settings_read on public.billing_settings for select to authenticated using(app.has_business_role(business_id,'employee'));
create policy sales_orders_read on public.sales_orders for select to authenticated using(app.has_store_access(store_id));
create policy order_items_read on public.sales_order_items for select to authenticated using(exists(select 1 from public.sales_orders o where o.id=order_id));
create policy sales_invoices_read on public.sales_invoices for select to authenticated using(app.has_store_access(store_id));
create policy invoice_items_read on public.sales_invoice_items for select to authenticated using(exists(select 1 from public.sales_invoices i where i.id=invoice_id));
create policy invoice_entries_read on public.invoice_entries for select to authenticated using(app.has_store_access(store_id));

create view public.v_invoice_balances with(security_invoker=true) as
select i.*, coalesce(e.debits,0) debits, coalesce(e.credits,0) credits, coalesce(e.paid,0) paid,
  case when i.state='ISSUED' then i.total+coalesce(e.debits,0)-coalesce(e.credits,0)-coalesce(e.paid,0) else 0 end outstanding,
  case when i.state<>'ISSUED' then i.state
    when coalesce(e.credits,0)>=i.total+coalesce(e.debits,0) and coalesce(e.credits,0)>0 then 'CREDITED'
    when i.total+coalesce(e.debits,0)-coalesce(e.credits,0)-coalesce(e.paid,0)<=0 then 'PAID'
    when i.due_date<(now() at time zone 'Africa/Johannesburg')::date then 'OVERDUE'
    when coalesce(e.paid,0)>0 then 'PARTIALLY_PAID' else 'UNPAID' end status
from public.sales_invoices i left join lateral (
  select sum(amount) filter(where kind='DEBIT_NOTE') debits,sum(amount) filter(where kind='CREDIT_NOTE') credits,
    sum(amount) filter(where kind='PAYMENT') paid from public.invoice_entries where invoice_id=i.id
) e on true;
grant select on public.v_invoice_balances to authenticated;

create function app.post_customer_entry(p_customer uuid,p_amount numeric,p_kind app.credit_txn_type,p_reference_table text,p_reference uuid,p_note text)
returns void language plpgsql security definer set search_path=public,app as $$
declare a public.credit_accounts%rowtype;
begin
  select * into a from public.credit_accounts where customer_id=p_customer for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  update public.credit_accounts set balance=balance+p_amount,updated_at=now() where id=a.id;
  insert into public.credit_transactions(credit_account_id,business_id,store_id,txn_type,amount,balance_after,reference_table,reference_id,note,performed_by)
    values(a.id,a.business_id,a.store_id,p_kind,p_amount,a.balance+p_amount,p_reference_table,p_reference,p_note,auth.uid());
end $$;
revoke execute on function app.post_customer_entry(uuid,numeric,app.credit_txn_type,text,uuid,text) from public,anon,authenticated;

create function public.set_billing_settings(p_business uuid,p_tax numeric,p_return_approval boolean)
returns void language plpgsql security definer set search_path=public,app as $$
begin
  if not app.has_business_role(p_business,'owner') then raise exception 'FORBIDDEN'; end if;
  if p_tax is null or p_tax::text in ('NaN','Infinity','-Infinity') or p_tax<0 or p_tax>100 or p_return_approval is null then raise exception 'INVALID_SETTINGS'; end if;
  insert into public.billing_settings values(p_business,round(p_tax,2),p_return_approval) on conflict(business_id) do update set tax_percent=excluded.tax_percent,return_approval_required=excluded.return_approval_required;
  perform app.audit('billing.settings','business',p_business,p_business,null,null,jsonb_build_object('tax_percent',p_tax,'return_approval',p_return_approval));
end $$;

create function public.create_sales_order(p_store uuid,p_customer uuid,p_items jsonb,p_request uuid,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare biz uuid; oid uuid; customer text; item jsonb; product public.products%rowtype; q numeric; price numeric; payload jsonb; old public.sales_orders%rowtype;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.stores where id=p_store and location_type='warehouse') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
  biz:=app.store_business(p_store);
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('user',auth.uid(),'store',p_store,'customer',p_customer,'items',p_items,'note',p_note);
  perform pg_advisory_xact_lock(hashtextextended(biz::text||p_request::text,0));
  select * into old from public.sales_orders where business_id=biz and request_id=p_request;
  if found then if old.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return old.id; end if;
  select name into customer from public.customers where id=p_customer and store_id=p_store and is_active;
  if not found then raise exception 'CUSTOMER_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS'; end if;
  insert into public.sales_orders(business_id,store_id,customer_id,customer_name,note,created_by,request_id,request_payload)
    values(biz,p_store,p_customer,customer,p_note,auth.uid(),p_request,payload) returning id into oid;
  for item in select value from jsonb_array_elements(p_items) loop
    select * into product from public.products where id=(item->>'product_id')::uuid and store_id=p_store and is_active;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    q:=(item->>'quantity')::numeric; price:=coalesce((item->>'unit_price')::numeric,product.selling_price);
    if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) then raise exception 'INVALID_QUANTITY'; end if;
    if price is null or price<0 or price::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRICE'; end if;
    price:=round(price,2);
    insert into public.sales_order_items(order_id,product_id,product_name,unit,quantity,unit_price,line_total) values(oid,product.id,product.name,product.unit,q,price,round(q*price,2));
  end loop;
  perform app.audit('order.create','sales_orders',oid,biz,p_store,null,payload);
  return oid;
end $$;

create function public.process_sales_order(p_order uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path=public,app as $$
declare o public.sales_orders%rowtype;
begin
  select * into o from public.sales_orders where id=p_order for update;
  if not found or not app.has_store_access(o.store_id) then raise exception 'FORBIDDEN'; end if;
  if p_action='confirm' then
    if o.status='CONFIRMED' then return o.status; end if;
    if o.status<>'DRAFT' then raise exception 'INVALID_ORDER_STATE'; end if;
    update public.sales_orders set status='CONFIRMED',confirmed_at=now() where id=o.id;
  elsif p_action='cancel' then
    if o.status='CANCELLED' then return o.status; end if;
    if exists(select 1 from public.sales_invoices where order_id=o.id) then raise exception 'INVOICE_EXISTS'; end if;
    if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.sales_orders set status='CANCELLED',cancellation_reason=p_reason where id=o.id;
  else raise exception 'INVALID_ACTION'; end if;
  perform app.audit('order.'||p_action,'sales_orders',o.id,o.business_id,o.store_id,null,jsonb_build_object('reason',p_reason));
  return (select status from public.sales_orders where id=o.id);
end $$;

create function public.create_sales_invoice(p_order uuid,p_due date,p_terms text,p_discount numeric default 0,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare o public.sales_orders%rowtype; existing public.sales_invoices%rowtype; iid uuid; subtotal numeric; tax numeric; tax_amount numeric; total numeric; line record; allocated numeric:=0; base_allocated numeric:=0; net numeric;
begin
  select * into o from public.sales_orders where id=p_order for update;
  if not found or not app.has_store_access(o.store_id) then raise exception 'FORBIDDEN'; end if;
  if o.status<>'CONFIRMED' then raise exception 'ORDER_NOT_CONFIRMED'; end if;
  select * into existing from public.sales_invoices where order_id=o.id;
  if found then
    if existing.due_date is distinct from p_due or existing.terms is distinct from p_terms or existing.discount is distinct from p_discount or existing.note is distinct from p_note then raise exception 'REQUEST_CONFLICT'; end if;
    return existing.id;
  end if;
  if p_due is null or p_terms is null or p_terms not in ('CASH','CARD_EFT','CREDIT') then raise exception 'INVALID_INVOICE_DETAILS'; end if;
  select sum(line_total) into subtotal from public.sales_order_items where order_id=o.id;
  if p_discount is null or p_discount::text in ('NaN','Infinity','-Infinity') or p_discount<0 or p_discount>subtotal then raise exception 'INVALID_DISCOUNT'; end if;
  p_discount:=round(p_discount,2);
  select coalesce((select tax_percent from public.billing_settings where business_id=o.business_id),0) into tax;
  tax_amount:=round((subtotal-p_discount)*tax/100,2); total:=subtotal-p_discount+tax_amount;
  insert into public.sales_invoices(business_id,store_id,order_id,customer_id,customer_name,business_name,store_name,currency,salesperson,created_by,terms,subtotal,discount,tax_percent,tax_amount,total,due_date,note)
    select o.business_id,o.store_id,o.id,o.customer_id,o.customer_name,b.name,s.name,b.currency,coalesce(p.full_name,'Salesperson'),auth.uid(),p_terms,subtotal,p_discount,tax,tax_amount,total,p_due,p_note
    from public.businesses b join public.stores s on s.business_id=b.id left join public.profiles p on p.id=o.created_by where b.id=o.business_id and s.id=o.store_id returning id into iid;
  for line in select oi.*,p.cost_price from public.sales_order_items oi join public.products p on p.id=oi.product_id where order_id=o.id order by oi.id loop
    -- Differences of rounded cumulative amounts keep every line nonnegative and sum exactly.
    base_allocated:=base_allocated+line.line_total;
    net:=case when subtotal=0 then 0 else round(total*base_allocated/subtotal,2)-allocated end;
    allocated:=allocated+net;
    insert into public.sales_invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,line_total,net_total,cost_price)
      values(iid,line.product_id,line.product_name,line.unit,line.quantity,line.unit_price,line.line_total,net,line.cost_price);
  end loop;
  perform app.audit('invoice.create','sales_invoices',iid,o.business_id,o.store_id,null,jsonb_build_object('order',o.id,'total',total));
  return iid;
end $$;

create function public.issue_sales_invoice(p_invoice uuid)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare i public.sales_invoices%rowtype; eid uuid;
begin
  select * into i from public.sales_invoices where id=p_invoice for update;
  if not found or not app.has_store_access(i.store_id) then raise exception 'FORBIDDEN'; end if;
  if i.state='ISSUED' then return i.id; end if;
  if i.state<>'DRAFT' then raise exception 'INVALID_INVOICE_STATE'; end if;
  insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,reason,performed_by,request_id,request_payload)
    values(i.id,i.business_id,i.store_id,'ISSUE',i.total,i.reference,auth.uid(),gen_random_uuid(),'{}') returning id into eid;
  perform app.post_customer_entry(i.customer_id,i.total,'ADJUSTMENT','invoice_entries',eid,'Invoice '||i.reference);
  update public.sales_invoices set state='ISSUED',issued_at=now() where id=i.id;
  perform app.audit('invoice.issue','sales_invoices',i.id,i.business_id,i.store_id,null,jsonb_build_object('total',i.total));
  return i.id;
end $$;
do $$ declare sig regprocedure; begin
  for sig in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('set_billing_settings','create_sales_order','process_sales_order','create_sales_invoice','issue_sales_invoice') loop
    execute format('revoke execute on function %s from public,anon',sig); execute format('grant execute on function %s to authenticated',sig);
  end loop;
end $$;
