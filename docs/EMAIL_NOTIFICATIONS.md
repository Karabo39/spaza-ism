# Hostinger email setup

POS INVENTORY uses Hostinger SMTP over certificate-verified TLS on port 465.
Resend is no longer required. Replies arrive in the existing Hostinger mailbox.

## Server settings

| Setting | Value | Location |
| --- | --- | --- |
| SMTP_USER | info@posinventory.store | Vercel Production and Supabase Edge secrets |
| SMTP_PASSWORD | Mailbox password; enter securely | Vercel Production and Supabase Edge secrets |
| REPORT_EMAIL_FROM | POS INVENTORY <reports@posinventory.store> | Vercel and Supabase |
| INVOICE_EMAIL_FROM | POS INVENTORY <invoice@posinventory.store> | Vercel |
| INVITATION_EMAIL_FROM | POS INVENTORY <registration@posinventory.store> | Supabase |
| NOTIFICATION_EMAIL_FROM | POS INVENTORY <updates@posinventory.store> | Supabase |
| INVITATION_APP_URL | https://posinventory.shop | Supabase |

Document, invitation and notification senders fall back to REPORT_EMAIL_FROM
when their dedicated setting is blank. SMTP credentials never go to the browser.
The existing orders alias can be used from Hostinger webmail; there is no separate
order-document email endpoint in the app.

## Authentication emails

Supabase Authentication SMTP settings: enable custom SMTP, sender
registration@posinventory.store, display name POS INVENTORY, host
smtp.hostinger.com, port 465, username info@posinventory.store, mailbox password.
Keep the per-user minimum interval at 60 seconds. Preserve existing authentication
and signup policies. Set production links to https://posinventory.shop.

Changing the mailbox password requires updating it in all three places:
Vercel SMTP_PASSWORD, Supabase Edge SMTP_PASSWORD, and Supabase Auth SMTP password.
Redeploy the web app after changing Vercel variables. No password belongs in Git.

## Using email

- Invitations: owner opens Users, creates an invitation with store/module access,
  reviews it and sends. Recipient follows the private acceptance link.
- Invoices and return receipts: open the document and its email action, confirm
  the recipient, then send. Attachments use the document's saved data.
- Reports: prepare the report, choose email, recipient and export format.
- Notifications: owners/managers enable their own options in Settings. Existing
  preferences remain unchanged; the scheduler only processes opted-in accounts.
- Account confirmation and password reset use the existing signup/reset screens.

## Duplicate prevention and uncertain deliveries

Apply the smtp_delivery_reservations migration before deploying the SMTP code.
Every application send first reserves its delivery key in the database. A second
request cannot send that same delivery while it is running or uncertain. Once
SMTP acceptance is recorded, retries reconcile the result without another send.
A stable Message-ID aids tracing but does not itself guarantee deduplication.

If a connection or recording error occurs after reservation, delivery remains
uncertain. The application does not automatically resend it. An administrator
must check the recipient mailbox and Hostinger delivery evidence before authorizing
a fresh request or resend. Never delete a reservation merely because it is old.
Only after proving a message was not sent may an operator remove the reservation
for a controlled retry. Existing owner invitation resends are new versions and
invalidate previous invitation links.

Existing per-user quotas, permissions and request validation remain in effect.
Hostinger applies additional mailbox limits shared by aliases; check the plan's
actual quota in hPanel. SMTP rejection does not trigger unbounded retries.

## Scheduled worker

Deploy employee-invitations and scheduled-notifications. Configure a random
NOTIFICATION_CRON_SECRET of at least 32 characters in Supabase Edge secrets and
store the same value as spaza_notification_secret in Supabase Vault. Store the
project URL as spaza_project_url. Run supabase/deploy/schedule-notifications.sql;
it creates/updates the hourly job at minute 15 without duplicating it.

Daily checks run after the chosen hour in South African time. Weekly profit runs
from Monday and covers the previous week. Stock-take completion is checked hourly.
Empty operational reports are skipped; emails include at most 100 detail rows.
Worker rechecks retain the payload and reservation; an uncertain SMTP send remains
blocked. Settings shows delivery status and errors.

## Verification

On 2026-09-11, all four controlled alias tests arrived at info@posinventory.store.
Their received headers passed SPF, DKIM and DMARC. No DNS changes were needed.
These tests verify delivery to the Hostinger mailbox, not every external provider.
Local tests cover authorization, reservations, accepted replays, uncertainty,
recipient rejection, safe SMTP options and attachment encoding.

References: [Hostinger mailbox limits](https://www.hostinger.com/support/4625828-parameters-and-limits-of-hostinger-email/),
[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Supabase function limits](https://supabase.com/docs/guides/functions/limits).

Activation status: Vercel SMTP and sender variables are saved; Supabase custom SMTP and invitation delivery are configured. Scheduled report deployment was blocked by automatic approval review and remains disabled pending explicit authorization for opted-in business report recipients. The temporary SMTP diagnostic has been replaced with a disabled response. No scheduler has been enabled yet.
