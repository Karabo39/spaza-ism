# Cash up returns products and navigation review

Reviewed 8 September 2026. This plan combines Cashup.docx, GoodsReturn (1).docx, Dashboard.docx and Products.docx, including their embedded screenshots, with a read-only review of the current application code. Application changes and deployment are not part of this review.

## Recommended order

1. Resolve cash-up ownership and calculation rules, return permissions, and expiry behavior.
2. Verify and finish return calculation, payment completion and expiry sale blocking.
3. Simplify cash-up around Start Day, End Day, Count Cash and Complete.
4. Improve product identification, search and expiry entry.
5. Apply navigation changes and verify the complete workflows together.

Keep Create an account on the login page and public business-owner registration enabled for testing. Close registration only when explicitly requested.

## Cash up

The document requests opening cash, automatic transaction totals, a simple end-of-day summary, expected drawer cash, physical cash counted and the difference. Paid invoice amounts count on the payment date; unpaid amounts and credit issued are shown separately. Manual entry of sales totals is unnecessary.

The current implementation has one cash-up per store and business date, opening cash, automatic cash sources, counted cash, submission, manager approval and reopening. It is not a separate session for every cashier. A cashier-specific shift model requires transaction and drawer attribution, not just a different screen label.

The document contradicts itself about opening cash: it calls it change money, then calls it sales. Recommended definitions:

| Figure | Meaning |
| --- | --- |
| Opening cash | Change money already in the drawer; included in expected drawer cash |
| Money received | Cash and card/EFT sales payments plus invoice and credit payments, each counted once |
| Net collected | Money received minus actual refunds paid, across payment methods |
| Credit issued | Goods supplied on credit; displayed separately from money received |
| Expected cash | Opening cash + cash sale payments + cash invoice payments + cash credit payments + cash added - cash refunds - cash removed |
| Difference | Cash counted minus expected cash |

Using the document's figures, money received is R10,000 and net collected is R9,800 after R200 of refunds. The R500 opening float and R800 credit issued are separate. The R10,800 activity figure combines credit issued with receipts; it should not be labelled collected cash. The separate drawer example correctly produces R6,600.

Proposed screen: Start Day with opening cash; automatic payment summary; End Day with physical count; clear Balanced, Short or Over result; Complete End of Day. Preserve approval and correction history while making these controls less prominent for the cashier. Before implementation, decide whether completion closes only the cashier's shift or the shared store drawer, how later transactions are handled, and who may reopen it. Recommended default is manager-authorized reopening with a reason; do not silently rewrite an approved count.

Acceptance: opening cash never inflates sales; partial invoice payments contribute only paid amounts; card/EFT does not increase drawer cash; old credit payments count on receipt; refunds count once; simultaneous payments cannot produce a stale approved cash count.

## Goods returns

The document requests standard-user capture, approval and refunds; recognizable original sale selection; quantity-based return value; expiry as a reason without a fee; editable payment reference before recording; and no payment edits after completion.

Current code already includes product names and quantities in checkout-sale choices, employee approval/refund delegation per store, a remaining-refundable calculation, and read-only payment history once fully refunded. Invoice choices still emphasize long references. Verify these current paths using the affected employee and store before treating the screenshots as current failures.

No fixed R17 expiry fee was found in the reviewed calculation. The screenshot shows one returned item valued at R17. The code prorates the original sold line value by returned quantity; the original transaction must be inspected to establish whether R17 was correct. Do not change historical values based on the screenshot alone.

Recommended improvements:

- A searchable original-document picker showing product and quantity, date, customer where present, amount and a short reference. Multi-item sales must remain distinguishable.
- Show original unit price, returned quantity, return value, previous refunds and remaining amount before confirmation.
- Use the original charged price, including its discount/tax allocation, rather than today's catalogue price. A price change after purchase should not change the recorded return value. This interpretation needs confirmation because the document says selling price without specifying which date.
- Default refund payment to the full amount currently refundable, with an explicit choice if partial refunds remain allowed. Unpaid invoice returns reduce debt; they must not automatically produce cash the customer never paid.
- Keep the generated refund receipt reference permanent. Allow a separate external payment reference to be edited before recording and then preserve it in the payment history.
- After settlement, retain a readable receipt/history with no editable payment form. Expired stock must not re-enter sellable stock even when the customer is refunded.

