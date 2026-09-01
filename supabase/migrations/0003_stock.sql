-- =====================================================================
-- 0003_stock.sql
-- Current stock state, expiry batches, and the append-only movement ledger.
-- Stock is NEVER mutated directly by clients — only by SECURITY DEFINER
-- RPCs (0006) which also write the ledger. current quantity is always
-- reconcilable against the sum of movement deltas.
-- =====================================================================

-- Authoritative current stock, one row per product+store.
create table if not exists public.stock (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  quantity     numeric(14,3) not null default 0,
  updated_at   timestamptz not null default now(),
  unique (product_id, store_id),
  constraint stock_non_negative check (quantity >= 0)
);
create index if not exists idx_stock_store on public.stock(store_id);
-- Partial index to find low stock quickly is added after products link.

-- Expiry batches (only used when product.track_expiry). Quantity here is
-- informational for FEFO/expiry reporting; authoritative total lives in stock.
create table if not exists public.stock_batches (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  batch_ref    text,
  expiry_date  date,
  quantity     numeric(14,3) not null default 0 check (quantity >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_batches_expiry on public.stock_batches(store_id, expiry_date)
  where quantity > 0;
create index if not exists idx_batches_product on public.stock_batches(product_id);

-- The immutable ledger. Every increase/decrease appends exactly one row.
-- quantity_before/after snapshot the stock row at mutation time.
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  movement_type   app.movement_type not null,
  quantity_delta  numeric(14,3) not null,          -- signed: + in, - out
  quantity_before numeric(14,3) not null,
  quantity_after  numeric(14,3) not null,
  unit_cost       numeric(14,2),
  reason          text,
  reference_table text,                            -- e.g. 'goods_out'
  reference_id    uuid,                            -- header id of the txn
  performed_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint movement_delta_consistent
    check (quantity_after = quantity_before + quantity_delta)
);
create index if not exists idx_movements_product on public.stock_movements(product_id, created_at desc);
create index if not exists idx_movements_store on public.stock_movements(store_id, created_at desc);
create index if not exists idx_movements_ref on public.stock_movements(reference_table, reference_id);

drop trigger if exists trg_stock_touch on public.stock;
create trigger trg_stock_touch before update on public.stock
  for each row execute function app.touch_updated_at();
drop trigger if exists trg_batches_touch on public.stock_batches;
create trigger trg_batches_touch before update on public.stock_batches
  for each row execute function app.touch_updated_at();

-- The ledger is append-only: block UPDATE and DELETE for everyone
-- (including the table owner via SECURITY DEFINER RPCs — they only INSERT).
create or replace function app.block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Table % is append-only; % is not permitted',
    tg_table_name, tg_op;
end $$;

drop trigger if exists trg_movements_no_update on public.stock_movements;
create trigger trg_movements_no_update before update or delete on public.stock_movements
  for each row execute function app.block_mutation();
