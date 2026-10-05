-- Customer ordering is a restricted mode of the existing catalogue and order ledger.
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values
 ('orders_online','View Online Orders','employee','orders','{}'),
 ('orders_online_process','Process online orders and confirm payments','employee','orders_online','{}'),
 ('orders_online_settings','Manage customer ordering links and settings','employee','orders_online','{}'),
 ('products_online','Manage online product availability and images','employee','products','{}');

alter table public.products add column available_online boolean not null default false,
 add column online_description text, add column online_price numeric(14,2) check(online_price>=0 and online_price::text not in ('NaN','Infinity','-Infinity')),
 add column online_image_path text,add column online_variant_group text,add column online_variant_name text;
create index products_online_catalog on public.products(store_id,id) where available_online and is_active;
create index order_items_online_reservations on public.sales_order_items(product_id,order_id);
alter table public.sales_orders alter column created_by drop not null;

create table public.online_ordering_settings (
 store_id uuid primary key references public.stores(id),link_token uuid not null unique default gen_random_uuid(),
 enabled boolean not null default false,collection_enabled boolean not null default true,delivery_enabled boolean not null default false,
 pay_on_collection boolean not null default true,delivery_fee numeric(14,2) not null default 0 check(delivery_fee>=0 and delivery_fee::text not in ('NaN','Infinity','-Infinity')),
 payment_instructions text not null default '',reservation_hours integer not null default 24 check(reservation_hours between 1 and 72),
 notifications_enabled boolean not null default true,version bigint not null default 1,
 check(collection_enabled or delivery_enabled),check(length(payment_instructions)<=4000)
);
insert into public.online_ordering_settings(store_id) select id from public.stores where location_type='store';
alter table public.online_ordering_settings enable row level security;
revoke all on public.online_ordering_settings from public,anon,authenticated;
grant select on public.online_ordering_settings to authenticated;
create policy online_settings_read on public.online_ordering_settings for select to authenticated using(app.has_module(store_id,'orders_online_settings'));

create table public.online_orders (
 order_id uuid primary key references public.sales_orders(id),store_id uuid not null references public.stores(id),
 invoice_id uuid unique references public.sales_invoices(id),fulfilment text not null check(fulfilment in ('COLLECTION','DELIVERY')),
 payment_option text not null check(payment_option in ('BANK_TRANSFER','PAY_ON_COLLECTION')),payment_reference text not null unique,
 status text not null default 'RECEIVED' check(status in ('RECEIVED','PROCESSING','READY_FOR_COLLECTION','READY_FOR_DELIVERY','COLLECTED','CANCELLED','EXPIRED')),
 collection_date date not null,expires_at timestamptz not null,delivery_fee numeric(14,2) not null default 0,
 tax_percent numeric(5,2) not null,total numeric(14,2) not null,payment_confirmed_at timestamptz,payment_confirmed_by uuid references auth.users(id),
 reservation_released boolean not null default false,courier_company text,tracking_number text,tracking_url text,
 cancellation_reason text,version bigint not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index online_orders_page on public.online_orders(store_id,created_at desc,order_id desc);
create index online_orders_expiry on public.online_orders(expires_at,order_id) where not reservation_released;
create index online_orders_payment_actor on public.online_orders(payment_confirmed_by);
alter table public.online_orders enable row level security;
revoke all on public.online_orders from public,anon,authenticated;
grant select on public.online_orders to authenticated;
create policy online_orders_read on public.online_orders for select to authenticated using(app.has_module(store_id,'orders_online'));
create table app_private.online_order_secrets(order_id uuid primary key references public.online_orders(order_id),secret text not null);
create table app_private.online_action_requests(request_id uuid primary key,payload jsonb not null,order_id uuid not null references public.online_orders(order_id));
create table app_private.online_rate_limits(key text primary key,window_start timestamptz not null,hits integer not null);
alter table app_private.online_order_secrets enable row level security;
alter table app_private.online_action_requests enable row level security;
alter table app_private.online_rate_limits enable row level security;
revoke all on app_private.online_order_secrets,app_private.online_action_requests,app_private.online_rate_limits from public,anon,authenticated;

create function app_private.online_reserved(p_product uuid) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(l.quantity),0) from public.sales_order_items l join public.online_orders o on o.order_id=l.order_id
 join public.sales_orders s on s.id=o.order_id where l.product_id=p_product and not o.reservation_released
 and s.status<>'CANCELLED' and (o.payment_confirmed_at is not null or o.expires_at>now())
