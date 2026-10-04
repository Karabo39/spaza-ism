# October document changes

Implemented from `Access Control_V1.docx`, `Changes Mixed (1).docx`, `Invoicing (3).docx`, `Orders (7).docx` and `System Changes (5).docx`, including their screenshots. `Goods Out (1).docx` contains a heading/logo but no actionable change instructions.

## Delivered

- Access Control now presents Owner and Employee, followed by the employee list and per-store permission editor. Owners retain full access. New employees receive no modules until granted. Existing effective permissions are preserved as explicit grants. Former manager functions have separate permissions for approval, product configuration, credit overrides, financial reporting and other sensitive operations. Navigation, pages, RLS and database functions enforce these permissions.
- Receipt, invoice and delivery-note Print actions load only the document in a hidden frame and keep the current application page open. Repeated clicks are blocked while printing. Receipt copy count, delay, audit and retry handling remain intact.
- Order and quotation totals use green, read-only summary boxes. Draft totals align with Save/Confirm; confirmed totals appear before Payment Due. Invoice subtotal, discount, tax and release time use the same treatment.
- Pay-To-be-Delivered invoices support a delivery fee beside Discount. The fee is included before tax at the invoice rate and appears on invoice/email documents. Goods discounts apply to products; product returns do not automatically refund the delivery fee. Amendments retain the fee and calculate product credits separately.
- Inactive recurring schedules can be deleted only after confirmation. The database also rejects deletion of active schedules or stale versions. Previously issued invoices, payments and manual-send history remain intact.
- Warehouse pages have a scoped pink Search Products control and an Enable/Disable action beside Sync Products. Disabled warehouses remain accessible to authorised administrators for re-enabling; operational actions remain blocked while disabled.
- Product/warehouse pagination remembers prior cursors, so Previous Page returns one page back. History is scoped to the store and filters and survives a reload in the same browser session. A directly bookmarked later page without prior cursor history does not offer a previous-page link.
- Download existing records fetches all matching records in bounded pages, removing the former 200-record download cap. Import processing retains its separate 200-row safety limit.
- Save All Count atomically saves edited quantities/expiry dates across stock-take pages, detects concurrent edits and leaves stock approval separate. Approval is blocked while local edits remain unsaved.
- Edit Store is removed from the overview and retained inside a store, with the same button size as Exit My Store.

## Decisions retained

- Permissions remain separate for each store. Existing access is preserved during conversion.
- Users, My Stores and Access Control remain owner-only. Operational and approval permissions can be delegated individually.
- The delivery fee follows the invoice tax rate before tax. Existing invoices receive a zero fee and are not recalculated.
- Test-environment Create Account remains available.

## Database and release

- `20261004013613_october_workflow_refinements.sql`: delivery-fee accounting/documents, guarded recurring deletion, atomic stock-count saving, disabled-warehouse management and bootstrap support.
- `20261004013654_employee_explicit_permissions.sql`: permission preservation, explicit employee defaults, approval capabilities, role conversion, invitation compatibility and server/RLS enforcement.
- Both migrations applied to the live Supabase project. The before/after effective-permission checksum matched exactly. The 61 existing invoices retained the same aggregate total (40,750.30), with zero delivery fees.
- The release contract requires both new capabilities. The live release check passed. Vercel remains configured for Dublin (`dub1`).

## Validation and limits

- 56 database test groups passed from an empty database, including permission-upgrade equivalence, tenant isolation, stock-count conflict handling, invoice fee calculations, preserved deletion history and concurrent checkout/delivery/stock release.
- Application suite covers 287 tests. The full run passed 284; three assertions still expected the old Manager wording. After updating those assertions, both affected files passed all eight tests. The added 501-record download test passed.
- TypeScript, lint and production build passed before release.
- Vercel successfully deployed the five main commits. Authenticated live checks passed for Dashboard, Access Control (role selection, employee list and permission editor), Products, Orders including the delivery-fee form, Invoicing, Recurring Invoices, Stock Take, Goods Out, Cash-up and Audit. A small follow-up fixes legacy garbled punctuation observed in billing labels; the affected order/invoice tests passed again.
- The signed-in business has no warehouses or recurring schedules. Those empty states loaded correctly; enabling/disabling warehouses and deleting inactive schedules were verified in the local database and component tests rather than by modifying another business's live records.
- Security advisor changes were reviewed: the private recurring-ID registry intentionally has no client policy or grants. New authenticated functions intentionally use guarded privileged execution; anonymous callers cannot invoke the new deletion/count functions. Existing unrelated advisor notices remain. See the [Supabase privileged-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Financial mutations, permission changes and deletion were tested against disposable local data, avoiding customer emails and new live financial records. Physical USB/network/Bluetooth printer output is not verified by these browser tests.
