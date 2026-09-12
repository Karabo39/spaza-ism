-- Payments and immutable receipts are committed in the same transaction as stock.
create table public.sale_receipts (
 sale_id uuid primary key references public.goods_out(id),
 store_id uuid not null references public.stores(id),
 reference text not null unique,
 snapshot jsonb not null,
 request_payload jsonb not null,
 created_at timestamptz not null default now()
);
create index sale_receipts_store_date on public.sale_receipts(store_id,created_at desc);
create table public.sale_payments (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references public.sale_receipts(sale_id),
 method text not null check(method in ('CASH','CARD','EFT')),
 amount numeric(14,2) not null check(amount>0),
 tendered numeric(14,2) not null check(tendered>=amount),
 reference text,
 confirmed_by uuid not null references auth.users(id),
 unique(sale_id,method),
 check(method='CASH' or tendered=amount)
);
create table public.receipt_preferences (
 store_id uuid primary key references public.stores(id),
 second_copy boolean not null default false,
 delay_seconds integer not null default 3 check(delay_seconds between 2 and 5),
 paper_format text not null default '80mm' check(paper_format in ('58mm','80mm','A4'))
);
create table public.receipt_print_events (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references public.sale_receipts(sale_id),
 performed_by uuid not null references auth.users(id),
 action text not null check(action in ('REQUESTED','DECLINED','COPY_REQUESTED')),
 created_at timestamptz not null default now()
);
create index receipt_print_events_sale on public.receipt_print_events(sale_id,created_at);
alter table public.sale_receipts enable row level security;
alter table public.sale_payments enable row level security;
alter table public.receipt_preferences enable row level security;
alter table public.receipt_print_events enable row level security;
revoke all on public.sale_receipts,public.sale_payments,public.receipt_preferences,public.receipt_print_events from public,anon,authenticated;
grant select on public.sale_receipts,public.sale_payments,public.receipt_preferences,public.receipt_print_events to authenticated;
create policy receipt_read on public.sale_receipts for select to authenticated using(app.has_any_module(store_id,array['goods_out','reports','cash_up']));
create policy payment_read on public.sale_payments for select to authenticated using(exists(select 1 from public.sale_receipts r where r.sale_id=sale_payments.sale_id));
create policy receipt_preferences_read on public.receipt_preferences for select to authenticated using(app.has_module(store_id,'goods_out'));
create policy receipt_events_read on public.receipt_print_events for select to authenticated using(exists(select 1 from public.sale_receipts r where r.sale_id=receipt_print_events.sale_id));
create trigger immutable_receipt before update or delete on public.sale_receipts for each row execute function app.block_mutation();
create trigger immutable_payment before update or delete on public.sale_payments for each row execute function app.block_mutation();
create trigger immutable_print_event before update or delete on public.receipt_print_events for each row execute function app.block_mutation();