$$;
create function app_private.online_available(p_product uuid) returns numeric language sql stable security definer set search_path='' as $$
 select case when p.tracking_type='SALES_ONLY' then 999999 else greatest(coalesce(s.quantity,0)
 -coalesce((select sum(b.quantity) from public.stock_batches b where b.product_id=p.id and b.expiry_date<(now() at time zone st.timezone)::date),0)
 -app_private.online_reserved(p.id),0) end
 from public.products p join public.stores st on st.id=p.store_id left join public.stock s on s.product_id=p.id and s.store_id=p.store_id where p.id=p_product
$$;
create function app_private.guard_online_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare reserved numeric;begin reserved:=app_private.online_reserved(new.product_id); if reserved>0 and new.quantity<reserved then raise exception 'STOCK_RESERVED_ONLINE';end if;return new;end $$;
create trigger protect_online_stock before update of quantity on public.stock for each row execute function app_private.guard_online_stock();
-- Invoice release consumes its own reservation inside the same stock transaction.
do $$ declare s text;begin
 s:=pg_get_functiondef('app.apply_stock_delta(uuid,uuid,uuid,numeric,app.movement_type,text,text,uuid,numeric)'::regprocedure);
 s:=replace(s,'v_after := v_before + p_delta;',
 'if p_ref_table=''sales_invoices'' then update public.online_orders set reservation_released=true where invoice_id=p_ref_id and not reservation_released;end if; v_after := v_before + p_delta;');
 execute s;
end $$;

