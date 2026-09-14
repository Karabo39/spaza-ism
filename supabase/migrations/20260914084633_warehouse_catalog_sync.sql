-- Catalogue sync deliberately has no stock-delta or batch mutation path.
create table public.warehouse_sync_settings (
 warehouse_id uuid primary key references public.stores(id),
 preferred_store_id uuid references public.stores(id),
 enabled boolean not null default true,
 configured_by uuid not null references auth.users(id),
 last_run_at timestamptz,
 last_result jsonb,
 updated_at timestamptz not null default now()
);
create index warehouse_sync_settings_source on public.warehouse_sync_settings(preferred_store_id);
create index warehouse_sync_settings_owner on public.warehouse_sync_settings(configured_by);
create index warehouse_catalog_sku on public.products(store_id,sku) where sku is not null;
alter table public.warehouse_sync_settings enable row level security;
revoke all on public.warehouse_sync_settings from public,anon,authenticated;
grant select on public.warehouse_sync_settings to authenticated;
create policy sync_settings_read on public.warehouse_sync_settings for select to authenticated using(app.has_store_role(warehouse_id,'owner') and app.has_module(warehouse_id,'warehouse'));
create table app.warehouse_product_links (
 warehouse_id uuid not null references public.stores(id),
 source_product_id uuid not null references public.products(id),
 product_id uuid not null references public.products(id),
 primary key(warehouse_id,source_product_id)
);
create index warehouse_product_links_target on app.warehouse_product_links(product_id);
create index warehouse_product_links_source on app.warehouse_product_links(source_product_id);
alter table app.warehouse_product_links enable row level security;
revoke all on app.warehouse_product_links from public,anon,authenticated;

