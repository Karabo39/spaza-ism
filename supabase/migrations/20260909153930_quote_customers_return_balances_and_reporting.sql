-- One-off quote contacts remain distinct from registered credit customers.
alter table public.customers add column is_once_off boolean not null default false, add column address text;
create or replace view public.v_credit_customers with(security_invoker=true) as
 select cu.id customer_id,cu.business_id,cu.store_id,cu.name,cu.phone,cu.email,cu.is_active,
 ca.id credit_account_id,ca.credit_limit,ca.balance,greatest(ca.credit_limit-ca.balance,0) available_credit,
 (ca.balance>ca.credit_limit and ca.credit_limit>0) over_limit
 from public.customers cu join public.credit_accounts ca on ca.customer_id=cu.id where not cu.is_once_off;
create function app.guard_once_off_credit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_table_name='sales_invoices' and to_jsonb(new)->>'terms'='CREDIT') or (tg_table_name='goods_out' and to_jsonb(new)->>'sale_type'='CREDIT') then
  if exists(select 1 from public.customers where id=new.customer_id and is_once_off) then raise exception 'REGISTERED_CREDIT_CUSTOMER_REQUIRED';end if;
 end if;
 return new;
end $$;
revoke all on function app.guard_once_off_credit() from public,anon,authenticated;
create trigger registered_invoice_credit before insert or update of terms,customer_id on public.sales_invoices for each row execute function app.guard_once_off_credit();
create trigger registered_checkout_credit before insert or update of sale_type,customer_id on public.goods_out for each row execute function app.guard_once_off_credit();
create function app.keep_once_off_contact() returns trigger language plpgsql set search_path='' as $$ begin if old.is_once_off and not new.is_once_off then raise exception 'ONCE_OFF_CONTACT_LOCKED';end if;return new;end $$;
revoke all on function app.keep_once_off_contact() from public,anon,authenticated;
create trigger once_off_contact_flag before update of is_once_off on public.customers for each row execute function app.keep_once_off_contact();

drop function public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint);
create function public.save_quote(p_store uuid,p_customer uuid,p_items jsonb,p_valid date,p_discount numeric,p_note text,p_request uuid,p_quote uuid default null,p_expected bigint default 0,p_guest jsonb default null) returns uuid
language plpgsql security definer set search_path=public,app as $$
#variable_conflict use_variable
declare old public.sales_quotes%rowtype; product public.products%rowtype; item jsonb; lines jsonb:='[]'; q numeric; price numeric; subtotal numeric:=0; tax numeric; tax_amount numeric; payload jsonb; result uuid; customer text;
begin
 perform app.require_module(p_store,array['invoices']);
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 payload:=jsonb_build_object('user',auth.uid(),'store',p_store,'customer',p_customer,'items',p_items,'valid',p_valid,'discount',p_discount,'note',p_note);
 if p_guest is not null then payload:=payload||jsonb_build_object('guest',p_guest);end if;
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
 if p_guest is not null then
  if p_customer is not null or jsonb_typeof(p_guest)<>'object' or nullif(btrim(p_guest->>'name'),'') is null or length(p_guest->>'name')>200 or length(coalesce(p_guest->>'phone',''))>50 or length(coalesce(p_guest->>'address',''))>1000 then raise exception 'INVALID_QUOTE_CONTACT';end if;
  customer:=btrim(p_guest->>'name');
  if old.id is not null and exists(select 1 from public.customers where id=old.customer_id and is_once_off) then
   p_customer:=old.customer_id;
   update public.customers set name=customer,phone=nullif(btrim(p_guest->>'phone'),''),address=nullif(btrim(p_guest->>'address'),'') where id=p_customer;
  else
   insert into public.customers(business_id,store_id,name,phone,address,is_once_off) values(app.store_business(p_store),p_store,customer,nullif(btrim(p_guest->>'phone'),''),nullif(btrim(p_guest->>'address'),''),true) returning id into p_customer;
  end if;
 else
  select name into customer from public.customers where id=p_customer and store_id=p_store and is_active and not is_once_off;
  if not found then raise exception 'CUSTOMER_REQUIRED';end if;
 end if;
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
revoke all on function public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint,jsonb) to authenticated;

create or replace function public.save_purchase_order(p_quote uuid,p_order uuid,p_received boolean,p_approved boolean,p_reference text,p_filename text,p_mime text,p_content text,p_expected bigint) returns void
language plpgsql security definer set search_path=public,app as $$
declare loc uuid; old public.sales_purchase_orders%rowtype; bytes bytea;
begin
 if (p_quote is null)=(p_order is null) then raise exception 'DOCUMENT_REQUIRED'; end if;
 if p_quote is not null then select store_id into loc from public.sales_quotes where id=p_quote for update; else select store_id into loc from public.sales_orders where id=p_order for update; end if;
 perform app.require_module(loc,array['invoices','orders']);
 if p_order is not null then perform 1 from public.sales_quotes where order_id=p_order for update;end if;
 if exists(select 1 from public.sales_quotes where (id=p_quote or order_id=p_order) and status in ('ACCEPTED','CONVERTED','CANCELLED')) then raise exception 'PURCHASE_ORDER_LOCKED';end if;
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
-- Permit only the explicit pre-delivery change to registered customer credit.
-- Prices, customer identity and all other posted invoice fields remain immutable.
create or replace function app.protect_posted_invoice() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'INVOICE_DELETE_FORBIDDEN';end if;
 if old.state='ISSUED' and old.goods_issued_at is null and new.terms='CREDIT' and old.terms<>'CREDIT'
   and (to_jsonb(new)-'terms')=(to_jsonb(old)-'terms')
   and exists(select 1 from public.customers where id=old.customer_id and is_active and not is_once_off) then return new;end if;
 if old.state<>'DRAFT' and (to_jsonb(new)-array['state','cancellation_reason','goods_issued_at','goods_issued_by','authorized_by'])
   is distinct from (to_jsonb(old)-array['state','cancellation_reason','goods_issued_at','goods_issued_by','authorized_by']) then raise exception 'POSTED_INVOICE_IMMUTABLE';end if;
 return new;
