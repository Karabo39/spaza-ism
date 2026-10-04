-- Retain immutable historical schedule identities while allowing inactive schedules
-- to be deleted. Generated invoices and request ledgers must never be deleted.
create table app_private.recurring_schedule_ids(id uuid primary key);
alter table app_private.recurring_schedule_ids enable row level security;
revoke all on app_private.recurring_schedule_ids from public,anon,authenticated;
insert into app_private.recurring_schedule_ids select id from public.recurring_invoices;
create function app_private.register_recurring_schedule() returns trigger language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.recurring_invoices where id=new.id) then insert into app_private.recurring_schedule_ids values(new.id);end if;return new;end $$;
revoke all on function app_private.register_recurring_schedule() from public,anon,authenticated;
create trigger register_recurring_schedule before insert on public.recurring_invoices for each row execute function app_private.register_recurring_schedule();
alter table public.sales_invoices drop constraint sales_invoices_recurring_schedule_id_fkey;
alter table public.sales_invoices add foreign key(recurring_schedule_id) references app_private.recurring_schedule_ids(id);
alter table app_private.manual_invoice_requests drop constraint manual_invoice_requests_schedule_id_fkey;
alter table app_private.manual_invoice_requests add foreign key(schedule_id) references app_private.recurring_schedule_ids(id);
create function public.delete_recurring_invoice(p_id uuid,p_expected bigint) returns void language plpgsql security definer set search_path='' as $$
declare r public.recurring_invoices%rowtype;
begin
 select * into r from public.recurring_invoices where id=p_id for update;
 if r.id is null or not app.can_manage_recurring(r.store_id) then raise exception 'FORBIDDEN';end if;
 if r.version is distinct from p_expected then raise exception 'SCHEDULE_CHANGED';end if;
 if r.active then raise exception 'DEACTIVATE_SCHEDULE_FIRST';end if;
 perform app.audit('recurring.delete','recurring_invoices',r.id,r.business_id,r.store_id,to_jsonb(r),null);
 delete from public.recurring_invoices where id=r.id;
end $$;
revoke all on function public.delete_recurring_invoice(uuid,bigint) from public,anon;
grant execute on function public.delete_recurring_invoice(uuid,bigint) to authenticated;

-- Save edited counts atomically. Never apply stock here; approval remains separate.
create function public.save_all_stock_take_counts(p_stock_take uuid,p_counts jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare st public.stock_takes%rowtype; row jsonb; item public.stock_take_items%rowtype; n integer:=0;
begin
 select * into st from public.stock_takes where id=p_stock_take for update;
 perform app.require_module(st.store_id,array['stock_take']);
 if st.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED';end if;
 if p_counts is null or jsonb_typeof(p_counts)<>'array' then raise exception 'INVALID_COUNTS';end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_counts)) then raise exception 'DUPLICATE_COUNT';end if;
 for row in select value from jsonb_array_elements(p_counts) order by value->>'id' loop
  select * into item from public.stock_take_items where id=(row->>'id')::uuid and stock_take_id=st.id for update;
  if item.id is null then raise exception 'INVALID_COUNT_ITEM';end if;
  if item.counted_at is distinct from (row->>'expected_at')::timestamptz then raise exception 'COUNT_CHANGED_REFRESH';end if;
  perform public.save_stock_take_count(item.id,(row->>'quantity')::numeric,(row->>'expiry')::date);n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.save_all_stock_take_counts(uuid,jsonb) from public,anon;
grant execute on function public.save_all_stock_take_counts(uuid,jsonb) to authenticated;

-- Disabled warehouses remain manageable without becoming trading locations.
create function app.can_manage_disabled_warehouse(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.stores s join public.memberships m on m.business_id=s.business_id
 left join public.store_module_access a on a.membership_id=m.id and a.store_id=s.id
 where s.id=p_store and s.location_type='warehouse' and m.is_active and m.user_id=auth.uid()
 and (m.role='owner' or (m.role='manager' and exists(select 1 from public.store_memberships sm where sm.membership_id=m.id and sm.store_id=s.id)
 and coalesce((a.permissions->>'warehouse')::boolean,true) and coalesce((a.permissions->>'warehouse_disable')::boolean,true))));
