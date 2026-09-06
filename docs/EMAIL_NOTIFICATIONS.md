# Report email and scheduled notification setup

Report downloads work without an email provider. Report email and the scheduled
worker use Resend; no delivery credential is sent to the browser.

## Application environment

Configure these server-only Vercel variables:

- `RESEND_API_KEY`: a Resend sending key.
- `REPORT_EMAIL_FROM`: a verified sender, for example `Shop reports <reports@your-domain>`.

The report email endpoint requires a signed-in user and the active location. It
limits each user to 20 report emails per day, records request IDs, and uses the
same Resend idempotency key after an uncertain response. Do not retry an uncertain
send beyond 23 hours; verify delivery before starting a new email.

## Scheduled worker

1. Apply migrations through 0025 and deploy `scheduled-notifications` with the
   included Supabase function configuration.
2. Configure its `RESEND_API_KEY`, `REPORT_EMAIL_FROM` and a random
   `NOTIFICATION_CRON_SECRET` of at least 32 characters. Supabase supplies the
   function's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; this privileged key
   stays inside the Edge Function.
3. Save `spaza_project_url` and `spaza_notification_secret` in Supabase Vault. The
   latter must match the worker's random secret.
4. Run `supabase/deploy/schedule-notifications.sql` to create the hourly check.
   It refuses to schedule until those Vault secrets exist. The script configures
   the named job, so rerunning updates that schedule instead of creating copies.
5. Owners and managers enable their own email preferences in Settings. All
   preferences default off. Recipients come from their account email and must
   retain manager/owner access to the location when a job is claimed.

Daily checks run after the chosen hour in South African time. Weekly profit is
eligible from Monday at that hour and covers the previous calendar week. Stock
take completion is checked hourly. Empty operational reports are skipped. Each
email contains at most 100 detail rows and a full matching-record count.

The worker reads live data when claiming a delivery. An uncertain retry preserves
that payload and delivery ID to prevent duplicates at the provider. Claimed jobs
can retry after ten minutes, up to five attempts and within 23 hours. Successful
periods are not sent again. Settings shows the latest delivery checks and errors.

## Verification before enabling production email

Use a staging sender and explicitly selected test recipient. Confirm tenant and
location permissions, active preferences, scheduled cadence, empty reports,
delivery failures and provider idempotency. No email was sent and no live schedule
was enabled during local development.

Implementation references: [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions),
[Supabase function authentication](https://supabase.com/docs/guides/functions/auth),
[Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