create function public.complete_checkout(p_store uuid,p_items jsonb,p_payments jsonb,p_request uuid,p_customer uuid default null,p_credit boolean default false,p_override boolean default false,p_override_token uuid default null,p_till text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare payload jsonb; existing public.goods_out%rowtype; pay jsonb; item jsonb; method text;
 amount numeric; total numeric:=0; paid numeric:=0; noncash numeric:=0; cash numeric:=0; cash_applied numeric; sid uuid; loc public.stores%rowtype; biz public.businesses%rowtype; doc jsonb;
begin
 perform app.require_module(p_store,array['goods_out']);
 if auth.uid() is null then raise exception 'FORBIDDEN';end if;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 if p_credit is null or p_override is null then raise exception 'INVALID_PAYMENT';end if;
 if length(coalesce(p_till,''))>80 then raise exception 'INVALID_TILL';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'NO_ITEMS';end if;
 if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments)>3 then raise exception 'INVALID_PAYMENT';end if;
 payload:=jsonb_build_object('user',auth.uid(),'items',p_items,'payments',p_payments,'customer',p_customer,'credit',p_credit,'override',p_override,'till',p_till);
 perform pg_advisory_xact_lock(hashtextextended(app.store_business(p_store)::text||p_request::text,0));
 select * into existing from public.goods_out where business_id=app.store_business(p_store) and request_id=p_request;
 if found then
  if existing.store_id<>p_store or not exists(select 1 from public.sale_receipts where sale_id=existing.id and request_payload=payload) then raise exception 'REQUEST_CONFLICT';end if;
  return existing.id;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if (item->>'unit_price') is null or (item->>'unit_price')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'unit_price')::numeric<0 or (item->>'unit_price')::numeric<>round((item->>'unit_price')::numeric,2) then raise exception 'INVALID_PRICE';end if;
  if (item->>'quantity') is null or (item->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric<>round((item->>'quantity')::numeric,3) then raise exception 'INVALID_QUANTITY';end if;
  total:=total+round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2);
 end loop;
 if total<=0 then raise exception 'INVALID_SALE_TOTAL';end if;
 if (select count(*)<>count(distinct value->>'method') from jsonb_array_elements(p_payments)) then raise exception 'DUPLICATE_PAYMENT_METHOD';end if;
 for pay in select value from jsonb_array_elements(p_payments) loop
  method:=pay->>'method';amount:=(pay->>'amount')::numeric;
  if method is null or method not in ('CASH','CARD','EFT') or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount<>round(amount,2) or amount>999999999999.99 then raise exception 'INVALID_PAYMENT';end if;
  if length(coalesce(pay->>'reference',''))>200 then raise exception 'INVALID_PAYMENT_REFERENCE';end if;
  if method<>'CASH' and (pay->>'confirmed')::boolean is distinct from true then raise exception 'PAYMENT_CONFIRMATION_REQUIRED';end if;
  paid:=paid+amount;
  if method='CASH' then cash:=amount;else noncash:=noncash+amount;end if;
 end loop;
 if p_credit then
  if jsonb_array_length(p_payments)<>0 then raise exception 'CREDIT_PAYMENT_NOT_ALLOWED';end if;
 else
  if paid<total then raise exception 'PAYMENT_UNDERPAID';end if;
  if noncash>total or (cash>0 and noncash>=total) then raise exception 'NONCASH_OVERPAYMENT';end if;
 end if;
 sid:=public.complete_sale(p_store,case when p_credit then 'CREDIT' when noncash>0 then 'CARD_EFT' else 'CASH' end,p_customer,p_items,p_override,null,p_request,null,p_override_token);
 select * into loc from public.stores where id=p_store;
 select * into biz from public.businesses where id=loc.business_id;
 cash_applied:=case when p_credit then 0 else total-noncash end;
 doc:=jsonb_build_object('id',sid,'reference','POS-'||upper(replace(sid::text,'-','')),'store',loc.name,'business',biz.name,'currency',loc.currency,
  'cashier',coalesce(nullif((select full_name from public.profiles where id=auth.uid()),''),'Team member'),'cashier_id',auth.uid(),'till',nullif(btrim(p_till),''),
  'created_at',(select created_at from public.goods_out where id=sid),'total',total,'discount',0,'tax',null,'status',case when p_credit then 'CREDIT' else 'PAID' end,
  'cash_tendered',cash,'change',case when cash>0 then cash-cash_applied else 0 end,
  'items',(select jsonb_agg(jsonb_build_object('name',p.name,'unit',p.unit,'quantity',i.quantity,'unit_price',i.unit_price,'total',i.line_total) order by i.id) from public.goods_out_items i join public.products p on p.id=i.product_id where i.goods_out_id=sid),
  'payments',(select coalesce(jsonb_agg(jsonb_build_object('method',value->>'method','amount',case when value->>'method'='CASH' then cash_applied else (value->>'amount')::numeric end,'reference',nullif(btrim(value->>'reference'),'')) order by value->>'method'),'[]') from jsonb_array_elements(p_payments)));
 insert into public.sale_receipts(sale_id,store_id,reference,snapshot,request_payload) values(sid,p_store,doc->>'reference',doc,payload);
 insert into public.sale_payments(sale_id,method,amount,tendered,reference,confirmed_by)
 select sid,value->>'method',case when value->>'method'='CASH' then cash_applied else (value->>'amount')::numeric end,(value->>'amount')::numeric,nullif(btrim(value->>'reference'),''),auth.uid() from jsonb_array_elements(p_payments);
 perform app.audit('checkout.complete','goods_out',sid,loc.business_id,p_store,null,jsonb_build_object('payments',doc->'payments','cash_tendered',cash,'change',doc->'change'));
 return sid;
end $$;
revoke all on function public.complete_checkout(uuid,jsonb,jsonb,uuid,uuid,boolean,boolean,uuid,text) from public,anon;
grant execute on function public.complete_checkout(uuid,jsonb,jsonb,uuid,uuid,boolean,boolean,uuid,text) to authenticated;

