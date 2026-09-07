create table public.sales_quotes (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
 store_id uuid not null references public.stores(id), customer_id uuid not null references public.customers(id), customer_name text not null,
 reference text not null unique default ('QUO-'||upper(replace(gen_random_uuid()::text,'-',''))),
 status text not null default 'DRAFT' check(status in ('DRAFT','SENT','ACCEPTED','CANCELLED','CONVERTED')),
 valid_until date not null, items jsonb not null, subtotal numeric(14,2) not null, discount numeric(14,2) not null,
 tax_percent numeric(5,2) not null, tax_amount numeric(14,2) not null,total numeric(14,2) not null,
 note text, version bigint not null default 1, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 order_id uuid unique references public.sales_orders(id), conversion_payload jsonb,
 request_id uuid not null,request_payload jsonb not null,unique(business_id,request_id)
);
create index sales_quotes_store on public.sales_quotes(store_id,created_at desc);
alter table public.sales_quotes enable row level security;
revoke all on public.sales_quotes from public,anon,authenticated;
grant select on public.sales_quotes to authenticated;
create policy quotes_read on public.sales_quotes for select to authenticated using(app.has_module(store_id,'invoices'));
alter table public.sales_orders add column quoted_tax_percent numeric(5,2),add column quoted_discount numeric(14,2);

create function public.save_quote(p_store uuid,p_customer uuid,p_items jsonb,p_valid date,p_discount numeric,p_note text,p_request uuid,p_quote uuid default null,p_expected bigint default 0) returns uuid
language plpgsql security definer set search_path=public,app as $$
#variable_conflict use_variable
declare old public.sales_quotes%rowtype; product public.products%rowtype; item jsonb; lines jsonb:='[]'; q numeric; price numeric; subtotal numeric:=0; tax numeric; tax_amount numeric; payload jsonb; result uuid; customer text;
begin
 perform app.require_module(p_store,array['invoices']);
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 payload:=jsonb_build_object('user',auth.uid(),'store',p_store,'customer',p_customer,'items',p_items,'valid',p_valid,'discount',p_discount,'note',p_note);
 perform pg_advisory_xact_lock(hashtextextended('quote:'||p_request::text,0));
 if p_quote is null then
  select * into old from public.sales_quotes where business_id=app.store_business(p_store) and request_id=p_request;
  if found then if old.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return old.id; end if;
 else
  select * into old from public.sales_quotes where id=p_quote for update;
  if not found or old.store_id<>p_store then raise exception 'FORBIDDEN'; end if;
  if old.request_id=p_request and old.request_payload=payload then return old.id; end if;
  if old.status<>'DRAFT' then raise exception 'QUOTE_NOT_DRAFT'; end if;
  if old.version is distinct from p_expected then raise exception 'QUOTE_CHANGED_REFRESH'; end if;
 end if;
 if p_valid is null or p_valid<(now() at time zone 'Africa/Johannesburg')::date then raise exception 'QUOTE_VALIDITY_REQUIRED'; end if;
 select name into customer from public.customers where id=p_customer and store_id=p_store and is_active;
 if not found then raise exception 'CUSTOMER_REQUIRED'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into product from public.products where id=(item->>'product_id')::uuid and store_id=p_store and is_active;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
  if exists(select 1 from jsonb_array_elements(lines) l where l->>'product_id'=product.id::text) then raise exception 'DUPLICATE_PRODUCT'; end if;
  q:=(item->>'quantity')::numeric; price:=coalesce((item->>'unit_price')::numeric,product.selling_price);
  if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) then raise exception 'INVALID_QUANTITY'; end if;
  if price is null or price<0 or price::text in ('NaN','Infinity','-Infinity') or price<>round(price,2) then raise exception 'INVALID_PRICE'; end if;
  subtotal:=subtotal+round(q*price,2);
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',product.id,'name',product.name,'unit',product.unit,'quantity',q,'unit_price',price,'line_total',round(q*price,2)));
 end loop;
 if p_discount is null or p_discount::text in ('NaN','Infinity','-Infinity') or p_discount<0 or p_discount>subtotal then raise exception 'INVALID_DISCOUNT'; end if;
 p_discount:=round(p_discount,2);
 tax:=coalesce(old.tax_percent,(select tax_percent from public.billing_settings where business_id=app.store_business(p_store)),0);
 tax_amount:=round((subtotal-p_discount)*tax/100,2);
 if p_quote is null then
  insert into public.sales_quotes(business_id,store_id,customer_id,customer_name,valid_until,items,subtotal,discount,tax_percent,tax_amount,total,note,created_by,request_id,request_payload)
  values(app.store_business(p_store),p_store,p_customer,customer,p_valid,lines,subtotal,p_discount,tax,tax_amount,subtotal-p_discount+tax_amount,p_note,auth.uid(),p_request,payload) returning id into result;
 else
  update public.sales_quotes set customer_id=p_customer,customer_name=customer,valid_until=p_valid,items=lines,subtotal=subtotal,discount=p_discount,tax_amount=tax_amount,total=subtotal-p_discount+tax_amount,note=p_note,version=version+1,request_id=p_request,request_payload=payload where id=p_quote returning id into result;
 end if;
 perform app.audit('quote.save','sales_quotes',result,app.store_business(p_store),p_store,null,payload);
 return result;
