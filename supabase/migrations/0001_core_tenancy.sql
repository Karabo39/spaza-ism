-- =====================================================================
-- 0001_core_tenancy.sql
-- Extensions, enums, tenancy core (businesses/stores/profiles/memberships)
-- and SECURITY DEFINER helper functions used by RLS across the schema.
-- =====================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";         -- case-insensitive text

-- Private schema for helper functions that must bypass RLS safely.
create schema if not exists app;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type app.membership_role as enum ('owner', 'manager', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.movement_type as enum (
    'GOODS_IN','SALE_CASH','SALE_CREDIT',
    'ADJUSTMENT_INCREASE','ADJUSTMENT_DECREASE',
    'STOCK_TAKE','DAMAGED','EXPIRED',
    'TRANSFER_IN','TRANSFER_OUT','RETURN_IN','VOID_REVERSAL'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.sale_type as enum ('CASH','CREDIT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.adjustment_reason as enum
    ('DAMAGED','EXPIRED','MISSING','STOCK_COUNT_CORRECTION','THEFT','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.credit_txn_type as enum
    ('CREDIT_SALE','PAYMENT','ADJUSTMENT','OPENING_BALANCE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.stock_take_status as enum
    ('IN_PROGRESS','PENDING_APPROVAL','COMPLETED','CANCELLED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Core tenancy tables
-- ---------------------------------------------------------------------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  slug        citext unique,
  currency    text not null default 'ZAR',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.stores (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  code         text,
  address      text,
  timezone     text not null default 'Africa/Johannesburg',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists idx_stores_business on public.stores(business_id);

-- Mirror of auth.users for app-level profile data.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A user's role within a business. MVP: membership grants access to all
-- stores in the business. store_members reserved for future granularity.
create table if not exists public.memberships (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         app.membership_role not null default 'employee',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, user_id)
);
create index if not exists idx_memberships_user on public.memberships(user_id);
create index if not exists idx_memberships_business on public.memberships(business_id);

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER: bypass RLS to prevent recursion)
-- ---------------------------------------------------------------------

-- Businesses the current user actively belongs to.
create or replace function app.user_business_ids()
returns setof uuid
language sql stable security definer set search_path = public, app as $$
  select business_id from public.memberships
  where user_id = auth.uid() and is_active;
$$;

create or replace function app.is_business_member(p_business uuid)
returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and business_id = p_business and is_active
  );
$$;

-- Numeric rank for role comparison (owner high).
create or replace function app.role_rank(r app.membership_role)
returns int language sql immutable as $$
  select case r when 'owner' then 3 when 'manager' then 2 when 'employee' then 1 else 0 end;
$$;

-- The current user's role in a business (null if none).
create or replace function app.business_role(p_business uuid)
returns app.membership_role
language sql stable security definer set search_path = public, app as $$
  select role from public.memberships
  where user_id = auth.uid() and business_id = p_business and is_active
  limit 1;
$$;

-- Does the user meet at least the required role in the business?
create or replace function app.has_business_role(p_business uuid, p_min app.membership_role)
returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce(app.role_rank(app.business_role(p_business)) >= app.role_rank(p_min), false);
$$;

-- Store-level access = membership in the store's business.
create or replace function app.has_store_access(p_store uuid)
returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.stores s
    join public.memberships m on m.business_id = s.business_id
    where s.id = p_store and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function app.store_business(p_store uuid)
returns uuid
language sql stable security definer set search_path = public, app as $$
  select business_id from public.stores where id = p_store;
$$;

create or replace function app.has_store_role(p_store uuid, p_min app.membership_role)
returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.has_business_role(app.store_business(p_store), p_min);
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
drop trigger if exists trg_businesses_touch on public.businesses;
create trigger trg_businesses_touch before update on public.businesses
  for each row execute function app.touch_updated_at();

drop trigger if exists trg_stores_touch on public.stores;
create trigger trg_stores_touch before update on public.stores
  for each row execute function app.touch_updated_at();

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

drop trigger if exists trg_memberships_touch on public.memberships;
create trigger trg_memberships_touch before update on public.memberships
  for each row execute function app.touch_updated_at();

-- Auto-create a profile row when an auth user is created.
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