create function public.record_receipt_print(p_sale uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare loc uuid;
begin
 select store_id into loc from public.sale_receipts where sale_id=p_sale;
 perform app.require_module(loc,array['goods_out']);
 insert into public.receipt_print_events(sale_id,performed_by,action) values(p_sale,auth.uid(),p_action);
 perform app.audit('receipt.print_choice','goods_out',p_sale,app.store_business(loc),loc,null,jsonb_build_object('action',p_action,'physical_status','unverified'));
end $$;
revoke all on function public.record_receipt_print(uuid,text) from public,anon;
grant execute on function public.record_receipt_print(uuid,text) to authenticated;
create function public.save_receipt_preferences(p_store uuid,p_second boolean,p_delay integer,p_paper text default '80mm') returns void language plpgsql security definer set search_path='' as $$
begin
 perform app.require_module(p_store,array['goods_out']);
 if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN';end if;
 insert into public.receipt_preferences(store_id,second_copy,delay_seconds,paper_format) values(p_store,p_second,p_delay,p_paper) on conflict(store_id) do update set second_copy=excluded.second_copy,delay_seconds=excluded.delay_seconds,paper_format=excluded.paper_format;
 perform app.audit('receipt.settings','store',p_store,app.store_business(p_store),p_store,null,jsonb_build_object('second_copy',p_second,'delay',p_delay,'paper',p_paper));
end $$;
revoke all on function public.save_receipt_preferences(uuid,boolean,integer,text) from public,anon;
grant execute on function public.save_receipt_preferences(uuid,boolean,integer,text) to authenticated;

CREATE OR REPLACE FUNCTION app.cash_drawer_sources(p_store uuid, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
 with bounds as(select p_day::timestamp at time zone 'Africa/Johannesburg' lo,(p_day+1)::timestamp at time zone 'Africa/Johannesburg' hi),
 sources as (
  select 'sales' kind,g.id,case when exists(select 1 from public.sale_receipts r where r.sale_id=g.id) then coalesce((select amount from public.sale_payments p where p.sale_id=g.id and p.method='CASH'),0) else g.total_amount end amount from public.goods_out g,bounds where g.store_id=p_store and (g.sale_type='CASH' or exists(select 1 from public.sale_payments p where p.sale_id=g.id and p.method='CASH')) and g.created_at>=lo and g.created_at<hi
  union all select 'invoices',i.id,i.amount from public.invoice_entries i,bounds where i.store_id=p_store and i.kind='PAYMENT' and i.method='CASH' and i.created_at>=lo and i.created_at<hi
  union all select case when m.method is null then 'unclassified' else 'credit' end,c.id,-c.amount from public.credit_transactions c left join public.credit_payment_methods m on m.transaction_id=c.id,bounds
   where c.store_id=p_store and c.txn_type='PAYMENT' and c.reference_table is null and c.created_at>=lo and c.created_at<hi and (m.method is null or m.method='CASH')
  union all select 'refunds',r.id,-r.amount from public.customer_refunds r,bounds where r.store_id=p_store and r.method='CASH' and r.created_at>=lo and r.created_at<hi
  union all select case when kind='ADD' then 'added' else 'removed' end,id,case when kind='ADD' then amount else -amount end from public.cash_drawer_movements where store_id=p_store and business_date=p_day
 ) select jsonb_build_object(
  'sales',coalesce(sum(amount) filter(where kind='sales'),0),
  'invoices',coalesce(sum(amount) filter(where kind='invoices'),0),
  'credit',coalesce(sum(amount) filter(where kind='credit'),0),
  'refunds',-coalesce(sum(amount) filter(where kind='refunds'),0),
  'added',coalesce(sum(amount) filter(where kind='added'),0),
  'removed',-coalesce(sum(amount) filter(where kind='removed'),0),
  'net',coalesce(sum(amount) filter(where kind<>'unclassified'),0),
  'unclassified',coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount,
   'customer_name',(select u.name from public.credit_transactions t join public.customers u on u.id=(select customer_id from public.credit_accounts where id=t.credit_account_id) where t.id=sources.id),
   'created_at',(select created_at from public.credit_transactions where id=sources.id))) filter(where kind='unclassified'),'[]'::jsonb),
  'fingerprint',md5(coalesce(string_agg(kind||':'||id::text||':'||amount::text,',' order by kind,id),''))
 ) from sources;
