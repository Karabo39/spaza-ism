# Customer invoice delivery and document branding

Implements Customers (1).docx, System Changes (4).docx and Invoicing (2).docx.

## Delivered behavior

- Customers have an optional **Automatically email invoices** setting on creation and in their profile. A valid email is required. Future invoices enter the delivery queue when issued; drafts and historical invoices are not sent retroactively.
- Recurring invoices have **Send Time**, evaluated in the store's configured time zone. Existing schedules retain midnight; new schedules default to 08:00. Generation and email delivery are checked every minute; this is not a guarantee of inbox delivery at an exact second.
- **Manual Send** opens a review with customer, items, prices, tax, total, terms and recipient. **Edit** returns to editing. Confirmation issues an additional invoice and queues its email. It does not advance, activate or modify an existing schedule. An unsaved schedule is stored inactive. Repeating an uncertain request returns the same invoice rather than issuing another.
- Invoice delivery uses the existing Hostinger SMTP worker and configured `invoice@posinventory.store` sender. An explicit recurring recipient takes precedence over the customer's default; only one delivery is queued for an issued invoice. Current access is checked before sending.
- Settings has a separate **Document logo** with preview, save, replace and removal. Only business owners can change it. Images are normalized to bounded PNG files in private, business-scoped storage. Navigation branding is independent.
- The logo appears at the top left of PDF and Excel exports, emailed documents, import templates, stock-count workbooks, invoice/return receipts and **Goods Out receipts**, as confirmed by the owner. PDF continuation pages reserve space for it. Goods Out printing waits for the image to load.
- CSV remains text-only because that format cannot contain an embedded image. Existing unbranded and new branded import templates are both supported.

## Changes

- Database: `20260928185317_document_branding_invoice_delivery.sql`; customer preference, document branding and private storage policies, send time, invoice-issue queue, idempotent manual-send RPC, authorization rechecks, scheduler and release capability.
- Interface: customer picker/profile, recurring invoice editor/review, Settings document logo and receipt headers.
- Exports: shared report PDF/Excel, emailed reports/documents, import templates and stock-count workbooks.
- Worker: `recurring-invoices` and shared image validation. Existing custom worker authentication and SMTP duplicate protection remain in place.

## Validation

- 243 automated tests passed across 63 files; lint and production build passed.
- Fresh local database: all migrations, 41 SQL workflow suites and both concurrency suites passed. Additional checks cover unsaved schedules remaining inactive and revoked users being unable to email queued invoices.
- Tested customer opt-in, draft exclusion, manual confirmation/retry, unchanged scheduled dates, credit limits, time zones, private logos and tenant isolation.
- Branded customer-import and stock-count Excel round trips passed. A six-page PDF was rendered and visually reviewed; the logo is present on every page without overlapping the table.
- Live database migration applied; private logo bucket, release capability and minute schedules verified. Email worker version 4 deployed and active.

## Boundaries

No historical customer preference was opted in automatically. No additional invoice was issued to a real customer merely for release testing. Inbox delivery and physical printer output are separate from successful queuing/SMTP acceptance and cannot be asserted from these tests. A business must select its document logo in Settings before it appears; its navigation logo is not copied automatically.
