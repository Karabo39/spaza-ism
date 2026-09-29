# Orders and Delivery Module changes — 29 September 2026

Implemented from `docs/Orders and Delivery Module.docx`.

## User-facing changes

- Orders no longer includes Delivery Management or Manage delivery controls. Order creation remains unchanged.
- Choosing Pay — To be Delivered when creating an invoice now creates one linked delivery immediately, even while the invoice is a draft or unpaid. It appears in Created without an invented scheduled date.
- Deliveries defaults to All Deliveries. Created, Scheduled, Delivered and Cancelled filters are available. Scheduled and rescheduled deliveries share the Scheduled queue; the underlying reschedule event remains available in history and reporting.
- Delivered has a green badge, Scheduled a yellow badge, and Cancelled a red badge. Only the most specific selected sidebar module is highlighted.
- Cancelling/voiding an eligible invoice cancels its delivery and displays Invoice Cancelled on its order. Payment and goods-release safeguards still apply.
- A manager can use **Edit order items** on an unreleased invoice to change quantities, remove or replace products, or add products after a stock shortage. The order and invoice numbers remain the same. The current order view and delivery note reflect the corrected invoice items.
- Existing line prices are preserved. Newly added lines use the store price. A price change between review and saving is rejected for review.
- The correction preview shows the revised total, retained payments, and resulting balance or customer credit. A reason is required.
- Original order lines remain preserved. Invoice revisions store complete before/after item and amount snapshots, author, timestamp and reason. The invoice screen provides revision history. Printed/emailed invoices show their revision.
- The Cancel / void button is red. Recurring invoices has a clickable Show button matching Create recurring invoice; select a status and click Show to apply it.

## Financial and access safeguards

- Item corrections require manager/owner role and invoice module access at the affected store. Corrections and history enforce current tenant/store/module permissions.
- No item correction is allowed after goods release, invoice/order cancellation, dispatch, completion, or existing credit/debit notes. Existing returns and financial-adjustment workflows continue to handle those cases.
- Payments are never edited, deleted or recreated. Issued corrections post a signed customer-account adjustment and appear in monthly invoice reconciliation on the actual correction date. Draft corrections are charged when the revised draft is issued.
- A lower total may leave customer-account credit. This does not automatically refund cash or create a goods return. A higher total requires the additional balance to be settled before cash/card goods release.
- Stock moves only when goods release succeeds. A failed release rolls back all stock changes. Corrections, release and delivery actions serialize on invoice locks; version checks and request identifiers prevent stale edits or duplicate corrections.
- Dispatch still requires payment, released goods, a scheduled date, address and contact number. A Created note is not permission to dispatch.
- Corrected invoices use the existing Hostinger notification service and customer opt-in. The account adjustment does not generate a duplicate generic notification.
- Existing records are not backfilled. Earlier Pay — To be Delivered selections were stored as CASH and cannot safely be distinguished from collection invoices.

## Implementation

- Migration `20260929182342_orders_delivery_collaboration.sql`: Created delivery lifecycle, automatic invoice linkage, cancellation summary, bounded current-item/history reads, immutable invoice revisions, reconciliation, notification metadata and release capability.
- New RPCs: `create_delivery_invoice`, `amend_invoice_items`, `order_current_items`, `invoice_revision_history`.
- New table: `invoice_revisions`, with RLS, read-only authenticated access, immutable records and supporting indexes. No anonymous access to the new RPCs.
- UI: orders, invoice workspace/item corrections, delivery queue/editor/report/note, recurring invoice filtering, sidebar selection, invoice receipt/email and reconciliation report.
- New release capability: `orders_delivery_collaboration_v1`.

## Validation

- Application suite: 275 tests across 69 files validated; the release-contract fixture was updated and rerun after the new capability was added.
- Complete local database regression suite: 51 test groups, including the new order/delivery correction tests. Follow-up targeted tests passed after the reconciliation update.
- Concurrent correction versus goods release passed; existing delivery creation, numbering and retry concurrency tests passed.
- Production build, TypeScript, lint and live database release-readiness checks passed.
- Live database migration applied successfully. No customer transactions or emails were generated to test deployment.
- Security advisor review: the four new authenticated privileged RPC notices are expected, with explicit store/module/role checks; no new anonymous execution grant or unprotected revision table. [Supabase advisory explanation](https://supabase.com/docs/guides/database/database-linter).

Physical printing and email inbox receipt are outside the automated checks. Revision history displays the latest 100 revisions; older immutable records remain in the database.
