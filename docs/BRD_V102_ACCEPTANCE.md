# BRD v1.02 acceptance record

Source: `POS_INVENTORY_BRD_V1.02.docx`, including its tables and the additions to section 12. This record separates implemented behavior from deployment evidence.

## Requirement coverage

| BRD sections | Where to review | Integrity and regression evidence |
| --- | --- | --- |
| 6.1: login, reset, roles, back/home | Login, Forgot password, Reset password, Users, application/public navigation | Password recovery, safe redirects, session, navigation and public browser tests. Real reset-email delivery is a staging check. |
| 6.2: dashboard | Home, location switcher, owner location summary, invoice summary | Scoped dashboard/invoice aggregates, location and invoice SQL suites. |
| 6.3–6.4: catalog/barcode | Products, product detail, Goods In/Out, Check Stock/Price | Existing product/scanner workflows, barcode constraints, price history and upgrade tests. Physical USB/camera acceptance remains manual. |
| 6.5: receiving | Goods In destination selector and whole-unit arrows | Location, receiving, expiry and stock reconciliation SQL cases. |
| 6.5.1: warehouses/transfers | Operations, Warehouse Stock, Transfer Stock, Receive Transfer | 0013–0016; lifecycle, both endpoints, retries, cancellation and expiry batches. |
| 6.5.2: unpacking | Operations → Unpack Bulk Stock; conversion/count controls | 0015/0030; paired changes, role checks and atomic rollback. |
| 6.6: Cash/Card-EFT/Credit | Goods Out and Payment Report | 0017–0018; card, credit approval and offline-sync tests. Card processing remains external. |
| 6.6.1: orders to receipts | Orders → Invoices → invoice workspace/receipt | 0019–0022/0034; tax/discount, partial payments, goods release once, debt reconciliation and linked cancellation. |
| 6.7: customer credit | Credit Customers, statements, Settings approval codes | Scoped expiring codes, sign convention, status sorting, date/type filters and pagination. Credit, session and export suites. |
| 6.7.1: returns | Returns, Settings reasons, approved return receipt, refund reports | 0021–0022/0033; source quantity caps, reasons, inspection, approval, quarantine, refund/credit limits and retries. |
| 6.7.2/table 1: invoicing | Invoice filters/summary/history, notes, receipts, ageing, reconciliation | Actual receipts are separate from payment terms. Receivable = total + debit notes − payments − credit notes. Issued records are never hard-deleted. |
| 6.8–6.9: lookup/adjustment | Check Stock/Price, Adjust Stock | Status filters, refresh/cancel, roles, reasons and quantities. 0031 expiry allocation and stale-quantity tests. |
| 6.10: stock takes | Location selection, saved counts, approval/history, variance report | 0031–0032; separate location counts, stale-approval rejection and closed-count protection. |
| 6.11–6.12: reorder/expiry | Low Stock, restock list, Expiry, Adjust Stock | Paginated exports, minimum/reorder levels, expiry batches and authorized write-offs. Forecasting/purchase ordering remains optional future scope. |
| 6.13: suppliers | Suppliers → purchase history; Goods In supplier/date filters | Supplier records/imports, receiving references and cost report. |
| 6.14: reports | Reports index and operational reports | Excel/PDF/CSV/email tests, preserved price history, costs, return/variance/payment views and report dates. |
| 6.15: audit | Audit → stock items and before/after details; movement history | 0034 invoker-rights view; owner/assigned-manager access, stock names and employee/foreign denial tests. |
| 7/table 2: imports/logo | Product/supplier/credit import links, Imports, Settings logo | 0028–0029; atomic previews, stale rejection, FEFO, ID matching and private image policies. |
| 8/12: nonfunctional | RLS/RPC, location switching, PWA/outbox, responsive shell | Database/unit/browser checks. Hosted performance, restore, hardware and authenticated acceptance require staging evidence. |
| 10.1–10.3: journeys | Goods Out, credit approval, credit payment/statement | Cash/card create no debt, credit does; payments do not move stock; green positive payment/negative credit-taking display. |
| 11: navigation | Dashboard, Operations, Goods In/Out, Returns, Orders, Invoices, Credit, Stock Control, Administration | Navigation/session and protected-route browser checks. |
| 13.1: notifications | Settings preferences, scheduled-notifications Edge worker | Six types; 0025/0027 and notification suites cover live data, access recheck, opt-in and retries. No schedule activated locally. |
| 13.2/14: printing/permissions | Invoice/credit-note print, exports, role/location controls | Print CSS/build, export tests, database role and tenant authorization cases. |