create function app.merge_warehouse_catalog(p_warehouse uuid,p_rows jsonb,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare wh public.stores%rowtype; r jsonb; before_row public.products%rowtype; target uuid; source_id uuid; candidates uuid[]; seen uuid[]:='{}'; codes text[]; code text; new_sku text; new_name text; new_unit text; tracked boolean; same_currency boolean; total numeric; created int:=0; changed int:=0; skipped int:=0; rownum int:=0; errors jsonb:='[]'; source_store uuid; prior_codes text[]; row_created boolean; row_changed boolean; category uuid; supplier uuid;
begin
 select * into wh from public.stores where id=p_warehouse and is_active and location_type='warehouse';
 if not found or not exists(select 1 from public.memberships where business_id=wh.business_id and user_id=p_actor and role='owner' and is_active) or not app.member_has_module(p_actor,p_warehouse,'warehouse') then raise exception 'FORBIDDEN';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>10000 then raise exception 'INVALID_CATALOG_ROWS';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text,1409));
 for r in select value from jsonb_array_elements(p_rows) loop
  rownum:=rownum+1;
  begin
   row_created:=false;row_changed:=false;prior_codes:=null;
   source_id:=nullif(r->>'id','')::uuid;target:=null;source_store:=null;
   if source_id is not null then
    select p.store_id into source_store from public.products p join public.stores s on s.id=p.store_id where p.id=source_id and p.business_id=wh.business_id and s.location_type='store' and s.is_active;
    if source_store is null then raise exception 'SOURCE_PRODUCT_NOT_IN_BUSINESS';end if;
    select product_id into target from app.warehouse_product_links where warehouse_id=wh.id and source_product_id=source_id;
   end if;
   new_name:=nullif(btrim(r->>'name'),'');new_sku:=nullif(btrim(r->>'sku'),'');new_unit:=coalesce(nullif(btrim(r->>'unit'),''),'each');tracked:=coalesce((r->>'track_expiry')::boolean,false);
   if new_name is null or length(new_name)>300 or length(new_sku)>128 or length(new_unit)>40 or length(r->>'description')>1000 then raise exception 'INVALID_PRODUCT_DETAILS';end if;
   if r ? 'barcodes' then select coalesce(array_agg(distinct btrim(value)) filter(where nullif(btrim(value),'') is not null),'{}') into codes from jsonb_array_elements_text(r->'barcodes');
   else codes:=case when nullif(btrim(r->>'barcode'),'') is null then '{}'::text[] else array[btrim(r->>'barcode')] end;end if;
   if exists(select 1 from unnest(codes)c where length(c)>128) then raise exception 'INVALID_BARCODE';end if;
   if source_id is null and new_sku is null and cardinality(codes)=0 then raise exception 'SKU_OR_BARCODE_REQUIRED';end if;
   select array_agg(id) into candidates from (select p.id from public.products p where p.store_id=wh.id and new_sku is not null and p.sku=new_sku union select b.product_id from public.product_barcodes b where b.store_id=wh.id and b.is_active and b.barcode=any(codes)) matches;
   if cardinality(candidates)>1 or (target is not null and cardinality(candidates)>0 and not(target=any(candidates))) then raise exception 'CONFLICTING_PRODUCT_IDENTIFIERS';end if;
   target:=coalesce(target,candidates[1]);
   same_currency:=coalesce((select currency from public.stores where id=source_store),r->>'currency',wh.currency)=wh.currency;
   if not same_currency then raise exception 'CURRENCY_MISMATCH';end if;
   if target is not null then
    select quantity into total from public.stock where product_id=target and store_id=wh.id for update;
    select * into before_row from public.products where id=target and store_id=wh.id for update;
    -- A partial template preserves omitted metadata. Explicit values still replace it.
    r:=(to_jsonb(before_row)-'id')||r;
    new_sku:=nullif(btrim(r->>'sku'),'');new_unit:=coalesce(nullif(btrim(r->>'unit'),''),'each');tracked:=coalesce((r->>'track_expiry')::boolean,false);
   end if;
   category:=nullif(r->>'category_id','')::uuid;supplier:=nullif(r->>'default_supplier_id','')::uuid;
   if category is not null and not exists(select 1 from public.categories where id=category and business_id=wh.business_id) then raise exception 'INVALID_PRODUCT_DETAILS';end if;
   if supplier is not null and not exists(select 1 from public.suppliers where id=supplier and business_id=wh.business_id) then raise exception 'INVALID_PRODUCT_DETAILS';end if;
   if target=any(seen) then
    if exists(select 1 from public.products where id=target and (unit<>new_unit or track_expiry<>tracked)) then raise exception 'CONFLICTING_PRODUCT_STRUCTURE';end if;
    if source_id is not null then insert into app.warehouse_product_links values(wh.id,source_id,target) on conflict do nothing;end if;
    skipped:=skipped+1;continue;
   end if;
   if exists(select 1 from jsonb_each_text(r) v where v.key in ('cost_price','selling_price','min_stock_level','reorder_level') and (v.value::numeric<0 or v.value::numeric>=1e10 or v.value::numeric<>round(v.value::numeric,case when v.key in ('cost_price','selling_price') then 2 else 3 end))) then raise exception 'INVALID_PRICE';end if;
   if target is null then
    insert into public.products(business_id,store_id,name,sku,description,unit,cost_price,selling_price,min_stock_level,reorder_level,track_expiry,category_id,default_supplier_id,created_by)
    values(wh.business_id,wh.id,new_name,new_sku,nullif(btrim(r->>'description'),''),new_unit,coalesce((r->>'cost_price')::numeric,0),coalesce((r->>'selling_price')::numeric,0),coalesce((r->>'min_stock_level')::numeric,0),coalesce((r->>'reorder_level')::numeric,0),tracked,category,supplier,p_actor) returning id into target;
    insert into public.stock(product_id,store_id,quantity) values(target,wh.id,0) on conflict(product_id,store_id) do nothing;
    row_created:=true;
    perform app.audit('warehouse.catalog_add','products',target,wh.business_id,wh.id,null,jsonb_build_object('source',source_id,'authorised_by',p_actor,'quantity',0));
   else
    if not before_row.is_active then raise exception 'WAREHOUSE_PRODUCT_INACTIVE';end if;
    if (before_row.unit<>new_unit or before_row.track_expiry<>tracked) and (coalesce(total,0)<>0 or exists(select 1 from public.stock_transfer_items i join public.stock_transfers t on t.id=i.transfer_id where target in(i.source_product_id,i.destination_product_id) and t.status in ('DRAFT','SUBMITTED','DISPATCHED')) or exists(select 1 from public.bulk_conversions where target in(pack_product_id,unit_product_id))) then raise exception 'STOCK_STRUCTURE_REQUIRES_REVIEW';end if;
    if row(before_row.name,before_row.sku,before_row.description,before_row.unit,before_row.cost_price,before_row.selling_price,before_row.min_stock_level,before_row.reorder_level,before_row.track_expiry,before_row.category_id,before_row.default_supplier_id) is distinct from row(new_name,new_sku,nullif(btrim(r->>'description'),''),new_unit,coalesce((r->>'cost_price')::numeric,0),coalesce((r->>'selling_price')::numeric,0),coalesce((r->>'min_stock_level')::numeric,0),coalesce((r->>'reorder_level')::numeric,0),tracked,category,supplier) then
     update public.products set name=new_name,sku=new_sku,description=nullif(btrim(r->>'description'),''),unit=new_unit,cost_price=coalesce((r->>'cost_price')::numeric,0),selling_price=coalesce((r->>'selling_price')::numeric,0),min_stock_level=coalesce((r->>'min_stock_level')::numeric,0),reorder_level=coalesce((r->>'reorder_level')::numeric,0),track_expiry=tracked,category_id=category,default_supplier_id=supplier where id=target;
     row_changed:=true;
     perform app.audit('warehouse.catalog_update','products',target,wh.business_id,wh.id,to_jsonb(before_row),jsonb_build_object('source',source_id,'authorised_by',p_actor,'details',r-'quantity'-'expiry_date'));
    end if;
   end if;
   select coalesce(array_agg(barcode order by barcode),'{}') into prior_codes from public.product_barcodes where product_id=target and is_active;
   if not(r ? 'barcodes' or r ? 'barcode') then codes:=prior_codes;end if;
   update public.product_barcodes set is_active=false where product_id=target and is_active and not(barcode=any(codes));
   foreach code in array codes loop
    if not exists(select 1 from public.product_barcodes where store_id=wh.id and barcode=code and is_active) then insert into public.product_barcodes(product_id,store_id,barcode) values(target,wh.id,code);end if;
   end loop;
   if (select array_agg(c order by c) from unnest(codes)c) is distinct from (select array_agg(c order by c) from unnest(prior_codes)c) then
    row_changed:=not row_created;
    perform app.audit('warehouse.catalog_barcodes','products',target,wh.business_id,wh.id,jsonb_build_object('barcodes',prior_codes),jsonb_build_object('barcodes',codes,'source',source_id,'authorised_by',p_actor));
   end if;
   if source_id is not null then insert into app.warehouse_product_links values(wh.id,source_id,target) on conflict(warehouse_id,source_product_id) do update set product_id=excluded.product_id;end if;
   seen:=array_append(seen,target);
   if row_created then created:=created+1;elsif row_changed then changed:=changed+1;end if;
  exception when others then
   if jsonb_array_length(errors)<100 then errors:=errors||jsonb_build_array(jsonb_build_object('row',rownum,'name',r->>'name','error',case when sqlstate='P0001' then sqlerrm when sqlstate='23505' then 'CONFLICTING_PRODUCT_IDENTIFIERS' else 'INVALID_PRODUCT_ROW' end));end if;
   skipped:=skipped+1;
  end;
 end loop;
 return jsonb_build_object('created',created,'updated',changed,'skipped',skipped,'errors',errors,'quantity_changed',false);