$$;
revoke all on function app.can_manage_disabled_warehouse(uuid) from public,anon;
grant execute on function app.can_manage_disabled_warehouse(uuid) to authenticated;
create function public.warehouse_management(p_business uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('location_id',s.id,'name',s.name,'code',s.code,'currency',s.currency,'is_active',s.is_active,
 'product_count',(select count(*) from public.products where store_id=s.id and is_active),
 'stock_quantity',(select coalesce(sum(quantity),0) from public.stock where store_id=s.id),
 'stock_value',(select coalesce(sum(st.quantity*p.cost_price),0) from public.stock st join public.products p on p.id=st.product_id where st.store_id=s.id and p.is_active),
 'can_manage',app.can_manage_disabled_warehouse(s.id)) order by s.name,s.id),'[]'::jsonb)
 from public.stores s where s.business_id=p_business and s.location_type='warehouse' and
 (app.has_module(s.id,'warehouse') or (not s.is_active and app.can_manage_disabled_warehouse(s.id)));
$$;
revoke all on function public.warehouse_management(uuid) from public,anon;
grant execute on function public.warehouse_management(uuid) to authenticated;
create function public.enable_warehouse(p_store uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.stores%rowtype;
begin
 select * into s from public.stores where id=p_store for update;
 if s.id is null or not app.can_manage_disabled_warehouse(p_store) then raise exception 'FORBIDDEN';end if;
 if s.is_active then return;end if;
 update public.stores set is_active=true where id=p_store;
 perform app.audit('warehouse.enable','stores',s.id,s.business_id,s.id,to_jsonb(s),jsonb_build_object('is_active',true));
end $$;
revoke all on function public.enable_warehouse(uuid) from public,anon;
grant execute on function public.enable_warehouse(uuid) to authenticated;

-- Delivery fees are separate from refundable product values and use the invoice tax rate.
alter table public.sales_invoices add column delivery_fee numeric(14,2) not null default 0 check(delivery_fee>=0 and delivery_fee<999999999999 and delivery_fee::text not in ('NaN','Infinity','-Infinity'));
CREATE OR REPLACE FUNCTION app_private.create_sales_invoice(p_order uuid, p_due date, p_terms text, p_discount numeric, p_note text, p_delivery_fee numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare o public.sales_orders%rowtype; existing public.sales_invoices%rowtype; iid uuid; subtotal numeric; tax numeric; tax_amount numeric; total numeric; line record; allocated numeric:=0; base_allocated numeric:=0; net numeric; product_subtotal numeric; product_total numeric;
begin
  select * into o from public.sales_orders where id=p_order for update;
  if not found or not app.has_store_access(o.store_id) then raise exception 'FORBIDDEN'; end if;
  if o.quoted_discount is not null then p_discount:=o.quoted_discount; end if; if o.status<>'CONFIRMED' then raise exception 'ORDER_NOT_CONFIRMED'; end if;
  select * into existing from public.sales_invoices where order_id=o.id;
  if found then
    if existing.due_date is distinct from p_due or existing.terms is distinct from p_terms or existing.discount is distinct from p_discount or existing.note is distinct from p_note or existing.delivery_fee is distinct from p_delivery_fee then raise exception 'REQUEST_CONFLICT'; end if;
    return existing.id;
  end if;
  if p_due is null or p_terms is null or p_terms not in ('CASH','CARD_EFT','CREDIT') then raise exception 'INVALID_INVOICE_DETAILS'; end if;
  select sum(line_total) into subtotal from public.sales_order_items where order_id=o.id;
  if p_discount is null or p_discount::text in ('NaN','Infinity','-Infinity') or p_discount<0 or p_discount>subtotal then raise exception 'INVALID_DISCOUNT'; end if;
  if p_delivery_fee is null or p_delivery_fee::text in ('NaN','Infinity','-Infinity') or p_delivery_fee<0 or p_delivery_fee<>round(p_delivery_fee,2) or p_delivery_fee>=999999999999 then raise exception 'INVALID_DELIVERY_FEE';end if;
  product_subtotal:=subtotal;subtotal:=subtotal+p_delivery_fee;
  p_discount:=round(p_discount,2);
  select coalesce(o.quoted_tax_percent,(select tax_percent from public.billing_settings where business_id=o.business_id),0) into tax;
  tax_amount:=round((subtotal-p_discount)*tax/100,2); total:=subtotal-p_discount+tax_amount; product_total:=product_subtotal-p_discount+round((product_subtotal-p_discount)*tax/100,2);
  insert into public.sales_invoices(business_id,store_id,order_id,customer_id,customer_name,business_name,store_name,currency,salesperson,created_by,terms,subtotal,discount,tax_percent,tax_amount,total,due_date,note,delivery_fee)
    select o.business_id,o.store_id,o.id,o.customer_id,o.customer_name,b.name,s.name,s.currency,coalesce(p.full_name,'Salesperson'),auth.uid(),p_terms,subtotal,p_discount,tax,tax_amount,total,p_due,p_note,p_delivery_fee
    from public.businesses b join public.stores s on s.business_id=b.id left join public.profiles p on p.id=o.created_by where b.id=o.business_id and s.id=o.store_id returning id into iid;
  for line in select oi.*,p.cost_price from public.sales_order_items oi join public.products p on p.id=oi.product_id where order_id=o.id order by oi.id loop
    -- Differences of rounded cumulative amounts keep every line nonnegative and sum exactly.
    base_allocated:=base_allocated+line.line_total;
    net:=case when product_subtotal=0 then 0 else round(product_total*base_allocated/product_subtotal,2)-allocated end;
    allocated:=allocated+net;
    insert into public.sales_invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,line_total,net_total,cost_price)
      values(iid,line.product_id,line.product_name,line.unit,line.quantity,line.unit_price,line.line_total,net,line.cost_price);
  end loop;
  perform app.audit('invoice.create','sales_invoices',iid,o.business_id,o.store_id,null,jsonb_build_object('order',o.id,'total',total));
  return iid;
end $function$
;
revoke all on function app_private.create_sales_invoice(uuid,date,text,numeric,text,numeric) from public,anon,authenticated;
create or replace function app_private.create_sales_invoice(p_order uuid,p_due date,p_terms text,p_discount numeric default 0,p_note text default null) returns uuid language sql security definer set search_path='' as $$ select app_private.create_sales_invoice(p_order,p_due,p_terms,p_discount,p_note,0); $$;
drop function public.create_delivery_invoice(uuid,date,numeric);
CREATE OR REPLACE FUNCTION public.create_delivery_invoice(p_order uuid, p_due date, p_discount numeric DEFAULT 0, p_delivery_fee numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.sales_orders%rowtype; iid uuid;
begin
 perform app.require_module((select store_id from public.sales_orders where id=p_order),array['invoices','invoices_create_from_order']);
 select * into o from public.sales_orders where id=p_order for update;
 if o.id is null or o.status<>'CONFIRMED' then raise exception 'ORDER_NOT_CONFIRMED';end if;
 if exists(select 1 from public.sales_invoices where order_id=o.id) and coalesce(o.delivery_details->>'auto_created','false')<>'true' then raise exception 'REQUEST_CONFLICT';end if;
 update public.sales_orders set delivery_required=true,delivery_details=delivery_details||jsonb_build_object('auto_created',true),delivery_version=delivery_version+case when delivery_details->>'auto_created'='true' then 0 else 1 end where id=o.id;
 iid:=app_private.create_sales_invoice(p_order,p_due,'CASH',p_discount,null,p_delivery_fee);
 perform app_private.ensure_delivery(iid);
 return iid;
end $function$
;
revoke all on function public.create_delivery_invoice(uuid,date,numeric,numeric) from public,anon;
grant execute on function public.create_delivery_invoice(uuid,date,numeric,numeric) to authenticated;
CREATE OR REPLACE FUNCTION public.amend_invoice_items(p_invoice uuid, p_expected integer, p_items jsonb, p_discount numeric, p_reason text, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<revision_values>>
declare i public.sales_invoices%rowtype; d public.order_deliveries%rowtype; old_doc jsonb; new_items jsonb:='[]';
 prev public.invoice_revisions%rowtype; payload jsonb; row jsonb; product public.products%rowtype; qty numeric; price numeric; subtotal numeric:=0; tax numeric; total numeric; change numeric; rid uuid:=gen_random_uuid();accum numeric:=0;allocated numeric:=0;net numeric;oid uuid; product_subtotal numeric; product_total numeric;
begin
 select order_id into oid from public.sales_invoices where id=p_invoice;
 perform 1 from public.sales_orders where id=oid for update;
 select * into i from public.sales_invoices where id=p_invoice for update;
 if i.id is null or not app.has_store_role(i.store_id,'manager') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(i.store_id,array['invoices','invoices_view_invoices']);
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 payload:=jsonb_build_object('actor',auth.uid(),'invoice',p_invoice,'expected',p_expected,'items',p_items,'discount',p_discount,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,3009));
 select * into prev from public.invoice_revisions where request_id=p_request;
 if found then if prev.payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return prev.id;end if;
 if i.revision is distinct from p_expected then raise exception 'INVOICE_CHANGED';end if;
 if i.goods_issued_at is not null or i.state not in ('DRAFT','ISSUED') or exists(select 1 from public.sales_orders where id=oid and status='CANCELLED') then raise exception 'INVOICE_AMENDMENT_CLOSED';end if;
 if exists(select 1 from public.invoice_entries where invoice_id=i.id and kind in ('CREDIT_NOTE','DEBIT_NOTE','VOID')) then raise exception 'INVOICE_ADJUSTMENTS_EXIST';end if;
 select * into d from public.order_deliveries where invoice_id=i.id for update;
 if d.status in ('OUT_FOR_DELIVERY','DELIVERED','CANCELLED') then raise exception 'DELIVERY_CLOSED';end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'REASON_REQUIRED';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'INVALID_ITEMS';end if;
 if (select count(distinct x->>'product_id') from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_PRODUCT';end if;
 old_doc:=jsonb_build_object('invoice',to_jsonb(i),'items',(select jsonb_agg(to_jsonb(l) order by l.product_id) from public.sales_invoice_items l where invoice_id=i.id));
 for row in select value from jsonb_array_elements(p_items) loop
  select * into product from public.products where id=(row->>'product_id')::uuid and store_id=i.store_id and is_active;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  qty:=(row->>'quantity')::numeric;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty<>round(qty,3) then raise exception 'INVALID_QUANTITY';end if;
  select unit_price into price from public.sales_invoice_items where invoice_id=i.id and product_id=product.id;
  price:=coalesce(price,product.selling_price);
  if row ? 'unit_price' and (row->>'unit_price')::numeric is distinct from price then raise exception 'INVOICE_PRICE_CHANGED';end if;
  subtotal:=subtotal+round(qty*price,2);
  new_items:=new_items||jsonb_build_array(jsonb_build_object('product_id',product.id,'product_name',product.name,'unit',product.unit,'quantity',qty,'unit_price',price,'line_total',round(qty*price,2),'cost_price',product.cost_price));
 end loop;
 if p_discount is null or p_discount::text in ('NaN','Infinity','-Infinity') or p_discount<0 or p_discount>subtotal then raise exception 'INVALID_DISCOUNT';end if;
 product_subtotal:=subtotal;subtotal:=subtotal+i.delivery_fee;p_discount:=round(p_discount,2);tax:=round((subtotal-p_discount)*i.tax_percent/100,2);total:=subtotal-p_discount+tax;change:=total-i.total;product_total:=product_subtotal-p_discount+round((product_subtotal-p_discount)*i.tax_percent/100,2);
 insert into public.invoice_revisions(id,invoice_id,store_id,revision,request_id,payload,before_data,after_data,reason,amount_change,actor_id)
 values(rid,i.id,i.store_id,i.revision+1,p_request,payload,old_doc,jsonb_build_object('items',new_items,'totals',jsonb_build_object('subtotal',subtotal,'discount',p_discount,'tax_amount',tax,'total',total)),btrim(p_reason),change,auth.uid());
 update public.sales_invoices set subtotal=revision_values.subtotal,discount=p_discount,tax_amount=tax,total=revision_values.total,revision=revision+1 where id=i.id;
 delete from public.sales_invoice_items where invoice_id=i.id;
 for row in select value from jsonb_array_elements(new_items) loop
  accum:=accum+(row->>'line_total')::numeric;
  net:=case when product_subtotal=0 then 0 else round(product_total*accum/product_subtotal,2)-allocated end;allocated:=allocated+net;
  insert into public.sales_invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,line_total,net_total,cost_price)
  values(i.id,(row->>'product_id')::uuid,row->>'product_name',row->>'unit',(row->>'quantity')::numeric,(row->>'unit_price')::numeric,(row->>'line_total')::numeric,net,(row->>'cost_price')::numeric);
 end loop;
 if i.state='ISSUED' and change<>0 then perform app.post_customer_entry(i.customer_id,change,'ADJUSTMENT', 'invoice_revisions',rid,'Invoice revision '||i.reference||': '||btrim(p_reason));end if;
 if d.id is not null then
  update public.order_deliveries set snapshot=snapshot||jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'description',l.product_name,'sku',p.sku,'barcode',(select barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,barcode limit 1),'unit',l.unit,'ordered_quantity',l.quantity,'delivery_quantity',l.quantity,'remarks',coalesce((select x->>'remarks' from jsonb_array_elements(d.snapshot->'items')x where x->>'product_id'=l.product_id::text limit 1),'')) order by l.id) from public.sales_invoice_items l join public.products p on p.id=l.product_id where l.invoice_id=i.id)),version=version+1,updated_at=clock_timestamp() where id=d.id;
  perform app_private.delivery_event(d.id,'items_amended',to_jsonb(d),(select to_jsonb(v) from public.order_deliveries v where v.id=d.id),p_reason);
 end if;
 perform app.audit('invoice.amend_items','sales_invoices',i.id,i.business_id,i.store_id,old_doc,jsonb_build_object('revision',i.revision+1,'total',total,'amount_change',change,'reason',p_reason));
 if i.state='ISSUED' then
 perform app_private.queue_customer_document(i.customer_id,i.store_id,auth.uid(),'invoices_view_invoices','invoice-revision:'||rid,
 app_private.customer_invoice_document(i.id)||jsonb_build_object('type','Revised invoice','summary','Revision '||(i.revision+1)||': '||p_reason));
 end if;
 return rid;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.customer_invoice_document(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('type','Invoice','reference',i.reference,'related_reference',o.reference,
 'date',i.invoice_date,'due',i.due_date,'currency',i.currency,'customer',i.customer_name,
 'business',i.business_name,'store',i.store_name,'address',i.customer_snapshot->>'address',
 'business_address',b.document_address,'business_contact',concat_ws(' · ',b.document_phone,b.document_email),
 'summary',coalesce(i.note,'Customer invoice'),'total',i.total,'outstanding',v.outstanding,'payment_status',v.status,
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('description',l.product_name,'quantity',l.quantity,'unit',l.unit,'price',l.unit_price,'amount',l.line_total) order by l.id),'[]') from public.sales_invoice_items l where l.invoice_id=i.id),
 'details',jsonb_build_object('Revision',i.revision,'Subtotal (including delivery)',i.subtotal,'Delivery fee',i.delivery_fee,'Discount',i.discount,'Tax',i.tax_amount,'Payments received',v.paid,'Credit notes',v.credits,'Debit notes',v.debits))
 from public.sales_invoices i join public.v_invoice_balances v on v.id=i.id join public.sales_orders o on o.id=i.order_id join public.businesses b on b.id=i.business_id where i.id=p_invoice
