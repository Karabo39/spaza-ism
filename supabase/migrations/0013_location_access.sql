-- BRD v1.02 foundation. `stores` remains the stable location identity used
-- by existing ledgers; warehouse is a non-saleable location, never pooled stock.
alter table public.stores add column location_type text not null default 'store'
  check (location_type in ('store', 'warehouse'));
alter table public.stores add constraint stores_id_business_unique unique (id, business_id);
alter table public.memberships add constraint memberships_id_business_unique unique (id, business_id);

create table public.store_memberships (
  membership_id uuid not null,
  store_id uuid not null,
  business_id uuid not null references public.businesses(id),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (membership_id, store_id),
  foreign key (membership_id, business_id) references public.memberships(id, business_id) on delete cascade,
  foreign key (store_id, business_id) references public.stores(id, business_id) on delete cascade
);
create index store_memberships_location on public.store_memberships(store_id, membership_id);
create index store_memberships_business on public.store_memberships(business_id);
alter table public.store_memberships enable row level security;
revoke all on public.store_memberships from public, anon, authenticated;
grant select on public.store_memberships to authenticated;

-- Preserve the unambiguous assignment for existing single-store businesses.
-- Multi-store staff need explicit owner assignment; do not infer broad access.
insert into public.store_memberships(membership_id, store_id, business_id)
select m.id, s.id, m.business_id from public.memberships m
join public.stores s on s.business_id = m.business_id
where m.role <> 'owner' and s.is_active
  and (select count(*) from public.stores s2 where s2.business_id = m.business_id and s2.is_active) = 1;

create or replace function app.has_store_access(p_store uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.stores s
    join public.memberships m on m.business_id = s.business_id
    where s.id = p_store and s.is_active and m.is_active and m.user_id = auth.uid()
      and (m.role = 'owner' or exists (
        select 1 from public.store_memberships sm
        where sm.membership_id = m.id and sm.store_id = s.id and sm.business_id = s.business_id
      ))
  );
$$;
create or replace function app.has_store_role(p_store uuid, p_min app.membership_role)
returns boolean language sql stable security definer set search_path = public, app as $$
  select app.has_store_access(p_store)
    and app.has_business_role(app.store_business(p_store), p_min);
$$;
create policy sel_store_memberships on public.store_memberships for select to authenticated
  using (app.has_business_role(business_id, 'owner') or exists (
    select 1 from public.memberships m where m.id = membership_id and m.user_id = (select auth.uid()) and m.is_active
  ));
drop policy sel_stores on public.stores;
create policy sel_stores on public.stores for select to authenticated
  using (app.has_store_access(id) or app.has_business_role(business_id, 'owner'));
drop policy ins_stores on public.stores;
drop policy upd_stores on public.stores;
-- Location creation/metadata and assignment changes are RPC-only and audited.
revoke insert, update, delete on public.stores from authenticated;
drop policy sel_audit_logs on public.audit_logs;
create policy sel_audit_logs on public.audit_logs for select to authenticated
  using (app.has_business_role(business_id, 'owner') or
    (store_id is not null and app.has_store_role(store_id, 'manager')));

