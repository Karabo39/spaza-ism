# BRD v1.02 implementation status

Updated 7 September 2026. The implementation covers handover epics A–G and the additional requirements found in the full BRD. Production release still requires Supabase staging acceptance and the deployment steps below.

The source is `docs/POS_INVENTORY_BRD_V1.02.docx`; its internal cover says Version 1.0, while the filename and handover identify v1.02. The original BRD, handover and supplied brand files are unchanged.

## Delivered functionality

| Area | Implementation |
| --- | --- |
| A: locations and access | Selling stores and warehouses, owner-wide dashboard, explicit staff assignments, database-enforced location access and separate stock counts. |
| B: operations | Destination-aware Goods In, transfer lifecycle, linked movements, expiry preservation and configured bulk unpacking. Managers can correct a verified physical pack count and unpack atomically. |
| C: orders and invoicing | Confirmed orders, tax/discount calculations, immutable invoices, partial/multiple payments, goods release, receipts, notes, refunds, store credit, ageing and reconciliation. Eligible order/invoice cancellations propagate together. |
| C: returns | Original sale/invoice lines, configured reasons, inspection, condition, approval, quarantine resolution, refund caps and printable credit notes. |
| D: Card/EFT | External payment references without customer debt; cash/Card-EFT/credit/refund reconciliation. |
| E: credit | Hashed manager codes, short-lived scoped approval, audit attribution, paginated/filterable statements, payment display signs and Excel/PDF/email exports. |
| F: reports and notifications | Warehouse, transfers, unpacking, supplier purchases, returns/refunds, count variance, valuation, movers, price history, profit, payments and credit. Six scheduled email types with live-data checks, opt-in preferences and safe delivery retries. |
| G: imports and interface | Excel templates, atomic preview/confirmation, stock/expiry and stale-preview checks; Products-tab import/export; back/home navigation; barcode copy; status filters; private business logos. |
| Additional acceptance fixes | Password recovery, safe auth redirects, stock-count expiry reconciliation, stale-count rejection, closed-count protection, invoice number/receipt-method filters, audit stock-item names and explicit report scope. |

## Five-commit stack

Each branch includes the preceding branch. Review/merge in this order or review the final branch cumulatively against the original base. The foundation is one initial commit; subsequent work is grouped in batches of five as requested.

| Branch | Base | Batch commits |
| --- | --- | ---: |
| `codex/brd-v102-location-foundation` | Original project base | 1 |
| `codex/brd-v102-operations` | Location foundation | 5 |
| `codex/brd-v102-payments-credit` | Operations | 5 |
| `codex/brd-v102-invoicing` | Payments/credit | 5 |
| `codex/brd-v102-reports-notifications` | Invoicing | 5 |
| `codex/brd-v102-imports-ux` | Reports/notifications | 5 |
| `codex/brd-v102-acceptance` | Imports/interface | 5 |
| `codex/brd-v102-main-integration` | Acceptance | 5 |

The acceptance batch contains password recovery, stock-count integrity, report coverage, configured returns/printing, and final workflow/acceptance fixes. The main integration batch includes the existing Vercel analytics change, source BRD/handover, supplied brand assets, machine-local file exclusion and this release record. Schema changes are incremental migrations **0013–0034** after the original 0001–0012. Released migrations were not rewritten.

## Validation and release boundaries

See [BRD_V102_ACCEPTANCE.md](BRD_V102_ACCEPTANCE.md) for coverage and verification results, [DEPLOYMENT.md](DEPLOYMENT.md) for rollout, and [EMAIL_NOTIFICATIONS.md](EMAIL_NOTIFICATIONS.md) for delivery configuration.

Local database tests use PostgreSQL with minimal Auth and Storage contracts. They verify migrations, RLS, retries, ledgers and rollback; they do not exercise hosted Supabase Auth, Storage HTTP or PostgREST. Browser smoke tests cover public navigation and access gates. Authenticated business flows still need staging verification with representative users and data.

The user authorized direct integration and push to `main`, superseding the earlier draft-PR route blocked by connector permissions. Integration preserves the feature commits without rewriting history. Machine-specific assistant permissions and ignored environment files stay local.

No production database migrations, live email or scheduled delivery were performed. A host connected to `main` may deploy after the push; hosting deployment status is separate from Git integration. Database migrations through **0034**, email credentials, Auth redirects, staging checks and backup verification remain rollout prerequisites.

## Business interpretations

- Working authentication is retained; the BRD's “to be removed” line remains ambiguous. Password reset is included.
- Multiple warehouses are supported; no warehouse is created automatically.
- Invoice tax is owner-configurable and defaults to zero. ZAR remains the default currency; money uses two decimals and quantities three.
- Resend is the implemented optional email adapter. Delivery stays disabled until configured and tested.
- Cash sales retain the offline outbox. New stock/money workflows needing current balances are explicitly online-only.
- Negative sale/transfer stock remains prohibited. Unpacking shortage approval records an actual physical count correction before conversion.
- Future-only WhatsApp/SMS, OCR, subscription billing and automatic supplier purchase orders are outside this release. Multi-store and transfers, explicitly upgraded to mandatory in the BRD, are included.
