-- One-store assignment changes retain other locations and their module grants.
create function app_private.set_store_member_access(p_store uuid,p_membership uuid,p_assigned boolean)
returns void language plpgsql security definer set search_path='' as $$
declare m public.memberships%rowtype; s public.stores%rowtype; prior boolean;
begin
 select * into s from public.stores where id=p_store and is_active and location_type='store';
 if auth.uid() is null or s.id is null or not app.has_store_role(p_store,'owner') or not app.has_module(p_store,'stores') or not app.has_module(p_store,'users') then raise exception 'FORBIDDEN';end if;
 select * into m from public.memberships where id=p_membership for update;
 if m.id is null or m.business_id<>s.business_id or not m.is_active or m.role='owner' or p_assigned is null then raise exception 'INVALID_MEMBER';end if;
 select exists(select 1 from public.store_memberships where store_id=p_store and membership_id=p_membership) into prior;
 if prior=p_assigned then return;end if;
 if p_assigned then
  insert into public.store_memberships(membership_id,store_id,business_id,assigned_by) values(m.id,s.id,s.business_id,auth.uid());
 else
  delete from public.store_memberships where membership_id=m.id and store_id=s.id;
 end if;
 perform app.audit('member.store_access','membership',m.id,s.business_id,s.id,jsonb_build_object('assigned',prior),jsonb_build_object('assigned',p_assigned));
end $$;

