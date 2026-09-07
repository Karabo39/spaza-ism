# Orders payment and completion changes

Implemented from Orders.docx on 7 September 2026.

- Issued invoices with no outstanding balance show a settlement summary instead
  of payment entry. Partial payments remain available up to the outstanding
  balance, including on credit invoices whose goods were already released.
- Manager adjustments remain separate, require a reason, and use the existing
  ledger. Existing database overpayment protection and retry identity are retained.
- Orders display Completed when their issued invoice is settled and goods are
  released. Settled invoices awaiting goods show Ready for collection. Released
  goods with a remaining balance show Awaiting payment. A later debit adjustment
  therefore updates the displayed workflow without rewriting historical orders.
- Existing linked invoices show their final financial summary and a View invoice
  link for staff with invoice access. Invoice creation and invalid cancellation
  controls are removed from those completed workflows. Valid cancellation reasons
  and the original server rules are retained.
- Order product selection uses one searchable dropdown with prices and available
  quantities, keyboard navigation and explicit loading/error states. Add item is
  beneath Quantity, and notes are labelled optional. Other modules keep their
  existing product selector.

The read-only order_workflow_summary RPC checks Orders access for the requested
store and exposes only the linked invoice summary, not its ledger. Orders-only
staff do not gain direct invoice-table access. Anonymous execution is revoked.
Completion is calculated from current balances, so existing orders need no backfill.

Validation: 93 unit tests, targeted database workflow tests, lint and production
build passed. Database cases cover settlement, payment retry, overpayment,
credit collection before settlement, subsequent adjustments, cross-store denial,
revoked module access and Orders-only access. The CI database runner includes
the new regression suite. Desktop and 390-pixel phone layouts were inspected
with real components and fictional local data; no production payments were made.

Migration 20260907185332_order_workflow_summary.sql was applied to production as
20260907190534_order_workflow_summary. The compatibility check passes. Stock,
credit balances and invoice-entry checks matched before and after migration.
The release contract now requires order_workflow_v1 before deployment.
