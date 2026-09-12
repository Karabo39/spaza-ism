# September 12: checkout, receipts, staff attribution and navigation

The four change requests are implemented: GoodsOut.docx, Orders (3).docx, System Changes (2).docx, and PAYMENT, CHANGE CALCULATION & RECEIPT PROCESSING.docx.

## Checkout

- Cash records the actual tender, remaining balance and change. Card and EFT are separate and require external-payment confirmation. Split payments use one amount per method, which can be edited or cleared before completion. Credit retains existing customer-limit and manager-approval controls.
- The database validates payment precision, duplicates, underpayments and noncash overpayments. One transaction saves the sale, stock movements, payment rows and immutable receipt. A retry uses the same request ID.
- Cash-up counts cash retained after change. Payment Report shows individual payment methods; Goods Out includes the cash part of split sales without counting the sale twice.
- Add Product and Cancel Sale use the existing pink primary style. Cancellation clears an unsaved cart without creating a sale. Pending or unconfirmed submissions cannot be edited or cancelled.
- Interrupted checkouts are kept in browser storage per user and store. Retry checks for the saved sale before resubmitting. Offline cash retains tender details and cashier identity; it only syncs under the original cashier. Outbox and mirrored stock updates are atomic. Earlier offline queue entries retain their original replay path.

## Receipts and printers

After a confirmed sale, the cashier chooses Print Receipt or Don't Print. Saved receipts remain available in Goods Out for searching, printing, PDF saving and email. Printing does not create or cancel a sale. Email uses the existing Hostinger invoice sender and delivery safeguards; scheduled email reports remain disabled.

Managers can open Goods Out → Saved receipts → Store receipt settings to choose:

- 58 mm thermal, 80 mm thermal (default), or A4 paper.
- Whether a store copy is requested automatically.
- A delay of 2–5 seconds after the first print dialog closes.

Each store selects its installed USB, network or Bluetooth printer through its operating system's print dialog. This avoids tying the application to one manufacturer. The driver and selected paper must match the printer. Bluetooth devices that do not expose a system printer may require their manufacturer's bridge or driver; physical compatibility has not been tested on shop hardware.

The application requests the second print after the selected delay and provides a manual repeat button. Browsers can require confirmation or block automatic dialogs; this is not a promise of silent hardware printing. Print events record REQUESTED, COPY_REQUESTED or DECLINED. Physical paper output remains unverified, including when a dialog is cancelled.

Receipts preserve product names, quantities, prices, currency, cashier, optional till label, tender, change and references. Checkout does not currently calculate a separate VAT component or document discount: receipts explicitly state VAT is not separately calculated and record zero document discount. Existing invoice VAT/discount handling is unchanged. Historical checkout rows retain their previous reporting classification; immutable receipts begin with this release.

## Staff names and sidebar

Orders capture Ordered By and invoices capture Invoiced By independently. Both retain the original order creator when invoicing later. Names appear in details, the recent lists, invoice print/PDF/email documents and invoice exports. Profile edits cannot change these snapshots. Older documents show Not recorded rather than presenting today's profile name as historical evidence.

Sidebar sections collapse independently and remember their state for each user/business. Dashboard remains outside the groups. Existing module and role visibility is preserved. Headings support keyboard interaction and expanded-state labels.

## Verification and deployment

- All 29 local database rollback suites passed, including checkout validation, payment reporting, print choices, invoice attribution, cross-business access and receipt email preparation.
- Concurrent checkout retries produced one sale, one stock deduction and balanced payment rows.
- Browser review covered desktop and 390 px layouts, split tender/change, the receipt choice, Don't Print, cancellation, and sidebar persistence. Browser testing used local mock data; financial logic was verified against local PostgreSQL.
- All 160 unit tests, TypeScript, lint and production build passed. Unit checks include delayed second-copy requests and offline exactly-once stock updates.
- Live migrations applied as checkout_payments_receipts (20260912074543) and document_staff_attribution (20260912074602). The production release capability check passed.
- Security advisor review introduced only the three expected notices for authenticated privileged RPCs. Each denies anonymous execution and checks store module access; settings also require manager access. These privileges are intentional because clients cannot write financial tables directly. See the [Supabase function-execution advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

No live test sales or customer emails were created during this release.
