# Six-document implementation — 25 September 2026

Source documents: Dashboard (2).docx, Cash Up (1).docx, Stock Take (1).docx, Access Control_New.docx, Orders (5).docx and Invoicing.docx.

## Delivered changes

| Document | Result |
| --- | --- |
| Dashboard | “View All Business Locations” and “Recent Stock Movements” expand/collapse with direction arrows. Data is fetched when opened. Movements use bounded 20-row cursor pages. |
| Cash Up | Start next shift sits directly below Cash-up approved in the same right-hand column. Recent cash-ups and all shift selectors use green buttons, with selected-state indicators. |
| Stock Take | Export template and Import Stock Take sit alongside Start stock take, including warehouses. Open counts also offer export/import. Excel includes product, SKU, unit, system quantity, physical count, Still the Same and expiry. |
| Access Control | Employees see the requested dashboard actions and movements; invoice summaries and location totals are hidden. Invoicing retains quotes, create-from-order and recent invoices. Check Stock displays/exports Product, In stock, Status and Selling only. Receiving cost is read-only for employees. Sale-price changes require an explicit per-store permission. |
| Orders | Reference arrows expand the existing detail panel immediately below that order. Clicking again collapses it. Invoice/payment history is a red action button. |
| Invoicing | Open Invoice / Receipt, Customer Statement, Return Goods and Back to invoice now use the shared primary button styling. Existing actions and eligibility rules are retained. |

## Stock-take workflow and safeguards

Exporting from the stock-take list opens an in-progress count for the current location. Exporting inside an open count uses that count. Neither export nor import changes inventory balances.

In Excel, enter a physical count (zero is valid), or choose TRUE under Still the Same. Leave a row blank to skip it. TRUE uses the server's saved quantity, not a quantity edited in the spreadsheet. Enter an expiry date for additional expiry-tracked stock.

Import shows the number of entered counts and TRUE rows before saving. The server checks current location access, stock-take status, product identity, product/stock versions and intervening saved counts. Every row is saved together or none is saved. Exact retries are safe; a previously imported template cannot be reused with different counts. Manager approval remains necessary to apply stock changes.

Templates support up to 10,000 products and 10 MB compressed files, with a 40 MB uncompressed guard. Formulas, duplicate IDs, invalid dates/counts, changed headers and another location's template are rejected. Export IDs and snapshots are stored privately with RLS and no direct employee access. Product or stock changes after export require a fresh template and recount, even if stock returns to the same quantity.

The count screen retrieves all items in bounded database batches and renders 50 at a time, preserving unsaved edits between pages. Spreadsheet code loads only when export or import is used.

## Employee access enforcement

The new Access Control child permission is **Goods Out → Change selling price / discount**. It is disabled by default for employees and can be granted separately per store by the owner. Managers retain their default ability; an explicit denial is respected. The database validates prices as well as the interface.

The receiving database function rejects employee unit-cost changes. A request that omits cost uses the current catalogue cost. Product-master writes, completed-sale deletion, direct stock adjustments, credit-limit changes, refund approvals and cash-up approval retain their existing restrictions. Employees retain their own cash-up access and the minimal approved-float handover needed for a new shift.

Existing per-store module denials and employee receiving grants remain effective. These changes do not automatically enable modules for every employee. Cost hiding in Check Stock and Check Price is a screen/export rule; this release does not introduce a global database column-confidentiality policy across all catalogue views.

Queued employee sales with a price that differs from the current authorised catalogue price will require resolution instead of silently applying an unauthorised override. Sales with unchanged prices and already-completed idempotent retries retain their existing behaviour.

## Main implementation files

- Dashboard: `src/app/(app)/page.tsx`, `src/features/dashboard/location-overview.tsx`, `src/features/dashboard/recent-movements.tsx`.
- Cash-up: `src/features/cash-up/cash-up-console.tsx`, shared `src/components/ui/button.tsx` success style.
- Billing: `src/features/billing/orders-console.tsx`, `invoice-workspace.tsx`, invoice list and receipt pages.
- Employee views: Goods In/Out, Check Price, Check Stock and StockExport; `src/lib/modules.ts` and `module-features.ts`.
- Excel: `src/features/stock-take/excel.ts`, `excel-actions.tsx`, `start-button.tsx`, `counter.tsx`.
- Database: `supabase/migrations/20260925055543_employee_controls_stock_take_excel.sql`. Adds private snapshots, guarded export/import APIs, sale-price permission checks, receiving-cost checks and manager-only invoice-summary permissions.
- Release: `release-contract.json` requires `employee_excel_v1`; database types and user-facing errors updated.

## Validation

- Full application suite: 220 tests across 58 files passed; a subsequent targeted run including two additional employee stock-screen tests passed all 28 tests across six files.
- The final Cash-up regression tests also passed (3 tests), checking that the next-shift panel immediately follows approval in the same column and that green shift selectors remain interactive.
- Type checking, lint and production build passed.
- All migrations replayed into a fresh disposable local database. All 38 SQL suites passed, including new employee/Excel checks, checkout, cash-up ownership, transfers, stock reconciliation and existing performance tests. Warehouse-disable concurrency tests passed in both operation orders.
- New SQL tests cover employee cost/price denial, explicit store price grants, export/import retries, TRUE using the authoritative snapshot, cross-store refusal, intervening movements and counts, atomic rejection, zero counts, manager approval and immediate permission revocation.
- The migration was applied to the live Supabase project; the hosted release contract passed. Anonymous export, direct private import execution and direct snapshot reads were verified denied.
- Security advisor changes are the expected two authenticated guarded API wrappers and one private RLS table without public policies. Existing advisor notices, including disabled leaked-password protection, are unchanged.

## Live release verification

Five functional commits were pushed to main: `71b49f5`, `78df7f3`, `ef26687`, `c6a60c6`, and `e520e73`. Vercel successfully deployed `e520e73e279b043fe720db72ca6629bb427e5c76`; the Dublin (`dub1`) function region and previous performance work remain in place.

All 14 authenticated page checks returned HTTP 200 without application-error markers: Dashboard, Goods Out, Check Stock, Products, sales report, movement report, Cash-up, Warehouse, Audit, Orders, Invoicing, Stock Take, Goods In and Check Price. Observed single-sample response completion times were 480–1,432 ms; these are smoke checks, not a new performance benchmark. Read-only RPC checks, cursor continuation, audit details, health, login and telemetry script checks also passed.

Live browser checks confirmed Dashboard expand/collapse and movement loading; order details directly beneath the selected row and collapse on a second click; the invoice-history link; invoice action styling and receipt back navigation; green recent cash-up selection and shift selectors; and enabled Excel export/import actions. The original active store was restored after verification.

Employee and stock-writing/approval scenarios were tested with disposable local fixtures. No test sale, receipt, stock count or cash-up was created in production. There was no current-day approved shift suitable for a live next-shift layout check; its placement was verified with an approved-shift component fixture. Desktop layout was visually checked; a full device/browser matrix and physical Excel desktop application were not exercised.