$function$
;
create or replace view public.v_invoice_balances with (security_invoker=true) as  SELECT i.id,
    i.business_id,
    i.store_id,
    i.order_id,
    i.customer_id,
    i.customer_name,
    i.business_name,
    i.store_name,
    i.currency,
    i.salesperson,
    i.created_by,
    i.reference,
    i.state,
    i.terms,
    i.subtotal,
    i.discount,
    i.tax_percent,
    i.tax_amount,
    i.total,
    i.due_date,
    i.note,
    i.cancellation_reason,
    i.created_at,
    i.issued_at,
    i.goods_issued_at,
    i.goods_issued_by,
    i.authorized_by,
    COALESCE(e.debits, 0::numeric) AS debits,
    COALESCE(e.credits, 0::numeric) AS credits,
    COALESCE(e.paid, 0::numeric) AS paid,
        CASE
            WHEN i.state = 'ISSUED'::text THEN i.total + COALESCE(e.debits, 0::numeric) - COALESCE(e.credits, 0::numeric) - COALESCE(e.paid, 0::numeric)
            ELSE 0::numeric
        END AS outstanding,
        CASE
            WHEN i.state <> 'ISSUED'::text THEN i.state
            WHEN COALESCE(e.credits, 0::numeric) >= (i.total + COALESCE(e.debits, 0::numeric)) AND COALESCE(e.credits, 0::numeric) > 0::numeric THEN 'CREDITED'::text
            WHEN (i.total + COALESCE(e.debits, 0::numeric) - COALESCE(e.credits, 0::numeric) - COALESCE(e.paid, 0::numeric)) <= 0::numeric THEN 'PAID'::text
            WHEN i.due_date < (now() AT TIME ZONE 'Africa/Johannesburg'::text)::date THEN 'OVERDUE'::text
            WHEN COALESCE(e.paid, 0::numeric) > 0::numeric THEN 'PARTIALLY_PAID'::text
            ELSE 'UNPAID'::text
        END AS status,
    i.ordered_by_name,
    i.invoiced_by_name,
    i.recurring_schedule_id,
    i.billing_period,
    i.invoice_date,
    i.customer_snapshot,
    i.revision,
    i.delivery_fee
   FROM sales_invoices i
     LEFT JOIN LATERAL ( SELECT sum(invoice_entries.amount) FILTER (WHERE invoice_entries.kind = 'DEBIT_NOTE'::text) AS debits,
            sum(invoice_entries.amount) FILTER (WHERE invoice_entries.kind = 'CREDIT_NOTE'::text) AS credits,
            sum(invoice_entries.amount) FILTER (WHERE invoice_entries.kind = 'PAYMENT'::text) AS paid
           FROM invoice_entries
          WHERE invoice_entries.invoice_id = i.id) e ON true;