end $$;
revoke all on function app.merge_warehouse_catalog(uuid,jsonb,uuid) from public,anon,authenticated;

create function app.sync_warehouse_catalog(p_warehouse uuid,p_preferred uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare biz uuid; rows jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text,1409));
 select business_id into biz from public.stores where id=p_warehouse and location_type='warehouse' and is_active;
 if p_preferred is not null and not exists(select 1 from public.stores where id=p_preferred and business_id=biz and location_type='store' and is_active) then raise exception 'INVALID_SOURCE_STORE';end if;
 if (select count(*) from public.products p join public.stores s on s.id=p.store_id where p.business_id=biz and p.is_active and s.is_active and s.location_type='store')>10000 then raise exception 'CATALOG_TOO_LARGE_USE_TEMPLATE';end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('currency',s.currency,'barcodes',(select coalesce(jsonb_agg(barcode),'[]') from public.product_barcodes where product_id=p.id and is_active)) order by (p.store_id=p_preferred) desc nulls last,p.updated_at desc,p.id),'[]') into rows
 from public.products p join public.stores s on s.id=p.store_id where p.business_id=biz and p.is_active and s.is_active and s.location_type='store';
 return app.merge_warehouse_catalog(p_warehouse,rows,p_actor);
end $$;
revoke all on function app.sync_warehouse_catalog(uuid,uuid,uuid) from public,anon,authenticated;
create function public.sync_warehouse_products(p_warehouse uuid,p_preferred uuid default null,p_auto boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not app.has_store_role(p_warehouse,'owner') or not app.has_module(p_warehouse,'warehouse') then raise exception 'FORBIDDEN';end if;
 result:=app.sync_warehouse_catalog(p_warehouse,p_preferred,auth.uid());
 insert into public.warehouse_sync_settings(warehouse_id,preferred_store_id,enabled,configured_by,last_run_at,last_result) values(p_warehouse,p_preferred,p_auto,auth.uid(),now(),result)
 on conflict(warehouse_id) do update set preferred_store_id=excluded.preferred_store_id,enabled=excluded.enabled,configured_by=excluded.configured_by,last_run_at=excluded.last_run_at,last_result=excluded.last_result,updated_at=now();
 return result;
end $$;
revoke all on function public.sync_warehouse_products(uuid,uuid,boolean) from public,anon;
grant execute on function public.sync_warehouse_products(uuid,uuid,boolean) to authenticated;
create function public.import_warehouse_catalog(p_warehouse uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not app.has_store_role(p_warehouse,'owner') or not app.has_module(p_warehouse,'warehouse') then raise exception 'FORBIDDEN';end if;
 if jsonb_array_length(p_rows)>200 then raise exception 'IMPORT_LIMIT_200';end if;
 return app.merge_warehouse_catalog(p_warehouse,p_rows,auth.uid());
end $$;
revoke all on function public.import_warehouse_catalog(uuid,jsonb) from public,anon;
grant execute on function public.import_warehouse_catalog(uuid,jsonb) to authenticated;
create function app.run_warehouse_catalog_sync() returns void
language plpgsql security definer set search_path='' as $$
declare s record; result jsonb; warehouse uuid;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('warehouse-product-sync-job',1409)) then return;end if;
 for warehouse in select warehouse_id from public.warehouse_sync_settings where enabled order by warehouse_id loop
  begin
   perform pg_advisory_xact_lock(hashtextextended(warehouse::text,1409));
   select * into s from public.warehouse_sync_settings where warehouse_id=warehouse and enabled;
   if not found then continue;end if;
   result:=app.sync_warehouse_catalog(s.warehouse_id,s.preferred_store_id,s.configured_by);
   update public.warehouse_sync_settings set last_run_at=now(),last_result=result where warehouse_id=s.warehouse_id;
  exception when others then
   update public.warehouse_sync_settings set last_run_at=now(),last_result=jsonb_build_object('error','Sync failed. Check owner access and source store settings.') where warehouse_id=s.warehouse_id;
  end;
 end loop;
end $$;
revoke all on function app.run_warehouse_catalog_sync() from public,anon,authenticated;
-- Native Windows PostgreSQL test installations do not ship pg_cron. Supabase does.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('warehouse-product-sync','*/30 * * * *','select app.run_warehouse_catalog_sync()');
 end if;
end $$;

-- Make deployment fail closed until these RPCs are present.
do $$ declare src text;begin
 src:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 src:=replace(src,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''warehouse_catalog_sync_v1'',to_regprocedure(''public.sync_warehouse_products(uuid,uuid,boolean)'') is not null and to_regprocedure(''public.import_warehouse_catalog(uuid,jsonb)'') is not null,');
 execute src;
end $$;
