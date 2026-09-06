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

## Remaining implementation

| Epic | Remaining work |
| --- | --- |
| B | Implemented; Supabase staging and authenticated browser verification remain before rollout. Export formats are completed with Epic F. |
| D | Card/EFT sale type, reconciliation reference and Payment Report. |
| C | Orders, invoices, payments, goods issue, receipts, credit/debit notes, returns, refunds and reconciliation. |
| E | Audited manager override codes, statements/exports and credit display convention. |
| F | Additional reports and Excel/PDF/email exports, scheduled notification delivery. |
| G | Imports, global back navigation, barcode copy, list filters and business logo upload. |

The full v1.02 release remains in progress. Apply migrations 0013–0016 before
deploying the Operations app version, and explicitly
assign existing multi-store staff as described in DEPLOYMENT.md.

## Open business decisions

Authentication is retained. The schema supports multiple warehouses; no
warehouse is auto-created. Existing money formatting uses ZAR and two decimal
places. Confirmation remains open for tax scope, the notification email
provider, any required changes to money rounding, and the ambiguous auth line.