Acceptance: two returned units use the original two-unit value; expiry reason does not change the price; total returns cannot exceed sold quantity; refund retries do not pay twice; standard-user rights match the chosen policy in the correct store; completed payment controls disappear while receipt history remains available.

## Products and expiry

The document requests a Barcode column, searchable filtering by product name, visible expiry beside the barcode, an expiry calendar when tracking is enabled, support for existing products and prevention of expired sales.

The current product list searches names and does not display barcodes. Product details show barcodes. The edit dialog changes the tracking flag but has no date input. Existing stock batches already contain store, quantity and expiry date; the current expiry reports use those batches.

Recommended design keeps expiry against the physical batch. The same product and barcode may have new and old stock with different dates. The product screen should show nearest expiry and a batch breakdown rather than overwriting all stock with one date.

When tracking is enabled, show date and quantity fields for the stock being assigned. Existing stock must be allocated across dated batches without adding stock or erasing existing batches. Future receipts require their own date. If the product has zero stock, recommend allowing the catalogue record and requiring a date when stock is received; confirm this exception to the document's mandatory-date rule.

Block sales from expired batches on the server, not just in the product form. Review checkout, invoice goods issue, order fulfilment, imports, adjustments, transfers, unpacking and offline synchronization so they preserve correct batch quantities. Allocate unexpired stock by earliest expiry first. Display total stock separately from sellable stock and flag undated tracked stock for correction.

The date boundary also needs a rule. Proposed default: an item dated 10 September can be sold through that date and is blocked from 11 September using the store's business timezone. This is a proposed product rule, not a statement about a particular product's safe-use requirements.

For search, support product name and barcode across all matching records, preserve filters between pages, and keep same-name products as separate rows. Show all assigned barcodes without duplicating stock totals. Include barcodes and expiry information in the relevant exports.

Acceptance: same-name/different-barcode items remain distinguishable; a product with expired and fresh batches can sell only its fresh quantity; missing dates cannot bypass tracked-stock controls; assigning dates to existing stock leaves total quantity unchanged; concurrent and offline requests cannot bypass the expiry rule.

## Navigation

Move Operations into Catalog. Catalog order becomes Products, Operations, Suppliers, Data Imports and Exports. Remove the standalone Low Stock sidebar link while keeping low-stock filtering in Check Stock. Rename Excel imports consistently in navigation, page heading and breadcrumbs. Existing download/template tools already provide an export-related action; the new label does not itself imply new file formats.

Keep direct links and permissions working. Check visibility for employee, manager and owner roles, narrow screens and active-store switching. The Dashboard document requests navigation changes, not replacement dashboard metrics.

## Decisions requested

- Shared store drawer or separate cashier drawers/shifts?
- All employees with Goods Return access can approve/refund, or owner-granted rights per store?
- Multiple expiry dates per product batch or one date for all stock?
- Keep opening cash separate from sales and collected money?

Further rules to settle in the final specification: original charged price for refunds; optional partial refunds; expiry-day cutoff; zero-stock expiry entry; and who may reopen a completed day. Recommendations are recorded above so these decisions can be answered without redesigning the plan.

## Delivery and verification

Implement in small functional groups after the decisions are resolved. Preserve existing transaction history and test database updates on representative records before deployment. Cover return permissions, original prices, partial and duplicate refunds, batch reconciliation, expiry-day boundaries, cash totals and shared-drawer/shift behavior. Check phone layouts and search/export consistency. Report what changed and what passed before the requested main-branch push.

## Implemented decision record — 8 September 2026

The user approved proceeding with the recommended defaults: one shared drawer per store/day, owner-granted return approval/refund rights per store, expiry per batch, and opening cash separate from collections. Original charged prices, partial refund safeguards, sale-through-expiry-date, zero-stock tracking without a date and manager reopening remain the chosen rules. See [release details](batch-expiry-cashup-release.md) for implementation and verification.
