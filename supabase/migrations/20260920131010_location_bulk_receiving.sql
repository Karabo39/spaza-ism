-- Product type follows the configured relationship at this exact location.
do $$ declare definition text;begin
 definition:=rtrim(pg_get_viewdef('public.v_product_catalog'::regclass,true), E';\n\r ');
 execute 'create or replace view public.v_product_catalog with(security_invoker=true) as select c.*, case when exists(select 1 from public.bulk_conversions b where b.pack_product_id=c.id and b.store_id=c.store_id) then ''Bulk Stock'' else ''Individual'' end::text as item_type from ('||definition||') c';
end $$;

create table app.bulk_product_requests (
 store_id uuid not null references public.stores(id), request_id uuid not null,
 product_id uuid not null references public.products(id), payload jsonb not null,
 primary key(store_id,request_id)
);
create index bulk_product_requests_product on app.bulk_product_requests(product_id);
alter table app.bulk_product_requests enable row level security;
revoke all on app.bulk_product_requests from public,anon,authenticated;

create function public.create_bulk_product(p_store uuid,p_unit uuid,p_name text,p_ratio integer,p_sku text,p_barcode text,p_cost numeric,p_selling numeric,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare unit public.products%rowtype; pid uuid; prior app.bulk_product_requests%rowtype; payload jsonb;
begin
 if auth.uid() is null or not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN';end if;
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
end $$;
revoke all on function public.create_bulk_product(uuid,uuid,text,integer,text,text,numeric,numeric,uuid) from public,anon;
grant execute on function public.create_bulk_product(uuid,uuid,text,integer,text,text,numeric,numeric,uuid) to authenticated;

create function app.guard_bulk_conversion() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.store_id::text,2010));
 if exists(select 1 from public.bulk_conversions where pack_product_id=new.unit_product_id or unit_product_id=new.pack_product_id) then raise exception 'INDIVIDUAL_PRODUCT_REQUIRED';end if;
 if exists(select 1 from public.stock where product_id=new.pack_product_id and quantity<>trunc(quantity)) then raise exception 'WHOLE_PACKS_REQUIRED';end if;
 if tg_op='UPDATE' and row(new.unit_product_id,new.units_per_pack) is not distinct from row(old.unit_product_id,old.units_per_pack) then return new;end if;
 if exists(select 1 from public.stock_transfer_items i join public.stock_transfers t on t.id=i.transfer_id where new.pack_product_id in(i.source_product_id,i.destination_product_id) and t.status in('DRAFT','SUBMITTED','DISPATCHED')) then raise exception 'BULK_TRANSFER_PENDING';end if;
 return new;
end $$;
revoke all on function app.guard_bulk_conversion() from public,anon,authenticated;
create trigger guard_bulk_conversion before insert or update on public.bulk_conversions for each row execute function app.guard_bulk_conversion();

create function app.check_bulk_transfer(p_source uuid,p_destination uuid,p_quantity numeric) returns void language plpgsql security definer set search_path='' as $$
declare src public.bulk_conversions%rowtype; dst public.bulk_conversions%rowtype; location uuid;
begin
 for location in select distinct store_id from public.products where id in(p_source,p_destination) order by store_id loop
  perform pg_advisory_xact_lock(hashtextextended(location::text,2010));
 end loop;
 -- Share-lock conversions so a pack cannot change ratio during dispatch/receipt.
 perform 1 from public.bulk_conversions where pack_product_id in(p_source,p_destination) order by pack_product_id for share;
 select * into src from public.bulk_conversions where pack_product_id=p_source;
 select * into dst from public.bulk_conversions where pack_product_id=p_destination;
 if (src.id is null)<>(dst.id is null) or src.units_per_pack<>dst.units_per_pack then raise exception 'BULK_TRANSFER_MISMATCH';end if;
 if src.id is not null and p_quantity<>trunc(p_quantity) then raise exception 'WHOLE_PACKS_REQUIRED';end if;
end $$;
revoke all on function app.check_bulk_transfer(uuid,uuid,numeric) from public,anon,authenticated;
create function app.guard_bulk_transfer_item() returns trigger language plpgsql security definer set search_path='' as $$
begin perform app.check_bulk_transfer(new.source_product_id,new.destination_product_id,new.quantity);return new;end $$;
revoke all on function app.guard_bulk_transfer_item() from public,anon,authenticated;
create trigger guard_bulk_transfer_item before insert or update on public.stock_transfer_items for each row execute function app.guard_bulk_transfer_item();
create function app.guard_bulk_transfer_status() returns trigger language plpgsql security definer set search_path='' as $$
declare i record;
begin
 if new.status in('SUBMITTED','DISPATCHED','RECEIVED') and new.status is distinct from old.status then
  for i in select * from public.stock_transfer_items where transfer_id=new.id order by source_product_id loop
   perform app.check_bulk_transfer(i.source_product_id,i.destination_product_id,i.quantity);
  end loop;
 end if;
 return new;
end $$;
revoke all on function app.guard_bulk_transfer_status() from public,anon,authenticated;
create trigger guard_bulk_transfer_status before update on public.stock_transfers for each row execute function app.guard_bulk_transfer_status();

-- A pack is indivisible; unpacking is the explicit conversion to individual units.
create function app.guard_whole_bulk_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.store_id::text,2010));
 if new.quantity<>trunc(new.quantity) and exists(select 1 from public.bulk_conversions where pack_product_id=new.product_id) then raise exception 'WHOLE_PACKS_REQUIRED';end if;
 return new;
end $$;
revoke all on function app.guard_whole_bulk_stock() from public,anon,authenticated;
create trigger guard_whole_bulk_stock before insert or update on public.stock for each row execute function app.guard_whole_bulk_stock();

-- Count corrections now use Adjust Stock; unpacking never adds missing packs.
create or replace function public.unpack_stock_with_count(p_conversion uuid,p_packs integer,p_counted integer,p_reason text,p_request uuid,p_expiry date default null)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform app.require_module((select store_id from public.bulk_conversions where id=p_conversion),array['operations']);
 raise exception 'UNPACK_COUNT_OVERRIDE_DISABLED';
end $$;

do $$ declare src text;begin
 src:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 src:=replace(src,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''location_bulk_receiving_v1'',to_regprocedure(''public.create_bulk_product(uuid,uuid,text,integer,text,text,numeric,numeric,uuid)'') is not null,');
 execute src;
end $$;
