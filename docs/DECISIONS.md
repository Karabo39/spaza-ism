# Requirements interrogation & design decisions

The BRD is a business document, not a technical spec. This records the
ambiguities, gaps and risks found while reading it critically, and the safe,
production-minded interpretation chosen for each. Where the BRD was silent or
contradictory, the most reliable option for an inventory system was taken.

## Ambiguities & chosen interpretations

1. **“Automatically decrease stock when sold” vs. negative stock.**
   §6.6 says prevent negative stock “unless an authorized override is enabled.”
   Decision: the sale RPC hard-blocks overselling via a `quantity >= 0` CHECK +
   row lock (the safe default). A negative-stock override was deferred rather
   than shipped, because allowing it casually undermines the ledger; it can be
   added later as an explicit, audited manager action.

2. **Selling price authority.** §6.6 says the system calculates value from the
   configured selling price, but operators sometimes discount at the till.
   Decision: the RPC computes every line total and the sale total server-side; a
   per-line `unit_price` may be supplied (for discounts) but is never trusted for
   arithmetic. The browser can never dictate the total.

3. **Expiry placement.** §6.12 mentions “expiry dates or batches.” Putting an
   expiry on the product is wrong when stock arrives in multiple batches.
   Decision: a `stock_batches` table keyed by product+store+expiry, enabled per
   product via `track_expiry`. Authoritative quantity still lives in `stock`.

4. **Customer / product store-scoping.** The BRD treats one shop as the norm but
   asks for multi-store readiness. Decision: products, stock, customers and
   credit are **store-scoped**; a membership grants access to all stores in the
   business (MVP). This keeps isolation simple now and multi-store-ready later.

5. **Credit overpayment.** The BRD supports partial payments but is silent on
   paying more than owed. Decision: allow it (balance may go negative = credit in
   the customer’s favour), which matches real spaza behaviour (prepayment).

6. **“Stock check and fix” (§6.9).** Interpreted as reconciliation: the
   `reconcile_stock` RPC recomputes quantities from the ledger and reports any
   drift; genuine corrections go through the audited `adjust_stock` path rather
   than silently overwriting.

7. **Roles.** The BRD names Owner/Admin, Manager, Employee. Decision: a
   three-level hierarchy `owner > manager > employee`. Employees do daily ops
   (goods in/out, lookups, create products/customers); managers add adjustments,
   stock-take approval, reports, audit; owners add user management and business
   settings.

## Risks addressed

- **Data integrity / partial writes** — every multi-step operation is a single
  PL/pgSQL transaction; any failure rolls the whole thing back.
- **Concurrency (two tills, same item)** — `SELECT … FOR UPDATE` on the stock
  row serialises writers; the CHECK constraint prevents overselling. Verified by
  the credit-limit and insufficient-stock assertions in the SQL test.
- **Client-controlled stock/credit/prices** — impossible: those tables are
  SELECT-only for clients; only `SECURITY DEFINER` RPCs write them.
- **Tenant leakage / IDOR** — RLS on every table; helper functions are
  `SECURITY DEFINER` with pinned `search_path`. Cross-tenant access is denied at
  the database. Verified by the isolation assertions.
- **Service-role exposure** — the app ships only the publishable key; no secret
  key exists in the frontend or environment.
- **Silent deletion of history** — ledgers are append-only (trigger + no client
  write policies); products deactivate rather than delete and remain visible in
  historical transactions.

## Deliberately deferred

- **Offline-first / PWA.** Shipped as a **safe cache + outbox**, not an
  independent offline ledger: the app installs and runs offline, scans/looks up
  products from a local mirror, and captures **cash** sales to a local queue that
  replays through the authoritative `complete_sale` RPC on reconnect (conflicts
  surface for review, never silently corrupt stock). Credit sales, Goods In and
  adjustments intentionally still require a connection. Full offline coverage
  (credit offline, background sync) is a later phase. See
  [OFFLINE.md](OFFLINE.md).
- **Email-based user invitations.** Adding a teammate requires them to have
  signed up first; the owner then adds them by email (`add_member_by_email`).
  True invite emails need a mailer/edge function and are future work.
- Negative-stock override, multi-store transfers, WhatsApp/SMS, OCR invoices,
  subscription billing — all listed as BRD “future enhancements.”

## Advisor note

Supabase’s security advisor flags the workflow RPCs as
`authenticated_security_definer_function_executable`. This is **by design**:
they must be callable by signed-in users and each authorises internally
(`auth.uid()` + role/store checks). All other advisor findings (mutable
search_path, extension-in-public, anon-executable functions) were remediated in
migrations `0007`–`0008`.
