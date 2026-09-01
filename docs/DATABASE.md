# Database reference

PostgreSQL on Supabase. Migrations live in [`../supabase/migrations`](../supabase/migrations),
numbered in apply order. Everything below is created by those migrations.

## Schemas

- **`public`** — application tables, views, and the callable RPCs.
- **`app`** — private helper functions used by RLS and RPCs (not exposed via the
  API surface directly; `SECURITY DEFINER`, pinned `search_path`).
- **`extensions`** — `pgcrypto`, `citext` (moved out of `public` per advisor).

## Tables

### Tenancy
| Table | Purpose |
|---|---|
| `businesses` | The SaaS customer (a shop-owning business). |
| `stores` | A physical shop/branch under a business. |
| `profiles` | App profile mirror of `auth.users` (name, phone). |
| `memberships` | user × business × role (`owner`/`manager`/`employee`), `is_active`. |

### Catalog
| Table | Purpose |
|---|---|
| `categories` | Product grouping (per business). |
| `suppliers` | Suppliers (per business). |
| `products` | Store-scoped product: prices, min/reorder levels, `track_expiry`, `is_active`. |
| `product_barcodes` | Multiple barcodes per product; **unique active barcode per store** (partial unique index). |
| `price_history` | Auto-logged on any cost/selling change (trigger). |

### Stock
| Table | Purpose |
|---|---|
| `stock` | Authoritative current quantity per product+store. `CHECK (quantity >= 0)`. |
| `stock_batches` | Expiry batches (when `track_expiry`). |
| `stock_movements` | **Append-only ledger.** Signed delta + before/after snapshot + type + reference + user. |

### Transactions & credit
| Table | Purpose |
|---|---|
| `goods_in` / `goods_in_items` | Receiving header + lines. |
| `goods_out` / `goods_out_items` | Sale header (cash/credit, override, authorizer) + lines. |
| `customers` | Credit customers (per store). |
| `credit_accounts` | One per customer: `credit_limit`, cached `balance`. |
| `credit_transactions` | **Append-only ledger** of `CREDIT_SALE`/`PAYMENT`/`ADJUSTMENT` with `balance_after`. |

### Control & audit
| Table | Purpose |
|---|---|
| `stock_adjustments` | Authorized corrections (reason, before/after, delta). |
| `stock_takes` / `stock_take_items` | Counting sessions; variances applied on completion. |
| `supplier_invoices` | Invoice/reference captured during receiving. |
| `audit_logs` | Important actions (actor, action, entity, before/after JSON). |

Append-only ledgers (`stock_movements`, `credit_transactions`) are enforced by a
`BEFORE UPDATE OR DELETE` trigger **and** by the absence of any client
UPDATE/DELETE RLS policy.

## Views (`security_invoker`, RLS-respecting)

- **`v_product_stock`** — product joined to current stock, category/supplier
  names, computed `stock_status` (`out`/`low`/`reorder`/`ok`), stock/retail
  value, and `suggested_reorder`. Powers Check Stock, Products, Low Stock, Reports.
- **`v_credit_customers`** — customer + credit account with `available_credit`
  and `over_limit`. Powers Credit screens and the credit report.

## RPCs (all `SECURITY DEFINER`, `authenticated`-only, self-authorizing)

| Function | Role required | What it does (atomically) |
|---|---|---|
| `create_business(name, store_name)` | any signed-in | Business + owner membership + first store. |
| `create_product(store, name, barcode, …)` | store member | Product + optional barcode + zero stock row. |
| `receive_stock(store, supplier, ref, note, items[])` | store member | Goods-in header/items, stock ↑, ledger, price update, batches, invoice, audit. |
| `complete_sale(store, type, customer, items[], override, note)` | store member (override → manager+) | Goods-out header/items, stock ↓ (guarded), credit ledger if credit, audit. |
| `record_credit_payment(customer, amount, note)` | store member | Payment ledger entry, balance ↓. **Never touches stock.** |
| `set_credit_limit(customer, limit)` | manager+ | Update credit limit (audited). |
| `adjust_stock(store, product, new_qty, reason, note)` | manager+ | Adjustment record + guarded movement + audit. |
| `start_stock_take(store, note)` | store member | Session + snapshot of active products. |
| `complete_stock_take(id)` | manager+ | Apply per-item variances as adjustments+movements; mark completed. |
| `add_member_by_email(business, email, role)` | owner | Add an existing account to the business. |
| `reconcile_stock(store)` → rows | store member | Compare `stock` vs ledger sum (drift check). |
| `dashboard_summary(store)` → json | store member | Counters for the dashboard in one call. |
| `customer_statement(customer)` → rows | store member | Full credit ledger with running balance. |
| `product_sales_summary(store, from, to)` → rows | store member | Sold qty/value per product (fast/slow-moving). |

Internal helpers in `app`: `apply_stock_delta` (the movement primitive — lock,
validate, update, append), `audit`, `is_business_member`, `has_business_role`,
`has_store_access`, `has_store_role`, `business_role`, `shares_business`.

## RLS model (summary)

| Table group | SELECT | INSERT/UPDATE |
|---|---|---|
| businesses / stores / memberships | members | owner/manager (per action) |
| categories / suppliers / products / barcodes / customers | members | members |
| stock / batches / movements / goods_in(_items) / goods_out(_items) / credit_accounts / credit_transactions / adjustments | members (store) | **none — RPC only** |
| stock_takes(_items) | members (store) | members (finalize gated in RPC) |
| audit_logs | manager+ | — (written by RPC/trigger) |

## Enums (`app` schema)

`membership_role`, `movement_type`, `sale_type`, `adjustment_reason`,
`credit_txn_type`, `stock_take_status`.

## Regenerating TypeScript types

After changing the schema, regenerate `src/lib/db/database.types.ts` from the
Supabase types (CLI: `supabase gen types typescript`) and re-add the hand-written
view/enum helper types at the bottom of that file.
