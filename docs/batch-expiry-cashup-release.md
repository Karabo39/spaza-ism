# Cash-up, returns, products and navigation release

Date: 8 September 2026
Source review: [four document review](review-cashup-returns-products-navigation.md).

## Delivered behavior

- Cash-up follows Start day, End day, count, Complete end of day. One shared drawer belongs to each store and business date. Manager approval and reopening history remain. Opening cash and optional drawer movements sit in an expandable management section.
- The daily summary shows cash/card sales, credit issued, actual credit/invoice payments, refunds and net collected. Opening cash and unpaid credit are excluded from collections. Expected drawer cash includes only cash movements and opening cash. Invoice payments are counted once.
- Completing a count does not disable trading. Later recorded activity invalidates the snapshot; the manager must reopen and recount. All tills should sync before counting. Offline sales belong to the date when synchronized.
- Return selection searches the latest 100 documents and includes product names and quantities for invoices. Older records remain available by full document ID. Original charged unit price and estimated return value are shown; final refundable amounts still account for payments, prior returns and refunds. Existing per-store approval/refund permissions and settled receipt history remain enforced.
- The R17 screenshot is not treated as an expiry fee. Its precise historical reference was not found during the read-only lookup, so no historic transaction was changed.
- Products show barcodes, name filtering, nearest batch expiry and sellable quantity. Same-name products keep separate rows and identifiers. Exports include barcode, expiry and sellable stock.
- Managers can assign dates to quantities of existing undated stock without changing total stock. Different dates remain separate batches. Enabling tracking through product edit requires dates for remaining undated stock; a zero-stock product can be registered with tracking and receives dates on receipt.
- Checkout and invoice goods issue consume the earliest unexpired batches. Expired and undated tracked stock cannot sell. Stock dated today remains sellable through today in Africa/Johannesburg. Tracking cannot be disabled while stock remains. Transfers and unpacking retain existing batch handling and matching-tracking checks.
- Expiry-tracked sales require a connection. A previously queued sale rejected by the server remains visible as failed for correction.
- Catalog order is Products, Operations, Suppliers, Data Imports and Exports. The Low Stock sidebar shortcut is removed; its route, permissions and Check Stock filtering remain.
- Create an account stays available for testing new business owners.

## Verification

- 120 application tests passed across 35 test files.
- All 22 local database suites passed against the full migration chain.
- Seven concurrency scenarios passed, including two tills competing for the last fresh unit, duplicate receipts/refunds and stale cash counts.
- Backup restore verified matching records and access across 67 tables, including stock/credit reconciliation and synthetic expiry fixtures.
- Lint, TypeScript and optimized production build passed.
- Local component previews at 1440px and 390px covered cash-up, expiry assignment and returns: no page overflow or browser runtime errors. These used fictional fixtures, not live authenticated customer transactions.
- Live migration batch_expiry_and_daily_totals applied successfully. Required database capability check passed.
- Security and performance advisors reviewed. The two new authenticated security-definer product functions are intentional, enforce store/module authorization and have fixed search paths; neither is available to anonymous callers. Existing project advisory items remain outside this release.

## Operational notes

Review expired and undated quantities before attempting tracked sales. Assign dates only from actual stock information; do not substitute a future date to make expired stock sellable. Existing dated batches are not overwritten by the assignment tool. Testing registration remains enabled; this release does not introduce licensing, device restrictions or change invitation email configuration.
