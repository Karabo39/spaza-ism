# Handover to Codex — Spaza ISM, BRD v1.02

**Date:** 2026-09-06
**From:** Karabo (owner) via Claude Code
**Source of truth for scope:** [`docs/POS_INVENTORY_BRD_V1.02.docx`](POS_INVENTORY_BRD_V1.02.docx)
**Read these first, in order:** [`AGENTS.md`](../AGENTS.md) → [`README.md`](../README.md) → [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) → [`docs/DATABASE.md`](DATABASE.md) → [`docs/DECISIONS.md`](DECISIONS.md) → [`docs/OFFLINE.md`](OFFLINE.md) → [`docs/DEPLOYMENT.md`](DEPLOYMENT.md)

---

## 0. Ground rules (do not skip)

1. **`AGENTS.md` is real.** This repo runs a Next.js build whose APIs may differ from
   your training data. Before writing any Next.js code, read the relevant guide under
   `node_modules/next/dist/docs/`. Do not fight the auto-generated agent block in
   `AGENTS.md`; commit it with your work if it reappears.
2. **The database is the integrity boundary, not the UI.** Stock levels and customer
   balances are **derived from append-only ledgers** via SQL RPCs and read models —
   never by the frontend doing `UPDATE stock SET qty = ...`. Every new feature that
   moves stock or money MUST go through a `SECURITY DEFINER` RPC + a migration, with
   RLS covering the new tables. See [`DATABASE.md`](DATABASE.md) and
   [`DECISIONS.md`](DECISIONS.md).
3. **Migrations are numbered and immutable.** Current head is
   `supabase/migrations/0012_perf.sql`. Add new migrations as `0013_*`, `0014_*`, …
   Never edit an already-applied migration; write a new one.
4. **Multi-tenant + RLS by default.** Everything is scoped by `business_id` and
   `store_id`. Any new table needs RLS policies mirroring the existing ones, or it is a
   data leak between businesses.
5. **Keep CI green on every PR:** `npm run typecheck && npm run lint && npm run test && npm run build`.
   Add unit tests for new RPC-backed logic; add an entry to `supabase/tests/rpc_integration.sql`
   for any new money/stock RPC.
6. **Offline/PWA is a shipped feature, not an afterthought** — see [`OFFLINE.md`](OFFLINE.md).
   New write flows that a cashier uses on the floor (Goods Out, Goods Return, transfers)
   must respect the existing offline-queue pattern or explicitly be marked online-only.

---

## 1. What already exists (BRD v1.0 — built and working)

App routes under `src/app/(app)/`:
`goods-in`, `goods-out`, `check-price`, `check-stock`, `credit`, `expiry`,
`low-stock`, `products`, `reports`, `suppliers`, `stock-take`, `adjust`, `audit`,
`users`, `settings`. Plus auth (`login`, `signup`, `onboarding`, `auth/callback`,
`auth/confirm`).

Backend: migrations `0001–0012` covering tenancy, catalog, stock ledger,
transactions, RLS, RPCs, read models, report RPCs, members, perf indexes.

Stack: Next.js (App Router), Supabase (Postgres + Auth + RLS), TanStack Query +
Table, react-hook-form + zod, Radix UI, Tailwind, `@zxing` for camera scanning,
`idb` for the offline queue. Publishable/anon key only on the client — **no
service-role key anywhere in the app.**

---

## 2. What v1.02 ADDS (the actual work)

The BRD is largely additive. Treat these as epics. Ship them behind the new
navigation in BRD §11 and keep everything role-gated (BRD §14).

### Epic A — Multi-store + Warehouse foundation (do this first; everything else depends on it)
- Multi-store is now **mandatory** (BRD §12 explicitly upgrades it). A business has
  many stores; a **warehouse** is a distinct stock location, not a saleable store.
- Stock is now **per (product, location)** where location ∈ {store, warehouse}.
  Warehouse stock is **not** part of any store's saleable stock or store stock-take
  until transferred in. This likely changes the `stock` read model — plan the
  migration carefully and back-fill existing single-store businesses to one default store.
- **Role → store scoping:** Owner/Admin = all stores in the business; Manager/Standard
  = only assigned stores. Enforce in RLS **and** RPC validation, not just the UI.

### Epic B — Operations window (BRD §6.5.1 / §6.5.2)
- One "Operations" area containing: **Warehouse Stock**, **Transfer Stock**,
  **Receive Transfer**, **Unpack Bulk Stock**.
- **Transfers** have a lifecycle: `Draft → Submitted → Dispatched → Received → Cancelled`.
  Unique transfer reference; **linked** source-decrease + destination-increase stock
  movements sharing that reference; stock only lands at destination when
  completed/received. Validate source qty, permissions, and business ownership before submit.
- **Bulk unpacking:** each pack product carries a conversion (e.g. 1×6-pack = 6 units).
  Unpacking 1 six-pack ⇒ pack stock −1, unit stock +6, in **one linked** transaction.
  Block when insufficient bulk unless authorized override. Record source/destination
  item, ratio, qty, user, timestamp, reason.
- Goods In (BRD §6.5) now requires a **destination: Main Shop or Warehouse**, stored on
  the transaction and shown in movement history/reports. Fix the qty stepper to count in
  whole units (1,2,3 — not 1.001).