end $$;
create function public.use_invoice_customer_credit(p_invoice uuid,p_customer uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.sales_invoices%rowtype;
begin
 select * into i from public.sales_invoices where id=p_invoice for update;
 if not found then raise exception 'FORBIDDEN';end if;
 perform app.require_module(i.store_id,array['invoices']);
 if i.customer_id is distinct from p_customer or not exists(select 1 from public.customers where id=p_customer and store_id=i.store_id and is_active and not is_once_off) then raise exception 'REGISTERED_INVOICE_CUSTOMER_REQUIRED';end if;
 if i.state not in ('DRAFT','ISSUED') or i.goods_issued_at is not null then raise exception 'INVALID_INVOICE_STATE';end if;
 if i.terms='CREDIT' then return;end if;
 update public.sales_invoices set terms='CREDIT' where id=i.id;
 perform app.audit('invoice.credit_terms','sales_invoices',i.id,i.business_id,i.store_id,jsonb_build_object('terms',i.terms),jsonb_build_object('terms','CREDIT','customer',p_customer));
end $$;
revoke all on function public.use_invoice_customer_credit(uuid,uuid) from public,anon;
grant execute on function public.use_invoice_customer_credit(uuid,uuid) to authenticated;

-- Submitted returns reserve quantities too; rejected returns release them.
create view public.v_returnable_items with(security_invoker=true) as
 select 'sale'::text source_type,g.store_id,g.id source_id,l.id item_id,p.name product_name,l.quantity,l.line_total charged,
 coalesce(r.used,0) returned_quantity,greatest(l.quantity-coalesce(r.used,0),0) remaining_quantity
 from public.goods_out g join public.goods_out_items l on l.goods_out_id=g.id join public.products p on p.id=l.product_id
 left join lateral(select sum(ri.quantity) used from public.goods_return_items ri join public.goods_returns rr on rr.id=ri.return_id where ri.sale_item_id=l.id and rr.status<>'REJECTED')r on true
 union all
 select 'invoice',g.store_id,g.id,l.id,l.product_name,l.quantity,l.net_total,coalesce(r.used,0),greatest(l.quantity-coalesce(r.used,0),0)
 from public.sales_invoices g join public.sales_invoice_items l on l.invoice_id=g.id
 left join lateral(select sum(ri.quantity) used from public.goods_return_items ri join public.goods_returns rr on rr.id=ri.return_id where ri.invoice_item_id=l.id and rr.status<>'REJECTED')r on true
 where g.state='ISSUED' and g.goods_issued_at is not null;
revoke all on public.v_returnable_items from public,anon;
grant select on public.v_returnable_items to authenticated;
create function public.returnable_documents(p_store uuid,p_type text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_module(p_store,array['returns']);
 if p_type not in ('sale','invoice') or p_type is null then raise exception 'INVALID_SOURCE';end if;
 return (with documents as(
 select g.id,g.created_at,g.id::text reference,coalesce(c.name,'Checkout customer') customer_name,g.total_amount total from public.goods_out g left join public.customers c on c.id=g.customer_id where p_type='sale' and g.store_id=p_store
 union all select i.id,i.created_at,i.reference,i.customer_name,i.total from public.sales_invoices i where p_type='invoice' and i.store_id=p_store and i.state='ISSUED' and i.goods_issued_at is not null
 ), available as(select d.*, (select jsonb_agg(jsonb_build_object('name',r.product_name,'remaining',r.remaining_quantity) order by r.item_id) from public.v_returnable_items r where r.source_id=d.id and r.source_type=p_type and r.store_id=p_store and r.remaining_quantity>0) items from documents d)
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]') from(select * from available where items is not null order by created_at desc,id limit 100)a);
end $$;
revoke all on function public.returnable_documents(uuid,text) from public,anon;
grant execute on function public.returnable_documents(uuid,text) to authenticated;

create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'invoice_refinements_v1', to_regprocedure('public.returnable_documents(uuid,text)') is not null and to_regprocedure('public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint,jsonb)') is not null and to_regprocedure('public.use_invoice_customer_credit(uuid,uuid)') is not null,
    'cash_shifts_v1', to_regprocedure('public.start_next_cash_shift(uuid,numeric,text,uuid)') is not null,
    'batch_expiry_v1', to_regprocedure('app.take_sellable_batches(uuid,uuid,numeric)') is not null and to_regclass('public.v_product_catalog') is not null,
    'employee_invitations_v1', to_regprocedure('public.accept_employee_invitation(uuid,text,text,text,text)') is not null and to_regprocedure('public.my_employee_setup()') is not null,
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