-- Internal row copier; only called after checking both locations.
-- Existing prices and stock configuration are never updated.
create function app_private.copy_store_catalog_row(p_store uuid,p_source uuid,p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare src public.products%rowtype; dest public.stores%rowtype; old public.products%rowtype;
 candidates uuid[]; target uuid; codes text[]; code text; created boolean:=false; changed boolean:=false; ratio integer;
begin
 select * into src from public.products where id=p_source and is_active for share;
 select * into dest from public.stores where id=p_store;
 if src.id is null or src.business_id<>dest.business_id then raise exception 'INVALID_PRODUCT_ROW';end if;
 select coalesce(array_agg(barcode),'{}') into codes from public.product_barcodes where product_id=src.id and is_active;
 if p_parent is not null then select units_per_pack into ratio from public.bulk_conversions where pack_product_id=src.id and unit_product_id=src.bulk_parent_id;end if;
 select array_agg(id) into candidates from (
  select p.id from public.products p where p.store_id=p_store and src.sku is not null and p.sku=src.sku
  union select b.product_id from public.product_barcodes b where b.store_id=p_store and b.is_active and b.barcode=any(codes)
  union select p.id from app.warehouse_product_links l join public.products p on p.id=l.source_product_id where l.warehouse_id=src.store_id and l.product_id=src.id and p.store_id=p_store
  union select p.id from public.products p join public.bulk_conversions c on c.pack_product_id=p.id where p.store_id=p_store and p.bulk_parent_id=p_parent and c.unit_product_id=p_parent and p.unit=src.unit and c.units_per_pack=ratio
 ) matches;
 if cardinality(candidates)>1 then raise exception 'CONFLICTING_PRODUCT_IDENTIFIERS';end if;
 target:=candidates[1];
 if target is null then
  if dest.currency<>(select currency from public.stores where id=src.store_id) then raise exception 'CURRENCY_MISMATCH';end if;
  insert into public.products(business_id,store_id,name,sku,description,unit,cost_price,selling_price,min_stock_level,reorder_level,track_expiry,category_id,default_supplier_id,created_by,tracking_type,bulk_enabled,bulk_parent_id)
  values(dest.business_id,p_store,src.name,src.sku,src.description,src.unit,src.cost_price,src.selling_price,src.min_stock_level,src.reorder_level,src.track_expiry,src.category_id,src.default_supplier_id,auth.uid(),src.tracking_type,src.bulk_enabled,p_parent) returning id into target;
  insert into public.stock(product_id,store_id,quantity) values(target,p_store,0) on conflict do nothing;
  created:=true;
 else
  select * into old from public.products where id=target for update;
  if not old.is_active then raise exception 'PRODUCT_INACTIVE';end if;
  if row(old.unit,old.track_expiry,old.tracking_type,old.bulk_enabled,old.bulk_parent_id) is distinct from row(src.unit,src.track_expiry,src.tracking_type,src.bulk_enabled,p_parent) then raise exception 'PRODUCT_STRUCTURE_MISMATCH';end if;
  if exists(select 1 from app.warehouse_product_links where warehouse_id=src.store_id and source_product_id=target and product_id<>src.id) then raise exception 'CONFLICTING_PRODUCT_LINK';end if;
  if old.sku is not null and src.sku is not null and old.sku<>src.sku then raise exception 'CONFLICTING_PRODUCT_IDENTIFIERS';end if;
  changed:=row(old.name,old.description,old.category_id,old.sku) is distinct from row(src.name,src.description,src.category_id,coalesce(old.sku,src.sku));
  if changed then update public.products set name=src.name,description=src.description,category_id=src.category_id,sku=coalesce(old.sku,src.sku) where id=target;end if;
 end if;
 foreach code in array codes loop
  if not exists(select 1 from public.product_barcodes where store_id=p_store and barcode=code and is_active) then
   insert into public.product_barcodes(product_id,store_id,barcode) values(target,p_store,code);changed:=true;
  end if;
 end loop;
 if p_parent is not null then
  if ratio is null then raise exception 'PRODUCT_STRUCTURE_MISMATCH';end if;
  if exists(select 1 from public.bulk_conversions where pack_product_id=target and (unit_product_id<>p_parent or units_per_pack<>ratio)) then raise exception 'PRODUCT_STRUCTURE_MISMATCH';end if;
  insert into public.bulk_conversions(business_id,store_id,pack_product_id,unit_product_id,pack_name,unit_name,units_per_pack,updated_by)
  values(dest.business_id,p_store,target,p_parent,src.name,(select name from public.products where id=p_parent),ratio,auth.uid()) on conflict(pack_product_id) do nothing;
 end if;
 insert into app.warehouse_product_links(warehouse_id,source_product_id,product_id) values(src.store_id,target,src.id) on conflict do nothing;
 if created or changed then perform app.audit('store.catalog_sync','products',target,dest.business_id,p_store,case when created then null else to_jsonb(old) end,jsonb_build_object('warehouse_product',src.id,'prices_preserved',not created,'quantity_changed',false));end if;
 return jsonb_build_object('id',target,'created',created,'updated',not created and changed);
end $$;

create function app_private.sync_store_products(p_store uuid,p_warehouse uuid,p_preview boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare dest public.stores%rowtype; wh public.stores%rowtype; src record; bulk record; r jsonb; child jsonb;
 created integer:=0; updated integer:=0; matched integer:=0; skipped integer:=0; errors jsonb:='[]'; result jsonb;
begin
 select * into dest from public.stores where id=p_store and is_active and location_type='store';
 select * into wh from public.stores where id=p_warehouse and is_active and location_type='warehouse';
 if auth.uid() is null or dest.id is null or wh.id is null or dest.business_id<>wh.business_id or not app.has_store_role(dest.id,'manager') or not app.has_module(dest.id,'products') or not app.has_store_access(wh.id) or not app.has_module(wh.id,'warehouse') then raise exception 'FORBIDDEN';end if;
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
end $$;

revoke all on function app_private.set_store_member_access(uuid,uuid,boolean),app_private.copy_store_catalog_row(uuid,uuid,uuid),app_private.sync_store_products(uuid,uuid,boolean) from public,anon,authenticated;
create function public.set_store_member_access(p_store uuid,p_membership uuid,p_assigned boolean) returns void language sql security definer set search_path='' as $$ select app_private.set_store_member_access(p_store,p_membership,p_assigned); $$;
create function public.sync_store_products(p_store uuid,p_warehouse uuid,p_preview boolean default true) returns jsonb language sql security definer set search_path='' as $$ select app_private.sync_store_products(p_store,p_warehouse,p_preview); $$;
revoke all on function public.set_store_member_access(uuid,uuid,boolean),public.sync_store_products(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_store_member_access(uuid,uuid,boolean),public.sync_store_products(uuid,uuid,boolean) to authenticated;
do $$ declare definition text;begin
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into definition;
 definition:=regexp_replace(definition,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''store_catalog_sync_v1'',true,');
 if definition not like '%store_catalog_sync_v1%' then raise exception 'Release contract pattern changed';end if;
 execute definition;
end $$;
