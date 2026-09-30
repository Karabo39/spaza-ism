# Changes Mixed implementation

Source: `docs/Changes Mixed.docx`, reviewed 30 September 2026, including its screenshots.

## Changes

- Goods Out receipt actions now share one wrapping row: Back to Goods Out, Print / save PDF, Email document. The back action uses the standard pink button and arrow.
- Delivery notes have a matching Back to Deliveries button, linking to Delivery Management and aligned with Print.
- Shared delivery badges use the exact supplied colour swatches: Created `#9400d3`, Out for Delivery `#89512a`; Failed and Cancelled are red, Delivered green, Scheduled yellow. Labels remain visible alongside colour.
- Delivery Management's Refresh uses the primary button style and aligns with the queue and scheduled-date controls, including mobile button heights.
- PO received and PO approved are independent in the editor and database. Staff with existing module access may record receipt; only managers/owners may change approval or approved document content. Receipt-only changes retain the original approver and approval time. Version checks and accepted/converted/cancelled quotation locks remain enforced. Audit records include before and after states.
- New saved checkout receipts use `POS-YYYYMMDD-001`; new transfers use `TR-YYYYMMDD-001`. Counters are shared across a business's stores, separate by document type and South African calendar day. Each business starts its own sequence. Numbers expand beyond three digits after 999. Existing identifiers are untouched.
- Receipt references and immutable document snapshots receive the same number before insert, including subsequent print/email use. Existing checkout/transfer request locks retain retry safety, including offline checkout replay.

The transfer example in the source contains an extra date digit; implementation uses the same eight-digit calendar date format as POS receipts. A screenshot of Recent Orders has no accompanying change instruction.

## Files and database

- Receipt page, `sale-print-actions.tsx`, shared `print-receipt.tsx`.
- Delivery note page, `delivery-status.tsx`, `delivery-queue.tsx`.
- `purchase-order.tsx` and nullable PO reference RPC typing in `database.types.ts`.
- Migration `20260930061338_mixed_document_refinements.sql`: business-scoped transfer uniqueness, store-scoped receipt uniqueness backed by business-wide counters, private insert triggers, independent PO states, guarded `save_purchase_order`, and release capability `mixed_document_refinements_v1`.
- Release contract, release fixture, PO interaction tests, SQL integration tests and simultaneous checkout/transfer tests.

## Verification

- Complete empty-database bootstrap and 54 database test groups passed, including stock, checkout, cash-up, delivery, PO permissions, tenant isolation and concurrent numbering/replay.
- 276 of 277 application tests passed on the full run. The existing delivery Excel export test exceeded its five-second limit while the build was running; all six tests in that file passed on an isolated rerun, without code changes.
- TypeScript, lint, production build and live database release check passed.
- Migration applied to the live Supabase project. Before/after fingerprints confirm all 53 existing receipt records/snapshots and nine transfer references remained unchanged.
- Security advisor reviewed. The PO RPC intentionally retains authenticated security-definer execution with store/module/role guards; the new private trigger is not callable by public, anonymous or authenticated clients. Existing unrelated advisor notices remain.

Physical printer output is unchanged and cannot be confirmed by a browser. New transaction creation and permission rejection were exercised with disposable local data rather than adding financial records to customer accounts.
