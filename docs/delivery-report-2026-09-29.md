# Delivery Report — 29 September 2026

## Where to find it

**Reports → Delivery Report** shows generated customer delivery notes. An order enters this report once its paid delivery note exists. Unpaid orders without notes remain in Orders.

Choose one branch or all report-enabled branches in the active business. Apply customer/driver text, delivery status, payment status, delivery note number, order number, invoice number and date filters. Dates can refer to the order, delivery-note generation, scheduled delivery or delivery confirmation; each branch uses its local calendar date. Text filters are case-insensitive partial matches.

Browsing loads 50 records per page. View all details expands the remaining fields without another request. All requested identification, customer/contact, branch, driver/vehicle, dates, status, order value/currency, payment, attempt count, rescheduling, failure/cancellation, confirming user, recipient and comments are available. Driver and vehicle remain optional typed fields in Manage delivery; they no longer prevent dispatch.

## Statuses and totals

Pending means a pending delivery due today or earlier. Scheduled means a pending delivery with a future date. Out for Delivery, Delivered/Completed, Rescheduled, Failed and Cancelled are distinct statuses. Attempt count counts dispatch events; rescheduling without dispatch does not create an attempted delivery. Rescheduled date and failure reason use the latest respective history event.

Summary cards cover all matching records, not only the visible page. Each status has a count. Total Delivery Value is the original invoice order total and includes cancelled deliveries. It is not net revenue, refunds or cash collected. Currency totals are kept separate.

## Numbering

New notes use `DNN-YYYYMMDD-001`, allocated transactionally per business and note-generation calendar date. Branches in the same business share that date's sequence; a note's date is determined in its branch timezone. Concurrent payments cannot allocate the same number. Rescheduling does not change the note number.

Numbers use at least three digits. After 999 they expand to 1000 rather than truncating, reusing a reference or preventing payment. Historical note references are preserved; the live database contained no notes when the change was applied.

## Permissions and outputs

Access Control now includes four store-specific permissions under Reports:

- View Delivery Report
- Print Delivery Report
- Export Delivery Report to Excel
- Export Delivery Report to PDF

Each output permission depends on View. Report permissions do not grant delivery editing. Every request verifies current membership, business/store scope and the relevant action permission. Selecting multiple branches requires that action in every selected branch. Revoked permissions block subsequent page/export requests. Ordinary browser printing/copying of already visible information cannot be revoked by these application controls.

Print, Excel and PDF fetch all matching records only when requested. Exports use a fixed sequence boundary so newly created notes are not unexpectedly added halfway through. Records may still change operationally while a large export is being assembled; refresh for current status. Excel has separate Summary and Deliveries sheets, numeric amounts and literal text cells. PDF and printing provide a summary followed by readable detail pages; long comments may continue onto another page. PDF continuation tables retain the delivery reference.

## Changes and verification

Migration `20260929162240_delivery_reporting.sql` adds private numbering counters, scoped unique references, optional-driver dispatch, report permissions, an indexed/guarded report RPC and release readiness. Expensive event enrichment happens only after selecting a bounded page.

The report page and navigation are in `src/app/(app)/reports`; UI/data/export logic is in `src/features/deliveries`. Module definitions, typed database calls, delivery controls and release checks were updated.

Validation completed before publishing:

- 260 application tests passed. An initial parallel build/test run timed out three tests; all passed when rerun with two test workers.
- Fresh-database migration/regression suite passed, including delivery report filters, status totals, currencies, paging, optional driver, report-only access, export denial, revocation and tenant isolation.
- Concurrent payment/numbering tests passed with unique sequential references.
- Production build, TypeScript, lint and live database release readiness passed.
- Excel was reopened and checked for sheet contents, numeric values and literal formula-like customer text. PDF pages, including long-comment continuation, were rendered and visually checked.

The live migration was applied successfully. No customer deliveries, payments or stock were created or changed for live verification. Physical printer output has not been tested.

Supabase's [security-definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) flags the intentionally callable report RPC; explicit current permissions protect every store/action. The [no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) concerns the private numbering counter, which has no client grants or policies by design.