create function public.save_online_ordering_settings(p_store uuid,p_expected bigint,p_values jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.online_ordering_settings%rowtype;
begin
 if not app.has_module(p_store,'orders_online_settings') or not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'FORBIDDEN';end if;
 insert into public.online_ordering_settings(store_id) values(p_store) on conflict do nothing;
 select * into r from public.online_ordering_settings where store_id=p_store for update;
 if r.version is distinct from p_expected then raise exception 'SETTINGS_CHANGED';end if;
 if coalesce((p_values->>'enabled')::boolean,false) and nullif(btrim(p_values->>'payment_instructions'),'') is null then raise exception 'PAYMENT_INSTRUCTIONS_REQUIRED';end if;
 update public.online_ordering_settings set enabled=(p_values->>'enabled')::boolean,collection_enabled=(p_values->>'collection_enabled')::boolean,
 delivery_enabled=(p_values->>'delivery_enabled')::boolean,pay_on_collection=(p_values->>'pay_on_collection')::boolean,
 delivery_fee=(p_values->>'delivery_fee')::numeric,payment_instructions=btrim(p_values->>'payment_instructions'),
 reservation_hours=(p_values->>'reservation_hours')::integer,notifications_enabled=(p_values->>'notifications_enabled')::boolean,version=version+1 where store_id=p_store;
 perform app.audit('online.settings','stores',p_store,app.store_business(p_store),p_store,to_jsonb(r),p_values);
 return r.link_token;
end $$;
create function public.save_product_online(p_product uuid,p_expected timestamptz,p_values jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype;path text;
begin
 select * into p from public.products where id=p_product for update;
 if p.id is null or not app.has_module(p.store_id,'products_online') then raise exception 'FORBIDDEN';end if;
 if p.updated_at is distinct from p_expected then raise exception 'PRODUCT_CHANGED';end if;
 path:=nullif(p_values->>'online_image_path','');
 if path is not null and (path not like p.business_id::text||'/'||p.store_id::text||'/'||p.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='online-product-images' and name=path)) then raise exception 'INVALID_PRODUCT_IMAGE';end if;
 if length(p_values->>'online_description')>4000 or length(p_values->>'online_variant_group')>150 or length(p_values->>'online_variant_name')>150 then raise exception 'DETAILS_TOO_LONG';end if;
 update public.products set available_online=(p_values->>'available_online')::boolean,online_description=nullif(btrim(p_values->>'online_description'),''),
 online_price=nullif(p_values->>'online_price','')::numeric,online_image_path=path,online_variant_group=nullif(btrim(p_values->>'online_variant_group'),''),online_variant_name=nullif(btrim(p_values->>'online_variant_name'),'') where id=p.id;
 perform app.audit('product.online','products',p.id,p.business_id,p.store_id,null,p_values);
end $$;

-- Preserve staff attribution checks; customer-mode orders have no staff actor.
do $$ declare s text;begin
 s:=pg_get_functiondef('app.capture_document_staff()'::regprocedure);
 s:=replace(s,'if new.created_by is distinct from auth.uid() or auth.uid() is null then',
 $replacement$if tg_table_name='sales_orders' and tg_op='INSERT' and new.created_by is null and new.ordered_by_name='Online customer' and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')='service_role' then return new;end if; if new.created_by is distinct from auth.uid() or auth.uid() is null then$replacement$);execute s;
end $$;

-- Only the public Edge Function's service role calls customer RPCs. No direct anonymous table access.
create function app_private.require_online_service() returns void language plpgsql set search_path='' as $$
begin if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;end $$;
create function public.online_rate_limit(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin perform app_private.require_online_service();
 insert into app_private.online_rate_limits(key,window_start,hits) values(p_key,now(),1)
 on conflict(key) do update set hits=case when app_private.online_rate_limits.window_start<now()-interval '10 minutes' then 1 else app_private.online_rate_limits.hits+1 end,
 window_start=case when app_private.online_rate_limits.window_start<now()-interval '10 minutes' then now() else app_private.online_rate_limits.window_start end returning hits into n;
 return n<=10;
end $$;
create function public.customer_catalog(p_link uuid,p_search text default '',p_after uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.online_ordering_settings%rowtype;shop jsonb;items jsonb;next_id uuid;
begin perform app_private.require_online_service();
 select * into r from public.online_ordering_settings where link_token=p_link and enabled;
 if r.store_id is null or not exists(select 1 from public.stores where id=r.store_id and is_active and location_type='store') then raise exception 'SHOP_UNAVAILABLE';end if;
 select jsonb_build_object('name',s.name,'business',b.name,'address',coalesce(s.address,b.document_address,''),'contact',b.document_phone,
 'currency',s.currency,'collection_enabled',r.collection_enabled,'delivery_enabled',r.delivery_enabled,'pay_on_collection',r.pay_on_collection,'delivery_fee',r.delivery_fee,
 'tax_percent',coalesce(bs.tax_percent,0),'payment_instructions',r.payment_instructions,'reservation_hours',r.reservation_hours,'today',(now() at time zone s.timezone)::date)
 into shop from public.stores s join public.businesses b on b.id=s.business_id left join public.billing_settings bs on bs.business_id=b.id where s.id=r.store_id;
 with page as (select p.* from public.products p where p.store_id=r.store_id and p.is_active and p.available_online and (p_after is null or p.id>p_after)
 and (coalesce(p_search,'')='' or p.name ilike '%'||left(p_search,100)||'%') order by p.id limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'description',coalesce(online_description,description,''),'price',coalesce(online_price,selling_price),
 'unit',unit,'image_path',online_image_path,'variant_group',online_variant_group,'variant',online_variant_name,'available',app_private.online_available(id)>0) order by id),'[]') into items from page;
 if jsonb_array_length(items)=25 then next_id:=(items->24->>'id')::uuid;end if;
 return jsonb_build_object('shop',shop,'products',items,'next',next_id);
end $$;

create function public.place_customer_order(p_link uuid,p_request uuid,p_secret text,p_contact jsonb,p_items jsonb,p_fulfilment text,p_date date,p_payment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.online_ordering_settings%rowtype;s public.stores%rowtype;oid uuid;cid uuid;tax numeric;total numeric:=0;fee numeric;v jsonb;p public.products%rowtype;q numeric;price numeric;payload jsonb;prior public.sales_orders%rowtype;ref text;expires timestamptz;
begin perform app_private.require_online_service();
 if p_request is null or p_secret!~'^[a-f0-9]{64}$' or p_secret is null then raise exception 'INVALID_REQUEST';end if;
 select * into r from public.online_ordering_settings where link_token=p_link and enabled;
 select * into s from public.stores where id=r.store_id and is_active and location_type='store';
 if s.id is null then raise exception 'SHOP_UNAVAILABLE';end if;
 payload:=jsonb_build_object('link',p_link,'contact',p_contact,'items',p_items,'fulfilment',p_fulfilment,'date',p_date,'payment',p_payment,'secret',md5(p_secret));
 perform pg_advisory_xact_lock(hashtextextended(s.id::text,511));
 perform pg_advisory_xact_lock(hashtextextended(s.business_id::text||p_request::text,0));
 select * into prior from public.sales_orders where business_id=s.business_id and request_id=p_request;
 if prior.id is not null then if prior.request_payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return jsonb_build_object('order_id',prior.id);end if;
 if nullif(btrim(p_contact->>'name'),'') is null or length(p_contact->>'name')>150 or nullif(btrim(p_contact->>'phone'),'') is null or length(p_contact->>'phone')>80
 or length(p_contact->>'email')>254 or length(p_contact->>'address')>1000 or length(p_contact->>'notes')>1000
 or (nullif(p_contact->>'email','') is not null and p_contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_CONTACT';end if;
 if p_fulfilment is null or p_fulfilment not in ('COLLECTION','DELIVERY') or (p_fulfilment='COLLECTION' and not r.collection_enabled) or (p_fulfilment='DELIVERY' and (not r.delivery_enabled or nullif(btrim(p_contact->>'address'),'') is null)) then raise exception 'FULFILMENT_UNAVAILABLE';end if;
 if p_payment is null or p_payment not in ('BANK_TRANSFER','PAY_ON_COLLECTION') or (p_payment='PAY_ON_COLLECTION' and (p_fulfilment<>'COLLECTION' or not r.pay_on_collection)) then raise exception 'INVALID_PAYMENT';end if;
 if p_date is null or p_date<(now() at time zone s.timezone)::date or p_date>(now() at time zone s.timezone)::date+14 then raise exception 'INVALID_COLLECTION_DATE';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'INVALID_ITEMS';end if;
 if (select count(distinct value->>'product_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_PRODUCT';end if;
 if (select count(*) from public.online_orders where store_id=s.id and payment_confirmed_at is null and expires_at>now() and status not in ('CANCELLED','EXPIRED'))>=100 then raise exception 'SHOP_BUSY';end if;
 insert into public.customers(business_id,store_id,name,phone,email,address,is_once_off,credit_enabled,email_notifications)
 values(s.business_id,s.id,btrim(p_contact->>'name'),btrim(p_contact->>'phone'),nullif(btrim(p_contact->>'email'),''),nullif(btrim(p_contact->>'address'),''),true,false,coalesce((p_contact->>'email_notifications')::boolean,false)) returning id into cid;
 select coalesce(tax_percent,0) into tax from public.billing_settings where business_id=s.business_id;tax:=coalesce(tax,0);
 fee:=case when p_fulfilment='DELIVERY' then r.delivery_fee else 0 end;
 ref:='ONL-'||to_char(now() at time zone s.timezone,'YYYYMMDD')||'-'||upper(left(replace(p_request::text,'-',''),10));
 insert into public.sales_orders(business_id,store_id,customer_id,customer_name,reference,status,confirmed_at,created_by,ordered_by_name,request_id,request_payload,note,quoted_tax_percent,delivery_required,delivery_details)
 values(s.business_id,s.id,cid,btrim(p_contact->>'name'),ref,'CONFIRMED',now(),null,'Online customer',p_request,payload,p_contact->>'notes',tax,p_fulfilment='DELIVERY',jsonb_build_object('date',p_date,'address',p_contact->>'address','phone',p_contact->>'phone','notes',p_contact->>'notes')) returning id into oid;
 -- Sorted product and stock locks match POS checkout. Prices/availability are always authoritative.
 for v in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
  select * into p from public.products where id=(v->>'product_id')::uuid and store_id=s.id and is_active and available_online for update;
  if p.id is null then raise exception 'PRODUCT_UNAVAILABLE';end if;
  q:=(v->>'quantity')::numeric;
  if q is null or q<=0 or q>10000 or q<>round(q,3) or q::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_QUANTITY';end if;
  perform 1 from public.stock where product_id=p.id and store_id=s.id for update;
  if app_private.online_available(p.id)<q then raise exception 'PRODUCT_UNAVAILABLE';end if;
  price:=coalesce(p.online_price,p.selling_price);
  insert into public.sales_order_items(order_id,product_id,product_name,unit,quantity,unit_price,line_total) values(oid,p.id,p.name||coalesce(' · '||p.online_variant_name,''),p.unit,q,price,round(q*price,2));
  total:=total+round(q*price,2);
 end loop;
 total:=round((total+fee)*(1+tax/100),2);
 expires:=case when p_payment='PAY_ON_COLLECTION' then (p_date+1)::timestamp at time zone s.timezone else now()+make_interval(hours=>r.reservation_hours) end;
 insert into public.online_orders(order_id,store_id,fulfilment,payment_option,payment_reference,collection_date,expires_at,delivery_fee,tax_percent,total)
 values(oid,s.id,p_fulfilment,p_payment,left(regexp_replace(upper(p_contact->>'name'),'[^A-Z0-9]','','g'),20)||'-'||ref,p_date,expires,fee,tax,total);
 insert into app_private.online_order_secrets values(oid,p_secret);
 return jsonb_build_object('order_id',oid);
end $$;

create function app_private.online_customer_status(p_order uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.order_id,'reference',so.reference,'customer',so.customer_name,'store',s.name,'store_address',coalesce(s.address,b.document_address,''),'currency',s.currency,
 'date',o.created_at,'fulfilment',o.fulfilment,'payment_option',o.payment_option,'payment_reference',o.payment_reference,'payment_status',case when o.payment_confirmed_at is not null then 'Payment Confirmed' else 'Awaiting Payment Confirmation' end,
 'status',case when so.status='CANCELLED' then 'CANCELLED' when d.status is not null and d.status not in ('CREATED','PENDING') then d.status else o.status end,
 'total',o.total,'delivery_fee',o.delivery_fee,'tax_percent',o.tax_percent,'expires_at',o.expires_at,'scheduled_date',coalesce(d.scheduled_date,o.collection_date),
 'invoice_number',i.reference,'delivery_number',d.reference,'courier_company',o.courier_company,'tracking_number',o.tracking_number,'tracking_url',o.tracking_url,
 'comments',coalesce(d.comments,so.note),'cancellation_reason',coalesce(o.cancellation_reason,so.cancellation_reason,d.cancellation_reason),'payment_instructions',st.payment_instructions,
 'lines',(select jsonb_agg(jsonb_build_object('name',l.product_name,'quantity',l.quantity,'unit',l.unit,'price',l.unit_price,'total',l.line_total) order by l.id) from public.sales_order_items l where l.order_id=o.order_id))
 from public.online_orders o join public.sales_orders so on so.id=o.order_id join public.stores s on s.id=o.store_id join public.businesses b on b.id=s.business_id
 join public.online_ordering_settings st on st.store_id=s.id left join public.sales_invoices i on i.id=o.invoice_id left join public.order_deliveries d on d.invoice_id=i.id where o.order_id=p_order
$$;
create function public.customer_order_status(p_link uuid,p_order uuid,p_secret text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform app_private.require_online_service();
 if p_secret is null or p_secret!~'^[a-f0-9]{64}$' or not exists(select 1 from app_private.online_order_secrets k join public.online_orders o on o.order_id=k.order_id join public.online_ordering_settings s on s.store_id=o.store_id where k.order_id=p_order and k.secret=p_secret and s.link_token=p_link) then raise exception 'ORDER_NOT_FOUND';end if;
 return app_private.online_customer_status(p_order);
end $$;

create function public.online_orders_page(p_store uuid,p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin if not app.has_module(p_store,'orders_online') then raise exception 'FORBIDDEN';end if;
 select coalesce(jsonb_agg(app_private.online_customer_status(order_id)||jsonb_build_object('version',version,'invoice_id',invoice_id) order by created_at desc,order_id desc),'[]') into rows
 from (select * from public.online_orders where store_id=p_store and (p_before is null or (created_at,order_id)<(p_before,p_before_id)) order by created_at desc,order_id desc limit 25) page;
 return rows;
end $$;

create function public.process_online_order(p_order uuid,p_expected bigint,p_action text,p_details jsonb,p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.online_orders%rowtype;so public.sales_orders%rowtype;i uuid;prior app_private.online_action_requests%rowtype;payload jsonb;amount numeric;reason text;
begin
 select * into so from public.sales_orders where id=p_order for update;
 select * into o from public.online_orders where order_id=p_order for update;
 if o.order_id is null or not app.has_module(o.store_id,'orders_online_process') then raise exception 'FORBIDDEN';end if;
 if p_request is null or p_details is null then raise exception 'INVALID_REQUEST';end if;
 payload:=jsonb_build_object('actor',auth.uid(),'order',p_order,'action',p_action,'details',p_details,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,510));
 select * into prior from app_private.online_action_requests where request_id=p_request;
 if prior.request_id is not null then if prior.payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return;end if;
 if o.version is distinct from p_expected then raise exception 'ORDER_CHANGED';end if;
 if so.status='CANCELLED' or o.status in ('CANCELLED','EXPIRED','COLLECTED') then raise exception 'ORDER_CLOSED';end if;
 if o.payment_confirmed_at is null and o.expires_at<=now() then raise exception 'ORDER_EXPIRED';end if;
 if p_action='confirm_payment' then
  if o.payment_confirmed_at is not null then raise exception 'PAYMENT_ALREADY_CONFIRMED';end if;
  if p_details->>'method' not in ('CASH','CARD_EFT') or p_details->>'method' is null then raise exception 'INVALID_PAYMENT_METHOD';end if;
  if o.fulfilment='DELIVERY' and p_details->>'method'='CASH' then raise exception 'DELIVERY_BANK_CONFIRMATION_REQUIRED';end if;
  i:=coalesce(o.invoice_id,app_private.create_sales_invoice(p_order,o.collection_date,case when p_details->>'method'='CASH' then 'CASH' else 'CARD_EFT' end,0,null,o.delivery_fee));
  update public.online_orders set invoice_id=i where order_id=p_order;
  if (select total from public.sales_invoices where id=i)<>o.total then raise exception 'ORDER_TOTAL_CHANGED';end if;
  perform app_private.issue_sales_invoice(i);
  select outstanding into amount from public.v_invoice_balances where id=i;
  if amount>0 then perform app_private.post_invoice_entry(i,'PAYMENT',amount,p_request,p_details->>'method',o.payment_reference,'Online payment verified by staff');end if;
  update public.online_orders set payment_confirmed_at=now(),payment_confirmed_by=auth.uid(),status=case when status='READY_FOR_COLLECTION' then status else 'PROCESSING' end where order_id=p_order;
  perform app_private.ensure_delivery(i);
 elsif p_action='processing' then
  if o.payment_confirmed_at is null then raise exception 'PAYMENT_REQUIRED';end if;
  update public.online_orders set status='PROCESSING' where order_id=p_order;
 elsif p_action='ready' then
  if o.payment_confirmed_at is null and (o.fulfilment='DELIVERY' or o.payment_option<>'PAY_ON_COLLECTION') then raise exception 'PAYMENT_REQUIRED';end if;
  update public.online_orders set status=case when fulfilment='DELIVERY' then 'READY_FOR_DELIVERY' else 'READY_FOR_COLLECTION' end where order_id=p_order;
 elsif p_action='collect' then
  if o.fulfilment<>'COLLECTION' or o.status<>'READY_FOR_COLLECTION' or o.payment_confirmed_at is null then raise exception 'COLLECTION_PAYMENT_REQUIRED';end if;
  perform app_private.issue_invoice_goods(o.invoice_id,false,null);
  update public.online_orders set status='COLLECTED',reservation_released=true where order_id=p_order;
 elsif p_action='release_delivery' then
  if o.fulfilment<>'DELIVERY' or o.payment_confirmed_at is null then raise exception 'PAYMENT_REQUIRED';end if;
  perform app_private.issue_invoice_goods(o.invoice_id,false,null);
 elsif p_action='tracking' then
  if o.fulfilment<>'DELIVERY' then raise exception 'DELIVERY_REQUIRED';end if;
  if length(p_details->>'courier_company')>150 or length(p_details->>'tracking_number')>150 or length(p_details->>'tracking_url')>1000
  or (nullif(p_details->>'tracking_url','') is not null and (p_details->>'tracking_url' !~ '^https://[^[:space:]]+$' or p_details->>'tracking_url' ~ '^https://[^/]*@')) then raise exception 'INVALID_TRACKING_LINK';end if;
  update public.online_orders set courier_company=nullif(btrim(p_details->>'courier_company'),''),tracking_number=nullif(btrim(p_details->>'tracking_number'),''),tracking_url=nullif(btrim(p_details->>'tracking_url'),'') where order_id=p_order;
 elsif p_action='cancel' then
  if not app.has_module(o.store_id,'orders_approve') then raise exception 'FORBIDDEN';end if;
  reason:=nullif(btrim(p_details->>'reason'),'');if reason is null or length(reason)>1000 then raise exception 'REASON_REQUIRED';end if;
  update public.online_orders set status='CANCELLED',cancellation_reason=reason,reservation_released=true where order_id=p_order;
  update public.sales_orders set status='CANCELLED',cancellation_reason=reason,cancelled_at=now(),cancelled_by=auth.uid() where id=p_order;
 else raise exception 'INVALID_ACTION';end if;
 update public.online_orders set version=version+1,updated_at=now() where order_id=p_order;
 insert into app_private.online_action_requests values(p_request,payload,p_order);
 perform app.audit('online.'||p_action,'sales_orders',p_order,so.business_id,o.store_id,to_jsonb(o),p_details);
end $$;

create function app_private.expire_online_orders() returns void language plpgsql security definer set search_path='' as $$
declare r record;
begin
 for r in select order_id from public.online_orders where expires_at<=now() and payment_confirmed_at is null and not reservation_released order by order_id loop
  perform 1 from public.sales_orders where id=r.order_id for update;
  perform 1 from public.online_orders where order_id=r.order_id and expires_at<=now() and payment_confirmed_at is null and not reservation_released for update;
  if not found then continue;end if;
  update public.online_orders set status='EXPIRED',reservation_released=true,cancellation_reason='Collection/payment deadline expired',version=version+1,updated_at=now() where order_id=r.order_id;
  update public.sales_orders set status='CANCELLED',cancellation_reason='Collection/payment deadline expired',cancelled_at=now() where id=r.order_id;
 end loop;
 delete from app_private.online_rate_limits where window_start<now()-interval '1 day';
end $$;

-- Customer status emails reuse the existing Hostinger outbox and PDF renderer.
alter table public.customer_document_notifications add column system_online boolean not null default false;
create function app_private.queue_online_status(p_order uuid,p_key text,p_summary text) returns void language plpgsql security definer set search_path='' as $$
declare o public.online_orders%rowtype;so public.sales_orders%rowtype;doc jsonb;j uuid;link uuid;secret text;
begin
 select * into o from public.online_orders where order_id=p_order;select * into so from public.sales_orders where id=p_order;
 if o.order_id is null or not exists(select 1 from public.online_ordering_settings where store_id=o.store_id and notifications_enabled) then return;end if;
 select link_token into link from public.online_ordering_settings where store_id=o.store_id;
 select k.secret into secret from app_private.online_order_secrets k where k.order_id=p_order;
 doc:=app_private.online_customer_status(p_order);
 j:=app_private.queue_customer_document(so.customer_id,o.store_id,auth.uid(),'orders_online','online-'||p_order||'-'||p_key,
 jsonb_build_object('type','Online order update','reference',so.reference,'related_reference',o.payment_reference,'date',now(),'summary',p_summary,
 'total',o.total,'payment_status',doc->>'payment_status','outstanding',case when o.payment_confirmed_at is null then o.total else 0 end,
 'tracking_url','https://posinventory.shop/shop/'||link||'/track/'||p_order||'#'||secret,'courier_tracking_url',o.tracking_url,
 'lines',(select jsonb_agg(jsonb_build_object('description',product_name,'quantity',quantity,'unit',unit,'price',unit_price,'amount',line_total) order by id) from public.sales_order_items where order_id=p_order),
 'details',jsonb_build_object('Order status',replace(doc->>'status','_',' '),'Payment reference',o.payment_reference,'Payment instructions',(select payment_instructions from public.online_ordering_settings where store_id=o.store_id),
 'Collection/delivery',o.fulfilment,'Scheduled date',doc->>'scheduled_date','Delivery number',doc->>'delivery_number','Tracking company',o.courier_company,'Tracking number',o.tracking_number,'Cancellation reason',doc->>'cancellation_reason')));
 if j is not null then update public.customer_document_notifications set system_online=true where id=j;end if;
end $$;
create function app_private.online_notification_event() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid;key text;summary text;
begin
 if tg_table_name='online_orders' then
  oid:=new.order_id;
  if tg_op='UPDATE' and new.version=old.version and new.payment_confirmed_at is not distinct from old.payment_confirmed_at then return new;end if;
  key:=case when tg_op='UPDATE' and old.payment_confirmed_at is null and new.payment_confirmed_at is not null then 'payment-confirmed' else 'state-'||new.version end;summary:=case when tg_op='INSERT' then 'Order received. Please use your payment reference. Processing starts after confirmed payment, except orders reserved for payment on collection.' when new.payment_confirmed_at is not null and old.payment_confirmed_at is null then 'Payment Confirmed' else replace(new.status,'_',' ') end;
 elsif tg_table_name='delivery_events' then
  select o.order_id into oid from public.online_orders o join public.order_deliveries d on d.invoice_id=o.invoice_id where d.id=new.delivery_id;
  key:='delivery-'||new.id;summary:='Delivery update: '||replace(new.action,'_',' ');
 else
  select order_id into oid from public.online_orders where order_id=new.id;key:='order-'||new.status;summary:=coalesce(new.cancellation_reason,replace(new.status,'_',' '));
  if tg_op='UPDATE' and old.status=new.status then return new;end if;
 end if;
 if oid is not null then perform app_private.queue_online_status(oid,key,summary);end if;return new;
end $$;
create constraint trigger online_order_email after insert or update on public.online_orders deferrable initially deferred for each row execute function app_private.online_notification_event();
create constraint trigger online_delivery_email after insert on public.delivery_events deferrable initially deferred for each row execute function app_private.online_notification_event();
create constraint trigger online_cancellation_email after update on public.sales_orders deferrable initially deferred for each row execute function app_private.online_notification_event();
do $$ declare s text;begin
 s:=pg_get_functiondef('public.claim_customer_documents(integer)'::regprocedure);
 s:=replace(s,'elsif auth.uid() is null or not app.has_store_access(j.store_id) or not app.has_module(j.store_id,j.module) then',
 'elsif not j.system_online and (auth.uid() is null or not app.has_store_access(j.store_id) or not app.has_module(j.store_id,j.module)) then');execute s;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('online-product-images','online-product-images',false,5242880,array['image/png','image/jpeg','image/webp']);
create policy online_images_read on storage.objects for select to authenticated using(bucket_id='online-product-images' and app.has_module((storage.foldername(name))[2]::uuid,'products_online'));
create policy online_images_insert on storage.objects for insert to authenticated with check(bucket_id='online-product-images' and app.has_module((storage.foldername(name))[2]::uuid,'products_online') and (storage.foldername(name))[1]=app.store_business((storage.foldername(name))[2]::uuid)::text);

-- Default-deny private helpers, explicitly separated staff and service APIs.
revoke all on function app_private.online_reserved(uuid),app_private.online_available(uuid),app_private.guard_online_stock(),app_private.require_online_service(),app_private.online_customer_status(uuid),app_private.expire_online_orders(),app_private.queue_online_status(uuid,text,text),app_private.online_notification_event() from public,anon,authenticated;
revoke all on function public.save_online_ordering_settings(uuid,bigint,jsonb),public.save_product_online(uuid,timestamptz,jsonb),public.online_orders_page(uuid,timestamptz,uuid),public.process_online_order(uuid,bigint,text,jsonb,uuid) from public,anon;
grant execute on function public.save_online_ordering_settings(uuid,bigint,jsonb),public.save_product_online(uuid,timestamptz,jsonb),public.online_orders_page(uuid,timestamptz,uuid),public.process_online_order(uuid,bigint,text,jsonb,uuid) to authenticated;
revoke all on function public.online_rate_limit(text),public.customer_catalog(uuid,text,uuid),public.place_customer_order(uuid,uuid,text,jsonb,jsonb,text,date,text),public.customer_order_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.online_rate_limit(text),public.customer_catalog(uuid,text,uuid),public.place_customer_order(uuid,uuid,text,jsonb,jsonb,text,date,text),public.customer_order_status(uuid,uuid,text) to service_role;
do $$ declare s text;begin
 s:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 s:=regexp_replace(s,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''online_ordering_v1'',true,');execute s;
 if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('expire-online-orders','*/5 * * * *','select app_private.expire_online_orders()');end if;
end $$;

do $$ declare r record;s text;begin
 for r in select oid from pg_proc where pronamespace='public'::regnamespace and proname='create_sales_invoice' loop
 s:=pg_get_functiondef(r.oid);s:=regexp_replace(s,'begin','begin if exists(select 1 from public.online_orders where order_id=p_order) then raise exception ''USE_ONLINE_ORDERS'';end if;','i');execute s;
 end loop;end $$;
create function public.online_settings(p_store uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin if not app.has_module(p_store,'orders_online_settings') then raise exception 'FORBIDDEN';end if;
 insert into public.online_ordering_settings(store_id) select id from public.stores where id=p_store and location_type='store' on conflict do nothing;
 return (select to_jsonb(s) from public.online_ordering_settings s where store_id=p_store);end $$;
create function public.product_online_settings(p_product uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not app.has_module((select store_id from public.products where id=p_product),'products_online') then raise exception 'FORBIDDEN';end if;
 return (select jsonb_build_object('available_online',available_online,'online_description',online_description,'online_price',online_price,'online_image_path',online_image_path,'online_variant_group',online_variant_group,'online_variant_name',online_variant_name,'updated_at',updated_at,'business_id',business_id,'store_id',store_id) from public.products where id=p_product);end $$;
revoke all on function public.online_settings(uuid),public.product_online_settings(uuid) from public,anon;
grant execute on function public.online_settings(uuid),public.product_online_settings(uuid) to authenticated;

create function app_private.sync_cancelled_online_order() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status='CANCELLED' then update public.online_orders set status='CANCELLED',reservation_released=true,cancellation_reason=new.cancellation_reason,version=version+1,updated_at=now() where order_id=new.id and status not in ('CANCELLED','EXPIRED');end if;return new;end $$;
create trigger sync_online_cancellation after update of status on public.sales_orders for each row execute function app_private.sync_cancelled_online_order();
revoke all on function app_private.sync_cancelled_online_order() from public,anon,authenticated;

-- Online item/pricing snapshots also define the reservation; normal invoice editing cannot diverge them.
do $$ declare s text;begin
 s:=pg_get_functiondef('public.amend_invoice_items(uuid,integer,jsonb,numeric,text,uuid)'::regprocedure);
 s:=regexp_replace(s,'begin','begin if exists(select 1 from public.online_orders where invoice_id=p_invoice) then raise exception ''ONLINE_ORDER_FIXED'';end if;','i');execute s;
end $$;
