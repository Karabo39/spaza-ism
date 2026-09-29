# Customer document emails — 29 September 2026

Customer transactions now share a professional HTML email with a plain-text alternative and an attached PDF. Sending continues through the existing Hostinger SMTP account and document sender; no new provider or credentials are required.

## Customer controls

Customer Profile → **Email Notifications — all customer documents** enables future automatic notifications to the saved customer email. A valid email is required. New customers also have this option. Existing invoice-only preferences remain invoice-only until deliberately changed; the migration does not enroll customers or email historical transactions.

The customer page includes **Customer email notifications**. Expand it to see the latest 50 permitted deliveries, refresh their status, or generate and email a statement for a selected date range. Statement generation is explicit: browsing a customer or exporting the existing on-screen list never sends an email. A statement includes all account entries within the requested period, opening/closing balances, and an immutable snapshot. Periods are limited to 366 days and 10,000 entries, with an error rather than silent truncation.

Cash/card checkout can optionally select a customer for receipts. Walk-in sales remain available. Selected customers must belong to the current store and be active. Cash/card attribution does not create account debt. Offline cash sales retain this customer and notify only after successful server synchronization.

## Supported events

| Activity | When queued | Attachment |
| --- | --- | --- |
| Invoice, including recurring invoice | Invoice issued | Invoice with items, totals, payment status, outstanding and due date |
| Order | Confirmed or cancelled | Order confirmation/cancellation and items |
| Goods Out at checkout | Successful cash, card, split or credit sale with a selected customer | Sales receipt, payment details, cash/change where applicable |
| Invoice goods release | Goods successfully issued | Goods Out document with invoice reference |
| Invoice payment | Posted payment | Payment receipt and invoice balance |
| Account payment/adjustment | Posted standalone account entry | Receipt/adjustment with recorded account balance |
| Return | Approved, including automatic approval | Combined return/credit note; associated invoice credit entry is not emailed again |
| Credit/debit note | Posted standalone invoice adjustment | Credit/debit note |
| Refund | Recorded refund | Refund receipt |
| Delivery | Note generated, dispatched, completed, failed, rescheduled or cancelled | Delivery note reflecting that event, schedule, items, recipient/driver information and signature spaces |
| Quotation | Marked Sent | Quotation with validity date and items |
| Statement | Generated using Generate & email statement | Complete account statement for the selected period |

All emails identify the customer, business, document type/number, transaction date, store, related reference when available, summary, currency/total, payment status, and applicable outstanding amount and due date. PDFs include the configured document logo. Existing manual invoice/receipt/return sends use the same email template while retaining their current explicit recipient and PDF workflow.

Explicit recurring schedules and Manual Send retain their existing independent authorization. There is still only one invoice queue, preventing duplicate invoice emails when both a recurring schedule and customer preference apply.

## Delivery safeguards

- Notifications are recorded transactionally. Rolled-back actions cannot leave an email behind; deferred triggers see completed line items and totals.
- Unique event keys and statement request IDs prevent duplicate jobs on retries. Customer contact changes and opt-outs suppress unclaimed automatic mail. Changes made after a job has already been claimed cannot recall it.
- Claims recheck the transaction user's current store/module access and the customer's current email/consent. Cross-store customer attribution is rejected.
- The new queue is protected by RLS. Customers-module access and source-document module access are required to view history. Only the service worker can claim or complete jobs; private helpers cannot be called by ordinary clients.
- A Vault-authenticated worker runs every minute, claiming at most five documents with row locking. Email delivery is outside checkout and financial transactions.
- PDF preparation failures retry up to three times, five minutes apart. SMTP outcomes that cannot be confirmed are held for review, never automatically resent. A durable SMTP reservation prevents replaying accepted mail.
- **Sent** means Hostinger accepted the message. It does not prove inbox placement, reading, or final delivery. There is no bounce/read tracking in this change.

## Implementation

- Migration `20260929170603_customer_document_notifications.sql`: customer consent, transactional event snapshots, protected outbox and worker APIs, statement generation/history, invoice consent rechecks, cash/card customer attribution, scheduler and release capability.
- `supabase/functions/_shared/customer-document.ts`: reusable dynamic HTML/text template and PDF renderer.
- `supabase/functions/customer-notifications/`: bounded, authenticated document worker using existing Hostinger credentials.
- `supabase/functions/recurring-invoices/`: shared invoice template/PDF; existing invoice queue and SMTP reservation keys retained.
- `src/features/credit/customer-emails.tsx`, customer profile/picker and customer detail page: consent, statement generation and lazy-loaded history.
- Goods Out and offline queue: preserve optional customer attribution through online/offline checkout.
- Existing document email route/loader: shared customer email format.
- `release-contract.json`: requires `customer_notifications_v1` before hosted deployment.

## Verification and rollout

The full local database suite passed against a fresh schema, including delivery, recurring billing, checkout, returns, cash-up, stock, permissions and concurrency tests. New regression tests cover completed-document snapshots, return/credit deduplication, statement idempotency, opt-out/contact changes, revoked access, RLS isolation, worker authorization, safe preparation retries, uncertain SMTP outcomes, HTML escaping and multipage PDFs. The production build and live database release gate passed.

Both email functions were deployed, the migration applied, and minute schedules confirmed active. At 17:07 UTC the live invoice worker accepted one normal queued invoice with the shared template/PDF (`sent: 1`, `uncertain: 0`); the new worker returned HTTP 200 with an empty queue. No test email was sent to a customer and no customer was newly opted in for testing.

Supabase's security advisor was reviewed. It identifies the two new guarded customer APIs as authenticated SECURITY DEFINER endpoints, which is intentional and covered by access tests. No anonymous grants were added. Existing private-table notices, extension placement and authentication configuration warnings remain outside this change. [Advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Operational limitations: SMTP cannot guarantee exactly-once inbox delivery. Staff must investigate unconfirmed acceptance before manually sending another copy. General-notification preferences default off, existing invoice-only and explicitly scheduled emails keep their previous behavior, and anonymous walk-in sales have no customer email target.
