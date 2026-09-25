-- Employee screens and explicit, per-store price overrides. Existing grants stay intact.
insert into public.module_catalog(key,label,minimum_role,parent_key,requires)
values('goods_out_change_price','Change selling price / discount','employee','goods_out','{}');
update public.module_catalog set minimum_role='manager' where key in
('dashboard_invoicing','invoices_summary','invoices_invoiced','invoices_paid','invoices_outstanding','invoices_overdue','invoices_credit_notes','invoices_month_to_date');
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
    and ((not coalesce(a.permissions ? p_module,false) and (m.role<>'employee' or p_module not in ('goods_in_new_stock','goods_in_receive_transfer','warehouse','goods_out_change_price'))) or a.permissions->p_module='true'::jsonb)))) into granted;
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
CREATE OR REPLACE FUNCTION app_private.complete_sale(p_store uuid, p_sale_type text, p_customer uuid, p_items jsonb, p_override boolean DEFAULT false, p_note text DEFAULT NULL::text, p_request uuid DEFAULT NULL::uuid, p_payment_reference text DEFAULT NULL::text, p_override_token uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_existing public.goods_out%rowtype; v_payload jsonb; v_biz uuid; v_go uuid; v_item jsonb; v_type app.sale_type;
  v_catalog_price numeric; v_can_price boolean; v_pid uuid; v_qty numeric; v_price numeric; v_line numeric; v_total numeric := 0;
  v_acct public.credit_accounts%rowtype;
  v_authorizer uuid; v_new_balance numeric; v_mtype app.movement_type; v_override boolean := false;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'NO_ITEMS'; end if;
  v_type := upper(p_sale_type)::app.sale_type;
  v_biz := app.store_business(p_store);
  v_mtype := case when v_type = 'CASH' then 'SALE_CASH' when v_type = 'CARD_EFT' then 'SALE_CARD' else 'SALE_CREDIT' end;
  v_payload:=jsonb_build_object('user',auth.uid(),'store',p_store,'type',v_type,'customer',p_customer,'items',p_items,'override',p_override,'note',p_note,'reference',p_payment_reference);
  if p_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_biz::text||p_request::text,0));
    select * into v_existing from public.goods_out where business_id=v_biz and request_id=p_request;
    if found then
      if v_existing.request_payload<>v_payload then raise exception 'REQUEST_CONFLICT'; end if;
      return v_existing.id;
    end if;
  end if;

  v_can_price:=app.has_module(p_store,'goods_out_change_price');
  if v_type = 'CREDIT' then
    if p_customer is null then raise exception 'CUSTOMER_REQUIRED'; end if;
    select * into v_acct from public.credit_accounts
      where customer_id = p_customer and store_id = p_store for update;
    if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  end if;

  insert into public.goods_out
    (business_id, store_id, sale_type, customer_id, note, performed_by,request_id,request_payload,payment_reference)
  values (v_biz, p_store, v_type, case when v_type='CREDIT' then p_customer else null end, p_note, auth.uid(),p_request,v_payload,nullif(btrim(p_payment_reference),''))
  returning id into v_go;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<>round(v_qty,3) then raise exception 'INVALID_QUANTITY'; end if;

    -- authoritative price: use provided unit_price if present else product selling price
    select coalesce(nullif(v_item->>'unit_price','')::numeric, selling_price), selling_price
      into v_price,v_catalog_price
      from public.products
      where id = v_pid and store_id = p_store and is_active for update;
    if v_price is null then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE: %', v_pid; end if;
    if v_price < 0 or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRICE'; end if;

    if not v_can_price and round(v_price,2) is distinct from v_catalog_price then raise exception 'PRICE_CHANGE_NOT_ALLOWED'; end if;
    v_price := round(v_price,2);
    v_line := round(v_qty * v_price, 2);
    v_total := v_total + v_line;

    insert into public.goods_out_items (goods_out_id, product_id, quantity, unit_price, line_total)
    values (v_go, v_pid, v_qty, v_price, v_line);

    perform app.apply_stock_delta(v_biz, p_store, v_pid, -v_qty, v_mtype,
      v_type||' sale', 'goods_out', v_go, null);
    perform app.take_sellable_batches(v_pid,p_store,v_qty);
  end loop;

  if v_type = 'CREDIT' then
    v_new_balance := v_acct.balance + v_total;
    if v_new_balance > v_acct.credit_limit then
      if not coalesce(p_override,false) and p_override_token is null then
        raise exception 'CREDIT_LIMIT_EXCEEDED: balance % would exceed limit %',
          v_new_balance, v_acct.credit_limit using errcode = 'check_violation';
      end if;
      -- override requires manager+
      if not app.has_store_role(p_store,'manager') then
        v_authorizer:=app.consume_credit_override(p_override_token,p_store,p_customer,v_total);
      end if;
      v_override := true;
    end if;

    update public.credit_accounts set balance = v_new_balance where id = v_acct.id;
    insert into public.credit_transactions
      (credit_account_id, business_id, store_id, txn_type, amount, balance_after,
       reference_table, reference_id, performed_by, note)
    values (v_acct.id, v_biz, p_store, 'CREDIT_SALE', v_total, v_new_balance,
       'goods_out', v_go, auth.uid(), p_note);

    update public.goods_out
      set credit_override = v_override,
          authorized_by = case when v_override then coalesce(v_authorizer,auth.uid()) else null end
      where id = v_go;
  end if;

  update public.goods_out set total_amount = v_total where id = v_go;

  perform app.audit('goods_out.complete','goods_out',v_go,v_biz,p_store,null,
    jsonb_build_object('sale_type',v_type,'total',v_total,'override',v_override));
  return v_go;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.receive_stock(p_store uuid, p_supplier uuid, p_reference text, p_note text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_catalog_cost numeric; v_can_cost boolean; v_biz uuid; v_gi uuid; v_item jsonb;
  v_pid uuid; v_qty numeric; v_cost numeric; v_line numeric; v_total numeric := 0;
  v_exp date; v_batch text;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'NO_ITEMS'; end if;
  v_biz := app.store_business(p_store);
  v_can_cost:=app.has_store_role(p_store,'manager');

  insert into public.goods_in (business_id, store_id, supplier_id, reference, note, performed_by)
  values (v_biz, p_store, p_supplier, nullif(btrim(coalesce(p_reference,'')),''), p_note, auth.uid())
  returning id into v_gi;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    v_pid  := (v_item->>'product_id')::uuid;
    v_qty  := (v_item->>'quantity')::numeric;
    v_cost := coalesce((v_item->>'unit_cost')::numeric, 0);
    v_exp  := nullif(v_item->>'expiry_date','')::date;
    v_batch:= nullif(v_item->>'batch_ref','');
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;

    select cost_price into v_catalog_cost from public.products
      where id = v_pid and store_id = p_store and is_active
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE: %', v_pid; end if;

    if not v_can_cost then
      if v_item->>'unit_cost' is null then v_cost:=v_catalog_cost; end if;
      if v_cost is distinct from v_catalog_cost then raise exception 'UNIT_COST_CHANGE_NOT_ALLOWED'; end if;
    end if;
    v_line := round(v_qty * v_cost, 2);
    v_total := v_total + v_line;

    insert into public.goods_in_items
      (goods_in_id, product_id, quantity, unit_cost, expiry_date, batch_ref, line_total)
    values (v_gi, v_pid, v_qty, v_cost, v_exp, v_batch, v_line);

    perform app.apply_stock_delta(v_biz, p_store, v_pid, v_qty, 'GOODS_IN',
      'Goods In '||coalesce(p_reference,''), 'goods_in', v_gi, v_cost);

    -- update cost price if provided (>0); trigger records price history
    if v_cost > 0 then
      update public.products set cost_price = v_cost where id = v_pid and cost_price is distinct from v_cost;
    end if;

    -- expiry batch tracking
    if v_exp is not null then
      insert into public.stock_batches (product_id, store_id, batch_ref, expiry_date, quantity)
      values (v_pid, p_store, v_batch, v_exp, v_qty);
    end if;
  end loop;

  update public.goods_in set total_cost = v_total where id = v_gi;
  if p_supplier is not null and nullif(btrim(coalesce(p_reference,'')),'') is not null then
    insert into public.supplier_invoices (business_id, store_id, supplier_id, goods_in_id, reference, amount)
    values (v_biz, p_store, p_supplier, v_gi, p_reference, v_total);
  end if;

  perform app.audit('goods_in.complete','goods_in',v_gi,v_biz,p_store,null,
    jsonb_build_object('total_cost',v_total,'items',jsonb_array_length(p_items)));
  return v_gi;
end $function$
;

-- Private snapshots make workbook IDs, TRUE counts and stale-record checks authoritative.
create table app.stock_take_exports (
 id uuid primary key,
 store_id uuid not null references public.stores(id) on delete cascade,
 stock_take_id uuid not null references public.stock_takes(id) on delete cascade,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 snapshot jsonb not null,
 imported_rows jsonb,
 imported_at timestamptz
);
create index stock_take_exports_take on app.stock_take_exports(stock_take_id);
create index stock_take_exports_store on app.stock_take_exports(store_id);
create index stock_take_exports_creator on app.stock_take_exports(created_by);
alter table app.stock_take_exports enable row level security;
revoke all on app.stock_take_exports from public,anon,authenticated;

create function app_private.export_stock_take_template(p_store uuid,p_export uuid,p_stock_take uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare take public.stock_takes%rowtype; previous app.stock_take_exports%rowtype; result jsonb;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p_store,array['stock_take']);
 if p_export is null then raise exception 'REQUEST_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_export::text,25));
 select * into previous from app.stock_take_exports where id=p_export;
 if found then
  if previous.created_by<>auth.uid() or previous.store_id<>p_store or (p_stock_take is not null and previous.stock_take_id<>p_stock_take) then raise exception 'REQUEST_CONFLICT'; end if;
  return previous.snapshot;
 end if;
 if p_stock_take is null then p_stock_take:=public.start_stock_take(p_store,'Excel stock take'); end if;
 select * into take from public.stock_takes where id=p_stock_take and store_id=p_store for update;
 if not found then raise exception 'FORBIDDEN'; end if;
 if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED'; end if;
 if (select count(*) from public.stock_take_items where stock_take_id=take.id)>10000 then raise exception 'TEMPLATE_TOO_LARGE'; end if;
 -- Products before stock, in the same ordering as stock approval and checkout.
 perform p.id from public.products p join public.stock_take_items i on i.product_id=p.id
 where i.stock_take_id=take.id order by p.id for share of p;
 perform s.product_id from public.stock s join public.stock_take_items i on i.product_id=s.product_id
 where i.stock_take_id=take.id and s.store_id=p_store order by s.product_id for share of s;
 select jsonb_build_object('export_id',p_export,'store_id',p_store,'stock_take_id',take.id,
  'store_name',(select name from public.stores where id=p_store),'items',coalesce(jsonb_agg(
   jsonb_build_object('id',i.id,'product_id',p.id,'name',p.name,'sku',p.sku,'unit',p.unit,
    'quantity',coalesce(s.quantity,0),'version',v.version,'counted_at',i.counted_at,
    'counted_qty',i.counted_qty,'counted_expiry',i.counted_expiry) order by p.name,p.id),'[]'::jsonb))
 into result from public.stock_take_items i join public.products p on p.id=i.product_id
 join app.catalog_versions v on v.product_id=p.id
 left join public.stock s on s.product_id=p.id and s.store_id=p_store
 where i.stock_take_id=take.id and p.store_id=p_store and p.is_active and p.tracking_type='QUANTITY';
 insert into app.stock_take_exports(id,store_id,stock_take_id,created_by,snapshot)
 values(p_export,p_store,take.id,auth.uid(),result);
 return result;
end $$;

create function app_private.import_stock_take_template(p_store uuid,p_export uuid,p_rows jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare template app.stock_take_exports%rowtype; take public.stock_takes%rowtype;
 row_data jsonb; snapshots jsonb; snap jsonb; item public.stock_take_items%rowtype; current_version uuid;
 current_qty numeric; count_qty numeric; expiry date;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p_store,array['stock_take']);
 select * into template from app.stock_take_exports where id=p_export and store_id=p_store;
 if not found then raise exception 'TEMPLATE_NOT_FOUND'; end if;
 select * into take from public.stock_takes where id=template.stock_take_id and store_id=p_store for update;
 select * into template from app.stock_take_exports where id=p_export for update;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'INVALID_COUNTS'; end if;
 if jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>10000 then raise exception 'INVALID_COUNTS'; end if;
 if template.imported_rows is not null then
  if template.imported_rows is distinct from p_rows then raise exception 'TEMPLATE_ALREADY_IMPORTED'; end if;
  return take.id; -- Safe retry of the exact import, even after approval.
 end if;
 if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED'; end if;
 if (select count(distinct value->>'item_id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'DUPLICATE_COUNT'; end if;
 -- Lock every participating product/stock row before validating versions. No partial saves.
 perform p.id from public.products p join public.stock_take_items i on i.product_id=p.id
 where i.stock_take_id=take.id and i.id in(select (value->>'item_id')::uuid from jsonb_array_elements(p_rows))
 order by p.id for update of p;
 perform s.product_id from public.stock s join public.stock_take_items i on i.product_id=s.product_id
 where i.stock_take_id=take.id and s.store_id=p_store and i.id in(select (value->>'item_id')::uuid from jsonb_array_elements(p_rows))
 order by s.product_id for share of s;
 select jsonb_object_agg(value->>'id',value) into snapshots from jsonb_array_elements(template.snapshot->'items');
 for row_data in select value from jsonb_array_elements(p_rows) order by value->>'item_id' loop
  snap:=snapshots->(row_data->>'item_id');
  if snap is null then raise exception 'TEMPLATE_ITEM_MISMATCH'; end if;
  select * into item from public.stock_take_items where id=(row_data->>'item_id')::uuid and stock_take_id=take.id for update;
  if not found then raise exception 'TEMPLATE_ITEM_MISMATCH'; end if;
  select v.version,coalesce(s.quantity,0) into current_version,current_qty
   from public.products p join app.catalog_versions v on v.product_id=p.id
   left join public.stock s on s.product_id=p.id and s.store_id=p_store
   where p.id=item.product_id and p.store_id=p_store and p.is_active and p.tracking_type='QUANTITY';
  if not found or current_version is distinct from (snap->>'version')::uuid or current_qty is distinct from (snap->>'quantity')::numeric then raise exception 'TEMPLATE_STOCK_CHANGED'; end if;
  if item.counted_at is distinct from (snap->>'counted_at')::timestamptz or item.counted_qty is distinct from (snap->>'counted_qty')::numeric or item.counted_expiry is distinct from (snap->>'counted_expiry')::date then raise exception 'TEMPLATE_COUNT_CHANGED'; end if;
  if jsonb_typeof(row_data->'same') is distinct from 'boolean' then raise exception 'INVALID_COUNTS'; end if;
  if (row_data->>'same')::boolean then count_qty:=(snap->>'quantity')::numeric;
  else
   if jsonb_typeof(row_data->'quantity') is distinct from 'number' then raise exception 'INVALID_COUNTS'; end if;
   count_qty:=(row_data->>'quantity')::numeric;
  end if;
  if count_qty is null or count_qty<0 or count_qty>999999999.999 or count_qty<>round(count_qty,3) or count_qty::text in('NaN','Infinity','-Infinity') then raise exception 'INVALID_COUNTS'; end if;
  expiry:=nullif(row_data->>'expiry','')::date;
  perform public.save_stock_take_count(item.id,count_qty,expiry);
 end loop;
 update app.stock_take_exports set imported_rows=p_rows,imported_at=now() where id=p_export;
 perform app.audit('stock_take.import','stock_take',take.id,take.business_id,p_store,null,jsonb_build_object('export_id',p_export,'count',jsonb_array_length(p_rows)));
 return take.id;
end $$;
-- Only the guarded API wrappers are exposed. Private bodies cannot be invoked directly.
revoke all on function app_private.export_stock_take_template(uuid,uuid,uuid),app_private.import_stock_take_template(uuid,uuid,jsonb) from public,anon,authenticated;
create function public.export_stock_take_template(p_store uuid,p_export uuid,p_stock_take uuid default null)
returns jsonb language sql security definer set search_path='' as $$
 select app_private.export_stock_take_template(p_store,p_export,p_stock_take);
$$;
create function public.import_stock_take_template(p_store uuid,p_export uuid,p_rows jsonb)
returns uuid language sql security definer set search_path='' as $$
 select app_private.import_stock_take_template(p_store,p_export,p_rows);
$$;
revoke all on function public.export_stock_take_template(uuid,uuid,uuid),public.import_stock_take_template(uuid,uuid,jsonb) from public,anon;
grant execute on function public.export_stock_take_template(uuid,uuid,uuid),public.import_stock_take_template(uuid,uuid,jsonb) to authenticated;

do $$ declare definition text; begin
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into definition;
 definition:=regexp_replace(definition,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''employee_excel_v1'',true,');
 if definition not like '%employee_excel_v1%' then raise exception 'Release contract pattern changed'; end if;
 execute definition;
end $$;
