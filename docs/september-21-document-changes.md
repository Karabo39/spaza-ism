# September 21 document changes

Implemented requests from Goods Out.docx, Goods In.docx, Bulk Stock.docx, Reports (2).docx and Cash Up.docx.

## Products and sales

Choose **Quantity Tracked** for physical stock or **Sales Tracked Only** for prepared items such as kota and chips. Sales-only products need no opening stock and show **N/A – Sales Tracked Only** in stock screens and exports. Checkout still records quantities, payments, credit, receipts and approved returns; it does not create physical stock movements. Offline sales follow the same rule.

Tracking mode cannot change after sales/order history, bulk configuration, physical stock or active stock counts exist. Create a new product when a historical product needs a different tracking model; this prevents older reports changing meaning.

## Bulk receiving and unpacking

On Products, enable **Bulk Stock**, enter the bulk unit and units per pack, and save. The linked bulk balance starts at zero. Goods In first selects the main product, then offers Individual or Bulk Stock. Receiving packs uses this existing configuration. Unpack converts available packs into individual units using the configured ratio.

The catalogue presents one main product with its linked bulk balances. Internal dependent product IDs remain for compatibility with existing stock, transfers and audit history; they are hidden from the main catalogue and normal product search. Existing pack quantities and historical references are preserved. Bulk stock cannot be disabled while stock or an unfinished transfer remains.

Warehouse View Stock supports product configuration. A destination needs a matching bulk configuration before receiving transferred packs. Warehouse stock decreases at dispatch and destination stock increases on receipt, retaining stock in transit.

New receiving and stock movement records capture Individual or Bulk Stock. Historical immutable records are unchanged; reports derive their display label from the linked product when needed.

## Reports

Reports are listed A–Z. Fast Moving is now **Stock Analysis** and Slow Moving is removed from the list. The older Slow Moving URL remains available for existing bookmarks.

**Quantity vs Sales Report** filters by store, date, product, cashier and tracking type. It shows units sold, returned and net units, plus net revenue. Issued invoice goods count once. Approved returns reduce the totals on their approval date and are attributed to the original sale cashier. Store and module permissions apply.

## Cash Up

The dark layout now has Cash Sales, Card / EFT Sales, Total Sales and Cash Expected cards, a Cash Summary beside the shift/count flow, and collapsed drawer controls. On phones the panels stack without horizontal scrolling.

Total Sales counts checkout sales and issued invoice goods. It is separate from payments collected, opening cash and credit repayments. Existing expected-cash calculations and approval controls remain.

Cashiers can see and submit their own shifts. Managers and owners with module access can review store shifts and manage the drawer. After another cashier’s shift is approved, the next cashier gets only the handover amount needed to start a new shift, without access to the previous cashier’s submission history. Historical approved counts and submissions are not rewritten.

## Verification

- 194 application tests across 53 files passed.
- TypeScript and ESLint passed.
- 36 database suites passed on a fresh local database, including payment and credit controls, sales-only returns, bulk receiving/unpacking/transfers, cashier permissions and shift handover.
- Existing bulk-stock and approved cash-up upgrade fixtures passed without changing historical quantities or counts.
- Warehouse disable concurrency checks passed in both operation orders.
- Cash-up desktop (1440 px) and phone (390 px) layouts were visually inspected; neither overflowed horizontally.

No production test transactions or emails were sent. Uploaded Word documents and credentials are excluded from source commits.

Production build passed. Both database migrations were applied; the follow-up policy change evaluates the authenticated user once per statement without changing access rules. Existing advisor findings remain; the new report adds one intentionally authenticated security-definer RPC, guarded by store/module access.
