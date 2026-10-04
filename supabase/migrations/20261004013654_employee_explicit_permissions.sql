-- Replace implicit role defaults with explicit, individual location grants.
-- Preserve the previous role settings before changing roles or defaults.
insert into public.store_module_access(membership_id,store_id,permissions,version)
select m.id,sm.store_id,(select jsonb_object_agg(c.key,
 app.role_rank(m.role)>=app.role_rank(c.minimum_role) and coalesce((a.permissions->>c.key)::boolean,m.role<>'employee' or c.key not in ('warehouse','goods_in_new_stock','goods_out_change_price','goods_in_receive_transfer')))
 from public.module_catalog c),coalesce(a.version,0)+1
from public.memberships m join public.store_memberships sm on sm.membership_id=m.id
left join public.store_module_access a on a.membership_id=m.id and a.store_id=sm.store_id
where m.role<>'owner'
on conflict(membership_id,store_id) do update set permissions=excluded.permissions,version=excluded.version,updated_at=now();
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('products_manage','Edit products and stock configuration','employee','products','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('products_manage',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('stock_take_approve','Approve and apply stock counts','employee','stock_take','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('stock_take_approve',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('cash_up_manage','Review cash-up and manage cash movements','employee','cash_up','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('cash_up_manage',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('credit_manage','Manage credit limits and account status','employee','credit','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('credit_manage',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('credit_override','Approve credit-limit overrides','employee','credit','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('credit_override',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('invoices_manage','Correct invoices, cancel and issue adjustments','employee','invoices','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('invoices_manage',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('orders_approve','Approve purchase orders and cancel delivery orders','employee','orders','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('orders_approve',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('returns_manage','Approve refunds and resolve quarantine','employee','returns','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('returns_manage',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('goods_in_cost','Change receiving costs','employee','goods_in','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('goods_in_cost',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('reports_financial','View profit and invoice reconciliation','employee','reports','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('reports_financial',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('settings_manage','Edit location and notification settings','employee','settings','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('settings_manage',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('operations_approve','Approve bulk stock count overrides','employee','operations','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('operations_approve',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('goods_out_receipt_settings','Change receipt printing preferences','employee','goods_out','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('goods_out_receipt_settings',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('goods_out_override','Approve sale overrides','employee','goods_out','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('goods_out_override',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('check_stock_costs','Show stock cost and margin summaries','employee','check_stock','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('check_stock_costs',m.role in ('owner','manager')) from public.memberships m where m.id=a.membership_id;
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values('products_edit','Add and edit product records','employee','products','{}');
update public.store_module_access a set permissions=permissions||jsonb_build_object('products_edit',true);
-- Preserve explicitly configured pending invitations and their previous child defaults.
update public.employee_invitations inv set assignments=(select coalesce(jsonb_object_agg(pair.key,
 (select jsonb_object_agg(c.key,coalesce((pair.value->>c.key)::boolean,
 case when c.key='products_edit' then true
 when c.key in ('products_manage','stock_take_approve','cash_up_manage','credit_manage','credit_override','invoices_manage','orders_approve','returns_manage','goods_in_cost','reports_financial','settings_manage','operations_approve','goods_out_receipt_settings','goods_out_override','check_stock_costs') then inv.role='manager'
 else c.parent_key is not null and app.role_rank(c.minimum_role)<=app.role_rank(inv.role) and (inv.role<>'employee' or c.key not in ('goods_in_new_stock','goods_in_receive_transfer')) end)) from public.module_catalog c)), '{}'::jsonb) from jsonb_each(inv.assignments) pair)
where state='PENDING' and role<>'owner';
update public.module_catalog set minimum_role='employee' where minimum_role='manager';
update public.memberships set role='employee' where role='manager';
-- Pending invitations keep their already-selected module grants; unspecified functions remain blocked.
update public.employee_invitations set role='employee',version=version+1 where role='manager' and state='PENDING';
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
    and a.permissions->p_module='true'::jsonb))) into granted;
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
CREATE OR REPLACE FUNCTION app_private.update_location(p_store uuid, p_name text, p_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare v_old public.stores%rowtype;
begin
  if not app.has_module(p_store,'settings_manage') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  select * into strict v_old from public.stores where id = p_store for update;
  update public.stores set name = btrim(p_name), code = nullif(btrim(p_code), '') where id = p_store;
  perform app.audit('location.update', 'store', p_store, v_old.business_id, p_store,
    jsonb_build_object('name', v_old.name, 'code', v_old.code),
    jsonb_build_object('name', btrim(p_name), 'code', nullif(btrim(p_code), '')));
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
  if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and store_id=p_store and is_active) then raise exception 'CUSTOMER_REQUIRED';end if; if v_type = 'CREDIT' then
    if p_customer is null then raise exception 'CUSTOMER_REQUIRED'; end if;
    select * into v_acct from public.credit_accounts
      where customer_id = p_customer and store_id = p_store for update;
    if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  end if;

  insert into public.goods_out
    (business_id, store_id, sale_type, customer_id, note, performed_by,request_id,request_payload,payment_reference)
  values (v_biz, p_store, v_type, p_customer, p_note, auth.uid(),p_request,v_payload,nullif(btrim(p_payment_reference),''))
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
      if not app.has_module(p_store,'goods_out_override') then
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
CREATE OR REPLACE FUNCTION app_private.import_excel(p_store uuid, p_kind text, p_rows jsonb, p_request uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare biz uuid; batch uuid; previous public.import_batches%rowtype; r jsonb; processed jsonb; results jsonb:='[]';
  i integer:=0; seen uuid[]:='{}'; payload jsonb; response jsonb;
begin
  if not app.has_module(p_store,'imports') then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('products','suppliers','customers') or p_rows is null or jsonb_typeof(p_rows)<>'array' or p_request is null or p_preview is null then raise exception 'INVALID_IMPORT'; end if;
  if jsonb_array_length(p_rows) not between 1 and 200 or octet_length(p_rows::text)>1000000 then raise exception 'IMPORT_LIMIT_200_ROWS'; end if;
  biz:=app.store_business(p_store); payload:=jsonb_build_object('store',p_store,'kind',p_kind,'rows',p_rows);
  perform pg_advisory_xact_lock(hashtextextended('import:'||biz::text,0));
  select * into previous from public.import_batches where business_id=biz and request_id=p_request;
  if found then
    if previous.performed_by<>auth.uid() or previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
    return previous.result;
  end if;
  begin
    insert into public.import_batches(business_id,store_id,kind,request_id,request_payload,performed_by) values(biz,p_store,p_kind,p_request,payload,auth.uid()) returning id into batch;
    for r in select * from jsonb_array_elements(p_rows) loop
      i:=i+1; processed:=app.apply_import_row(p_store,p_kind,r,batch,p_preview);
      if (processed->>'id')::uuid=any(seen) then raise exception 'DUPLICATE_RECORD_IN_FILE'; end if;
      seen:=array_append(seen,(processed->>'id')::uuid); results:=results||jsonb_build_array(processed||jsonb_build_object('row',i+1));
    end loop;
    response:=jsonb_build_object('ok',true,'preview',p_preview,'batch_id',batch,'rows',results);
    if p_preview then raise exception using errcode='ZX001',message='ROLLBACK_PREVIEW'; end if;
    update public.import_batches set result=response where id=batch;
    perform app.audit('import.complete','import_batches',batch,biz,p_store,null,jsonb_build_object('kind',p_kind,'rows',i));
  exception when sqlstate 'ZX001' then return response;
    when others then return jsonb_build_object('ok',false,'row',i+1,'error',sqlerrm);
  end;
  return response;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.invoice_monthly_reconciliation(p_store uuid, p_month date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare start_at timestamptz; end_at timestamptz; result jsonb; opening numeric; closing numeric;
begin
  if not app.has_module(p_store,'reports_financial') then raise exception 'FORBIDDEN'; end if;
  if p_month is null then raise exception 'MONTH_REQUIRED'; end if;
  start_at:=date_trunc('month',p_month::timestamp) at time zone 'Africa/Johannesburg'; end_at:=(date_trunc('month',p_month::timestamp)+interval '1 month') at time zone 'Africa/Johannesburg';
  select coalesce(sum(case when kind in ('ISSUE','DEBIT_NOTE') then amount else -amount end),0) into opening from public.invoice_entries where store_id=p_store and created_at<start_at;
  select coalesce(sum(case when kind in ('ISSUE','DEBIT_NOTE') then amount else -amount end),0) into closing from public.invoice_entries where store_id=p_store and created_at<end_at;
  select jsonb_build_object('opening',opening,'invoiced',coalesce(sum(amount) filter(where kind='ISSUE'),0),'debits',coalesce(sum(amount) filter(where kind='DEBIT_NOTE'),0),
    'credit_notes',coalesce(sum(amount) filter(where kind='CREDIT_NOTE'),0),'voided',coalesce(sum(amount) filter(where kind='VOID'),0),
    'cash_received',coalesce(sum(amount) filter(where kind='PAYMENT' and method='CASH'),0),'card_received',coalesce(sum(amount) filter(where kind='PAYMENT' and method='CARD_EFT'),0),
    'store_credit_received',coalesce(sum(amount) filter(where kind='PAYMENT' and method='CREDIT'),0),'closing',closing,
    'refunds',coalesce((select sum(amount) from public.customer_refunds where store_id=p_store and created_at>=start_at and created_at<end_at),0),
    'customer_ledger_balance',coalesce((select sum(amount) from public.credit_transactions where store_id=p_store and created_at<end_at),0)) into result
    from public.invoice_entries where store_id=p_store and created_at>=start_at and created_at<end_at;
  return result || jsonb_build_object(
 'opening',opening+coalesce((select sum(amount_change) from public.invoice_revisions where store_id=p_store and before_data->'invoice'->>'state'='ISSUED' and created_at<start_at),0),
 'closing',closing+coalesce((select sum(amount_change) from public.invoice_revisions where store_id=p_store and before_data->'invoice'->>'state'='ISSUED' and created_at<end_at),0),
 'revisions',coalesce((select sum(amount_change) from public.invoice_revisions where store_id=p_store and before_data->'invoice'->>'state'='ISSUED' and created_at>=start_at and created_at<end_at),0));
end $function$
;
CREATE OR REPLACE FUNCTION app_private.profit_summary(p_store uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
begin
  if not app.has_module(p_store,'reports_financial') then raise exception 'FORBIDDEN'; end if;
  return app.profit_data(p_store,p_from,p_to);
end $function$
;
CREATE OR REPLACE FUNCTION app_private.set_notification_preference(p_store uuid, p_kind text, p_enabled boolean, p_hour integer DEFAULT 8)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare result uuid;
begin
  if not app.has_module(p_store,'settings_manage') then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('OUT_OF_STOCK','UPCOMING_EXPIRY','STOCK_TAKE_COMPLETED','LOW_STOCK','WEEKLY_PROFIT','OVERDUE_INVOICES') or p_enabled is null or p_hour is null or p_hour not between 0 and 23 then raise exception 'INVALID_NOTIFICATION_SETTINGS'; end if;
  insert into public.notification_preferences(business_id,store_id,user_id,kind,enabled,delivery_hour)
    values(app.store_business(p_store),p_store,auth.uid(),p_kind,p_enabled,p_hour)
    on conflict(store_id,user_id,kind) do update set enabled=excluded.enabled,delivery_hour=excluded.delivery_hour,updated_at=now() returning id into result;
  perform app.audit('notification.preference','notification_preferences',result,app.store_business(p_store),p_store,null,jsonb_build_object('kind',p_kind,'enabled',p_enabled,'hour',p_hour));
  return result;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.set_credit_limit(p_customer uuid, p_limit numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare v_acct public.credit_accounts%rowtype;
begin
  if p_limit is null or p_limit < 0 then raise exception 'INVALID_LIMIT'; end if;
  select * into v_acct from public.credit_accounts where customer_id = p_customer;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if not app.has_module(v_acct.store_id,'credit_manage') then raise exception 'FORBIDDEN'; end if;
  update public.credit_accounts set credit_limit = p_limit where id = v_acct.id;
  perform app.audit('credit.set_limit','credit_account',v_acct.id,v_acct.business_id,v_acct.store_id,
    jsonb_build_object('limit',v_acct.credit_limit), jsonb_build_object('limit',p_limit));
end $function$
;
CREATE OR REPLACE FUNCTION app_private.unpack_stock_with_count(p_conversion uuid, p_packs integer, p_counted integer, p_reason text, p_request uuid, p_expiry date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.bulk_conversions%rowtype; prior public.bulk_count_overrides%rowtype; payload jsonb; available numeric; correction numeric; cost numeric; tracked boolean; uid uuid; aid uuid;
begin
  select * into c from public.bulk_conversions where id=p_conversion for share;
  if not found or not app.has_module(c.store_id,'operations_approve') then raise exception 'FORBIDDEN';end if;
  if p_packs is null or p_packs<1 or p_counted is null or p_counted<p_packs or p_request is null or nullif(btrim(p_reason),'') is null then raise exception 'COUNT_AND_REASON_REQUIRED';end if;
  payload:=jsonb_build_object('conversion',p_conversion,'packs',p_packs,'counted',p_counted,'reason',btrim(p_reason),'expiry',p_expiry);
  perform pg_advisory_xact_lock(hashtextextended(c.business_id::text||p_request::text,0));
  select * into prior from public.bulk_count_overrides where business_id=c.business_id and request_id=p_request;
  if found then
    if prior.request_payload<>payload or prior.authorized_by<>auth.uid() then raise exception 'REQUEST_CONFLICT';end if;return prior.unpacking_id;
  end if;
  if exists(select 1 from public.bulk_unpackings where business_id=c.business_id and request_id=p_request) then raise exception 'REQUEST_CONFLICT';end if;
  perform product_id from public.stock where store_id=c.store_id and product_id in (c.pack_product_id,c.unit_product_id) order by product_id for update;
  select quantity into available from public.stock where product_id=c.pack_product_id and store_id=c.store_id;
  if available is null or available>=p_packs then raise exception 'NO_SHORTAGE_USE_NORMAL_UNPACK';end if;
  correction:=p_counted-available;
  select cost_price,track_expiry into cost,tracked from public.products where id=c.pack_product_id and is_active;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  if tracked and p_expiry is null then raise exception 'EXPIRY_DATE_REQUIRED';end if;
  insert into public.stock_adjustments(business_id,store_id,product_id,reason,quantity_before,quantity_after,delta,note,performed_by)
    values(c.business_id,c.store_id,c.pack_product_id,'STOCK_COUNT_CORRECTION',available,p_counted,correction,'Manager unpack override: '||btrim(p_reason),auth.uid()) returning id into aid;
  perform app.apply_stock_delta(c.business_id,c.store_id,c.pack_product_id,correction,'ADJUSTMENT_INCREASE','Manager unpack override: '||btrim(p_reason),'stock_adjustments',aid,cost);
  if tracked then perform app.put_stock_batches(c.pack_product_id,c.store_id,jsonb_build_array(jsonb_build_object('quantity',correction,'expiry_date',p_expiry,'batch_ref','Count override '||aid::text)));end if;
  uid:=public.unpack_stock(p_conversion,p_packs,btrim(p_reason),p_request);
  insert into public.bulk_count_overrides(business_id,store_id,unpacking_id,request_id,request_payload,quantity_before,counted_quantity,reason,authorized_by)
    values(c.business_id,c.store_id,uid,p_request,payload,available,p_counted,btrim(p_reason),auth.uid());
  perform app.audit('bulk.count_override','bulk_unpackings',uid,c.business_id,c.store_id,jsonb_build_object('quantity',available),jsonb_build_object('counted_quantity',p_counted,'adjustment_id',aid,'reason',p_reason));
  return uid;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.adjust_stock(p_store uuid, p_product uuid, p_new_qty numeric, p_reason text, p_note text DEFAULT NULL::text, p_expiry date DEFAULT NULL::date, p_request uuid DEFAULT NULL::uuid, p_expected numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare biz uuid; payload jsonb; prior public.stock_adjustment_requests%rowtype; aid uuid; available numeric;
begin
  if not app.has_module(p_store,'adjust') then raise exception 'FORBIDDEN';end if;biz:=app.store_business(p_store);
  payload:=jsonb_build_object('store',p_store,'product',p_product,'quantity',p_new_qty,'reason',p_reason,'note',p_note,'expiry',p_expiry,'expected',p_expected);
  if p_request is not null then
    perform pg_advisory_xact_lock(hashtextextended('adjust:'||biz::text||p_request::text,0));select * into prior from public.stock_adjustment_requests where business_id=biz and request_id=p_request;
    if found then if prior.payload<>payload or prior.performed_by<>auth.uid() then raise exception 'REQUEST_CONFLICT';end if;return prior.adjustment_id;end if;
  end if;
  perform 1 from public.products where id=p_product and store_id=p_store for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  select quantity into available from public.stock where product_id=p_product and store_id=p_store for update;
  if p_expected is not null and p_expected is distinct from coalesce(available,0) then raise exception 'STOCK_CHANGED_RECOUNT';end if;
  aid:=app.adjust_stock_count(p_store,p_product,p_new_qty,p_reason,p_note,p_expiry);
  if p_request is not null then insert into public.stock_adjustment_requests values(p_request,biz,p_store,aid,payload,auth.uid());end if;return aid;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.cancel_sales_invoice(p_invoice uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare i public.sales_invoices%rowtype; eid uuid; nextstate text;
begin
  select * into i from public.sales_invoices where id=p_invoice;
  if not found or not app.has_module(i.store_id,'invoices_manage') then raise exception 'FORBIDDEN'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  perform 1 from public.sales_orders where id=i.order_id for update;
  select * into i from public.sales_invoices where id=p_invoice for update;
  nextstate:=i.state;
  if i.state not in ('CANCELLED','VOID') then
    if i.goods_issued_at is not null or exists(select 1 from public.invoice_entries where invoice_id=i.id and kind<>'ISSUE') then raise exception 'USE_CREDIT_NOTE_OR_RETURN'; end if;
    nextstate:=case when i.state='DRAFT' then 'CANCELLED' else 'VOID' end;
    if nextstate='VOID' then
      insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,reason,performed_by,request_id,request_payload)
        values(i.id,i.business_id,i.store_id,'VOID',i.total,p_reason,auth.uid(),gen_random_uuid(),'{}') returning id into eid;
      perform app.post_customer_entry(i.customer_id,-i.total,'ADJUSTMENT','invoice_entries',eid,'Void '||i.reference||': '||p_reason);
    end if;
    update public.sales_invoices set state=nextstate,cancellation_reason=p_reason where id=i.id;
    perform app.audit('invoice.cancel','sales_invoices',i.id,i.business_id,i.store_id,null,jsonb_build_object('reason',p_reason,'state',nextstate,'order',i.order_id));
  end if;
  update public.sales_orders set status='CANCELLED',cancellation_reason=p_reason where id=i.order_id and status<>'CANCELLED';
  if found then perform app.audit('order.cancel','sales_orders',i.order_id,i.business_id,i.store_id,null,jsonb_build_object('reason',p_reason,'invoice',i.id)); end if;
  return nextstate;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.cancel_stock_take(p_stock_take uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare take public.stock_takes%rowtype;
begin
  select * into take from public.stock_takes where id=p_stock_take for update;
  if not found or not app.has_store_access(take.store_id) or (take.started_by is distinct from auth.uid() and not app.has_module(take.store_id,'stock_take_approve')) then raise exception 'FORBIDDEN';end if;
  if take.status='CANCELLED' then return;end if;
  if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED';end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED';end if;
  update public.stock_takes set status='CANCELLED',note=concat_ws(E'\n',note,'Cancelled: '||btrim(p_reason)) where id=p_stock_take;
  perform app.audit('stock_take.cancel','stock_take',p_stock_take,take.business_id,take.store_id,null,jsonb_build_object('reason',p_reason));
end $function$
;
CREATE OR REPLACE FUNCTION app_private.complete_stock_take(p_stock_take uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare take public.stock_takes%rowtype; item record; current_qty numeric;
begin
  select * into take from public.stock_takes where id=p_stock_take for update;
  if not found or not app.has_module(take.store_id,'stock_take_approve') then raise exception 'FORBIDDEN';end if;
  if take.status='COMPLETED' then return;end if;
  if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED';end if;
  if not exists(select 1 from public.stock_take_items where stock_take_id=p_stock_take and counted) then raise exception 'NO_COUNTS';end if;
  for item in select * from public.stock_take_items where stock_take_id=p_stock_take and counted order by product_id for update loop
    perform 1 from public.products where id=item.product_id for update;
    select quantity into current_qty from public.stock where product_id=item.product_id and store_id=take.store_id for update;
    if item.counted_at is null or coalesce(current_qty,0)<>item.system_qty then raise exception 'STOCK_CHANGED_RECOUNT: %',item.product_id;end if;
    if item.counted_qty<>item.system_qty then perform app.adjust_stock_count(take.store_id,item.product_id,item.counted_qty,'STOCK_COUNT_CORRECTION','Stock take '||p_stock_take::text,item.counted_expiry,p_stock_take);end if;
  end loop;
  update public.stock_takes set status='COMPLETED',approved_by=auth.uid(),completed_at=now() where id=p_stock_take;
  perform app.audit('stock_take.complete','stock_take',p_stock_take,take.business_id,take.store_id,null,null);
end $function$
;
CREATE OR REPLACE FUNCTION app_private.post_invoice_entry(p_invoice uuid, p_kind text, p_amount numeric, p_request uuid, p_method text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare i public.sales_invoices%rowtype; b public.v_invoice_balances%rowtype; previous public.invoice_entries%rowtype; eid uuid; payload jsonb; delta numeric;
begin
  select * into i from public.sales_invoices where id=p_invoice for update;
  if not found or not app.has_store_access(i.store_id) then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('PAYMENT','CREDIT_NOTE','DEBIT_NOTE') then raise exception 'INVALID_ACTION'; end if;
  if p_kind<>'PAYMENT' and not app.has_module(i.store_id,'invoices_manage') then raise exception 'FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('user',auth.uid(),'invoice',i.id,'kind',p_kind,'amount',p_amount,'method',p_method,'reference',p_reference,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(i.business_id::text||p_request::text,0));
  select * into previous from public.invoice_entries where business_id=i.business_id and request_id=p_request;
  if found then if previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return previous.id; end if;
  if i.state<>'ISSUED' then raise exception 'INVALID_INVOICE_STATE'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<=0 then raise exception 'INVALID_AMOUNT'; end if;
  p_amount:=round(p_amount,2);
  select * into b from public.v_invoice_balances where id=i.id;
  if p_kind='PAYMENT' then
    if p_method is null or p_method not in ('CASH','CARD_EFT') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
    if p_amount>b.outstanding then raise exception 'PAYMENT_EXCEEDS_OUTSTANDING'; end if;
  else
    if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
    if p_kind='CREDIT_NOTE' and p_amount>i.total+b.debits-b.credits then raise exception 'CREDIT_EXCEEDS_INVOICE'; end if;
    if p_method is not null then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  end if;
  delta:=case when p_kind='DEBIT_NOTE' then p_amount else -p_amount end;
  insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,method,payment_reference,reason,performed_by,request_id,request_payload)
    values(i.id,i.business_id,i.store_id,p_kind,p_amount,p_method,p_reference,p_reason,auth.uid(),p_request,payload) returning id into eid;
  perform app.post_customer_entry(i.customer_id,delta,case when p_kind='PAYMENT' then 'PAYMENT'::app.credit_txn_type else 'ADJUSTMENT'::app.credit_txn_type end,'invoice_entries',eid,p_kind||' '||i.reference||coalesce(': '||p_reason,''));
  perform app.audit('invoice.'||lower(p_kind),'invoice_entries',eid,i.business_id,i.store_id,null,payload);
  return eid;
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
  v_can_cost:=app.has_module(p_store,'goods_in_cost');

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
CREATE OR REPLACE FUNCTION app_private.resolve_return_quarantine(p_item uuid, p_action text, p_reason text, p_expiry date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare line public.goods_return_items%rowtype; r public.goods_returns%rowtype; previous public.return_dispositions%rowtype; result uuid;
begin
  select * into line from public.goods_return_items where id=p_item for update;
  select * into r from public.goods_returns where id=line.return_id;
  if r.id is null or not app.has_module(r.store_id,'returns_manage') then raise exception 'FORBIDDEN'; end if;
  if r.status<>'APPROVED' or line.inventory_action<>'QUARANTINE' then raise exception 'INVALID_RETURN_STATE'; end if;
  select * into previous from public.return_dispositions where return_item_id=line.id;
  if found then
    if previous.action is distinct from p_action or previous.reason is distinct from p_reason or previous.expiry_date is distinct from p_expiry then raise exception 'REQUEST_CONFLICT'; end if; return previous.id;
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  if p_action is null or p_action not in ('RETURN_TO_STOCK','SUPPLIER_RETURN','WRITE_OFF') then raise exception 'INVALID_ACTION'; end if;
  if p_action='RETURN_TO_STOCK' then
    if p_expiry<(now() at time zone 'Africa/Johannesburg')::date then raise exception 'RETURN_REQUIRES_QUARANTINE'; end if;
    if p_expiry is null and exists(select 1 from public.products where id=line.product_id and track_expiry) then raise exception 'EXPIRY_REQUIRED'; end if;
    perform app.apply_stock_delta(r.business_id,r.store_id,line.product_id,line.quantity,'RETURN_IN',r.reference||': '||p_reason,'goods_returns',r.id);
    perform app.put_stock_batches(line.product_id,r.store_id,jsonb_build_array(jsonb_build_object('quantity',line.quantity,'expiry_date',p_expiry,'batch_ref',r.reference)));
  end if;
  insert into public.return_dispositions(return_item_id,action,reason,expiry_date,performed_by) values(line.id,p_action,p_reason,p_expiry,auth.uid()) returning id into result;
  perform app.audit('return.disposition','return_dispositions',result,r.business_id,r.store_id,null,jsonb_build_object('action',p_action,'reason',p_reason));
  return result;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.set_bulk_conversion(p_pack uuid, p_unit uuid, p_ratio integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare pack public.products%rowtype; unit public.products%rowtype; cid uuid; prior jsonb;
begin
  select * into pack from public.products where id=p_pack and is_active;
  if not found or not app.has_module(pack.store_id,'products_manage') then raise exception 'FORBIDDEN'; end if;
  select * into unit from public.products where id=p_unit and store_id=pack.store_id and business_id=pack.business_id and is_active;
  if not found or p_pack=p_unit then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
  if p_ratio is null or p_ratio not between 1 and 100000 then raise exception 'INVALID_CONVERSION'; end if;
  if pack.track_expiry<>unit.track_expiry then raise exception 'PRODUCT_UNITS_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_pack::text,1));
  select to_jsonb(c) into prior from public.bulk_conversions c where pack_product_id=p_pack for update;
  insert into public.bulk_conversions(business_id,store_id,pack_product_id,unit_product_id,pack_name,unit_name,units_per_pack,updated_by)
    values(pack.business_id,pack.store_id,p_pack,p_unit,pack.name,unit.name,p_ratio,auth.uid())
    on conflict(pack_product_id) do update set unit_product_id=excluded.unit_product_id,pack_name=excluded.pack_name,unit_name=excluded.unit_name,
      units_per_pack=excluded.units_per_pack,updated_by=auth.uid(),updated_at=now() returning id into cid;
  perform app.audit('bulk.configure','bulk_conversions',cid,pack.business_id,pack.store_id,prior,jsonb_build_object('pack',p_pack,'unit',p_unit,'ratio',p_ratio));
  return cid;
end $function$
;
CREATE OR REPLACE FUNCTION public.open_cash_up(p_store uuid, p_day date, p_float numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype;
begin
 perform app.require_module(p_store,array['cash_up']);
 if not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
 if p_day is null or p_day>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'INVALID_DATE'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 perform app.cash_day_lock(p_store,p_day);
 select * into c from public.cash_ups where store_id=p_store and business_date=p_day order by shift_number desc limit 1;
 if found then if c.created_by<>auth.uid() and not app.has_module(p_store,'cash_up_manage') then raise exception 'SHIFT_BELONGS_TO_OTHER_USER';end if; if c.opening_float<>p_float then raise exception 'CASH_UP_ALREADY_OPEN'; end if; return c.id; end if;
 insert into public.cash_ups(business_id,store_id,business_date,opening_float,created_by) values(app.store_business(p_store),p_store,p_day,p_float,auth.uid()) returning * into c;
 perform app.audit('cash_up.open','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('date',p_day,'opening_float',p_float));
 return c.id;
end $function$
;
CREATE OR REPLACE FUNCTION public.correct_cash_up_float(p_cash_up uuid, p_float numeric, p_version bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if not app.has_module(c.store_id,'cash_up_manage') then raise exception 'FORBIDDEN'; end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if c.status<>'OPEN' or p_version is distinct from c.version then raise exception 'CASH_UP_CHANGED'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 update public.cash_ups set opening_float=p_float,version=version+1 where id=c.id;
 perform app.audit('cash_up.float','cash_up',c.id,c.business_id,c.store_id,jsonb_build_object('opening_float',c.opening_float),jsonb_build_object('opening_float',p_float,'reason',p_reason));
end $function$
;
CREATE OR REPLACE FUNCTION public.record_cash_movement(p_store uuid, p_day date, p_kind text, p_amount numeric, p_reason text, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare previous public.cash_drawer_movements%rowtype; payload jsonb; mid uuid;
begin
 perform app.require_module(p_store,array['cash_up']);
 if not app.has_module(p_store,'cash_up_manage') then raise exception 'FORBIDDEN'; end if;
 if p_day is null or p_day>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'INVALID_DATE'; end if;
 if not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 if p_kind is null or p_kind not in ('ADD','REMOVE') then raise exception 'INVALID_ACTION'; end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'REASON_REQUIRED'; end if;
 perform app.cash_day_lock(p_store,p_day);
 payload:=jsonb_build_object('user',auth.uid(),'day',p_day,'kind',p_kind,'amount',p_amount,'reason',p_reason);
 select * into previous from public.cash_drawer_movements where store_id=p_store and request_id=p_request;
 if found then if previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return previous.id; end if;
 insert into public.cash_drawer_movements(store_id,business_date,kind,amount,reason,created_by,request_id,request_payload) values(p_store,p_day,p_kind,p_amount,p_reason,auth.uid(),p_request,payload) returning id into mid;
 perform app.audit('cash_up.movement','cash_drawer_movement',mid,app.store_business(p_store),p_store,null,payload);
 return mid;
end $function$
;
CREATE OR REPLACE FUNCTION public.classify_credit_payment(p_transaction uuid, p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare t public.credit_transactions%rowtype; previous text;
begin
 select * into t from public.credit_transactions where id=p_transaction and txn_type='PAYMENT' and reference_table is null;
 perform app.require_module(t.store_id,array['cash_up']);
 if not app.has_module(t.store_id,'cash_up_manage') then raise exception 'FORBIDDEN'; end if;
 if p_method is null or p_method not in ('CASH','CARD_EFT') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
 perform app.cash_day_lock(t.store_id,(t.created_at at time zone 'Africa/Johannesburg')::date);
 select method into previous from public.credit_payment_methods where transaction_id=t.id;
 if found then if previous<>p_method then raise exception 'PAYMENT_ALREADY_CLASSIFIED'; end if; return; end if;
 insert into public.credit_payment_methods(transaction_id,store_id,method,classified_by) values(t.id,t.store_id,p_method,auth.uid());
 perform app.audit('credit.classify_payment','credit_transaction',t.id,t.business_id,t.store_id,null,jsonb_build_object('method',p_method));
end $function$
;
CREATE OR REPLACE FUNCTION app.can_return_action(p_store uuid, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
 select app.has_module(p_store,'returns') and p_action in ('approve','refund') and
 (app.has_module(p_store,'returns_manage') or exists(select 1 from public.store_return_access a join public.memberships m on m.id=a.membership_id
 where a.store_id=p_store and m.user_id=auth.uid() and m.is_active and case when p_action='approve' then a.approve else a.refund end));
$function$
;
CREATE OR REPLACE FUNCTION public.assign_stock_expiry(p_product uuid, p_expiry date, p_quantity numeric, p_expected numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; total numeric; dated numeric; undated numeric; remaining numeric; b record; taken numeric;
begin
 select * into p from public.products where id=p_product;
 if not found or not app.has_module(p.store_id,'products_manage') then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p.store_id,array['products']);
 select quantity into total from public.stock where product_id=p.id and store_id=p.store_id for update;
 total:=coalesce(total,0);
 if p_expiry is null or p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<>round(p_quantity,3) then raise exception 'EXPIRY_AND_QUANTITY_REQUIRED'; end if;
 select coalesce(sum(quantity) filter(where expiry_date is not null),0),coalesce(sum(quantity),0) into dated,undated from public.stock_batches where product_id=p.id and store_id=p.store_id;
 if undated>total then raise exception 'BATCH_RECONCILIATION_REQUIRED'; end if;
 undated:=total-dated;
 if undated is distinct from p_expected or p_quantity>undated then raise exception 'STOCK_CHANGED_REFRESH'; end if;
 remaining:=p_quantity;
 for b in select * from public.stock_batches where product_id=p.id and store_id=p.store_id and expiry_date is null and quantity>0 order by created_at,id for update loop
  exit when remaining<=0; taken:=least(remaining,b.quantity);
  update public.stock_batches set quantity=quantity-taken where id=b.id; remaining:=remaining-taken;
 end loop;
 update public.products set track_expiry=true where id=p.id;
 insert into public.stock_batches(product_id,store_id,quantity,expiry_date,batch_ref) values(p.id,p.store_id,p_quantity,p_expiry,'Existing stock');
 perform app.audit('product.assign_expiry','products',p.id,p.business_id,p.store_id,null,jsonb_build_object('expiry',p_expiry,'quantity',p_quantity));
end $function$
;
CREATE OR REPLACE FUNCTION app.cash_shift_summary(p_store uuid, p_day date, p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype; source jsonb; history jsonb; handover public.cash_ups%rowtype;
begin
 perform app.require_module(p_store,array['cash_up']);
 if p_day is null then raise exception 'INVALID_DATE'; end if;
 if p_shift is null and not app.has_module(p_store,'cash_up_manage') and p_day=(now() at time zone 'Africa/Johannesburg')::date then
  select * into handover from public.cash_ups where store_id=p_store and business_date=p_day order by shift_number desc limit 1;
  if handover.status='APPROVED' and handover.created_by<>auth.uid() then
   return jsonb_build_object('handover',jsonb_build_object('id',handover.id,'counted',(select counted from public.cash_up_submissions where id=handover.latest_submission)));
  end if;
 end if;

 select * into c from public.cash_ups where store_id=p_store and business_date=p_day and (p_shift is null or id=p_shift) and (created_by=auth.uid() or app.has_module(p_store,'cash_up_manage')) order by shift_number desc limit 1;
 if p_shift is not null and c.id is null then raise exception 'FORBIDDEN';end if;
 if c.id is null and not app.has_module(p_store,'cash_up_manage') and exists(select 1 from public.cash_ups where store_id=p_store and business_date=p_day) then raise exception 'SHIFT_BELONGS_TO_OTHER_USER';end if;
 source:=case when c.id is null then app.cash_sources(p_store,p_day) else app.cash_shift_sources(c.id) end;
 select coalesce(jsonb_agg(to_jsonb(s)-'request_payload'-'request_id'-'sources' || jsonb_build_object('created_by_name',coalesce(p.full_name,'Team member'),
  'reviews',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('created_by_name',coalesce(rp.full_name,'Manager')) order by r.created_at),'[]'::jsonb) from public.cash_up_reviews r left join public.profiles rp on rp.id=r.created_by where r.submission_id=s.id)) order by s.revision desc),'[]'::jsonb)
 into history from public.cash_up_submissions s left join public.profiles p on p.id=s.created_by where s.cash_up_id=c.id;
 return jsonb_build_object('day_activity',case when app.has_module(p_store,'cash_up_manage') then app.cash_sources(p_store,p_day)->'activity' else null end,'sealed',exists(select 1 from public.cash_ups where previous_shift=c.id),'started_by_name',(select full_name from public.profiles where id=c.created_by),'shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'shift_number',x.shift_number,'status',x.status,'created_by_name',coalesce(p.full_name,'Team member'),'created_at',x.created_at,'opening_float',x.opening_float) order by x.shift_number),'[]') from public.cash_ups x left join public.profiles p on p.id=x.created_by where x.store_id=p_store and x.business_date=p_day and (x.created_by=auth.uid() or app.has_module(p_store,'cash_up_manage'))),'session',case when c.id is null then null else to_jsonb(c)-'baseline' end,'sources',case when app.has_module(p_store,'cash_up_manage') then source else source-'cumulative' end,'history',history,
  'expected',coalesce(c.opening_float,0)+(source->>'net')::numeric,
  'count_token',md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text),
  'changed_since_count',c.latest_submission is not null and source->>'fingerprint' is distinct from (select sources->>'fingerprint' from public.cash_up_submissions where id=c.latest_submission),
  'movements',(select coalesce(jsonb_agg(to_jsonb(d)-'request_payload'-'request_id' order by created_at desc),'[]'::jsonb) from public.cash_drawer_movements d where store_id=p_store and business_date=p_day and app.has_module(p_store,'cash_up_manage')));
end $function$
;
CREATE OR REPLACE FUNCTION public.review_cash_up(p_cash_up uuid, p_submission uuid, p_action text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype; s public.cash_up_submissions%rowtype; source jsonb;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if not app.has_module(c.store_id,'cash_up_manage') then raise exception 'FORBIDDEN'; end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if exists(select 1 from public.cash_ups where previous_shift=c.id) then raise exception 'SHIFT_LOCKED';end if;
 if p_submission is null or p_submission is distinct from c.latest_submission then raise exception 'CASH_UP_CHANGED'; end if;
 select * into s from public.cash_up_submissions where id=p_submission;
 if p_action='APPROVE' then
  if c.status='APPROVED' then return; end if;
  if c.status<>'SUBMITTED' then raise exception 'CASH_UP_CHANGED'; end if;
  source:=app.cash_shift_sources(c.id);
  if source->>'fingerprint' is distinct from s.sources->>'fingerprint' then raise exception 'CASH_ACTIVITY_CHANGED'; end if;
  if s.variance<>0 and nullif(btrim(p_note),'') is null then raise exception 'VARIANCE_NOTE_REQUIRED'; end if;
 elsif p_action='REOPEN' then
  if c.status='OPEN' then return; end if;
  if nullif(btrim(p_note),'') is null then raise exception 'REASON_REQUIRED'; end if;
 else raise exception 'INVALID_ACTION'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'NOTE_TOO_LONG'; end if;
 insert into public.cash_up_reviews(submission_id,action,note,created_by) values(s.id,p_action,p_note,auth.uid());
 update public.cash_ups set status=case when p_action='APPROVE' then 'APPROVED' else 'OPEN' end,version=version+1 where id=c.id;
 perform app.audit('cash_up.'||lower(p_action),'cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('submission',s.id,'note',p_note));
end $function$
;
CREATE OR REPLACE FUNCTION public.save_receipt_preferences(p_store uuid, p_second boolean, p_delay integer, p_paper text DEFAULT '80mm'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform app.require_module(p_store,array['goods_out']);
 if not app.has_module(p_store,'goods_out_receipt_settings') then raise exception 'FORBIDDEN';end if;
 insert into public.receipt_preferences(store_id,second_copy,delay_seconds,paper_format) values(p_store,p_second,p_delay,p_paper) on conflict(store_id) do update set second_copy=excluded.second_copy,delay_seconds=excluded.delay_seconds,paper_format=excluded.paper_format;
 perform app.audit('receipt.settings','store',p_store,app.store_business(p_store),p_store,null,jsonb_build_object('second_copy',p_second,'delay',p_delay,'paper',p_paper));
end $function$
;
CREATE OR REPLACE FUNCTION public.correct_batch_expiry(p_batch uuid, p_expiry date, p_expected_expiry date, p_expected_quantity numeric, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.stock_batches%rowtype; p public.products%rowtype;
begin
 select * into b from public.stock_batches where id=p_batch;
 if not found then raise exception 'FORBIDDEN';end if;
 perform app.require_module(b.store_id,array['products']);
 if not app.has_module(b.store_id,'products_manage') then raise exception 'FORBIDDEN';end if;
 if p_expiry is null or nullif(btrim(p_reason),'') is null then raise exception 'EXPIRY_AND_REASON_REQUIRED';end if;
 select * into p from public.products where id=b.product_id;
 perform 1 from public.stock where store_id=b.store_id and product_id=b.product_id for update;
 select * into b from public.stock_batches where id=p_batch for update;
 if b.quantity<=0 or b.quantity is distinct from p_expected_quantity or b.expiry_date is distinct from p_expected_expiry then raise exception 'BATCH_CHANGED_REFRESH';end if;
 update public.stock_batches set expiry_date=p_expiry where id=b.id;
 perform app.audit('stock.expiry_corrected','stock_batches',b.id,p.business_id,b.store_id,to_jsonb(b),jsonb_build_object('expiry_date',p_expiry,'quantity',b.quantity,'reason',btrim(p_reason)));
end $function$
;
CREATE OR REPLACE FUNCTION app_private.guard_customer_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if length(new.name)>200 or nullif(btrim(new.name),'') is null or length(new.phone)>50 or length(new.email)>254
 or (nullif(new.email,'') is not null and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 or greatest(length(new.street),length(new.suburb),length(new.town),length(new.province),length(new.country))>200 or length(new.postal_code)>30 then raise exception 'INVALID_CUSTOMER_PROFILE';end if;
 if tg_op='INSERT' and auth.uid() is not null and not app.has_module(new.store_id,'credit_manage') then new.credit_enabled:=false;end if;
 if tg_op='UPDATE' and new.credit_enabled is distinct from old.credit_enabled and auth.uid() is not null and not app.has_module(old.store_id,'credit_manage') then raise exception 'FORBIDDEN';end if;
 if tg_op='UPDATE' then new.updated_at:=clock_timestamp();end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.create_bulk_product(p_store uuid, p_unit uuid, p_name text, p_ratio integer, p_sku text, p_barcode text, p_cost numeric, p_selling numeric, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare unit public.products%rowtype; pid uuid; prior app.bulk_product_requests%rowtype; payload jsonb;
begin
 if auth.uid() is null or not app.has_module(p_store,'products_manage') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(p_store,array['goods_in_new_stock']);
 perform app.require_module(p_store,array['products']);
 perform app.require_module(p_store,array['operations']);
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 if p_ratio is null or p_ratio not between 1 and 100000 then raise exception 'INVALID_CONVERSION';end if;
 if nullif(btrim(p_name),'') is null or length(p_name)>300 or length(p_sku)>128 or length(p_barcode)>128 then raise exception 'INVALID_PRODUCT_DETAILS';end if;
 if nullif(btrim(p_sku),'') is null and nullif(btrim(p_barcode),'') is null then raise exception 'SKU_OR_BARCODE_REQUIRED';end if;
 if p_cost is null or p_selling is null or p_cost<0 or p_selling<0 or p_cost>=1e10 or p_selling>=1e10 or p_cost<>round(p_cost,2) or p_selling<>round(p_selling,2) then raise exception 'INVALID_PRICE';end if;
 payload:=jsonb_build_object('unit',p_unit,'name',btrim(p_name),'ratio',p_ratio,'sku',nullif(btrim(p_sku),''),'barcode',nullif(btrim(p_barcode),''),'cost',p_cost,'selling',p_selling);
 perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_request::text,2009));
 select * into prior from app.bulk_product_requests where store_id=p_store and request_id=p_request;
 if found then
  if prior.payload<>payload then raise exception 'REQUEST_CONFLICT';end if;
  return prior.product_id;
 end if;
 select * into unit from public.products where id=p_unit and store_id=p_store and is_active for share;
 if not found or exists(select 1 from public.bulk_conversions where pack_product_id=p_unit) then raise exception 'INDIVIDUAL_PRODUCT_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_store::text,2010));
 if exists(select 1 from public.products where store_id=p_store and sku=nullif(btrim(p_sku),'')) then raise exception 'BULK_PRODUCT_EXISTS';end if;
 pid:=public.create_product(p_store:=p_store,p_name:=btrim(p_name),p_barcode:=nullif(btrim(p_barcode),''),p_cost:=p_cost,p_selling:=p_selling,p_unit:='pack',p_track_expiry:=unit.track_expiry);
 update public.products set sku=nullif(btrim(p_sku),'') where id=pid;
 perform public.set_bulk_conversion(pid,p_unit,p_ratio);
 insert into app.bulk_product_requests values(p_store,p_request,pid,payload);
 perform app.audit('bulk.product_create','products',pid,unit.business_id,p_store,null,payload);
 return pid;
end $function$
;
CREATE OR REPLACE FUNCTION app.configure_product_stock(p_product uuid, p_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; pack uuid; ratio integer; enabled boolean; tracking text; bulk_label text;
begin
 select * into p from public.products where id=p_product for update;
 if not found then raise exception 'FORBIDDEN';end if;
 if not app.has_module(p.store_id,'products_manage') then
  if app.has_module(p.store_id,'products_edit') and coalesce(p_values->>'tracking_type',p.tracking_type)=p.tracking_type
    and coalesce((p_values->>'bulk_enabled')::boolean,p.bulk_enabled)=p.bulk_enabled
    and (not p.bulk_enabled or exists(select 1 from public.bulk_conversions bc join public.products pack on pack.id=bc.pack_product_id where bc.unit_product_id=p.id and coalesce((p_values->>'units_per_pack')::integer,bc.units_per_pack)=bc.units_per_pack and coalesce(p_values->>'bulk_unit',pack.unit)=pack.unit)) then return;end if;
  raise exception 'FORBIDDEN';
 end if;
 perform app.require_module(p.store_id,array['products']);
 if p.bulk_parent_id is not null then raise exception 'EDIT_MAIN_PRODUCT';end if;
 tracking:=coalesce(p_values->>'tracking_type',p.tracking_type);
 enabled:=coalesce((p_values->>'bulk_enabled')::boolean,p.bulk_enabled);
 if tracking='SALES_ONLY' and enabled then raise exception 'SALES_ONLY_NO_BULK';end if;
 update public.products set tracking_type=tracking,bulk_enabled=enabled,
  track_expiry=case when tracking='SALES_ONLY' then false else track_expiry end,
  min_stock_level=case when tracking='SALES_ONLY' then 0 else min_stock_level end,
  reorder_level=case when tracking='SALES_ONLY' then 0 else reorder_level end where id=p.id;
 select pack_product_id into pack from public.bulk_conversions where unit_product_id=p.id order by updated_at,id limit 1 for update;
 if enabled then
  ratio:=coalesce((p_values->>'units_per_pack')::integer,(select units_per_pack from public.bulk_conversions where pack_product_id=pack),6);
  bulk_label:=coalesce(nullif(btrim(p_values->>'bulk_unit'),''),(select unit from public.products where id=pack),'case');
  if ratio not between 1 and 100000 or length(bulk_label)>40 then raise exception 'INVALID_CONVERSION';end if;
  if pack is null then
   pack:=app_private.create_product(p_store:=p.store_id,p_name:=p.name||' – Bulk Stock',p_cost:=p.cost_price*ratio,p_selling:=p.selling_price*ratio,p_unit:=bulk_label,p_track_expiry:=p.track_expiry);
   update public.products set bulk_parent_id=p.id where id=pack;
  else
   update public.products set is_active=p.is_active,unit=bulk_label where id=pack;
  end if;
  perform app_private.set_bulk_conversion(pack,p.id,ratio);
 else
  if exists(select 1 from public.products b join public.stock st on st.product_id=b.id where b.bulk_parent_id=p.id and st.quantity<>0)
   or exists(select 1 from public.stock_transfer_items i join public.stock_transfers t on t.id=i.transfer_id join public.products b on b.id in(i.source_product_id,i.destination_product_id) where b.bulk_parent_id=p.id and t.status in('DRAFT','SUBMITTED','DISPATCHED')) then raise exception 'BULK_STOCK_OR_TRANSFER_REMAINS';end if;
  update public.products set is_active=false where bulk_parent_id=p.id;
 end if;
 perform app.audit('product.stock_configuration','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $function$
;
CREATE OR REPLACE FUNCTION public.submit_cash_up(p_cash_up uuid, p_counted numeric, p_denominations jsonb, p_fingerprint text, p_note text, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype; source jsonb; payload jsonb; prior public.cash_up_submissions%rowtype; sid uuid; total numeric;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if c.created_by<>auth.uid() and not app.has_module(c.store_id,'cash_up_manage') then raise exception 'FORBIDDEN';end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 payload:=jsonb_build_object('user',auth.uid(),'counted',p_counted,'denominations',p_denominations,'fingerprint',p_fingerprint,'note',p_note);
 select * into prior from public.cash_up_submissions where cash_up_id=c.id and request_id=p_request;
 if found then if prior.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return prior.id; end if;
 if c.status<>'OPEN' then raise exception 'CASH_UP_NOT_OPEN'; end if;
 if p_counted is null or p_counted::text in ('NaN','Infinity','-Infinity') or p_counted<0 or p_counted<>round(p_counted,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 if p_denominations is null or jsonb_typeof(p_denominations)<>'object' then raise exception 'INVALID_DENOMINATIONS'; end if;
 if exists(select 1 from jsonb_each(p_denominations) e where key not in ('200','100','50','20','10','5','2','1','0.5','0.2','0.1','0.05','0.02','0.01') or jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]{1,7}$') then raise exception 'INVALID_DENOMINATIONS'; end if;
 if p_denominations<>'{}'::jsonb then
  select coalesce(sum(key::numeric*value::numeric),0) into total from jsonb_each_text(p_denominations);
  if total<>p_counted then raise exception 'CASH_COUNT_MISMATCH'; end if;
  if (select currency from public.businesses where id=c.business_id)<>'ZAR' then raise exception 'DENOMINATIONS_REQUIRE_ZAR'; end if;
 end if;
 source:=app.cash_shift_sources(c.id);
 if jsonb_array_length(source->'unclassified')>0 then raise exception 'UNCLASSIFIED_PAYMENTS'; end if;
 if p_fingerprint is distinct from md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text) then raise exception 'CASH_ACTIVITY_CHANGED'; end if;
 if p_counted<>c.opening_float+(source->>'net')::numeric and nullif(btrim(p_note),'') is null then raise exception 'VARIANCE_NOTE_REQUIRED'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'NOTE_TOO_LONG'; end if;
 insert into public.cash_up_submissions(cash_up_id,revision,counted,expected,denominations,note,sources,created_by,request_id,request_payload)
 values(c.id,c.version,p_counted,c.opening_float+(source->>'net')::numeric,p_denominations,p_note,source||jsonb_build_object('opening_float',c.opening_float),auth.uid(),p_request,payload) returning id into sid;
 update public.cash_ups set status='SUBMITTED',latest_submission=sid,version=version+1 where id=c.id;
 perform app.audit('cash_up.submit','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('submission',sid,'counted',p_counted,'expected',c.opening_float+(source->>'net')::numeric));
 return sid;
end $function$
;
CREATE OR REPLACE FUNCTION app_private.sync_store_products(p_store uuid, p_warehouse uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare dest public.stores%rowtype; wh public.stores%rowtype; src record; bulk record; r jsonb; child jsonb;
 created integer:=0; updated integer:=0; matched integer:=0; skipped integer:=0; errors jsonb:='[]'; result jsonb;
begin
 select * into dest from public.stores where id=p_store and is_active and location_type='store';
 select * into wh from public.stores where id=p_warehouse and is_active and location_type='warehouse';
 if auth.uid() is null or dest.id is null or wh.id is null or dest.business_id<>wh.business_id or not app.has_module(dest.id,'products_manage') or not app.has_module(dest.id,'products') or not app.has_store_access(wh.id) or not app.has_module(wh.id,'warehouse') then raise exception 'FORBIDDEN';end if;
 if p_preview is null then raise exception 'INVALID_PREVIEW';end if;
 if (select count(*) from public.products where store_id=wh.id and is_active)>10000 then raise exception 'CATALOG_TOO_LARGE';end if;
 -- Share the warehouse lock with reverse sync; serialize destination syncs.
 perform pg_advisory_xact_lock(hashtextextended(wh.id::text,1409));
 perform pg_advisory_xact_lock(hashtextextended(dest.id::text,2609));
 begin
  for src in select id,name from public.products where store_id=wh.id and is_active and bulk_parent_id is null order by id loop
   begin
    r:=app_private.copy_store_catalog_row(dest.id,src.id);
    -- A product and all of its bulk definitions form one atomic group.
    for bulk in select id from public.products where bulk_parent_id=src.id and is_active order by id loop
     child:=app_private.copy_store_catalog_row(dest.id,bulk.id,(r->>'id')::uuid);
     if (child->>'created')::boolean or (child->>'updated')::boolean then r:=r||jsonb_build_object('updated',true);end if;
    end loop;
    if (r->>'created')::boolean then created:=created+1;
    elsif (r->>'updated')::boolean then updated:=updated+1;
    else matched:=matched+1;end if;
   exception when others then
    skipped:=skipped+1;
    if jsonb_array_length(errors)<100 then errors:=errors||jsonb_build_array(jsonb_build_object('name',src.name,'error',case when sqlstate='P0001' then sqlerrm when sqlstate='23505' then 'CONFLICTING_PRODUCT_IDENTIFIERS' else 'INVALID_PRODUCT_ROW' end));end if;
   end;
  end loop;
  result:=jsonb_build_object('created',created,'updated',updated,'matched',matched,'skipped',skipped,'errors',errors,'preview',p_preview,'quantity_changed',false);
  -- Roll back previews, including links, audits and catalog revisions. Confirmation
  -- repeats all validation against current data rather than trusting the preview.
  if p_preview then raise exception using errcode='PT026',message='CATALOG_PREVIEW_ROLLBACK';end if;
 exception when sqlstate 'PT026' then null;
 end;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION app.can_manage_recurring(p_store uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and app.has_module(p_store,'invoices_manage') and app.has_module(p_store,'invoices')
 and app.has_module(p_store,'invoices_create_from_order') and app.has_module(p_store,'invoices_view_invoices')
 and app.has_module(p_store,'orders_recent')
$function$
;
CREATE OR REPLACE FUNCTION app_private.issue_invoice_goods(p_invoice uuid, p_override boolean DEFAULT false, p_override_token uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare i public.sales_invoices%rowtype; b public.v_invoice_balances%rowtype; a public.credit_accounts%rowtype; line record; approver uuid; allocations jsonb; movement app.movement_type;
begin perform app.cash_day_lock((select store_id from public.sales_invoices where id=p_invoice),(now() at time zone 'Africa/Johannesburg')::date);
  select * into i from public.sales_invoices where id=p_invoice for update;
  if not found or not app.has_store_access(i.store_id) then raise exception 'FORBIDDEN'; end if;
  if i.goods_issued_at is not null then return i.id; end if;
  if i.state<>'ISSUED' then raise exception 'INVALID_INVOICE_STATE'; end if;
  if exists(select 1 from public.stores where id=i.store_id and location_type='warehouse') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
  select * into b from public.v_invoice_balances where id=i.id;
  if b.credits>0 then raise exception 'CREDITED_INVOICE_CANNOT_ISSUE_GOODS'; end if;
  select * into a from public.credit_accounts where customer_id=i.customer_id for update;
  if b.outstanding>0 then if exists(select 1 from public.customers where id=i.customer_id and not credit_enabled) then raise exception 'CUSTOMER_CREDIT_DISABLED';end if;
    if i.terms<>'CREDIT' then raise exception 'INVOICE_PAYMENT_REQUIRED'; end if;
    if a.balance>a.credit_limit then
      if app.has_module(i.store_id,'credit_override') and coalesce(p_override,false) then approver:=auth.uid();
      else approver:=app.consume_credit_override(p_override_token,i.store_id,i.customer_id,b.outstanding); end if;
    end if;
  end if;
  movement:=case when i.terms='CREDIT' then 'SALE_CREDIT' when i.terms='CARD_EFT' then 'SALE_CARD' else 'SALE_CASH' end;
  for line in select * from public.sales_invoice_items where invoice_id=i.id order by product_id loop
    if not exists(select 1 from public.products where id=line.product_id and store_id=i.store_id and is_active) then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    perform app.apply_stock_delta(i.business_id,i.store_id,line.product_id,-line.quantity,movement,i.reference,'sales_invoices',i.id,line.cost_price);
    allocations:=app.take_sellable_batches(line.product_id,i.store_id,line.quantity);
    update public.sales_invoice_items set batches=allocations where id=line.id;
  end loop;
  update public.sales_invoices set goods_issued_at=now(),goods_issued_by=auth.uid(),authorized_by=approver where id=i.id;
  perform app.audit('invoice.goods_issue','sales_invoices',i.id,i.business_id,i.store_id,null,jsonb_build_object('authorized_by',approver,'outstanding',b.outstanding));
  return i.id;
end $function$
;
CREATE OR REPLACE FUNCTION public.process_delivery(p_id uuid, p_expected bigint, p_action text, p_details jsonb, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.order_deliveries%rowtype;prior public.delivery_events%rowtype;i public.v_invoice_balances%rowtype;oid uuid;old jsonb;payload jsonb;reason text;notes text;new_date date;item jsonb;
begin
 if p_request is null or p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'INVALID_DELIVERY_REQUEST';end if;
 select inv.order_id into oid from public.order_deliveries v join public.sales_invoices inv on inv.id=v.invoice_id where v.id=p_id;
 if oid is null then raise exception 'FORBIDDEN';end if;
 perform 1 from public.sales_orders where id=oid for update;
 perform 1 from public.sales_invoices where order_id=oid for update;
 select * into d from public.order_deliveries where id=p_id for update;
 if not app.has_module(d.store_id,'orders_deliveries') or (p_action='cancel_order' and not app.has_module(d.store_id,'orders_approve')) then raise exception 'FORBIDDEN';end if;
 payload:=jsonb_build_object('delivery',p_id,'actor',auth.uid(),'action',p_action,'details',p_details,'expected',p_expected);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,2909));
 select * into prior from public.delivery_events where request_id=p_request;
 if prior.id is not null then if prior.request_payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return p_id;end if;
 if d.version is distinct from p_expected then raise exception 'DELIVERY_CHANGED';end if;
 if d.status in ('DELIVERED','CANCELLED') then raise exception 'DELIVERY_CLOSED';end if;
 select * into i from public.v_invoice_balances where id=d.invoice_id;
 old:=to_jsonb(d);notes:=nullif(btrim(p_details->>'notes'),'');
 if length(notes)>2000 or length(p_details->>'driver_name')>150 or length(p_details->>'vehicle_registration')>50 or length(p_details->>'delivery_reference')>150 or length(p_details->>'received_by')>150 or length(p_details->>'receiver_phone')>80 then raise exception 'DELIVERY_DETAILS_TOO_LONG';end if;
 if p_action='update' then
  if d.status not in ('CREATED','PENDING','RESCHEDULED','FAILED') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if nullif(btrim(p_details->>'address'),'') is null or nullif(btrim(p_details->>'phone'),'') is null or length(p_details->>'address')>1000 or length(p_details->>'phone')>80 then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if jsonb_typeof(p_details->'remarks') is distinct from 'object' then raise exception 'INVALID_DELIVERY_REMARKS';end if;
  for item in select value from jsonb_array_elements(d.snapshot->'items') loop
   if length(p_details->'remarks'->>(item->>'id'))>500 then raise exception 'DELIVERY_DETAILS_TOO_LONG';end if;
  end loop;
  update public.order_deliveries set driver_name=btrim(p_details->>'driver_name'),vehicle_registration=btrim(p_details->>'vehicle_registration'),delivery_reference=btrim(p_details->>'delivery_reference'),comments=notes,
  snapshot=snapshot||jsonb_build_object('delivery_address',btrim(p_details->>'address'),'contact_number',btrim(p_details->>'phone'),
  'items',(select jsonb_agg(l||jsonb_build_object('remarks',coalesce(p_details->'remarks'->>(l->>'id'),''))) from jsonb_array_elements(d.snapshot->'items') l)) where id=d.id;
 elsif p_action='dispatch' then
  if d.status not in ('CREATED','PENDING','RESCHEDULED','FAILED') then raise exception 'INVALID_DELIVERY_STATE';end if;
  if i.status<>'PAID' or i.credits>0 then raise exception 'DELIVERY_PAYMENT_REQUIRED';end if;
  if d.scheduled_date is null then raise exception 'DELIVERY_SCHEDULE_REQUIRED';end if;
  if nullif(btrim(d.snapshot->>'delivery_address'),'') is null or nullif(btrim(d.snapshot->>'contact_number'),'') is null then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if i.goods_issued_at is null then raise exception 'DELIVERY_RELEASE_GOODS_FIRST';end if;
  
  update public.order_deliveries set status='OUT_FOR_DELIVERY' where id=d.id;
 elsif p_action='complete' then
  if d.status<>'OUT_FOR_DELIVERY' then raise exception 'INVALID_DELIVERY_STATE';end if;
  if i.status<>'PAID' or i.credits>0 then raise exception 'DELIVERY_PAYMENT_REQUIRED';end if;
  if d.scheduled_date is null then raise exception 'DELIVERY_SCHEDULE_REQUIRED';end if;
  if nullif(btrim(d.snapshot->>'delivery_address'),'') is null or nullif(btrim(d.snapshot->>'contact_number'),'') is null then raise exception 'DELIVERY_ADDRESS_CONTACT_DATE_REQUIRED';end if;
  if nullif(btrim(p_details->>'received_by'),'') is null then raise exception 'DELIVERY_RECIPIENT_REQUIRED';end if;
  update public.order_deliveries set status='DELIVERED',delivered_at=clock_timestamp(),confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),received_by=btrim(p_details->>'received_by'),receiver_phone=btrim(p_details->>'receiver_phone'),comments=notes where id=d.id;
 elsif p_action='fail' then
  if d.status<>'OUT_FOR_DELIVERY' or notes is null then raise exception 'DELIVERY_FAILURE_REASON_REQUIRED';end if;
  update public.order_deliveries set status='FAILED',comments=notes where id=d.id;
 elsif p_action in ('schedule','reschedule') then
  if p_action='schedule' and d.status<>'CREATED' then raise exception 'INVALID_DELIVERY_STATE';end if;
  new_date:=nullif(p_details->>'date','')::date;
  if new_date is null or new_date<(now() at time zone (select timezone from public.stores where id=d.store_id))::date then raise exception 'DELIVERY_DATE_IN_PAST';end if;
  if d.status='OUT_FOR_DELIVERY' then perform app_private.delivery_event(d.id,'failed',jsonb_build_object('status',d.status),jsonb_build_object('status','FAILED'),'Attempt rescheduled. '||coalesce(notes,''));end if;
  update public.order_deliveries set status='RESCHEDULED',original_date=coalesce(original_date,new_date),scheduled_date=new_date,comments=notes where id=d.id;
 elsif p_action in ('cancel','cancel_order') then
  reason:=p_details->>'reason';
  if reason is null or reason not in ('Customer Rejected Order','Customer No Longer Wants Order','Customer Unavailable','Incorrect Delivery Address','Order Damaged','Items Unavailable/Out of Stock','Duplicate Order','Customer Cancelled Order','Payment Issue','Delivery Area Not Supported','Delivery Attempt Failed','Order Expired','Other') or (reason='Other' and notes is null) then raise exception 'DELIVERY_CANCELLATION_REASON_REQUIRED';end if;
  update public.order_deliveries set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_reason=reason,comments=notes where id=d.id;
  if p_action='cancel_order' then
   update public.sales_orders set status='CANCELLED',cancellation_reason=reason||coalesce(': '||notes,'') where id=oid;
   perform app.audit('order.cancel','sales_orders',oid,d.business_id,d.store_id,null,jsonb_build_object('delivery',d.id,'reason',reason,'notes',notes,'financial_reversal',false));
  end if;
 else raise exception 'INVALID_DELIVERY_ACTION';end if;
 update public.order_deliveries set version=version+1,updated_at=clock_timestamp() where id=d.id;
 perform app_private.delivery_event(d.id,p_action,old,(select to_jsonb(v) from public.order_deliveries v where v.id=d.id),notes,p_request,payload);
 return d.id;
end $function$
;
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
 if i.id is null or not app.has_module(i.store_id,'invoices_manage') then raise exception 'FORBIDDEN';end if;
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
end $function$;
CREATE OR REPLACE FUNCTION public.save_purchase_order(p_quote uuid, p_order uuid, p_received boolean, p_approved boolean, p_reference text, p_filename text, p_mime text, p_content text, p_expected bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare loc uuid; old public.sales_purchase_orders%rowtype; bytes bytea;
begin
 if (p_quote is null)=(p_order is null) then raise exception 'DOCUMENT_REQUIRED'; end if;
 if p_quote is not null then select store_id into loc from public.sales_quotes where id=p_quote for update; else select store_id into loc from public.sales_orders where id=p_order for update; end if;
 perform app.require_module(loc,case when p_quote is not null then array['invoices_view_quotes'] else array['orders_recent'] end);
 if p_order is not null then perform 1 from public.sales_quotes where order_id=p_order for update;end if;
 if exists(select 1 from public.sales_quotes where (id=p_quote or order_id=p_order) and status in ('ACCEPTED','CONVERTED','CANCELLED')) then raise exception 'PURCHASE_ORDER_LOCKED';end if;
 select * into old from public.sales_purchase_orders where (p_quote is not null and quote_id=p_quote) or (p_order is not null and order_id=p_order) for update;
 if coalesce(old.version,0) is distinct from p_expected then raise exception 'PO_CHANGED_REFRESH'; end if;
 if p_received is null or p_approved is null then raise exception 'INVALID_PO_STATE'; end if;
 if (p_approved is distinct from coalesce(old.approved,false) or (old.approved and (p_content is not null or p_reference is distinct from old.reference))) and not app.has_module(loc,'orders_approve') then raise exception 'FORBIDDEN'; end if;
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
   approved_by=case when p_approved then case when old.approved and bytes is null and p_reference is not distinct from old.reference then old.approved_by else auth.uid() end end,
   approved_at=case when p_approved then case when old.approved and bytes is null and p_reference is not distinct from old.reference then old.approved_at else now() end end where id=old.id;
 end if;
 perform app.audit('document.purchase_order','sales_orders',coalesce(p_order,p_quote),app.store_business(loc),loc,
  case when old.id is not null then jsonb_build_object('received',old.received,'approved',old.approved,'reference',old.reference,'filename',old.filename,'approved_by',old.approved_by,'approved_at',old.approved_at) end,
  (select jsonb_build_object('received',po.received,'approved',po.approved,'reference',po.reference,'filename',po.filename,'approved_by',po.approved_by,'approved_at',po.approved_at) from public.sales_purchase_orders po where (p_quote is not null and po.quote_id=p_quote) or (p_order is not null and po.order_id=p_order)));
end $function$
;
CREATE OR REPLACE FUNCTION app_private.set_credit_override_code(p_business uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
begin
  if not app.has_business_module(p_business,array['credit_override']) then raise exception 'FORBIDDEN'; end if;
  if p_code is null or p_code !~ '^[0-9]{6,12}$' then raise exception 'INVALID_OVERRIDE_CODE_FORMAT'; end if;
  insert into app.credit_override_codes(business_id,user_id,code_hash) values(p_business,auth.uid(),crypt(p_code,gen_salt('bf',10)))
    on conflict(business_id,user_id) do update set code_hash=excluded.code_hash,updated_at=now();
  update app.credit_override_tokens set expires_at=now() where business_id=p_business and authorized_by=auth.uid() and used_at is null;
  perform app.audit('credit.override_code_set','membership',null,p_business,null,null,jsonb_build_object('user',auth.uid()));
end $function$
;
CREATE OR REPLACE FUNCTION app.member_manages_location(p_user uuid, p_store uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
 select app.member_has_module(p_user,p_store,'credit_override');
$function$;
CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(p_limit integer DEFAULT 20)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare p public.notification_preferences%rowtype; old public.notification_deliveries%rowtype; period_key text; local_now timestamp:=now() at time zone 'Africa/Johannesburg';
  body jsonb; recipient text; jid uuid; count_claimed integer:=0; location_name text; business_name text; currency text;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT'; end if;
  for p in select * from public.notification_preferences where enabled order by last_sent_at nulls first,id for update skip locked loop
    exit when count_claimed>=p_limit;
    if not app.member_has_module(p.user_id,p.store_id,'settings_manage') then continue; end if;
    if p.kind<>'STOCK_TAKE_COMPLETED' and extract(hour from local_now)<p.delivery_hour then continue; end if;
    period_key:=case when p.kind='WEEKLY_PROFIT' then date_trunc('week',local_now)::date::text when p.kind='STOCK_TAKE_COMPLETED' then to_char(local_now,'YYYY-MM-DD-HH24') else local_now::date::text end;
    select * into old from public.notification_deliveries where preference_id=p.id and
      (period=period_key or (state in ('CLAIMED','FAILED') and created_at>now()-interval '23 hours'))
      order by case when state in ('CLAIMED','FAILED') then 0 else 1 end,created_at limit 1 for update;
    if found then
      if old.state in ('SENT','SKIPPED') or old.attempts>=5 or old.claimed_at>now()-interval '10 minutes' or old.created_at<now()-interval '23 hours' then continue; end if;
      update public.notification_deliveries set state='CLAIMED',claimed_at=now(),attempts=attempts+1 where id=old.id;
      count_claimed:=count_claimed+1; return next jsonb_build_object('id',old.id,'recipient',old.recipient,'payload',old.payload); continue;
    end if;
    select u.email into recipient from auth.users u where u.id=p.user_id;
    if recipient is null then continue; end if;
    select s.name,b.name,s.currency into location_name,business_name,currency from public.stores s join public.businesses b on b.id=s.business_id where s.id=p.store_id;
    body:=app.notification_data(p);
    insert into public.notification_deliveries(preference_id,period,state,recipient,payload)
      values(p.id,period_key,case when body is null then 'SKIPPED' else 'CLAIMED' end,recipient,coalesce(body,'{}')||jsonb_build_object('kind',p.kind,'store',location_name,'business',business_name,'currency',currency)) returning id into jid;
    if body is null then continue; end if;
    count_claimed:=count_claimed+1;
    return next jsonb_build_object('id',jid,'recipient',recipient,'payload',body||jsonb_build_object('kind',p.kind,'store',location_name,'business',business_name,'currency',currency));
  end loop;
end $function$
;
CREATE OR REPLACE FUNCTION public.accept_employee_invitation(p_invitation uuid, p_secret text, p_first_name text, p_surname text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item public.employee_invitations%rowtype; uid uuid:=auth.uid(); mid uuid; pair record; perms jsonb;
begin
 select * into item from public.employee_invitations where id=p_invitation for update;
 perform public.employee_invitation_details(p_invitation,p_secret);
 if item.state='ACCEPTED' and item.user_id=uid then return; end if;
 if item.state<>'PENDING' then raise exception 'INVITATION_INVALID'; end if;
 if not exists(select 1 from public.memberships where business_id=item.business_id and user_id=item.created_by and role='owner' and is_active) then raise exception 'INVITER_NO_LONGER_AUTHORIZED'; end if;
 if coalesce(length(btrim(p_first_name)),0) not between 1 and 100 or coalesce(length(btrim(p_surname)),0) not between 1 and 100 or p_phone is null or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15 or p_phone !~ '^\+?[0-9 ()-]{7,32}$' then raise exception 'PROFILE_DETAILS_REQUIRED'; end if;
 if not exists(select 1 from auth.users where id=uid and coalesce(encrypted_password,'')<>'') then raise exception 'PASSWORD_REQUIRED'; end if;
 perform app.validate_invitation_access(item.business_id,item.role,item.assignments);
 if exists(select 1 from public.memberships where business_id=item.business_id and user_id=uid) then raise exception 'USER_ALREADY_MEMBER'; end if;
 update public.profiles set first_name=btrim(p_first_name),surname=btrim(p_surname),full_name=btrim(p_first_name)||' '||btrim(p_surname),phone=btrim(p_phone) where id=uid;
 insert into app.managed_identities values(uid,item.email,true) on conflict(user_id) do update set setup_complete=true;
 insert into public.memberships(business_id,user_id,role,is_active) values(item.business_id,uid,item.role,true) returning id into mid;
 if item.role<>'owner' then
  for pair in select * from jsonb_each(item.assignments) loop
   insert into public.store_memberships(membership_id,store_id,business_id,assigned_by) values(mid,pair.key::uuid,item.business_id,item.created_by);
   select jsonb_object_agg(key,coalesce((pair.value->>key)::boolean,false)) into perms from public.module_catalog;
   insert into public.store_module_access(membership_id,store_id,permissions,updated_by) values(mid,pair.key::uuid,perms,item.created_by);
  end loop;
 end if;
 update public.employee_invitations set state='ACCEPTED',accepted_at=now(),user_id=uid where id=item.id;
 perform app.audit('invitation.accept','invitation',item.id,item.business_id,null,null,jsonb_build_object('membership',mid));
end $function$
;
alter policy sel_audit_logs on public.audit_logs using ((app.has_business_role(business_id, 'owner'::app.membership_role) OR ((store_id IS NOT NULL) AND app.has_module(store_id,'audit'))));
alter policy imports_read on public.import_batches using (app.has_module(store_id,'imports'));
alter policy bulk_override_read on public.bulk_count_overrides using (app.has_module(store_id,'operations_approve'));
alter policy adjustment_requests_read on public.stock_adjustment_requests using (app.has_module(store_id,'adjust'));
alter policy drawer_read on public.cash_drawer_movements using ((app.has_module(store_id, 'cash_up'::text) AND app.has_module(store_id,'cash_up_manage')));
alter policy notification_preferences_read on public.notification_preferences using (((user_id = ( SELECT auth.uid() AS uid)) AND app.has_module(store_id,'settings_manage')));
alter policy cash_up_read on public.cash_ups using ((app.has_module(store_id, 'cash_up'::text) AND ((created_by = ( SELECT auth.uid() AS uid)) OR app.has_module(store_id,'cash_up_manage'))));
alter policy module_insert on public.products with check(app.has_module(store_id,'products_edit'));
alter policy module_update on public.products using (app.has_module(store_id,'products_edit')) with check(app.has_module(store_id,'products_edit'));
create function app_private.owner_employee_roles() returns trigger language plpgsql set search_path='' as $$ begin if new.role='manager' then raise exception 'USE_OWNER_OR_EMPLOYEE';end if;return new;end $$;
revoke all on function app_private.owner_employee_roles() from public,anon,authenticated;
create trigger owner_employee_roles before insert or update of role on public.memberships for each row execute function app_private.owner_employee_roles();
create trigger owner_employee_roles before insert or update of role on public.employee_invitations for each row execute function app_private.owner_employee_roles();
create or replace function app.can_manage_disabled_warehouse(p_store uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.stores s join public.memberships m on m.business_id=s.business_id
 left join public.store_module_access a on a.membership_id=m.id and a.store_id=s.id
 where s.id=p_store and s.location_type='warehouse' and m.is_active and m.user_id=auth.uid()
 and (m.role='owner' or (m.role='employee' and exists(select 1 from public.store_memberships sm where sm.membership_id=m.id and sm.store_id=s.id)
 and coalesce((a.permissions->>'warehouse')::boolean,false) and coalesce((a.permissions->>'warehouse_disable')::boolean,false))));
$$;

CREATE OR REPLACE FUNCTION public.create_product(p_store uuid, p_name text, p_barcode text DEFAULT NULL::text, p_category uuid DEFAULT NULL::uuid, p_supplier uuid DEFAULT NULL::uuid, p_cost numeric DEFAULT 0, p_selling numeric DEFAULT 0, p_min numeric DEFAULT 0, p_reorder numeric DEFAULT 0, p_unit text DEFAULT 'each'::text, p_track_expiry boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$begin perform app.require_module(p_store,array['products_edit']); return app_private.create_product(p_store,p_name,p_barcode,p_category,p_supplier,p_cost,p_selling,p_min,p_reorder,p_unit,p_track_expiry); end;$function$
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
 perform app.require_module(p.store_id,array['products_edit']);
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
 perform app.configure_product_stock(p.id,p_values);
 perform app.audit('product.edit','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $function$
;

do $$declare s text;begin
 s:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 s:=regexp_replace(s,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''employee_explicit_permissions_v1'',true,');execute s;
end $$;
