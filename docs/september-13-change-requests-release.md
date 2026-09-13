# September 13 change requests

Source documents: GoodsIn.docx, GoodsOut.docx, GoodsReturn.docx, Products.docx and Warehouse.docx in docs/changerequests.

## Receiving and permissions

Goods In separates supplier receipts from transfer receiving. Standard employees start with both receiving permissions off. An owner grants either permission separately for each location in Access Control; managers and owners retain role defaults. Transfer receiving does not require source warehouse access or Operations access. A destination cashier sees the original dispatched transfer and confirms it without editing products or quantities. Create, dispatch, submit/cancel and view permissions are separately available under Operations.

The user confirmed that stock decreases at dispatch and remains in transit until received. Receiving increments destination stock once and records the actual receiving user and timestamp. Cancellation remains unavailable to a receiving-only cashier. Existing batch allocations, unit costs, movement quantities and history are preserved.

## Warehouse

Administration now contains Warehouse after My Stores. My Stores creates and lists selling stores only. Warehouse creates multiple warehouses and shows their individual stock values and totals grouped by currency, with stock, SKU/barcode, unit cost, quantity and stock status. Location actions select the warehouse before opening stock, receiving, transfers, adjustments, stock take or movement reports. Totals include all active warehouse products; the detailed list/export is capped at 1,000 products and explains the limit.

Warehouse access is checked in database module permissions and the session. A user without Warehouse permission cannot use other modules to read warehouse stock. Dashboard's All business locations table lists selling stores only. Warehouses still cannot record sales.

## Checkout

New checkouts offer Cash, Card / EFT, Split Payment and Credit. Split Payment uses Cash plus a combined Card / EFT amount. This is the documented working assumption pending the user's optional clarification. Legacy CARD, EFT and three-part split payment drafts remain readable and retry with their original payloads. Confirmation, underpayment, noncash overpayment, change and idempotency controls remain enforced.

New credit receipts capture the customer name at sale time. Historical receipts retain their original snapshot; when possible, the linked account's current name is shown with that qualification. Receipt history, printed receipts and emailed documents include customer identity.

## Returns and products

Reason for return appears before Inventory action. Expiry is optional unless the reason is Expired, enforced on the server as well as in the form. Undated returned stock with expiry tracking remains unavailable for sale. Sidebar labels are Goods Return / Refunds and Cash Up.

SKU is optional when creating and editing a product. Internal lists, shared product searches, receiving and checkout carts, transfer details, stock take, adjustments and stock reports expose SKU. Existing import templates already support SKU. Customer receipt/invoice item descriptions remain product names without SKU.

Product editing links to individual expiry batches. Managers can correct a batch date with a reason. The database locks stock and the batch, rejects stale date/quantity values, preserves quantity and writes an audit entry. Original goods-in, sale and receipt history is unchanged.

## Database and release

- 20260913135357_warehouse_receiving_and_catalog_changes.sql
- 20260913140100_combined_checkout_and_credit_customer.sql
- Required application capability: warehouse_receiving_v1.

Validation: 30 local database suites passed, including a new authenticated regression suite. Application checks: 162 unit/component tests passed across the full regression run and targeted reruns; TypeScript, ESLint and the production build passed. The release-gate subprocess test was rerun alone after a CPU-contention timeout and passed.

No production test sale, stock movement, return, refund or email was created. Existing account creation for testing and email scheduling settings are retained.

Live migrations applied successfully:
- warehouse_receiving_and_catalog_changes: 20260913142804
- combined_checkout_and_credit_customer: 20260913142830

The live release compatibility check passed. Security advisories retain the existing baseline plus the four intentional authenticated, permission-checked RPCs introduced here. No new anonymously callable RPC or exposed table was introduced.
