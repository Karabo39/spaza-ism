# Quotations returns and stock exports

Implemented from Invoices.docx, GoodsReturn.docx and CheckStock.docx on 7 September 2026.

## Where to find the changes

- Invoices → Create quotation / Quotes: save draft quotations, reopen and edit drafts, mark sent or accepted, cancel, export, email and review conversion to an order.
- Goods Return: checkout choices show products and quantities; approved returns show remaining refundable credit. Fully refunded returns retain their history without payment entry controls.
- Access Control → select a standard user → Delegated return actions: independently allow approval/rejection and recording refunds at that store. Goods Return module access is still required. Owners manage delegation; existing manager powers remain.
- Check Stock: select a stock category and search, then choose Excel, PDF or CSV. Export all matching products across pages, or explicitly choose the current page. Email uses the same selected data and format.
- Quotations, orders and invoices: optional customer PO reference, received/approved tracking and attachment download. PO approval requires a manager or owner.

## Behaviour and limits

Quotations do not reserve or deduct stock and do not create receivables. They retain product names, units, prices, discount and tax. Conversion rechecks active products and available quantities; users can reduce quantities or remove items by setting quantity to zero. The original quote remains unchanged, and its discount is apportioned to the retained subtotal. Conversion creates one draft order, which continues through the existing confirmation, invoice and goods-release process. Availability can change again before goods release.

Drafts have version checks to prevent overwriting another user's changes. Sent/accepted quotations retain their terms. Expired or cancelled quotations cannot be converted. Quote listings show the latest 200 matches and support customer search.

Refund amounts use the original transaction's prorated line value, including invoice discounts and tax. Expiry affects stock disposition, not the amount. The available cash refund also accounts for earlier refunds and customer debt/credit usage. The default reference comes from the most recent referenced invoice payment or original checkout payment, falling back to the return reference. Users can change it before posting. Switching returns clears pending payment fields.

PO files accept PDF, PNG and JPEG up to 2 MB. They are stored privately with explicit authorised download access. A PO remains optional, including when converting a quotation. Adding one after conversion still links it to the quote, order and invoice.

Stock exports support up to 5,000 matching products. Larger sets require a narrower search or current-page export. Exports include store, filter, search and generation time. Email retains the existing configured sender, delivery provider, retry protection, daily rate limit and payload-size limit. No customer email was sent during verification.

## Validation

- All 20 database suites pass from an empty local database, including new document workflow tests.
- Covered quote retry/edit conflicts, no stock/debt effects, unavailable conversion, duplicate conversion, preserved invoice terms, optional/late PO linking, PO access, delegated return actions, original net refund amounts, partial/full refund caps and stock exports beyond 20 rows.
- UI tests cover refund field resets, completed refunds, action permissions, export scope and email module permission checks.
- Existing concurrency checks pass for access changes, payment retries, stock count submissions and approval races.
- Desktop and 390-pixel phone previews inspected using fictional data; no horizontal overflow or browser errors. All three quote export formats downloaded successfully.
- Production build and TypeScript checks pass. Existing lint warnings remain outside this change; no lint errors.

## Deployment

Apply the three migrations in order before deploying the application:

1. `20260907202009_return_controls.sql`
2. `20260907202427_stock_exports.sql`
3. `20260907202639_quotations_purchase_orders.sql`

The application release contract requires `document_workflows_v1`. The hosted build checks this capability and will block deployment if migrations are missing. New RPCs use the project's guarded workflow pattern; table writes remain unavailable to browser roles. The Supabase advisor flags authenticated security-definer workflow functions for review; their explicit store/module/action checks are intentional and are covered by allow/deny tests.
