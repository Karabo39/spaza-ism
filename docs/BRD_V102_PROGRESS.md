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

## Remaining implementation

| Epic | Remaining work |
| --- | --- |
| B | Operations area, linked transfer lifecycle and receiving, explicit product mapping between locations, bulk conversion configuration and unpacking, detailed location reporting. |
| D | Card/EFT sale type, reconciliation reference and Payment Report. |
| C | Orders, invoices, payments, goods issue, receipts, credit/debit notes, returns, refunds and reconciliation. |
| E | Audited manager override codes, statements/exports and credit display convention. |
| F | Additional reports and Excel/PDF/email exports, scheduled notification delivery. |
| G | Imports, global back navigation, barcode copy, list filters and business logo upload. |

Do not present the foundation as a complete v1.02 release. Transfers are not yet
available, so warehouse inventory must not be sold or manually relabelled as
store stock to simulate a transfer. Finish Epic B before operational warehouse
rollout. Apply migration 0013 before deploying this app version, and explicitly
assign existing multi-store staff as described in DEPLOYMENT.md.

## Open business decisions

Authentication is retained. The schema supports multiple warehouses; no
warehouse is auto-created. Existing money formatting uses ZAR and two decimal
places. Confirmation remains open for tax scope, the notification email
provider, any required changes to money rounding, and the ambiguous auth line.
