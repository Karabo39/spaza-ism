-- Independent per-location receiving and warehouse permissions.
insert into public.module_catalog(key,label,minimum_role,parent_key) values
 ('warehouse','Warehouse','employee',null),
 ('goods_in_new_stock','Receive New Stock / Supplier','employee','goods_in'),
 ('goods_in_receive_transfer','Receive Stock Transfer','employee','goods_in'),
 ('operations_transfer_create','Create Transfers','employee','operations'),
 ('operations_transfer_dispatch','Dispatch Transfers','employee','operations'),
 ('operations_transfer_modify','Submit / Cancel Transfers','employee','operations'),
 ('operations_transfer_view','View Transfers','employee','operations');
update public.module_catalog set label='Goods Return / Refunds' where key='returns';
update public.module_catalog set label='Cash Up' where key='cash_up';
CREATE OR REPLACE FUNCTION app.member_has_module(p_user uuid, p_store uuid, p_module text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare granted boolean; parent text; dependency text; dependencies text[];
begin
 select exists(
  select 1 from public.memberships m join public.stores s on s.business_id=m.business_id
  join public.module_catalog c on c.key=p_module
  left join public.store_module_access a on a.membership_id=m.id and a.store_id=s.id
  where s.id=p_store and s.is_active and m.user_id=p_user and m.is_active
   and app.role_rank(m.role)>=app.role_rank(c.minimum_role)
   and (m.role='owner' or (exists(select 1 from public.store_memberships sm where sm.membership_id=m.id and sm.store_id=s.id)
    and ((not coalesce(a.permissions ? p_module,false) and (m.role<>'employee' or p_module not in ('goods_in_new_stock','goods_in_receive_transfer','warehouse'))) or a.permissions->p_module='true'::jsonb)))) into granted;
 if not granted then return false;end if;
 if p_module<>'warehouse' and exists(select 1 from public.stores where id=p_store and location_type='warehouse') and not app.member_has_module(p_user,p_store,'warehouse') then return false;end if;
 select parent_key,requires into parent,dependencies from public.module_catalog where key=p_module;
 if parent is not null and not app.member_has_module(p_user,p_store,parent) then return false;end if;
 foreach dependency in array dependencies loop
  if not app.member_has_module(p_user,p_store,dependency) then return false;end if;
 end loop;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.receive_stock(p_store uuid, p_supplier uuid, p_reference text, p_note text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$begin perform app.require_module(p_store,array['goods_in_new_stock']); return app_private.receive_stock(p_store,p_supplier,p_reference,p_note,p_items); end;$function$
;
CREATE OR REPLACE FUNCTION public.create_stock_transfer(p_source uuid, p_destination uuid, p_items jsonb, p_request uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$begin perform app.require_module(p_source,array['operations_transfer_create']);perform app.require_module(p_destination,array['operations']); return app_private.create_stock_transfer(p_source,p_destination,p_items,p_request,p_note); end;$function$
;

create or replace function public.process_stock_transfer(p_transfer uuid,p_action text,p_reason text default null) returns text
language plpgsql security definer set search_path='' as $$
declare t public.stock_transfers%rowtype;
begin
 select * into t from public.stock_transfers where id=p_transfer;
 if not found then raise exception 'FORBIDDEN';end if;
 if p_action='receive' then
  perform app.require_module(t.destination_id,array['goods_in_receive_transfer']);
 else
  perform app.require_module(t.source_id,case when p_action='dispatch' then array['operations_transfer_dispatch'] else array['operations_transfer_modify'] end);
  perform app.require_module(t.destination_id,array['operations']);
 end if;
 return app_private.process_stock_transfer(p_transfer,p_action,p_reason);
end $$;
CREATE OR REPLACE FUNCTION app_private.process_stock_transfer(p_transfer uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare t public.stock_transfers%rowtype; item record; next_status text; allocations jsonb;
begin
  select * into t from public.stock_transfers where id=p_transfer for update;
  if not found or not app.has_store_access(t.destination_id) or (p_action<>'receive' and not app.has_store_access(t.source_id)) then raise exception 'FORBIDDEN'; end if;
  next_status:=case p_action when 'submit' then 'SUBMITTED' when 'dispatch' then 'DISPATCHED' when 'receive' then 'RECEIVED' when 'cancel' then 'CANCELLED' else null end;
  if next_status is null then raise exception 'INVALID_ACTION'; end if;
  if t.status=next_status then return t.status; end if;
  if not ((p_action='submit' and t.status='DRAFT') or (p_action='dispatch' and t.status='SUBMITTED') or
    (p_action='receive' and t.status='DISPATCHED') or (p_action='cancel' and t.status in ('DRAFT','SUBMITTED','DISPATCHED'))) then raise exception 'INVALID_TRANSFER_STATE'; end if;
  if p_action='cancel' and nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  -- Lock all involved stock rows in a stable order before any movements.
  perform s.id from public.stock s where
    (s.store_id=t.source_id and s.product_id in (select source_product_id from public.stock_transfer_items where transfer_id=t.id)) or
    (s.store_id=t.destination_id and s.product_id in (select destination_product_id from public.stock_transfer_items where transfer_id=t.id))
    order by s.store_id,s.product_id for update;
  if p_action in ('submit','dispatch') then
    if exists(select 1 from public.stock_transfer_items i join public.products p on p.id=i.source_product_id
      join public.products d on d.id=i.destination_product_id where i.transfer_id=t.id and (not p.is_active or not d.is_active or p.unit<>d.unit or p.track_expiry<>d.track_expiry))
      then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    if exists(select 1 from (select source_product_id,sum(quantity) quantity from public.stock_transfer_items where transfer_id=t.id group by source_product_id) i
      left join public.stock s on s.product_id=i.source_product_id and s.store_id=t.source_id where coalesce(s.quantity,0)<i.quantity)
      then raise exception 'INSUFFICIENT_STOCK'; end if;
  end if;
  for item in select * from public.stock_transfer_items where transfer_id=t.id order by source_product_id,destination_product_id loop
    if p_action='dispatch' then
      perform app.apply_stock_delta(t.business_id,t.source_id,item.source_product_id,-item.quantity,'TRANSFER_OUT',t.reference,'stock_transfers',t.id,item.unit_cost);
      allocations:=app.take_stock_batches(item.source_product_id,t.source_id,item.quantity);
      update public.stock_transfer_items set batches=allocations where id=item.id;
    elsif p_action='receive' then
      perform app.apply_stock_delta(t.business_id,t.destination_id,item.destination_product_id,item.quantity,'TRANSFER_IN',t.reference,'stock_transfers',t.id,item.unit_cost);
      perform app.put_stock_batches(item.destination_product_id,t.destination_id,item.batches);
    elsif p_action='cancel' and t.status='DISPATCHED' then
      perform app.apply_stock_delta(t.business_id,t.source_id,item.source_product_id,item.quantity,'TRANSFER_IN',t.reference||' cancelled: '||p_reason,'stock_transfers',t.id,item.unit_cost);
      perform app.put_stock_batches(item.source_product_id,t.source_id,item.batches);
    end if;
  end loop;
  update public.stock_transfers set status=next_status,
    submitted_at=case when p_action='submit' then now() else submitted_at end,
    dispatched_at=case when p_action='dispatch' then now() else dispatched_at end,
    dispatched_by=case when p_action='dispatch' then auth.uid() else dispatched_by end,
    received_at=case when p_action='receive' then now() else received_at end,
    received_by=case when p_action='receive' then auth.uid() else received_by end,
    cancelled_at=case when p_action='cancel' then now() else cancelled_at end,
    cancellation_reason=case when p_action='cancel' then btrim(p_reason) else cancellation_reason end
    where id=t.id;
  perform app.audit('transfer.'||p_action,'stock_transfers',t.id,t.business_id,t.source_id,jsonb_build_object('status',t.status),jsonb_build_object('status',next_status,'reason',p_reason,'destination',t.destination_id));
  return next_status;
end $function$
;

create or replace function app.can_read_transfer(p_source uuid,p_destination uuid,p_status text) returns boolean
language sql stable security definer set search_path='' as $$
 select (app.has_any_module(p_source,array['operations_transfer_view','reports']) and app.has_any_module(p_destination,array['operations_transfer_view','reports']))
 or (p_status in ('DISPATCHED','RECEIVED') and app.has_module(p_destination,'goods_in_receive_transfer'));
$$;
revoke all on function app.can_read_transfer(uuid,uuid,text) from public,anon;
grant execute on function app.can_read_transfer(uuid,uuid,text) to authenticated;
alter policy sel_transfers on public.stock_transfers using(app.can_read_transfer(source_id,destination_id,status));
alter policy module_read on public.stock_transfers using(app.can_read_transfer(source_id,destination_id,status));
CREATE OR REPLACE FUNCTION public.transfer_history(p_business uuid, p_source uuid DEFAULT NULL::uuid, p_destination uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_product text DEFAULT NULL::text, p_user uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS SETOF stock_transfers
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
begin
  if not app.is_business_member(p_business) then raise exception 'FORBIDDEN'; end if;
  return query select t.* from public.stock_transfers t
    where t.business_id=p_business and app.can_read_transfer(t.source_id,t.destination_id,t.status)
      and (p_source is null or t.source_id=p_source) and (p_destination is null or t.destination_id=p_destination)
      and (p_status is null or t.status=p_status) and (p_user is null or p_user in (t.created_by,t.dispatched_by,t.received_by))
      and (p_from is null or t.created_at>=p_from) and (p_to is null or t.created_at<p_to)
      and (nullif(btrim(p_product),'') is null or exists(select 1 from public.stock_transfer_items i where i.transfer_id=t.id
        and (i.source_name ilike '%'||p_product||'%' or i.destination_name ilike '%'||p_product||'%' or exists(select 1 from public.products p where p.id in (i.source_product_id,i.destination_product_id) and p.sku ilike '%'||p_product||'%'))))
    order by t.created_at desc,t.id limit 200;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.submit_goods_return(p_source_type text, p_source uuid, p_items jsonb, p_reason text, p_inspection text, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare loc uuid; biz uuid; customer uuid; rid uuid; payload jsonb; old public.goods_returns%rowtype; item jsonb; source record;
  q numeric; previous_qty numeric; previous_amount numeric; amount numeric; total numeric:=0; tracked boolean; expiry date;
begin
  if p_source_type='invoice' then
    select store_id,business_id,customer_id into loc,biz,customer from public.sales_invoices where id=p_source and state='ISSUED' and goods_issued_at is not null for update;
  elsif p_source_type='sale' then
    select store_id,business_id,customer_id into loc,biz,customer from public.goods_out where id=p_source for update;
  else raise exception 'INVALID_SOURCE'; end if;
  if loc is null or not app.has_store_access(loc) then raise exception 'FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('user',auth.uid(),'source_type',p_source_type,'source',p_source,'items',p_items,'reason',p_reason,'inspection',p_inspection);
  perform pg_advisory_xact_lock(hashtextextended(biz::text||p_request::text,0));
  select * into old from public.goods_returns where business_id=biz and request_id=p_request;
  if found then if old.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return old.id; end if;
  if nullif(btrim(p_reason),'') is null or nullif(btrim(p_inspection),'') is null then raise exception 'REASON_AND_INSPECTION_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS'; end if;
  insert into public.goods_returns(business_id,store_id,invoice_id,sale_id,customer_id,reason,inspection,created_by,request_id,request_payload)
    values(biz,loc,case when p_source_type='invoice' then p_source end,case when p_source_type='sale' then p_source end,customer,p_reason,p_inspection,auth.uid(),p_request,payload) returning id into rid;
  for item in select value from jsonb_array_elements(p_items) loop
    if p_source_type='invoice' then
      select id,product_id,product_name,quantity,net_total as amount into source from public.sales_invoice_items where invoice_id=p_source and id=(item->>'item_id')::uuid;
    else
      select si.id,si.product_id,p.name product_name,si.quantity,si.line_total as amount into source from public.goods_out_items si join public.products p on p.id=si.product_id where goods_out_id=p_source and si.id=(item->>'item_id')::uuid;
    end if;
    if not found then raise exception 'INVALID_RETURN_ITEM'; end if;
    q:=(item->>'quantity')::numeric;
    if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) then raise exception 'INVALID_QUANTITY'; end if;
    select coalesce(sum(ri.quantity),0),coalesce(sum(ri.amount),0) into previous_qty,previous_amount from public.goods_return_items ri join public.goods_returns r on r.id=ri.return_id
      where r.status<>'REJECTED' and (ri.invoice_item_id=source.id or ri.sale_item_id=source.id);
    if previous_qty+q>source.quantity then raise exception 'RETURN_EXCEEDS_SOLD_QUANTITY'; end if;
    if item->>'condition' is null or item->>'condition' not in ('GOOD','DAMAGED','EXPIRED','OTHER') or item->>'action' is null or item->>'action' not in ('RETURN_TO_STOCK','QUARANTINE','SUPPLIER_RETURN','WRITE_OFF') then raise exception 'INVALID_RETURN_CONDITION'; end if;
    expiry:=nullif(item->>'expiry_date','')::date;
    if lower(btrim(split_part(p_reason, ':', 1)))='expired' and expiry is null then raise exception 'EXPIRY_REQUIRED';end if;
    select track_expiry into tracked from public.products where id=source.product_id;
    if item->>'action'='RETURN_TO_STOCK' then
      if item->>'condition'<>'GOOD' or (expiry is not null and expiry<(now() at time zone 'Africa/Johannesburg')::date) then raise exception 'RETURN_REQUIRES_QUARANTINE'; end if;
      -- Undated tracked returns remain excluded from sellable batch quantities.
    end if;
    amount:=case when previous_qty+q=source.quantity then source.amount-previous_amount else least(round(source.amount*q/source.quantity,2),source.amount-previous_amount) end;
    total:=total+amount;
    insert into public.goods_return_items(return_id,invoice_item_id,sale_item_id,product_id,product_name,quantity,amount,condition,inventory_action,expiry_date)
      values(rid,case when p_source_type='invoice' then source.id end,case when p_source_type='sale' then source.id end,source.product_id,source.product_name,q,amount,item->>'condition',item->>'action',expiry);
  end loop;
  update public.goods_returns set amount=total where id=rid;
  perform app.audit('return.submit','goods_returns',rid,biz,loc,null,payload);
  if not coalesce((select return_approval_required from public.billing_settings where business_id=biz),true) then perform app.approve_goods_return(rid); end if;
  return rid;
end $function$
;
CREATE OR REPLACE FUNCTION public.save_product_details(p_product uuid, p_values jsonb, p_expiry date DEFAULT NULL::date, p_expected numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; total numeric; undated numeric; current_barcode text; new_barcode text; barcode_id uuid;
begin
 select * into p from public.products where id=p_product;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p.store_id,array['products']);
 select quantity into total from public.stock where product_id=p.id and store_id=p.store_id for update;
 select greatest(coalesce(total,0)-coalesce(sum(quantity) filter(where expiry_date is not null),0),0) into undated from public.stock_batches where product_id=p.id and store_id=p.store_id;
 if coalesce((p_values->>'track_expiry')::boolean,false) and undated>0 then
  if p_expiry is null then raise exception 'EXPIRY_REQUIRED'; end if;
  perform public.assign_stock_expiry(p.id,p_expiry,undated,p_expected);
 end if;
 if p_values ? 'barcode' then
  new_barcode:=btrim(p_values->>'barcode');
  select id,barcode into barcode_id,current_barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,id limit 1 for update;
  if current_barcode is distinct from nullif(p_values->>'expected_barcode','') then raise exception 'BARCODE_CHANGED_REFRESH';end if;
  if nullif(new_barcode,'') is null or length(new_barcode)>128 then raise exception 'INVALID_BARCODE';end if;
  if new_barcode is distinct from current_barcode then
   if exists(select 1 from public.product_barcodes where store_id=p.store_id and barcode=new_barcode and is_active) then raise exception 'BARCODE_ALREADY_EXISTS';end if;
   if barcode_id is not null then update public.product_barcodes set is_active=false where id=barcode_id;end if;
   insert into public.product_barcodes(product_id,store_id,barcode) values(p.id,p.store_id,new_barcode);
   perform app.audit('product.barcode','products',p.id,p.business_id,p.store_id,jsonb_build_object('barcode',current_barcode),jsonb_build_object('barcode',new_barcode));
  end if;
 end if;
 if nullif(btrim(p_values->>'name'),'') is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
 if char_length(p_values->>'description')>1000 then raise exception 'PRODUCT_DESCRIPTION_TOO_LONG';end if;
 if char_length(p_values->>'sku')>128 then raise exception 'INVALID_SKU';end if;
 update public.products set sku=case when p_values ? 'sku' then nullif(btrim(p_values->>'sku'),'') else sku end,description=case when p_values ? 'description' then nullif(btrim(p_values->>'description'),'') else description end,name=btrim(p_values->>'name'),cost_price=(p_values->>'cost_price')::numeric,
 selling_price=(p_values->>'selling_price')::numeric,min_stock_level=(p_values->>'min_stock_level')::numeric,
 reorder_level=(p_values->>'reorder_level')::numeric,unit=coalesce(nullif(btrim(p_values->>'unit'),''),'each'),
 track_expiry=(p_values->>'track_expiry')::boolean,is_active=(p_values->>'is_active')::boolean where id=p.id;
 perform app.audit('product.edit','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $function$
;

-- Correct one batch, never historic receipt or movement evidence; lock stock before batches.
create or replace function public.correct_batch_expiry(p_batch uuid,p_expiry date,p_expected_expiry date,p_expected_quantity numeric,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.stock_batches%rowtype; p public.products%rowtype;
begin
 select * into b from public.stock_batches where id=p_batch;
 if not found then raise exception 'FORBIDDEN';end if;
 perform app.require_module(b.store_id,array['products']);
 if not app.has_store_role(b.store_id,'manager') then raise exception 'FORBIDDEN';end if;
 if p_expiry is null or nullif(btrim(p_reason),'') is null then raise exception 'EXPIRY_AND_REASON_REQUIRED';end if;
 select * into p from public.products where id=b.product_id;
 perform 1 from public.stock where store_id=b.store_id and product_id=b.product_id for update;
 select * into b from public.stock_batches where id=p_batch for update;
 if b.quantity<=0 or b.quantity is distinct from p_expected_quantity or b.expiry_date is distinct from p_expected_expiry then raise exception 'BATCH_CHANGED_REFRESH';end if;
 update public.stock_batches set expiry_date=p_expiry where id=b.id;
 perform app.audit('stock.expiry_corrected','stock_batches',b.id,p.business_id,b.store_id,to_jsonb(b),jsonb_build_object('expiry_date',p_expiry,'quantity',b.quantity,'reason',btrim(p_reason)));
end $$;
revoke all on function public.correct_batch_expiry(uuid,date,date,numeric,text) from public,anon;
grant execute on function public.correct_batch_expiry(uuid,date,date,numeric,text) to authenticated;

create or replace function public.warehouse_summary(p_business uuid) returns table(location_id uuid,name text,currency text,product_count bigint,stock_quantity numeric,stock_value numeric)
language sql stable security definer set search_path='' as $$
 select s.id,s.name,s.currency,count(p.id),coalesce(sum(st.quantity),0),coalesce(sum(st.quantity*p.cost_price),0)
 from public.stores s left join public.products p on p.store_id=s.id and p.is_active
 left join public.stock st on st.product_id=p.id and st.store_id=s.id
 where s.business_id=p_business and s.is_active and s.location_type='warehouse' and app.has_module(s.id,'warehouse')
 group by s.id,s.name,s.currency;
$$;
revoke all on function public.warehouse_summary(uuid) from public,anon;
grant execute on function public.warehouse_summary(uuid) to authenticated;
create or replace function public.create_product_catalog(p_store uuid,p_name text,p_values jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 perform app.require_module(p_store,array['products']);
 if length(p_values->>'sku')>128 then raise exception 'INVALID_SKU';end if;
 pid:=public.create_product_with_description(p_store:=p_store,p_name:=p_name,p_description:=p_values->>'description',p_barcode:=p_values->>'barcode',p_cost:=coalesce((p_values->>'cost')::numeric,0),p_selling:=coalesce((p_values->>'selling')::numeric,0),p_min:=coalesce((p_values->>'min')::numeric,0),p_reorder:=coalesce((p_values->>'reorder')::numeric,0),p_track_expiry:=coalesce((p_values->>'track_expiry')::boolean,false));
 update public.products set sku=nullif(btrim(p_values->>'sku'),'') where id=pid;
 return pid;
end $$;
revoke all on function public.create_product_catalog(uuid,text,jsonb) from public,anon;
grant execute on function public.create_product_catalog(uuid,text,jsonb) to authenticated;

create or replace view public.v_product_catalog with(security_invoker=true) as
 SELECT existing.id,
    existing.business_id,
    existing.store_id,
    existing.name,
    existing.sku,
    existing.unit,
    existing.cost_price,
    existing.selling_price,
    existing.min_stock_level,
    existing.reorder_level,
    existing.track_expiry,
    existing.is_active,
    existing.category_id,
    existing.default_supplier_id,
    existing.quantity,
    existing.stock_value,
    existing.retail_value,
    existing.category_name,
    existing.supplier_name,
    existing.stock_status,
    existing.suggested_reorder,
    existing.barcodes,
    existing.search_text || ' ' || coalesce(existing.sku,'') as search_text,
    existing.nearest_expiry,
    existing.expired_quantity,
    existing.undated_quantity,
    existing.sellable_quantity,
    p.description
   FROM ( SELECT v.id,
            v.business_id,
            v.store_id,
            v.name,
            v.sku,
            v.unit,
            v.cost_price,
            v.selling_price,
            v.min_stock_level,
            v.reorder_level,
            v.track_expiry,
            v.is_active,
            v.category_id,
            v.default_supplier_id,
            v.quantity,
            v.stock_value,
            v.retail_value,
            v.category_name,
            v.supplier_name,
            v.stock_status,
            v.suggested_reorder,
            COALESCE(b.barcodes, ''::text) AS barcodes,
            (COALESCE(b.barcodes, ''::text) || ' '::text) || v.name AS search_text,
            x.nearest_expiry,
            COALESCE(x.expired_quantity, 0::numeric) AS expired_quantity,
            GREATEST(v.quantity - COALESCE(x.dated_quantity, 0::numeric), 0::numeric) AS undated_quantity,
                CASE
                    WHEN v.track_expiry THEN LEAST(v.quantity, COALESCE(x.sellable_quantity, 0::numeric))
                    ELSE v.quantity
                END AS sellable_quantity
           FROM v_product_stock v
             LEFT JOIN LATERAL ( SELECT string_agg(product_barcodes.barcode, ', '::text ORDER BY product_barcodes.barcode) AS barcodes
                   FROM product_barcodes
                  WHERE product_barcodes.product_id = v.id AND product_barcodes.is_active) b ON true
             LEFT JOIN LATERAL ( SELECT min(stock_batches.expiry_date) FILTER (WHERE stock_batches.quantity > 0::numeric) AS nearest_expiry,
                    sum(stock_batches.quantity) FILTER (WHERE stock_batches.expiry_date IS NOT NULL) AS dated_quantity,
                    sum(stock_batches.quantity) FILTER (WHERE stock_batches.expiry_date < (now() AT TIME ZONE 'Africa/Johannesburg'::text)::date) AS expired_quantity,
                    sum(stock_batches.quantity) FILTER (WHERE stock_batches.expiry_date >= (now() AT TIME ZONE 'Africa/Johannesburg'::text)::date) AS sellable_quantity
                   FROM stock_batches
                  WHERE stock_batches.product_id = v.id AND stock_batches.store_id = v.store_id) x ON true) existing
     JOIN products p ON p.id = existing.id;
-- Invitation defaults must agree with the interactive permission editor.
do $$ declare src text;oid oid;begin
 select p.oid into strict oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='accept_employee_invitation';
 src:=pg_get_functiondef(oid);
 src:=replace(src,'parent_key is not null and app.role_rank(minimum_role)<=app.role_rank(item.role)', 'parent_key is not null and app.role_rank(minimum_role)<=app.role_rank(item.role) and (item.role<>''employee'' or key not in (''goods_in_new_stock'',''goods_in_receive_transfer''))');
 execute src;
end $$;
create or replace function public.transfer_detail(p_transfer uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.stock_transfers%rowtype;
begin
 select * into t from public.stock_transfers where id=p_transfer;
 if not found or not app.can_read_transfer(t.source_id,t.destination_id,t.status) then raise exception 'FORBIDDEN';end if;
 return jsonb_build_object('source',(select name from public.stores where id=t.source_id),'destination',(select name from public.stores where id=t.destination_id),
 'requested_by',(select full_name from public.profiles where id=t.created_by),'dispatched_by',(select full_name from public.profiles where id=t.dispatched_by),'received_by',(select full_name from public.profiles where id=t.received_by),'note',t.note,
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'source_name',i.source_name,'destination_name',i.destination_name,'quantity',i.quantity,'sku',p.sku,'unit_cost',i.unit_cost,'batches',i.batches)),'[]') from public.stock_transfer_items i join public.products p on p.id=i.source_product_id where i.transfer_id=t.id));
end $$;
revoke all on function public.transfer_detail(uuid) from public,anon;
grant execute on function public.transfer_detail(uuid) to authenticated;