-- Keep recovery controls available even when a user's only assigned warehouse is disabled.
alter policy sel_stores on public.stores using (app.has_store_access(id) or app.has_business_role(business_id,'owner') or (not is_active and app.can_manage_disabled_warehouse(id)));
CREATE OR REPLACE FUNCTION public.session_bootstrap()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with member_rows as materialized (
   select m.id,m.business_id,m.role,b.name business_name,b.currency
   from public.memberships m join public.businesses b on b.id=m.business_id
   where m.user_id=(select auth.uid()) and m.is_active
 ), payload as (
   select jsonb_build_object(
     'setup_required',coalesce((public.my_employee_setup()->>'required')::boolean,false),
     'full_name',(select full_name from public.profiles where id=(select auth.uid())),
     'has_membership',exists(select 1 from member_rows),
     'stores',coalesce((select jsonb_agg(jsonb_build_object(
       'id',s.id,'is_active',s.is_active,'name',s.name,'business_id',s.business_id,'business_name',m.business_name,
       'role',m.role,'currency',coalesce(s.currency,m.currency),'location_type',s.location_type,
       'permissions',g.permissions) order by s.location_type,s.name,s.id)
       from public.stores s join member_rows m on m.business_id=s.business_id
       left join public.store_module_access g on g.membership_id=m.id and g.store_id=s.id
       where s.is_active or app.can_manage_disabled_warehouse(s.id)),'[]'::jsonb)
   ) value
 ) select value||jsonb_build_object('revision',md5(value::text)) from payload
 where (select auth.uid()) is not null;
$function$
;

do $$declare s text;begin
 s:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 s:=regexp_replace(s,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''october_workflows_v1'',true,');execute s;
end $$;
