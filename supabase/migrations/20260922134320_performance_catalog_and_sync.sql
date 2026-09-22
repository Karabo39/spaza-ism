create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index products_name_trigram on public.products using gin(name extensions.gin_trgm_ops);
create index products_store_name_id on public.products(store_id,name,id);

-- Keep the existing read-model contract, with one product join instead of wrappers.
create or replace view public.v_product_stock with(security_invoker=true) as
select p.id,p.business_id,p.store_id,p.name,p.sku,p.unit,p.cost_price,p.selling_price,
 p.min_stock_level,p.reorder_level,p.track_expiry,p.is_active,p.category_id,p.default_supplier_id,
 coalesce(s.quantity,0) quantity,round(coalesce(s.quantity,0)*p.cost_price,2) stock_value,
 round(coalesce(s.quantity,0)*p.selling_price,2) retail_value,c.name category_name,sup.name supplier_name,
 case when p.tracking_type='SALES_ONLY' then 'not_tracked'
 when coalesce(s.quantity,0)<=0 then 'out' when s.quantity<=p.min_stock_level then 'low'
 when s.quantity<=p.reorder_level then 'reorder' else 'ok' end stock_status,
 greatest(p.reorder_level-coalesce(s.quantity,0),0) suggested_reorder,
 p.description,p.tracking_type,p.bulk_parent_id,p.bulk_enabled,
 coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'conversion_id',bc.id,'name',b.name,'unit',b.unit,
 'units_per_pack',bc.units_per_pack,'quantity',coalesce(bs.quantity,0),'cost_price',b.cost_price,'selling_price',b.selling_price)
 order by bc.updated_at,bc.id) from public.bulk_conversions bc join public.products b on b.id=bc.pack_product_id
 left join public.stock bs on bs.product_id=b.id and bs.store_id=b.store_id
 where bc.unit_product_id=p.id and b.is_active),'[]'::jsonb) bulk_options
from public.products p left join public.stock s on s.product_id=p.id and s.store_id=p.store_id
left join public.categories c on c.id=p.category_id left join public.suppliers sup on sup.id=p.default_supplier_id;

