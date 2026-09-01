-- =====================================================================
-- 0002_catalog.sql
-- Categories, suppliers, products, barcodes, price history.
-- =====================================================================

create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists idx_categories_business on public.categories(business_id);

create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  contact_name  text,
  phone         text,
  email         citext,
  address       text,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_suppliers_business on public.suppliers(business_id);

-- Products belong to a STORE (stock is per store). Same-named product in
-- two stores are distinct rows in MVP; multi-store sharing is future work.
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  store_id          uuid not null references public.stores(id) on delete cascade,
  name              text not null check (length(btrim(name)) > 0),
  sku               text,
  category_id       uuid references public.categories(id) on delete set null,
  default_supplier_id uuid references public.suppliers(id) on delete set null,
  unit              text not null default 'each',        -- each, kg, pack...
  cost_price        numeric(14,2) not null default 0 check (cost_price >= 0),
  selling_price     numeric(14,2) not null default 0 check (selling_price >= 0),
  min_stock_level   numeric(14,3) not null default 0 check (min_stock_level >= 0),
  reorder_level     numeric(14,3) not null default 0 check (reorder_level >= 0),
  track_expiry      boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null
);
create index if not exists idx_products_store on public.products(store_id);
create index if not exists idx_products_business on public.products(business_id);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_active on public.products(store_id, is_active);
-- Fast name search (trigram would be nicer; keep simple + lower index).
create index if not exists idx_products_name_lower on public.products(store_id, lower(name));

-- A product may carry multiple barcodes. Uniqueness of an *active* barcode
-- is enforced per store via a partial unique index.
create table if not exists public.product_barcodes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  barcode     text not null check (length(btrim(barcode)) > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_active_barcode_per_store
  on public.product_barcodes(store_id, barcode) where is_active;
create index if not exists idx_barcodes_product on public.product_barcodes(product_id);

-- Immutable-ish record of price changes (cost and/or selling).
create table if not exists public.price_history (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  old_cost      numeric(14,2),
  new_cost      numeric(14,2),
  old_selling   numeric(14,2),
  new_selling   numeric(14,2),
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now(),
  source        text                              -- 'manual','goods_in',...
);
create index if not exists idx_price_history_product on public.price_history(product_id, changed_at desc);

-- Record price changes automatically when a product's price is updated.
create or replace function app.log_price_change()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if (tg_op = 'UPDATE') and
     (new.cost_price is distinct from old.cost_price
       or new.selling_price is distinct from old.selling_price) then
    insert into public.price_history
      (product_id, store_id, old_cost, new_cost, old_selling, new_selling, changed_by, source)
    values
      (new.id, new.store_id, old.cost_price, new.cost_price,
       old.selling_price, new.selling_price, auth.uid(), 'manual');
  end if;
  return new;
end $$;

drop trigger if exists trg_products_price_history on public.products;
create trigger trg_products_price_history
  after update on public.products
  for each row execute function app.log_price_change();

drop trigger if exists trg_categories_touch on public.categories;
create trigger trg_categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();
drop trigger if exists trg_suppliers_touch on public.suppliers;
create trigger trg_suppliers_touch before update on public.suppliers
  for each row execute function app.touch_updated_at();
drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function app.touch_updated_at();