Orders show estimated line/subtotal/tax totals. Any discount is selected before invoice generation; the RPC calculates final amounts. Each order has one invoice. Cancelling an eligible invoice also cancels its order; cancelling an invoiced order reuses manager-only void rules. Payments, notes or released goods require correction/return instead of cancellation.

Reports disclose export scope. Product/customer/expiry/low-stock lists use pages; transaction reports have stated limits and date filters. Movers are ranked on the server before selecting 50 results. Invoice summaries and valuation totals use aggregate functions rather than capped tables.

## Final local verification

Verified on 7 September 2026:

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Lint | 0 errors; 10 existing React effect warnings |
| Unit/component tests | 64 passed across 22 files |
| Production build | Passed with Next.js 16.3.3 |
| Fresh local PostgreSQL | 0001–0034 applied; 2 upgrade fixtures and all 16 rollback suites passed |
| Chromium browser tests | 8 passed against the production server, including 375 px recovery navigation and protected return receipts |
| Production dependency audit | 0 reported vulnerabilities |
| Edge worker | Deno type check passed during the notification batch; worker unchanged in this acceptance batch |

The order-preview fractional-quantity rounding regression was corrected and the
complete unit suite rerun successfully. The browser test's recovery-link label
was corrected to match the displayed text; all eight browser checks then passed.
The mobile recovery screen was also captured for visual inspection.

Before the requested integration to `main`, type checks, lint, all 64 unit/component
tests and the production build were run again with the existing analytics change
included. All passed; lint retained the same 10 pre-existing warnings. The source
BRD, handover and supplied brand assets were added to version control unchanged.
Database migrations and application workflows did not change in this final batch,
so the database and browser results above remain the relevant acceptance evidence.

The database runner applies all migrations to an empty disposable local database and checks single-/multi-store assignment backfill and legacy price-history preservation. Its 16 rollback suites are: core RPC, location access, transfers, unpacking, Card/EFT, credit approvals, invoices, returns, store credit, report email, report history, notifications, imports, logos, bulk-count override and stock counts. New money/stock cases run in these dedicated suites alongside the original `rpc_integration.sql`.

## Staging acceptance before rollout

- [ ] Apply 0001–0034 to a separate Supabase staging project. Never apply the local bootstrap there. Reconcile stock and credit.
- [ ] Exercise owner, assigned manager/cashier, unassigned member and foreign-business access through the hosted app/PostgREST and RPCs.
- [ ] Receive at a warehouse; transfer, receive, sell packs, unpack and sell units. Verify stock/batch totals, references, roles and audit names.
- [ ] Confirm an order, invoice, record partial/multiple payments, release and print. Test an eligible linked void and denial after payment/supply.
- [ ] Approve an over-limit credit sale, retry an uncertain result, and verify one posting and correct manager attribution.
- [ ] Return checkout/invoice goods using each action; verify reasons, approval, quarantine, refund caps, store credit, printing and reconciliation.
- [ ] Count stores/warehouses separately; sell after a saved count and verify recount is required. Check expiry and closed-count protections.
- [ ] Import each template, change data after preview and confirm stale rejection. Retry without duplicate changes; reject foreign IDs/missing expiry.
- [ ] Upload/replace/remove logos through actual Storage HTTP and verify cross-business denial.
- [ ] Exercise email confirmation/reset on the final domain, including expired links.
- [ ] Export representative reports/statements; check Excel numeric cells, PDF pagination, print layout, scope and test-inbox delivery.
- [ ] Configure a test email provider/recipient and verify all six notifications, opt-out, changed access and retry behavior.
- [ ] Verify intended desktop/tablet/mobile scanners, camera permissions, scrolling, receipt printers and offline cash replay.
- [ ] Verify backup/restore, hosted monitoring and database advisors; obtain business sign-off before production rollout.

## Defaults to review

Authentication remains enabled. Multiple warehouses are allowed. Invoice tax defaults to zero after discounts; currency defaults to ZAR. Return approval defaults on; notifications default off. Resend is the optional delivery adapter. Production tax, provider and authentication policy decisions have not been assumed.
