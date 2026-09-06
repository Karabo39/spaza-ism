-- Imports execute in one transaction. Preview uses the same code and rolls back.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  store_id uuid not null, kind text not null check(kind in ('products','suppliers','customers')),
  request_id uuid not null, request_payload jsonb not null, result jsonb not null default '{}',
  performed_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  foreign key(store_id,business_id) references public.stores(id,business_id), unique(business_id,request_id)
);
alter table public.import_batches enable row level security;
revoke all on public.import_batches from public,anon,authenticated;
grant select on public.import_batches to authenticated;
create policy imports_read on public.import_batches for select to authenticated using(app.has_store_role(store_id,'manager'));
create index imports_store on public.import_batches(store_id,created_at desc);

create function app.apply_import_row(p_store uuid,p_kind text,r jsonb,p_batch uuid,p_preview boolean)
returns jsonb language plpgsql security definer set search_path=public,app as $$
declare biz uuid:=app.store_business(p_store); rid uuid; barcode_id uuid; existing boolean:=false;
  previous jsonb; revised jsonb; prod public.products%rowtype; before_qty numeric:=0; target_qty numeric; delta numeric;
  fld text; val numeric; exp date; input jsonb:=r; old_limit numeric;
begin
  if jsonb_typeof(r)<>'object' then raise exception 'INVALID_ROW'; end if;
  if exists(select 1 from jsonb_each_text(r) where length(value)>1000) then raise exception 'CELL_TOO_LONG'; end if;
  foreach fld in array array['cost_price','selling_price','min_stock_level','reorder_level','quantity','expected_quantity','credit_limit'] loop
    if r ? fld and r->>fld is not null then
      val:=(r->>fld)::numeric;
      if val::text in ('NaN','Infinity','-Infinity') or val<0 or val>=10000000000 or val<>round(val,case when fld in ('cost_price','selling_price','credit_limit') then 2 else 3 end) then raise exception 'INVALID_NUMBER: %',fld; end if;
    end if;
  end loop;
  if r ? 'name' and nullif(btrim(r->>'name'),'') is null then raise exception 'NAME_REQUIRED'; end if;
  if nullif(r->>'email','') is not null and r->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL'; end if;
  rid:=nullif(r->>'id','')::uuid;
  if p_kind='products' then
    if nullif(r->>'barcode','') is not null then
      select product_id into barcode_id from public.product_barcodes where store_id=p_store and barcode=btrim(r->>'barcode') and is_active;
      if rid is not null and barcode_id is not null and rid<>barcode_id then raise exception 'BARCODE_BELONGS_TO_ANOTHER_PRODUCT'; end if;
    end if;
    if rid is null then rid:=barcode_id; end if;
    if rid is not null then
      select * into prod from public.products where id=rid and store_id=p_store and business_id=biz for update;
      if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
      existing:=true; previous:=to_jsonb(prod);
      if r ? 'track_expiry' and (r->>'track_expiry')::boolean<>prod.track_expiry then raise exception 'EXPIRY_TRACKING_CHANGE_REQUIRES_MANUAL_REVIEW'; end if;
      if r ? 'unit' and r->>'unit'<>prod.unit then raise exception 'UNIT_CHANGE_REQUIRES_MANUAL_REVIEW'; end if;
    else
      if nullif(btrim(r->>'name'),'') is null then raise exception 'NAME_REQUIRED_FOR_NEW_PRODUCT'; end if;
      rid:=public.create_product(p_store,r->>'name',null,null,null,coalesce((r->>'cost_price')::numeric,0),coalesce((r->>'selling_price')::numeric,0),coalesce((r->>'min_stock_level')::numeric,0),coalesce((r->>'reorder_level')::numeric,0),coalesce(nullif(r->>'unit',''),'each'),coalesce((r->>'track_expiry')::boolean,false));
      select * into prod from public.products where id=rid;
    end if;
    if existing and not p_preview and (r->>'expected_updated_at')::timestamptz is distinct from prod.updated_at then raise exception 'RECORD_CHANGED_REVIEW_AGAIN'; end if;
    if existing then input:=input||jsonb_build_object('expected_updated_at',prod.updated_at); end if;
    update public.products set name=coalesce(r->>'name',name),sku=coalesce(r->>'sku',sku),
      cost_price=coalesce((r->>'cost_price')::numeric,cost_price),selling_price=coalesce((r->>'selling_price')::numeric,selling_price),
      min_stock_level=coalesce((r->>'min_stock_level')::numeric,min_stock_level),reorder_level=coalesce((r->>'reorder_level')::numeric,reorder_level),
      is_active=coalesce((r->>'is_active')::boolean,is_active) where id=rid returning * into prod;
    if nullif(btrim(r->>'barcode'),'') is not null and barcode_id is null then
      insert into public.product_barcodes(product_id,store_id,barcode) values(rid,p_store,btrim(r->>'barcode'));
    end if;
    insert into public.stock(product_id,store_id,quantity) values(rid,p_store,0) on conflict do nothing;
    select quantity into before_qty from public.stock where product_id=rid and store_id=p_store for update;
    target_qty:=coalesce((r->>'quantity')::numeric,before_qty); delta:=target_qty-before_qty;
    if existing and r ? 'quantity' then
      if not p_preview and (r->>'expected_quantity')::numeric is distinct from before_qty then raise exception 'STOCK_CHANGED_REVIEW_AGAIN'; end if;
      input:=input||jsonb_build_object('expected_quantity',before_qty);
    end if;
    if delta<>0 then
      if delta>0 and prod.track_expiry then
        exp:=nullif(r->>'expiry_date','')::date;
        if exp is null then raise exception 'EXPIRY_DATE_REQUIRED'; end if;
        perform app.put_stock_batches(rid,p_store,jsonb_build_array(jsonb_build_object('quantity',delta,'expiry_date',exp,'batch_ref','Import '||p_batch::text)));
      elsif delta<0 then perform app.take_stock_batches(rid,p_store,-delta); end if;
      insert into public.stock_adjustments(business_id,store_id,product_id,reason,quantity_before,quantity_after,delta,note,performed_by)
        values(biz,p_store,rid,'STOCK_COUNT_CORRECTION',before_qty,target_qty,delta,'Excel import '||p_batch::text,auth.uid());
      perform app.apply_stock_delta(biz,p_store,rid,delta,case when delta>0 then 'ADJUSTMENT_INCREASE'::app.movement_type else 'ADJUSTMENT_DECREASE'::app.movement_type end,'Excel import quantity', 'import_batches',p_batch,prod.cost_price);
    end if;
    revised:=to_jsonb(prod)||jsonb_build_object('quantity',target_qty);
  elsif p_kind='suppliers' then
    if rid is not null then
      select to_jsonb(s) into previous from public.suppliers s where id=rid and business_id=biz for update;
      if not found then raise exception 'SUPPLIER_NOT_FOUND'; end if; existing:=true;
    else
      if nullif(btrim(r->>'name'),'') is null then raise exception 'NAME_REQUIRED_FOR_NEW_SUPPLIER'; end if;
      insert into public.suppliers(business_id,name) values(biz,r->>'name') returning id into rid;
    end if;
    if existing and not p_preview and (r->>'expected_updated_at')::timestamptz is distinct from (previous->>'updated_at')::timestamptz then raise exception 'RECORD_CHANGED_REVIEW_AGAIN'; end if;
    if existing then input:=input||jsonb_build_object('expected_updated_at',previous->>'updated_at'); end if;
    update public.suppliers set name=coalesce(r->>'name',name),contact_name=coalesce(r->>'contact_name',contact_name),phone=coalesce(r->>'phone',phone),email=coalesce(r->>'email',email),address=coalesce(r->>'address',address),notes=coalesce(r->>'notes',notes),is_active=coalesce((r->>'is_active')::boolean,is_active) where id=rid;
    select to_jsonb(s) into revised from public.suppliers s where id=rid;
  elsif p_kind='customers' then
    if rid is not null then
      select to_jsonb(c) into previous from public.customers c where id=rid and store_id=p_store and business_id=biz for update;
      if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if; existing:=true;
    else
      if nullif(btrim(r->>'name'),'') is null then raise exception 'NAME_REQUIRED_FOR_NEW_CUSTOMER'; end if;
      insert into public.customers(business_id,store_id,name) values(biz,p_store,r->>'name') returning id into rid;
    end if;
    if existing and not p_preview and (r->>'expected_updated_at')::timestamptz is distinct from (previous->>'updated_at')::timestamptz then raise exception 'RECORD_CHANGED_REVIEW_AGAIN'; end if;
    if existing then input:=input||jsonb_build_object('expected_updated_at',previous->>'updated_at'); end if;
    update public.customers set name=coalesce(r->>'name',name),phone=coalesce(r->>'phone',phone),email=coalesce(r->>'email',email),notes=coalesce(r->>'notes',notes),is_active=coalesce((r->>'is_active')::boolean,is_active) where id=rid;
    if r ? 'credit_limit' then
      select credit_limit into old_limit from public.credit_accounts where customer_id=rid for update;
      if existing and not p_preview and (r->>'expected_credit_limit')::numeric is distinct from old_limit then raise exception 'CREDIT_LIMIT_CHANGED_REVIEW_AGAIN'; end if;
      if existing then input:=input||jsonb_build_object('expected_credit_limit',old_limit); previous:=previous||jsonb_build_object('credit_limit',old_limit); end if;
      update public.credit_accounts set credit_limit=(r->>'credit_limit')::numeric where customer_id=rid;
    end if;
    select to_jsonb(c)||jsonb_build_object('credit_limit',a.credit_limit) into revised from public.customers c join public.credit_accounts a on a.customer_id=c.id where c.id=rid;
  else raise exception 'INVALID_IMPORT_KIND'; end if;
  perform app.audit('import.'||case when existing then 'update' else 'create' end,p_kind,rid,biz,p_store,previous,revised);
  return jsonb_build_object('id',rid,'name',revised->>'name','action',case when existing then 'Update' else 'Create' end,'quantity_before',case when p_kind='products' then before_qty end,'quantity_after',case when p_kind='products' then target_qty end,'input',input);
end $$;

create function public.import_excel(p_store uuid,p_kind text,p_rows jsonb,p_request uuid,p_preview boolean default true)
returns jsonb language plpgsql security definer set search_path=public,app as $$
declare biz uuid; batch uuid; previous public.import_batches%rowtype; r jsonb; processed jsonb; results jsonb:='[]';
  i integer:=0; seen uuid[]:='{}'; payload jsonb; response jsonb;
begin
  if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN'; end if;
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
end $$;
revoke execute on function app.apply_import_row(uuid,text,jsonb,uuid,boolean) from public,anon,authenticated;
revoke execute on function public.import_excel(uuid,text,jsonb,uuid,boolean) from public,anon;
grant execute on function public.import_excel(uuid,text,jsonb,uuid,boolean) to authenticated;
