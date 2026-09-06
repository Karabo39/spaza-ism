alter type app.movement_type add value if not exists 'UNPACK_OUT';
alter type app.movement_type add value if not exists 'UNPACK_IN';
create table public.bulk_conversions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), store_id uuid not null,
  pack_product_id uuid not null unique references public.products(id), unit_product_id uuid not null references public.products(id),
  pack_name text not null, unit_name text not null, units_per_pack integer not null check(units_per_pack between 1 and 100000),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
  check(pack_product_id<>unit_product_id), foreign key(store_id,business_id) references public.stores(id,business_id)
);
create index bulk_conversions_store on public.bulk_conversions(store_id);
create index bulk_conversions_unit on public.bulk_conversions(unit_product_id);
create table public.bulk_unpackings (
  id uuid primary key default gen_random_uuid(), reference text not null unique default ('UP-'||upper(replace(gen_random_uuid()::text,'-',''))),
  business_id uuid not null references public.businesses(id), store_id uuid not null,
  conversion_id uuid not null references public.bulk_conversions(id),
  pack_product_id uuid not null references public.products(id), unit_product_id uuid not null references public.products(id),
  pack_name text not null, unit_name text not null, units_per_pack integer not null,
  packs integer not null check(packs>0), units numeric(14,3) not null check(units>0),
  reason text not null check(length(btrim(reason))>0), performed_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  request_id uuid not null, unique(business_id,request_id), foreign key(store_id,business_id) references public.stores(id,business_id)
);
create index unpackings_store on public.bulk_unpackings(store_id,created_at desc);
create index unpackings_conversion on public.bulk_unpackings(conversion_id);
create index unpackings_pack on public.bulk_unpackings(pack_product_id);
create index unpackings_unit on public.bulk_unpackings(unit_product_id);
alter table public.bulk_conversions enable row level security;
alter table public.bulk_unpackings enable row level security;
revoke all on public.bulk_conversions,public.bulk_unpackings from public,anon,authenticated;
grant select on public.bulk_conversions,public.bulk_unpackings to authenticated;
create policy sel_bulk_conversions on public.bulk_conversions for select to authenticated using(app.has_store_access(store_id));
create policy sel_bulk_unpackings on public.bulk_unpackings for select to authenticated using(app.has_store_access(store_id));
create trigger trg_unpacking_immutable before update or delete on public.bulk_unpackings for each row execute function app.block_mutation();

create function public.set_bulk_conversion(p_pack uuid,p_unit uuid,p_ratio integer)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare pack public.products%rowtype; unit public.products%rowtype; cid uuid; prior jsonb;
begin
  select * into pack from public.products where id=p_pack and is_active;
  if not found or not app.has_store_role(pack.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
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
end $$;
create function public.unpack_stock(p_conversion uuid,p_packs integer,p_reason text,p_request uuid)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare c public.bulk_conversions%rowtype; previous public.bulk_unpackings%rowtype; uid uuid; ref text; units numeric; cost numeric; batches jsonb;
begin
  select * into c from public.bulk_conversions where id=p_conversion for share;
  if not found or not app.has_store_access(c.store_id) then raise exception 'FORBIDDEN'; end if;
  if p_packs is null or p_packs<=0 then raise exception 'INVALID_QUANTITY'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.business_id::text||p_request::text,0));
  select * into previous from public.bulk_unpackings where business_id=c.business_id and request_id=p_request;
  if found then
    if previous.conversion_id<>p_conversion or previous.packs<>p_packs or previous.reason<>btrim(p_reason) then raise exception 'REQUEST_CONFLICT'; end if;
    return previous.id;
  end if;
  if not exists(select 1 from public.products p join public.products u on u.id=c.unit_product_id where p.id=c.pack_product_id
    and p.is_active and u.is_active and p.track_expiry=u.track_expiry) then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
  perform id from public.stock where store_id=c.store_id and product_id in (c.pack_product_id,c.unit_product_id) order by product_id for update;
  select cost_price into cost from public.products where id=c.pack_product_id;
  units:=p_packs::numeric*c.units_per_pack;
  insert into public.bulk_unpackings(business_id,store_id,conversion_id,pack_product_id,unit_product_id,pack_name,unit_name,units_per_pack,packs,units,reason,performed_by,request_id)
    values(c.business_id,c.store_id,c.id,c.pack_product_id,c.unit_product_id,c.pack_name,c.unit_name,c.units_per_pack,p_packs,units,btrim(p_reason),auth.uid(),p_request)
    returning id,reference into uid,ref;
  perform app.apply_stock_delta(c.business_id,c.store_id,c.pack_product_id,-p_packs,'UNPACK_OUT',ref||': '||p_reason,'bulk_unpackings',uid,cost);
  batches:=app.take_stock_batches(c.pack_product_id,c.store_id,p_packs);
  perform app.apply_stock_delta(c.business_id,c.store_id,c.unit_product_id,units,'UNPACK_IN',ref||': '||p_reason,'bulk_unpackings',uid,round(cost/c.units_per_pack,2));
  perform app.put_stock_batches(c.unit_product_id,c.store_id,batches,c.units_per_pack);
  -- Match Goods In's current-cost valuation convention for the produced units.
  if cost>0 then update public.products set cost_price=round(cost/c.units_per_pack,2) where id=c.unit_product_id; end if;
  perform app.audit('bulk.unpack','bulk_unpackings',uid,c.business_id,c.store_id,null,jsonb_build_object('pack',c.pack_product_id,'unit',c.unit_product_id,'packs',p_packs,'ratio',c.units_per_pack,'units',units,'reason',p_reason));
  return uid;
end $$;
revoke execute on function public.set_bulk_conversion(uuid,uuid,integer),public.unpack_stock(uuid,integer,text,uuid) from public,anon;
grant execute on function public.set_bulk_conversion(uuid,uuid,integer),public.unpack_stock(uuid,integer,text,uuid) to authenticated;
