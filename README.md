# Spaza ISM — Inventory Management System

A production-oriented, multi-tenant SaaS for **spaza shops, village shops and
small community retailers** to manage stock and customer credit quickly and
reliably. Built to be operated fast by a shop employee with limited technical
experience: **scan stock in, scan stock out, check stock, check price, manage
credit** — with a database that guarantees stock and credit integrity.

## Highlights

- **Stock integrity by design.** The frontend never writes stock or credit
  balances. Every mutation goes through `SECURITY DEFINER` PostgreSQL RPCs that
  run atomically, take row locks, write an **append-only ledger**, and record
  an audit trail. Current stock is always reconcilable against the ledger.
- **Multi-tenant with enforced isolation.** `business → store` hierarchy with
  PostgreSQL **Row Level Security**. Tenant isolation is enforced in the
  database, not the client.
- **Scan-first UX.** USB keyboard-wedge scanners work out of the box (scan →
  Enter → next). Unknown barcodes prompt product registration inline.
- **Roles.** `owner` > `manager` > `employee`. Adjustments, credit-limit
  overrides, stock-take approval and user management are gated in the RPCs and
  in RLS — not just the UI.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4 |
| UI | shadcn-style components on Radix primitives, Lucide icons, TanStack Query/Table, React Hook Form + Zod, sonner |
| Backend | Supabase — PostgreSQL, Auth, RLS, `SECURITY DEFINER` RPCs |
| Testing | Vitest (unit), Playwright (E2E), SQL integration harness |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + publishable key
npm run dev                  # http://localhost:3000
```

### Environment

Only two public values are needed (both safe to expose — the publishable key
only grants what RLS allows). **The service-role/secret key is never used in
this app**; all privileged actions run through RPCs as the signed-in user.

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```

### Database

Migrations live in [`supabase/migrations`](supabase/migrations) and are numbered
in apply order (`0001` → `0011`). Apply them to a clean database via the
Supabase CLI (`supabase db push`) or by running each file in order. They are
idempotent where practical.

Schema overview:

- **Tenancy:** `businesses`, `stores`, `profiles`, `memberships`
- **Catalog:** `categories`, `suppliers`, `products`, `product_barcodes`, `price_history`
- **Stock:** `stock` (current state), `stock_batches` (expiry), `stock_movements` (append-only ledger)
- **Transactions:** `goods_in`/`goods_in_items`, `goods_out`/`goods_out_items`
- **Credit:** `customers`, `credit_accounts`, `credit_transactions` (append-only ledger)
- **Control:** `stock_adjustments`, `stock_takes`/`stock_take_items`, `supplier_invoices`, `audit_logs`

Authoritative operations (all atomic, all audited):

`create_business` · `create_product` · `receive_stock` · `complete_sale`
(cash/credit) · `record_credit_payment` · `set_credit_limit` · `adjust_stock`
· `start_stock_take` / `complete_stock_take` · `reconcile_stock` ·
`add_member_by_email` · read-models `dashboard_summary`, `customer_statement`,
`product_sales_summary`, views `v_product_stock`, `v_credit_customers`.

## Security model

- RLS is enabled on **every** table. Members can read their business/store data;
  reference tables (products, customers, suppliers, categories, barcodes) are
  member-writable; **stock, credit, ledger and transaction tables are
  SELECT-only for clients** — they are written exclusively by the RPCs.
- RPCs are `SECURITY DEFINER` with a pinned `search_path`, verify `auth.uid()`
  and role/store access internally, and are revoked from `anon`/`public`
  (only `authenticated` may call them).
- Ledgers (`stock_movements`, `credit_transactions`) are append-only, enforced
  by a trigger **and** by the absence of client UPDATE/DELETE policies.
- Concurrency: sales/adjustments take `SELECT … FOR UPDATE` on the stock row and
  a `quantity >= 0` CHECK prevents overselling under concurrent transactions.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest unit tests
npm run build       # production build

# Database integration (simulates 3 users, exercises every RPC + RLS,
# then rolls back). Expect it to end with: ERROR ... TESTS_PASSED
psql "$DATABASE_URL" -f supabase/tests/rpc_integration.sql

# E2E (one-time browser install first)
npx playwright install chromium
npm run test:e2e
```

The database engine was verified live: onboarding, tenant isolation, atomic
goods-in, cash & credit sales, credit-limit blocking (with no state leakage),
manager override, partial payment, insufficient-stock blocking, manager-only
adjustment, ledger⇄stock reconciliation, append-only ledger, duplicate-barcode
rejection, and employee authorization limits all pass.

## Demo account (development only)

A confirmed demo owner exists for evaluation:

- **demo@spazaism.co.za** / **Demo1234!**

⚠️ **Remove before production go-live:**
`delete from auth.users where email = 'demo@spazaism.co.za';`

## Roadmap (deferred, per BRD “future enhancements”)

Multi-store transfers, WhatsApp/SMS statements & low-stock alerts, purchase-order
generation, OCR invoice capture, offline-first sync, subscription billing.
Offline was intentionally deferred rather than shipped as an unsafe offline
ledger — see [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Project structure

```
src/
  app/(app)/…        authenticated pages (dashboard + workflows)
  app/login, signup, onboarding
  components/ui       shadcn-style primitives
  components/shell    sidebar, topbar, page header, search
  features/…          one folder per workflow (goods-in, goods-out, credit, …)
  lib/                supabase clients, session, formatting, types
supabase/migrations   ordered SQL migrations
supabase/tests        SQL integration harness
tests/unit, tests/e2e Vitest + Playwright
```