-- Exact barcode takes precedence over SKU, with the authorised product in one call.
create function public.resolve_product_code(p_store uuid,p_code text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare product uuid; result jsonb;
begin
 if nullif(btrim(p_code),'') is null then return null; end if;
 select p.id into product from public.product_barcodes b join public.products p on p.id=b.product_id
 where b.store_id=p_store and p.store_id=p_store and b.barcode=btrim(p_code) and b.is_active and p.is_active limit 1;
 if product is null then select id into product from public.products where store_id=p_store and sku=btrim(p_code) and is_active order by id limit 1; end if;
 if product is null then return null; end if;
 select to_jsonb(v) into result from public.v_product_stock v where id=product;
 return result;
end $$;
revoke all on function public.resolve_product_code(uuid,text) from public,anon;
grant execute on function public.resolve_product_code(uuid,text) to authenticated;

-- Select an authorised, bounded base page first. Each enrichment is explicitly
-- parameterised by one selected ID, so no aggregate can run for off-page rows.
create function public.catalog_page(p_stores uuid[],p_search text default '',p_status text default 'all',
 p_active boolean default null,p_main_only boolean default true,p_item_type text default null,
 p_after jsonb default null,p_limit integer default 50) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r record; item jsonb; result jsonb:='[]'; last_row jsonb; next_row jsonb; n integer:=0;
 page_size integer:=greatest(1,least(coalesce(p_limit,50),200)); term text:=btrim(coalesce(p_search,''));
begin
 if cardinality(p_stores)>100 then raise exception 'TOO_MANY_LOCATIONS'; end if;
 for r in
  select p.id,p.name from public.products p
  left join public.stock s on s.product_id=p.id and s.store_id=p.store_id
  where p.store_id=any(p_stores)
   and (p_active is null or p.is_active=p_active)
   and (not p_main_only or p.bulk_parent_id is null)
   and (p_item_type is null or (p_item_type='Bulk Stock')=(p.bulk_parent_id is not null))
   and (term='' or p.name ilike '%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' escape '\'
     or p.sku=term or exists(select 1 from public.product_barcodes b where b.product_id=p.id and b.store_id=p.store_id and b.is_active and b.barcode=term))
   and (p_status in ('all','inactive') or p_status=case when p.tracking_type='SALES_ONLY' then 'not_tracked'
      when coalesce(s.quantity,0)<=0 then 'out' when s.quantity<=p.min_stock_level then 'low'
      when s.quantity<=p.reorder_level then 'reorder' else 'ok' end)
   and (p_after is null or (p.name,p.id)>((p_after->>'name'),(p_after->>'id')::uuid))
  order by p.name,p.id limit page_size+1
 loop
  if n=page_size then next_row:=last_row; exit; end if;
  select to_jsonb(v) into item from public.v_product_catalog v where v.id=r.id limit 1;
  result:=result||jsonb_build_array(item); n:=n+1;
  last_row:=jsonb_build_object('name',r.name,'id',r.id);
 end loop;
 return jsonb_build_object('rows',result,'next',next_row);
end $$;
revoke all on function public.catalog_page(uuid[],text,text,boolean,boolean,text,jsonb,integer) from public,anon;
grant execute on function public.catalog_page(uuid[],text,text,boolean,boolean,text,jsonb,integer) to authenticated;

-- A change token per product avoids timestamp/commit-order gaps. Tokens are not
-- sequential: the client compares a bounded manifest and downloads changed rows.
create table app.catalog_versions (
 product_id uuid primary key references public.products(id) on delete cascade,
 version uuid not null default gen_random_uuid()
);
alter table app.catalog_versions enable row level security;
create policy catalog_versions_read on app.catalog_versions for select to authenticated
 using(exists(select 1 from public.products p where p.id=product_id));
revoke all on app.catalog_versions from public,anon,authenticated;
grant select on app.catalog_versions to authenticated;
insert into app.catalog_versions(product_id) select id from public.products;

create function app.touch_catalog_versions() returns trigger language plpgsql security definer set search_path='' as $$
declare ids uuid[]; old_row jsonb:=case when tg_op<>'INSERT' then to_jsonb(old) else '{}'::jsonb end;
 new_row jsonb:=case when tg_op<>'DELETE' then to_jsonb(new) else '{}'::jsonb end;
begin
 if tg_table_name='products' then ids:=array[(old_row->>'id')::uuid,(new_row->>'id')::uuid,(old_row->>'bulk_parent_id')::uuid,(new_row->>'bulk_parent_id')::uuid];
 elsif tg_table_name='bulk_conversions' then ids:=array[(old_row->>'unit_product_id')::uuid,(new_row->>'unit_product_id')::uuid,(old_row->>'pack_product_id')::uuid,(new_row->>'pack_product_id')::uuid];
 elsif tg_table_name='categories' then select array_agg(id) into ids from public.products where category_id=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
 elsif tg_table_name='suppliers' then select array_agg(id) into ids from public.products where default_supplier_id=coalesce((new_row->>'id')::uuid,(old_row->>'id')::uuid);
 else ids:=array[(old_row->>'product_id')::uuid,(new_row->>'product_id')::uuid]; end if;
 insert into app.catalog_versions(product_id,version)
 select id,gen_random_uuid() from public.products where id=any(ids) or id in
 (select bulk_parent_id from public.products where id=any(ids)) order by id
 on conflict(product_id) do update set version=excluded.version;
 return null;
end $$;
revoke all on function app.touch_catalog_versions() from public,anon,authenticated;
create trigger catalog_version after insert or update or delete on public.products for each row execute function app.touch_catalog_versions();
create trigger catalog_version after insert or update or delete on public.stock for each row execute function app.touch_catalog_versions();
create trigger catalog_version after insert or update or delete on public.product_barcodes for each row execute function app.touch_catalog_versions();
create trigger catalog_version after insert or update or delete on public.bulk_conversions for each row execute function app.touch_catalog_versions();
create trigger catalog_version after update on public.categories for each row execute function app.touch_catalog_versions();
create trigger catalog_version after update on public.suppliers for each row execute function app.touch_catalog_versions();

create function public.catalog_manifest(p_store uuid,p_after uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from (
 select p.id,c.version from public.products p join app.catalog_versions c on c.product_id=p.id
 where p.store_id=p_store and (p_after is null or p.id>p_after) order by p.id limit 500) v;
$$;
create function public.catalog_sync_products(p_store uuid,p_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r uuid; product jsonb; result jsonb:='[]';
begin
 if coalesce(cardinality(p_ids),0)>500 then raise exception 'PAGE_TOO_LARGE'; end if;
 foreach r in array coalesce(p_ids,'{}'::uuid[]) loop
  select to_jsonb(v)||jsonb_build_object('_barcodes',coalesce((select jsonb_agg(b.barcode order by b.barcode)
   from public.product_barcodes b where b.product_id=r and b.store_id=p_store and b.is_active),'[]'::jsonb))
   into product from public.v_product_stock v where v.id=r and v.store_id=p_store limit 1;
  if product is not null then result:=result||jsonb_build_array(product); end if;
 end loop;
 return result;
end $$;
revoke all on function public.catalog_manifest(uuid,uuid),public.catalog_sync_products(uuid,uuid[]) from public,anon;
grant execute on function public.catalog_manifest(uuid,uuid),public.catalog_sync_products(uuid,uuid[]) to authenticated;

create or replace view public.v_product_catalog with(security_invoker=true) as
select v.id,v.business_id,v.store_id,v.name,v.sku,v.unit,v.cost_price,v.selling_price,
 v.min_stock_level,v.reorder_level,v.track_expiry,v.is_active,v.category_id,v.default_supplier_id,
 v.quantity,v.stock_value,v.retail_value,v.category_name,v.supplier_name,v.stock_status,v.suggested_reorder,
 coalesce(b.barcodes,'') barcodes,coalesce(b.barcodes,'')||' '||v.name||' '||coalesce(v.sku,'') search_text,
 x.nearest_expiry,coalesce(x.expired_quantity,0) expired_quantity,
 greatest(v.quantity-coalesce(x.dated_quantity,0),0) undated_quantity,
 case when v.track_expiry then least(v.quantity,coalesce(x.sellable_quantity,0)) else v.quantity end sellable_quantity,
 v.description,case when v.bulk_parent_id is not null then 'Bulk Stock' else 'Individual' end::text item_type,
 v.tracking_type,v.bulk_parent_id,v.bulk_enabled,v.bulk_options
from public.v_product_stock v
left join lateral(select string_agg(barcode,', ' order by barcode) barcodes from public.product_barcodes where product_id=v.id and is_active)b on true
left join lateral(select min(expiry_date) filter(where quantity>0) nearest_expiry,
 sum(quantity) filter(where expiry_date is not null) dated_quantity,
 sum(quantity) filter(where expiry_date<(now() at time zone 'Africa/Johannesburg')::date) expired_quantity,
 sum(quantity) filter(where expiry_date>=(now() at time zone 'Africa/Johannesburg')::date) sellable_quantity
 from public.stock_batches where product_id=v.id and store_id=v.store_id)x on true;