### Epic C — Orders → Invoicing → Payments → Returns (BRD §6.6.1, §6.7.1, §6.7.2, tables 1)
This is the biggest new area. Model it as proper linked ledgers, not status columns on one row.
- **Orders:** capture customer + lines, generate unique order number, confirm.
- **Invoicing:** invoice generated from a confirmed order. Statuses
  `Draft → Issued → Unpaid → Partially Paid → Paid`, plus `Overdue / Cancelled / Void / Credited`.
  Full/partial/multiple payments per invoice. `Outstanding = Total − Payments − Credit Notes`.
  Payment method captured (Cash / Card-EFT / Credit). Receipts/proof-of-purchase with
  salesperson. Dashboard totals (invoiced, paid, outstanding, overdue, credit notes, MTD).
  Credit notes, debit notes, adjustments, monthly reconciliation, ageing/statements.
  **Issued/posted invoices must never be hard-deleted** — corrections are notes, not edits.
- **Goods Return / Credit Note (§6.7.1):** mandatory reason, condition/inspection,
  inventory action (return-to-stock / quarantine / supplier-return / write-off), approval
  where enabled, credit note linked to original invoice, correct inventory movement,
  refund/store-credit record + refund report. For credit customers, reduce outstanding.

### Epic D — Payment types + Card/EFT (BRD §6.6, §13.2)
- Goods Out gains **Card/EFT** alongside Cash and Credit. Card/EFT decreases stock, creates
  **no** customer debt, but IS recorded for reconciliation against the speed-point/card slip.
- New **Payment Report** splitting Cash / Card-EFT / Credit.

### Epic E — Credit management upgrades (BRD §6.7)
- **Override code** setting: managers/admins enter a PIN/code to override credit limits
  for standard users. Needs a Settings config + an audited override path.
- Statements exportable to Excel/PDF/Email; sortable/filterable by status.
- Credit ledger display sign convention (BRD §10.3): payment shows as **+R (green)**,
  credit taken as **−R**.

### Epic F — Reports, exports, notifications (BRD §6.14, §13.1)
- Many new reports (warehouse stock, transfers, unpacking, payment, valuation,
  fast/slow movers, price history). Every report: a one-line description + Excel/PDF/Email export.
- **Scheduled notification emails** to Owner/Manager: Out of Stock, Upcoming Expiry,
  Stock Take Completed, Low Stock, Weekly Profit, Overdue Invoice Summary. This needs a
  server-side scheduler (Supabase cron / Edge Function) that reads live data at send time —
  design where secrets live (this is the one place a service-role/Edge context is acceptable,
  **never** in the browser).

### Epic G — Imports + UX polish (BRD §7, §6.1)
- Excel import for **Products** (create + update qty), **Suppliers**, **Credit Customers**
  to a defined template/format.
- Global **back button** on every page; **logo → home**.
- Barcode copy on the product screen; status-column filters on stock/credit lists.
- Store logo upload (top-left) per business (BRD table 2).

### Note on BRD §6.1 ("Authentication … To be removed for the new system")
This line is ambiguous. **Do not delete working auth.** Confirm with Karabo whether it
means "auth is already solved, don't re-spec it" (most likely) or an actual auth rework.
Flag, don't guess.

---

## 3. Suggested build order

1. **Epic A** (multi-store + warehouse data model + migration + RLS) — foundational.
2. **Epic B** (Operations: transfers + unpacking + Goods In destination).
3. **Epic D** (Card/EFT payment type) — small, unblocks payment reports.
4. **Epic C** (Orders/Invoicing/Returns) — largest; can be phased Orders → Invoices → Payments → Returns.
5. **Epic E** (credit overrides + statements).
6. **Epic F** (reports + scheduled emails).
7. **Epic G** (imports + UX polish) — parallelizable throughout.

Ship each epic as its own PR (or a small stack), migrations included, CI green, with a
short note in `docs/DECISIONS.md` for any non-obvious modeling choice.

---

## 4. Definition of done (per feature)

- [ ] Migration added (`00NN_*.sql`), RLS on every new table, RPCs `SECURITY DEFINER`.
- [ ] Stock/money changes are ledger-derived and reconcilable (no direct qty writes).
- [ ] Role/store permissions enforced in DB, not just UI.
- [ ] Unit tests + an `rpc_integration.sql` case for money/stock RPCs.
- [ ] `typecheck`, `lint`, `test`, `build` all pass.
- [ ] Offline behaviour decided (queued or explicitly online-only).
- [ ] Audit trail entry (who/what/when/why) for every sensitive action.

---

## 5. Environment / deployment context (see DEPLOYMENT.md)

- DB: Supabase (live project ref recorded in Claude memory / Karabo has it).
- App: Vercel, Next.js preset. Client env vars only:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Custom domain is being added on Vercel (see the deploy notes Karabo will share). When
  the domain changes, **Supabase Auth → Site URL + Redirect URLs must be updated to the
  new domain**, or email confirmation / password reset links break.
- Go-live checklist and backups: see [`DEPLOYMENT.md`](DEPLOYMENT.md) §4–5.

---

## 6. Open questions to confirm with Karabo before/while building

1. §6.1 auth "to be removed" — clarify intent (assume: keep current auth).
2. Warehouse count per business — one warehouse, or many?
3. Tax handling — the BRD marks tax "optional/configurable". In or out of MVP?
4. Email delivery provider for notifications (Resend / Supabase SMTP / other?).
5. Currency/locale is ZAR (R) — confirm formatting + rounding rules for money.