end $$;

create function public.set_quote_status(p_quote uuid,p_status text,p_expected bigint) returns void
language plpgsql security definer set search_path=public,app as $$
declare q public.sales_quotes%rowtype;
begin
 select * into q from public.sales_quotes where id=p_quote for update;
 perform app.require_module(q.store_id,array['invoices']);
 if q.status=p_status then return; end if;
 if q.version is distinct from p_expected then raise exception 'QUOTE_CHANGED_REFRESH'; end if;
 if q.status in ('CANCELLED','CONVERTED') or p_status not in ('SENT','ACCEPTED','CANCELLED') or p_status is null then raise exception 'INVALID_QUOTE_STATE'; end if;
 if p_status<>'CANCELLED' and q.valid_until<(now() at time zone 'Africa/Johannesburg')::date then raise exception 'QUOTE_EXPIRED'; end if;
 if q.status='ACCEPTED' and p_status='SENT' then raise exception 'INVALID_QUOTE_STATE'; end if;
 update public.sales_quotes set status=p_status,version=version+1 where id=q.id;
 perform app.audit('quote.status','sales_quotes',q.id,q.business_id,q.store_id,null,jsonb_build_object('status',p_status));
end $$;

create table public.sales_purchase_orders (
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.stores(id),
 quote_id uuid unique references public.sales_quotes(id),order_id uuid unique references public.sales_orders(id),
 received boolean not null default false,approved boolean not null default false,reference text,
 filename text,mime text,content bytea,version bigint not null default 1,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),approved_by uuid references auth.users(id),approved_at timestamptz,
 check(quote_id is not null or order_id is not null),check(not approved or received)
);
alter table public.sales_purchase_orders enable row level security;
revoke all on public.sales_purchase_orders from public,anon,authenticated;
-- File contents are returned only on an explicit download request.
grant select(id,store_id,quote_id,order_id,received,approved,reference,filename,mime,version,updated_by,updated_at,approved_by,approved_at) on public.sales_purchase_orders to authenticated;
create policy po_read on public.sales_purchase_orders for select to authenticated using(app.has_any_module(store_id,array['invoices','orders']));

