# Architecture

Spaza ISM is a server-rendered Next.js app talking directly to Supabase
(PostgreSQL + Auth). There is **no custom API tier** — the security boundary is
the database itself (RLS + `SECURITY DEFINER` RPCs), so the app can use the
Supabase client directly from React Server Components and the browser without
ever trusting the client for authority.

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React 19)                                            │
│   • Client Components: scan consoles, dialogs, TanStack Query  │
│   • Supabase browser client (publishable key)                  │
└───────────────┬───────────────────────────┬──────────────────┘
                │ cookie session             │ RPC / REST (RLS)
┌───────────────▼───────────────┐            │
│  Next.js server (RSC + MW)     │            │
│   • middleware: refresh + gate │            │
│   • Server Components: reads    │           │
│   • Supabase server client      │           │
└───────────────┬────────────────┘            │
                │ SQL over the wire (RLS)      │
┌───────────────▼──────────────────────────────▼──────────────┐
│  Supabase / PostgreSQL                                        │
│   • RLS on every table (tenant isolation, role gating)        │
│   • SECURITY DEFINER RPCs (atomic stock/credit mutations)     │
│   • Append-only ledgers + audit_logs                          │
│   • Auth (GoTrue): email/password sessions                    │
└───────────────────────────────────────────────────────────────┘
```

## Why the database is the security boundary

The publishable/anon key is shipped to the browser, so anything the browser can
do, an attacker can do. That is safe here because:

- **RLS is on for every table.** A request only ever sees rows for businesses the
  signed-in user is an active member of. Cross-tenant reads/writes are impossible
  regardless of what the client sends.
- **Authoritative mutations are RPCs, not table writes.** Stock, credit balances,
  ledgers and transactions are **SELECT-only** for the `authenticated` role. The
  only way to change them is to call an RPC, and each RPC re-derives authority
  from `auth.uid()` + the caller's role — never from client-supplied values.
- **No service-role key exists in the app.** There is no privileged code path to
  abuse; even the server components run as the signed-in user.

## Request lifecycle

1. **Middleware** (`src/middleware.ts` → `lib/supabase/middleware.ts`) refreshes
   the auth session on every request and redirects unauthenticated users to
   `/login` (preserving `?next=`).
2. **`(app)` layout** loads the session via `getSession()`
   (`lib/session.ts`): the user's accessible stores (with per-business role) and
   the active store (from the `sism_store` cookie). No stores → `/onboarding`.
3. **`StoreProvider`** (`lib/store-context.tsx`) exposes `{ store, stores, role,
   currency, setStore, can() }` to client components.
4. **Reads** happen in Server Components (fast, cached, RLS-scoped) or via
   TanStack Query in client components for interactive lists.
5. **Writes** are always `supabase.rpc(...)` calls; the RPC does the atomic work
   and returns; the client shows a toast and calls `router.refresh()`.

## Tenancy model

```
Business ──< Store ──< Products ──< Stock / Batches / Barcodes
   │            │         └─────────< Stock Movements (ledger)
   │            ├──< Customers ──< Credit Account ──< Credit Txns (ledger)
   │            ├──< Goods In / Goods Out (+ items)
   │            └──< Adjustments / Stock Takes / Supplier Invoices
   └──< Memberships (user × business × role)
```

MVP: a membership grants access to **all stores** in its business. The schema is
already store-scoped, so per-store access lists and multi-store transfers are an
additive change, not a rewrite.

## Frontend structure

- `src/app/(app)/…` — authenticated pages. Server Components by default; each
  workflow's interactivity lives in a client "console" under `src/features/…`.
- `src/components/ui` — shadcn-style primitives on Radix.
- `src/components/shell` — sidebar, topbar, page header, global search.
- `src/features/<workflow>` — one folder per business workflow.
- `src/lib` — Supabase clients, session, formatting, generated DB types.

## Stock & credit engine

See [DATABASE.md](DATABASE.md) for the table + RPC reference. The core
invariant: **`stock.quantity` is always reconcilable against
`sum(stock_movements.quantity_delta)`**, and every credit balance is the running
sum of its `credit_transactions`. `reconcile_stock()` proves the former at any
time; the append-only ledgers guarantee neither can silently drift.

## Concurrency

Sales and adjustments `SELECT … FOR UPDATE` the stock row before changing it, so
concurrent transactions serialize on that row. A `CHECK (quantity >= 0)`
constraint is the final backstop against overselling. Two tills selling the last
units cannot both succeed — the second blocks, then fails cleanly with
`INSUFFICIENT_STOCK`.
