-- =====================================================================
-- 0004_transactions.sql
-- Goods In / Goods Out headers+items, customers + credit ledger,
-- stock adjustments, stock takes, supplier invoices, audit log.
-- =====================================================================

-- ---------------- Goods In ----------------
create table if not exists public.goods_in (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  supplier_id   uuid references public.suppliers(id) on delete set null,
  reference     text,                              -- invoice / delivery note
  note          text,
  total_cost    numeric(14,2) not null default 0,
  performed_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_goods_in_store on public.goods_in(store_id, created_at desc);
create index if not exists idx_goods_in_supplier on public.goods_in(supplier_id);

create table if not exists public.goods_in_items (
  id           uuid primary key default gen_random_uuid(),
  goods_in_id  uuid not null references public.goods_in(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete restrict,
  quantity     numeric(14,3) not null check (quantity > 0),
  unit_cost    numeric(14,2) not null default 0 check (unit_cost >= 0),
  expiry_date  date,
  batch_ref    text,
  line_total   numeric(14,2) not null default 0
);
create index if not exists idx_goods_in_items_header on public.goods_in_items(goods_in_id);

-- ---------------- Customers & Credit ----------------
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  phone         text,
  email         citext,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_customers_store on public.customers(store_id);
create index if not exists idx_customers_name on public.customers(store_id, lower(name));

-- One credit account per customer. balance is a cached projection of the
-- ledger, only ever changed inside RPCs alongside a ledger insert.
create table if not exists public.credit_accounts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null unique references public.customers(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  credit_limit  numeric(14,2) not null default 0 check (credit_limit >= 0),
  balance       numeric(14,2) not null default 0,   -- positive = customer owes
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_credit_accounts_store on public.credit_accounts(store_id);

-- Append-only credit ledger. balance_after snapshots the account balance.
create table if not exists public.credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null references public.credit_accounts(id) on delete cascade,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  txn_type        app.credit_txn_type not null,
  amount          numeric(14,2) not null,           -- signed: + increases debt
  balance_after   numeric(14,2) not null,
  reference_table text,
  reference_id    uuid,
  note            text,
  performed_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_credit_txn_account on public.credit_transactions(credit_account_id, created_at desc);

-- ---------------- Goods Out (sales) ----------------
create table if not exists public.goods_out (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  store_id       uuid not null references public.stores(id) on delete cascade,
  sale_type      app.sale_type not null,
  customer_id    uuid references public.customers(id) on delete set null,
  total_amount   numeric(14,2) not null default 0,
  credit_override boolean not null default false,   -- limit override used?
  note           text,
  performed_by   uuid references auth.users(id) on delete set null,
  authorized_by  uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint credit_requires_customer
    check (sale_type <> 'CREDIT' or customer_id is not null)
);
create index if not exists idx_goods_out_store on public.goods_out(store_id, created_at desc);
create index if not exists idx_goods_out_customer on public.goods_out(customer_id);

create table if not exists public.goods_out_items (
  id            uuid primary key default gen_random_uuid(),
  goods_out_id  uuid not null references public.goods_out(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete restrict,
  quantity      numeric(14,3) not null check (quantity > 0),
  unit_price    numeric(14,2) not null check (unit_price >= 0),
  line_total    numeric(14,2) not null default 0
);
create index if not exists idx_goods_out_items_header on public.goods_out_items(goods_out_id);

-- ---------------- Stock Adjustments ----------------
create table if not exists public.stock_adjustments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  reason          app.adjustment_reason not null,
  quantity_before numeric(14,3) not null,
  quantity_after  numeric(14,3) not null,
  delta           numeric(14,3) not null,
  note            text,
  performed_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_adjustments_store on public.stock_adjustments(store_id, created_at desc);
create index if not exists idx_adjustments_product on public.stock_adjustments(product_id);

-- ---------------- Stock Take ----------------
create table if not exists public.stock_takes (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  status        app.stock_take_status not null default 'IN_PROGRESS',
  note          text,
  started_by    uuid references auth.users(id) on delete set null,
  approved_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists idx_stock_takes_store on public.stock_takes(store_id, created_at desc);

create table if not exists public.stock_take_items (
  id             uuid primary key default gen_random_uuid(),
  stock_take_id  uuid not null references public.stock_takes(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete restrict,
  system_qty     numeric(14,3) not null default 0,
  counted_qty    numeric(14,3),
  variance       numeric(14,3),
  counted        boolean not null default false,
  unique (stock_take_id, product_id)
);
create index if not exists idx_stock_take_items_header on public.stock_take_items(stock_take_id);

-- ---------------- Supplier invoices ----------------
create table if not exists public.supplier_invoices (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  supplier_id   uuid references public.suppliers(id) on delete set null,
  goods_in_id   uuid references public.goods_in(id) on delete set null,
  reference     text,
  amount        numeric(14,2) not null default 0,
  invoice_date  date,
  created_at    timestamptz not null default now()
);
create index if not exists idx_supplier_invoices_supplier on public.supplier_invoices(supplier_id);

-- ---------------- Audit log ----------------
create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete set null,
  actor_id     uuid references auth.users(id) on delete set null,
  action       text not null,                       -- e.g. 'goods_out.complete'
  entity_type  text,
  entity_id    uuid,
  before_data  jsonb,
  after_data   jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_business on public.audit_logs(business_id, created_at desc);
create index if not exists idx_audit_entity on public.audit_logs(entity_type, entity_id);

-- Touch triggers
drop trigger if exists trg_customers_touch on public.customers;
create trigger trg_customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();
drop trigger if exists trg_credit_accounts_touch on public.credit_accounts;
create trigger trg_credit_accounts_touch before update on public.credit_accounts
  for each row execute function app.touch_updated_at();
drop trigger if exists trg_stock_takes_touch on public.stock_takes;
create trigger trg_stock_takes_touch before update on public.stock_takes
  for each row execute function app.touch_updated_at();

-- Append-only ledgers: block UPDATE/DELETE on credit_transactions.
drop trigger if exists trg_credit_txn_no_update on public.credit_transactions;
create trigger trg_credit_txn_no_update before update or delete on public.credit_transactions
  for each row execute function app.block_mutation();