create function public.convert_quote(p_quote uuid,p_items jsonb,p_expected bigint) returns uuid
language plpgsql security definer set search_path=public,app as $$
declare q public.sales_quotes%rowtype; item jsonb; original jsonb; lines jsonb:='[]'; qty numeric; available numeric; subtotal numeric:=0; oid uuid;
begin
 select * into q from public.sales_quotes where id=p_quote for update;
 perform app.require_module(q.store_id,array['invoices']); perform app.require_module(q.store_id,array['orders']);
 if q.status='CONVERTED' then
  if q.conversion_payload is distinct from p_items then raise exception 'QUOTE_ALREADY_CONVERTED'; end if; return q.order_id;
 end if;
 if q.version is distinct from p_expected then raise exception 'QUOTE_CHANGED_REFRESH'; end if;
 if q.status='CANCELLED' or q.valid_until<(now() at time zone 'Africa/Johannesburg')::date then raise exception 'QUOTE_EXPIRED_OR_CANCELLED'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS'; end if;
 for item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
  select value into original from jsonb_array_elements(q.items) where value->>'product_id'=item->>'product_id';
  if not found then raise exception 'QUOTE_PRODUCT_REQUIRED'; end if;
  qty:=(item->>'quantity')::numeric;
  if qty is null or qty<=0 or qty::text in ('NaN','Infinity','-Infinity') or qty<>round(qty,3) or qty>(original->>'quantity')::numeric then raise exception 'INVALID_QUANTITY'; end if;
  if exists(select 1 from jsonb_array_elements(lines) l where l->>'product_id'=item->>'product_id') then raise exception 'DUPLICATE_PRODUCT'; end if;
  select s.quantity into available from public.stock s join public.products p on p.id=s.product_id where p.id=(item->>'product_id')::uuid and s.store_id=q.store_id and p.is_active for update of s;
  if coalesce(available,0)<qty then raise exception 'QUOTE_STOCK_CHANGED'; end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',item->>'product_id','quantity',qty,'unit_price',original->'unit_price'));
  subtotal:=subtotal+round(qty*(original->>'unit_price')::numeric,2);
 end loop;
 oid:=public.create_sales_order(q.store_id,q.customer_id,lines,gen_random_uuid(),'From quotation '||q.reference||coalesce(': '||q.note,''));
 update public.sales_orders set quoted_tax_percent=q.tax_percent,quoted_discount=case when q.subtotal=0 then 0 else round(q.discount*subtotal/q.subtotal,2) end where id=oid;
 update public.sales_quotes set status='CONVERTED',order_id=oid,conversion_payload=p_items,version=version+1 where id=q.id;
 update public.sales_purchase_orders set order_id=oid where quote_id=q.id;
 if not found then
  insert into public.sales_purchase_orders(store_id,quote_id,order_id,updated_by) values(q.store_id,q.id,oid,auth.uid());
 end if;
 perform app.audit('quote.convert','sales_quotes',q.id,q.business_id,q.store_id,null,jsonb_build_object('order_id',oid,'items',lines));
 return oid;
end $$;
-- Quote terms follow the order into the invoice; current catalogue/settings cannot silently change them.
do $$ declare definition text; begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='create_sales_invoice';
 definition:=replace(definition,'if o.status<>''CONFIRMED''','if o.quoted_discount is not null then p_discount:=o.quoted_discount; end if; if o.status<>''CONFIRMED''');
 definition:=replace(definition,'select coalesce((select tax_percent from public.billing_settings where business_id=o.business_id),0) into tax;','select coalesce(o.quoted_tax_percent,(select tax_percent from public.billing_settings where business_id=o.business_id),0) into tax;');
 execute definition;
end $$;