create function public.create_location(p_business uuid, p_name text, p_type text, p_code text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app.has_business_role(p_business, 'owner') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  if p_type is null or p_type not in ('store','warehouse') then raise exception 'INVALID_LOCATION_TYPE'; end if;
  insert into public.stores(business_id, name, code, location_type)
  values(p_business, btrim(p_name), nullif(btrim(p_code), ''), p_type) returning id into v_id;
  perform app.audit('location.create', 'store', v_id, p_business, v_id, null,
    jsonb_build_object('name', btrim(p_name), 'location_type', p_type));
  return v_id;
end $$;

create function public.update_location(p_store uuid, p_name text, p_code text default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_old public.stores%rowtype;
begin
  if not app.has_store_role(p_store, 'manager') then raise exception 'FORBIDDEN'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'NAME_REQUIRED'; end if;
  select * into strict v_old from public.stores where id = p_store for update;
  update public.stores set name = btrim(p_name), code = nullif(btrim(p_code), '') where id = p_store;
  perform app.audit('location.update', 'store', p_store, v_old.business_id, p_store,
    jsonb_build_object('name', v_old.name, 'code', v_old.code),
    jsonb_build_object('name', btrim(p_name), 'code', nullif(btrim(p_code), '')));
end $$;

create function public.set_member_locations(p_membership uuid, p_stores uuid[])
returns void language plpgsql security definer set search_path = public, app as $$
declare v_member public.memberships%rowtype; v_before jsonb;
begin
  select * into v_member from public.memberships where id = p_membership for update;
  if not found or not app.has_business_role(v_member.business_id, 'owner') then raise exception 'FORBIDDEN'; end if;
  if v_member.role = 'owner' then raise exception 'OWNER_HAS_ALL_LOCATIONS'; end if;
  if p_stores is null then raise exception 'LOCATIONS_REQUIRED'; end if;
  if exists (select 1 from unnest(p_stores) x(id) left join public.stores s on s.id = x.id
    where s.id is null or s.business_id <> v_member.business_id or not s.is_active)
    then raise exception 'INVALID_LOCATION'; end if;
  select coalesce(jsonb_agg(store_id order by store_id), '[]'::jsonb) into v_before
    from public.store_memberships where membership_id = p_membership;
  delete from public.store_memberships where membership_id = p_membership;
  insert into public.store_memberships(membership_id, store_id, business_id, assigned_by)
    select p_membership, id, v_member.business_id, auth.uid() from (select distinct unnest(p_stores) id) selected;
  perform app.audit('member.locations', 'membership', p_membership, v_member.business_id, null,
    jsonb_build_object('locations', v_before), jsonb_build_object('locations', to_jsonb(p_stores)));
end $$;

-- Defense at the transaction boundary covers the existing sale RPC too.
create function app.require_saleable_location()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from public.stores s where s.id = new.store_id
    and s.business_id = new.business_id and s.is_active and s.location_type = 'store')
    then raise exception 'LOCATION_NOT_SALEABLE'; end if;
  return new;
end $$;
create trigger trg_goods_out_saleable before insert or update on public.goods_out
  for each row execute function app.require_saleable_location();

-- Prevent cross-location product/customer reassignment and forged business IDs.
create function app.validate_location_identity()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if tg_op = 'UPDATE' then
    if new.store_id is distinct from old.store_id or new.business_id is distinct from old.business_id then
      raise exception 'LOCATION_IDENTITY_IMMUTABLE';
    end if;
  end if;
  if not exists (select 1 from public.stores s where s.id = new.store_id and s.business_id = new.business_id)
    then raise exception 'INVALID_LOCATION'; end if;
  return new;
end $$;
create trigger trg_products_location_identity before insert or update on public.products
  for each row execute function app.validate_location_identity();
create trigger trg_customers_location_identity before insert or update on public.customers
  for each row execute function app.validate_location_identity();

-- Make product/location coherence a database constraint, including legacy RPCs.
alter table public.products add constraint products_id_store_unique unique(id, store_id);
alter table public.stock add constraint stock_product_location_fk
  foreign key(product_id, store_id) references public.products(id, store_id) on delete cascade;
alter table public.stock drop constraint stock_product_id_fkey;
alter table public.stock_movements add constraint movements_product_location_fk
  foreign key(product_id, store_id) references public.products(id, store_id);
alter table public.stock_movements drop constraint stock_movements_product_id_fkey;
alter table public.stock_batches add constraint batches_product_location_fk
  foreign key(product_id, store_id) references public.products(id, store_id) on delete cascade;
alter table public.stock_batches drop constraint stock_batches_product_id_fkey;
alter table public.product_barcodes add constraint barcodes_product_location_fk
  foreign key(product_id, store_id) references public.products(id, store_id) on delete cascade;
alter table public.product_barcodes drop constraint product_barcodes_product_id_fkey;

-- Internal ledger primitives must never be available to API roles directly.
revoke execute on function app.apply_stock_delta(uuid,uuid,uuid,numeric,app.movement_type,text,text,uuid,numeric) from public, anon, authenticated;
revoke execute on function app.audit(text,text,uuid,uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function app.require_saleable_location(), app.validate_location_identity() from public, anon, authenticated;
revoke execute on function public.create_location(uuid,text,text,text), public.update_location(uuid,text,text), public.set_member_locations(uuid,uuid[]) from public, anon;
grant execute on function public.create_location(uuid,text,text,text), public.update_location(uuid,text,text), public.set_member_locations(uuid,uuid[]) to authenticated;

-- Owner overview preserves separate balances for every physical location.
create function public.business_location_summary(p_business uuid)
returns table(location_id uuid, name text, location_type text, product_count bigint, stock_quantity numeric, stock_value numeric)
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.has_business_role(p_business, 'owner') then raise exception 'FORBIDDEN'; end if;
  return query
    select s.id, s.name, s.location_type, count(p.id),
      coalesce(sum(st.quantity),0), coalesce(sum(st.quantity * p.cost_price),0)
    from public.stores s
    left join public.products p on p.store_id=s.id and p.business_id=s.business_id
    left join public.stock st on st.product_id=p.id and st.store_id=s.id
    where s.business_id=p_business and s.is_active
    group by s.id order by s.location_type, s.name;
end $$;
revoke execute on function public.business_location_summary(uuid) from public, anon;
grant execute on function public.business_location_summary(uuid) to authenticated;