$function$
;
CREATE OR REPLACE FUNCTION app.cash_sources(p_store uuid, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with bounds as(select p_day::timestamp at time zone 'Africa/Johannesburg' lo,(p_day+1)::timestamp at time zone 'Africa/Johannesburg' hi), events as(
 select case when sale_type='CASH' then 'cash_sales' when sale_type='CARD_EFT' then 'card_sales' else 'credit_issued' end kind,id,total_amount amount
 from public.goods_out,bounds where not exists(select 1 from public.sale_receipts r where r.sale_id=goods_out.id) and store_id=p_store and created_at>=lo and created_at<hi
 union all select 'credit_issued',i.id,greatest(i.total-coalesce((select sum(e.amount) from public.invoice_entries e where e.invoice_id=i.id and e.kind='PAYMENT' and e.created_at<=i.goods_issued_at),0),0) from public.sales_invoices i,bounds where i.store_id=p_store and i.terms='CREDIT' and i.goods_issued_at>=lo and i.goods_issued_at<hi
 union all select case when p.method='CASH' then 'cash_sales' else 'card_sales' end,g.id,p.amount from public.sale_payments p join public.goods_out g on g.id=p.sale_id,bounds where g.store_id=p_store and g.created_at>=lo and g.created_at<hi
 union all select 'credit_issued',g.id,g.total_amount from public.goods_out g join public.sale_receipts r on r.sale_id=g.id,bounds where g.store_id=p_store and g.sale_type='CREDIT' and g.created_at>=lo and g.created_at<hi
 union all select 'invoice_payments',id,amount from public.invoice_entries,bounds where store_id=p_store and kind='PAYMENT' and created_at>=lo and created_at<hi
 union all select 'credit_payments',id,-amount from public.credit_transactions,bounds where store_id=p_store and txn_type='PAYMENT' and reference_table is null and created_at>=lo and created_at<hi
 union all select 'refunds',id,amount from public.customer_refunds,bounds where store_id=p_store and created_at>=lo and created_at<hi
 ), totals as(select jsonb_build_object('cash_sales',coalesce(sum(amount) filter(where kind='cash_sales'),0),
 'card_sales',coalesce(sum(amount) filter(where kind='card_sales'),0),'credit_issued',coalesce(sum(amount) filter(where kind='credit_issued'),0),
 'invoice_payments',coalesce(sum(amount) filter(where kind='invoice_payments'),0),'credit_payments',coalesce(sum(amount) filter(where kind='credit_payments'),0),
 'refunds',coalesce(sum(amount) filter(where kind='refunds'),0),
 'net_collected',coalesce(sum(case when kind='refunds' then -amount when kind='credit_issued' then 0 else amount end),0)) activity,
 coalesce(string_agg(kind||id::text||amount::text,',' order by kind,id,amount),'') fingerprint from events), drawer as(select app.cash_drawer_sources(p_store,p_day) value)
 select value||jsonb_build_object('activity',activity,'fingerprint',md5((value->>'fingerprint')||totals.fingerprint)) from drawer,totals;
$function$
;
CREATE OR REPLACE FUNCTION public.prepare_document_email(p_type text, p_document uuid, p_request uuid, p_hash text, p_recipient text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare loc uuid;
begin if p_type='invoice' then perform app.require_module((select store_id from public.sales_invoices where id=p_document),array['invoices_view_invoices']);end if;
 if p_type='invoice' then select store_id into loc from public.sales_invoices where id=p_document;perform app.require_module(loc,array['invoices']);
 elsif p_type='return' then select store_id into loc from public.goods_returns where id=p_document and status='APPROVED';perform app.require_module(loc,array['returns']);
 elsif p_type='sale' then select store_id into loc from public.sale_receipts where sale_id=p_document;perform app.require_module(loc,array['goods_out']);
 else raise exception 'INVALID_DOCUMENT';end if;
 return app_private.prepare_report_email(loc,p_request,p_hash,p_recipient);
end $function$
;

create or replace view public.v_payment_activity with (security_invoker=true) as  SELECT g.id,
    g.store_id,
    g.business_id,
    g.created_at,
    g.sale_type::text AS method,
    g.total_amount AS amount,
    g.id::text AS reference,
    g.payment_reference,
    'CHECKOUT'::text AS source,
    g.id AS document_id
   FROM goods_out g
 WHERE g.sale_type='CREDIT' or not exists(select 1 from public.sale_receipts r where r.sale_id=g.id)
UNION ALL
 SELECT p.id,g.store_id,g.business_id,g.created_at,p.method,p.amount,r.reference,p.reference,'CHECKOUT'::text,g.id
 FROM public.sale_payments p join public.sale_receipts r on r.sale_id=p.sale_id join public.goods_out g on g.id=p.sale_id
UNION ALL
 SELECT e.id,
    e.store_id,
    e.business_id,
    e.created_at,
    e.method,
    e.amount,
    e.reference,
    e.payment_reference,
    'INVOICE_PAYMENT'::text AS source,
    e.invoice_id AS document_id
   FROM invoice_entries e
  WHERE e.kind = 'PAYMENT'::text
UNION ALL
 SELECT i.id,
    i.store_id,
    i.business_id,
    i.issued_at AS created_at,
    'CREDIT'::text AS method,
    i.total AS amount,
    i.reference,
    NULL::text AS payment_reference,
    'INVOICE_CREDIT'::text AS source,
    i.id AS document_id
   FROM sales_invoices i
  WHERE i.state = 'ISSUED'::text AND i.terms = 'CREDIT'::text
UNION ALL
 SELECT f.id,
    f.store_id,
    f.business_id,
    f.created_at,
    f.method,
    - f.amount AS amount,
    f.reference,
    f.payment_reference,
    'REFUND'::text AS source,
    f.return_id AS document_id
   FROM customer_refunds f;