create function public.save_purchase_order(p_quote uuid,p_order uuid,p_received boolean,p_approved boolean,p_reference text,p_filename text,p_mime text,p_content text,p_expected bigint) returns void
language plpgsql security definer set search_path=public,app as $$
declare loc uuid; old public.sales_purchase_orders%rowtype; bytes bytea;
begin
 if (p_quote is null)=(p_order is null) then raise exception 'DOCUMENT_REQUIRED'; end if;
 if p_quote is not null then select store_id into loc from public.sales_quotes where id=p_quote for update; else select store_id into loc from public.sales_orders where id=p_order for update; end if;
 perform app.require_module(loc,array['invoices','orders']);
 select * into old from public.sales_purchase_orders where (p_quote is not null and quote_id=p_quote) or (p_order is not null and order_id=p_order) for update;
 if coalesce(old.version,0) is distinct from p_expected then raise exception 'PO_CHANGED_REFRESH'; end if;
 if p_received is null or p_approved is null or (p_approved and not p_received) then raise exception 'INVALID_PO_STATE'; end if;
 if (p_approved is distinct from coalesce(old.approved,false) or (old.approved and (p_content is not null or p_reference is distinct from old.reference or p_received is distinct from old.received))) and not app.has_store_role(loc,'manager') then raise exception 'FORBIDDEN'; end if;
 if p_content is not null then
  if length(p_content)>2800000 or p_mime not in ('application/pdf','image/png','image/jpeg') or p_mime is null or nullif(p_filename,'') is null or length(p_filename)>180 then raise exception 'INVALID_PO_FILE'; end if;
  bytes:=decode(p_content,'base64');
  if octet_length(bytes) not between 1 and 2097152 then raise exception 'INVALID_PO_FILE'; end if;
 end if;
 if old.id is null then
  insert into public.sales_purchase_orders(store_id,quote_id,order_id,received,approved,reference,filename,mime,content,updated_by,approved_by,approved_at)
  values(loc,p_quote,coalesce(p_order,(select order_id from public.sales_quotes where id=p_quote)),p_received,p_approved,p_reference,p_filename,p_mime,bytes,auth.uid(),case when p_approved then auth.uid() end,case when p_approved then now() end);
 else
  update public.sales_purchase_orders set received=p_received,approved=p_approved,reference=p_reference,
   filename=case when bytes is null then filename else p_filename end,mime=case when bytes is null then mime else p_mime end,content=coalesce(bytes,content),version=version+1,updated_by=auth.uid(),updated_at=now(),
   approved_by=case when p_approved then auth.uid() end,approved_at=case when p_approved then now() end where id=old.id;
 end if;
 perform app.audit('document.purchase_order','sales_orders',coalesce(p_order,p_quote),app.store_business(loc),loc,null,jsonb_build_object('received',p_received,'approved',p_approved,'reference',p_reference,'filename',p_filename));
end $$;
create function public.download_purchase_order(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,app as $$
declare doc public.sales_purchase_orders%rowtype;
begin
 select * into doc from public.sales_purchase_orders where id=p_id;
 perform app.require_module(doc.store_id,array['invoices','orders']);
 return jsonb_build_object('filename',doc.filename,'mime',doc.mime,'content',encode(doc.content,'base64'));
end $$;
revoke all on function public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint),public.set_quote_status(uuid,text,bigint),public.convert_quote(uuid,jsonb,bigint),public.save_purchase_order(uuid,uuid,boolean,boolean,text,text,text,text,bigint),public.download_purchase_order(uuid) from public,anon;
grant execute on function public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint),public.set_quote_status(uuid,text,bigint),public.convert_quote(uuid,jsonb,bigint),public.save_purchase_order(uuid,uuid,boolean,boolean,text,text,text,text,bigint),public.download_purchase_order(uuid) to authenticated;

create index sales_quotes_customer on public.sales_quotes(customer_id);
create index sales_purchase_orders_store on public.sales_purchase_orders(store_id);

create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'document_workflows_v1', to_regprocedure('public.convert_quote(uuid,jsonb,bigint)') is not null and to_regprocedure('public.return_refund_summary(uuid)') is not null and to_regprocedure('public.stock_export(uuid,text,text)') is not null and to_regprocedure('public.download_purchase_order(uuid)') is not null,
    'order_workflow_v1', to_regprocedure('public.order_workflow_summary(uuid)') is not null,
    'brd_v102', to_regprocedure('public.invoice_summary(uuid)') is not null
      and exists(select 1 from pg_attribute where attrelid=to_regclass('public.stores') and attname='location_type' and not attisdropped),
    'module_access_v1', to_regprocedure('public.my_module_access(uuid)') is not null
      and to_regprocedure('public.set_store_module_access(uuid,uuid,jsonb,bigint)') is not null,
    'cash_up_v1', to_regprocedure('public.cash_up_summary(uuid,date)') is not null
      and to_regprocedure('public.submit_cash_up(uuid,numeric,jsonb,text,text,uuid)') is not null
  ));
$$;
revoke all on function public.app_schema_status() from public;
grant execute on function public.app_schema_status() to anon,authenticated,service_role;
