# BRD v1.02 implementation status

## First change set: location foundation

Implemented locally on `codex/brd-v102-location-foundation`:

- Migration 0013 adds selling-store/warehouse types and explicit staff assignments.
- Owner location creation in Settings; manager/employee assignment controls in Users.
- Owner dashboard lists stock separately across all business locations.
- Warehouse sale denial, separate warehouse receiving and stock takes, and
  product/location foreign keys protect the existing stock ledger.
- The receiving destination is visible and selectable before adding items.
  Goods In quantity arrows now increment by one.
- Session roles come only from the signed-in user's membership. Members without
  assigned locations see an access message instead of onboarding.
- Stock/credit integration tests, location RLS/RPC tests, upgrade/backfill tests,
  session tests and location-creation UI tests cover the foundation.

The source BRD is `docs/POS_INVENTORY_BRD_V1.02.docx`. Its internal cover still
says Version 1.0; the filename and handover identify this revision as v1.02.
The BRD and original handover have been left unchanged.

## Operations change set

Implemented on `codex/brd-v102-operations`, stacked on the foundation:

- Migration 0014 adds drafts, submission, dispatch, receipt and cancellation,
  request IDs for safe retries, linked movements, source checks and expiry batches.
- Migration 0015 adds manager-configured bulk conversions and atomic unpacking.
- Migration 0016 provides location-scoped transfer history with product, operator,
  date, status and source/destination filters.
- The Operations area links Warehouse Stock, Transfer Stock, Receive Transfer and
  Unpack Bulk Stock. Both endpoints of a transfer must be assigned to the caller.
- Cashier operations require a connection; negative bulk stock is blocked.
- Stock RPC integration and component tests cover lifecycle, retries, permission
  denials, shortage rollback, expiry preservation and configured conversion use.

## Payments and credit change set

Implemented on `codex/brd-v102-payments-credit`:

- Card/EFT checkout records a slip/EFT reference and moves stock without debt.
- Sale request IDs prevent duplicate stock/debt changes after uncertain responses,
  including cash sales replayed from the offline outbox.
- Expiry-tracked products require expiry dates on receipt; sales consume batches.
- Managers set personal hashed approval codes. A cashier requests an approval
  scoped to their customer, location and amount, expiring after two minutes.
  Five incorrect attempts trigger a fifteen-minute limit. Successful sales record
  the actual authorizing manager and consume the approval once.
- Payment Report separates checkout Cash/Card-EFT/Credit. Statements display
  receipts as positive green amounts and credit taken as negative amounts.
- Local migration and RPC tests cover payment retry, debt/stock reconciliation,
  code permissions, incorrect-code throttling and approval reuse prevention.

## Orders, invoicing and returns change set

Implemented on `codex/brd-v102-invoicing`:

- Orders are captured as drafts and confirmed before invoice creation. Invoice
  snapshots retain business/customer/item names, salesperson, prices, discounts,
  configurable tax and due dates. Issued invoices cannot be edited or deleted.
- Invoice issue posts the receivable; a separate goods-release RPC checks payment
  or account credit and consumes stock/expiry batches once.
- Partial and multiple payments, debit/credit notes, voids and return credits use
  immutable entries. All account-affecting entries also post to the customer ledger.
- Receipts include salesperson and payment history, with print/save-PDF support.
- Returns reference original invoice or checkout lines and require a reason,
  condition, inspection and inventory action. Manager approval defaults on.
  Quarantine stays out of saleable stock until separately resolved.
- Refunds are capped by approved, unspent credit. Store credit can be allocated
  to another invoice with paired entries that preserve customer net debt.
- Invoicing dashboard, status/date/customer filters, ageing, monthly reconciliation,
  payment activity and refund reports include the new workflow.
- Database tests cover order/invoice retries, tax/discount calculations, payment
  allocation, role and tenant isolation, goods release, return/refund caps,
  quarantine, expiry batches and both stock and customer reconciliation.

## Remaining implementation

## Reports and notification change set

Implemented on `codex/brd-v102-reports-notifications`:

- Shared report controls export Excel, paginated PDF and safe CSV files, and send
  an attachment through an authenticated, location-checked email endpoint.
- Email requests have daily limits, audit records and provider retry keys.
- Warehouse, transfer, unpacking, payment, valuation, movers, price history,
  gross profit, credit, invoice ageing and refund reporting are connected.
- Original price history is preserved on upgrade. Future stock movements record
  cost snapshots; profit reports label missing historical costs as estimates.
- Owner/manager notification preferences default off. The Edge worker claims live
  data, checks current role/location access, skips empty operational reports and
  preserves delivery IDs through retries. A Vault-based hourly schedule is supplied.
- Email and worker tests mock delivery; no live email or schedule was enabled.
  Configure the delivery secrets and staging verification in EMAIL_NOTIFICATIONS.md.

## Remaining implementation

| Epic | Remaining work |
| --- | --- |
| B | Implemented; Supabase staging and authenticated browser verification remain before rollout. Export formats are completed with Epic F. |
| D | Implemented, including invoice payments, store-credit allocations and refunds. |
| C | Implemented locally; staging acceptance and browser verification remain before rollout. |
| E | Codes and statement convention implemented; Excel/PDF/email and further list sorting complete with F/G. |
| F | Implemented locally. Email credentials, Edge deployment and scheduler activation remain deployment prerequisites. |
| G | Imports, global back navigation, barcode copy, list filters and business logo upload. |

The full v1.02 release remains in progress. Apply migrations 0013–0016 before
deploying the Operations app version; apply 0017–0018 for Payments/Credit. Explicitly
assign existing multi-store staff as described in DEPLOYMENT.md.

## Open business decisions

Authentication is retained. The schema supports multiple warehouses; no
warehouse is auto-created. Existing money formatting uses ZAR and two decimal
places. Confirmation remains open for tax scope, the notification email
provider, any required changes to money rounding, and the ambiguous auth line.

