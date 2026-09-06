# Requirements interrogation & design decisions

## BRD v1.02 foundation (0013)

These decisions supersede the v1.0 all-store access assumption below.

- **Stable location identity.** `stores` now represents physical stock locations,
  distinguished by `location_type = store | warehouse`. Keeping the existing
  IDs means historical receiving, stock takes, stock balances and append-only
  ledgers do not need rewriting. A warehouse has its own product catalog, stock
  and stock take; `goods_out` rejects warehouse locations in the database.
  Existing store-scoped product IDs remain distinct. Transfers must explicitly
  map source and destination products; do not merge products by name or barcode.
- **Roles and assignments.** The existing `owner` role represents Owner/Admin;
  `employee` represents Standard User. Owners can access all active locations
  within their business. Managers and employees need explicit
  `store_memberships` entries, including warehouses. Both RLS and RPC role
  helpers enforce assignments. Global business stock summaries are owner-only.
- **Upgrade without guessing.** Existing single-active-store businesses retain
  their store and their staff access through an assignment backfill. For a
  business with multiple active stores, the owner must assign staff locations
  before staff resume work. New memberships start with no location access.
  There is no automatic assignment to future stores or warehouses.
- **Warehouse count.** The model permits multiple warehouses. No warehouse is
  created automatically, and no existing store becomes a warehouse. The owner
  chooses which physical locations to create in Settings. Location type cannot
  be changed after creation through the app.
- **Online management.** Location creation, assignments and switching locations
  require a connection. Existing cash-sale queues still use their original
  store IDs and RPC validation. Rejected replay after access removal remains
  available for review. Switching locations remounts workflow forms so a cart
  cannot silently migrate to a different location.
- **Authentication retained.** BRD §6.1 does not authorize removing working
  authentication. Existing business members without assignments see an access
  message, not a new-business setup form. Tax, email delivery provider and any
  change to existing ZAR rounding remain open decisions for later epics.

Migration 0013 was tested on an isolated local PostgreSQL database, including
upgrade backfill, ledger preservation, authenticated allow/deny paths and
cross-business isolation. It has not been applied to the live Supabase project.

## BRD v1.02 Operations (0014–0016)

Transfers explicitly map the same physical product in two location catalogs,
requiring matching units and expiry tracking. Drafts and submitted transfers
do not reserve stock; dispatch rechecks and removes it under stock-row locks.
Receipt adds stock at the destination. Cancellation before receipt requires a
reason and restores dispatched quantities to the source. Request IDs make
creation retries safe; repeated dispatch/receipt/cancel cannot post twice.
Both locations must remain accessible to the caller at every stage.

Expiry allocations travel with a transfer and are restored if cancelled.
Insufficient recorded expiry batches block dispatch/unpacking so dates cannot
silently disappear. Managers configure pack ratios; any assigned user can
unpack. The unpacking ledger stores the ratio used at posting time. Units stay
at the pack's location. Negative-stock overrides are not enabled. Current unit
cost follows pack cost divided by the ratio, following Goods In's last-cost
valuation convention; historical movement costs remain in the ledger.

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
# BRD v1.02 payment and credit decisions

Card/EFT is a record of an externally completed payment; the application does not
charge a card. Cash outbox identifiers are passed to the same sale RPC to cover
the case where a server committed before its response was lost. Reusing an ID
with different sale content is rejected.

Credit codes are personal to each manager and stored as bcrypt hashes in the
private app schema. Approval returns a single-use token scoped to cashier,
location, customer and maximum amount, with two-minute expiry. Failed-code
counters return a denial result so the counter commits rather than rolling back.
These online-only approvals preserve current direct manager authorization.
# BRD v1.02 invoice and return ledgers

Orders and issued invoice snapshots are separate from append-only financial
entries. Issuing an invoice creates a customer receivable but does not release
stock. Cash/Card-EFT terms require full settlement before release; credit terms
check the complete current customer balance and support audited manager approval.
Invoice payment method CREDIT means allocated return credit; an unpaid credit
arrangement is never recorded as cash received.

Invoices allocate their discounted, tax-inclusive total across line snapshots
using differences of rounded cumulative values. Returns credit this allocated
value. Pending returns reserve quantities until approved or rejected.

Refunds settle available account credit; they are separate cash flows and do not
reopen an invoice as customer debt. Store-credit allocation moves credit between
invoices with paired entries. For checkout returns without a named customer, the
return reference serves as the store-credit record and may be allocated to an
invoice in the same location.

Return actions other than return-to-stock never increase saleable stock. A later
manager inspection can clear an entire quarantined line to stock, send it to the
supplier or write it off. Tax defaults to zero and is configurable by the owner.
Return approval defaults to required.

## BRD v1.02 imports, branding and shortage approval

Excel imports are online-only and require a manager at the selected location.
Products match by ID or active barcode; suppliers and customers match by ID.
Blank cells preserve values. Quantity means the new total on hand. Previews run
the same database changes inside a rolled-back transaction. Confirmation checks
the reviewed record timestamp, stock balance and credit limit again. Every file
is atomic and an import request can be replayed without posting twice.
Customer imports never manufacture or replace account balances.

Business logos use a private, image-only Storage bucket with a 2 MB limit.
Active members can read their business images; only owners can upload, change
or remove them. The currently selected image cannot be deleted. References:
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
and [bucket file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

A manager shortage override for unpacking requires a physical count and reason.
The stock-count correction and unpacking post atomically with expiry allocations
and the authorizing manager. This allows verified stock to be unpacked while
retaining the existing non-negative-stock invariant. It does not enable selling
or transferring stock that does not physically exist.

Report date boundaries and timestamps use Africa/Johannesburg. End dates include
the whole selected day by using the next midnight as an exclusive upper bound.
