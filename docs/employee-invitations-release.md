# Employee invitations — release and setup

8 September 2026. Implementation is available for testing. Public registration remains open. Email sending is not configured; the complete live email journey is not yet signed off.

## Available behavior

Owners use **Users → Add user**, enter the employee email and optional profile details, choose a role, then assign stores and modules separately for each store. A review page shows the access before sending. Unselected modules are denied; owners retain full business access.

Pending invitations create no active membership. Employees explicitly confirm the email link, enter first names, surname and phone, and choose their own password. Existing accounts retain their password. Email is read-only and protected by a database guard on Auth identity changes. Setup can be retried after a connection failure without duplicating membership.

Owners can edit access, resend or cancel pending invitations. Editing and resending invalidate the previous acceptance secret; correcting the email requires cancellation and a new invitation. Delivery status is separate from acceptance. “Sent” means the email provider accepted the request, not guaranteed inbox delivery.

The former add-existing-user API and direct membership insertion are unavailable to browser clients. Membership identity cannot be replaced through a direct update. Existing member role and active-state management remains available to authorized owners.

## Configure invitation email

In the Supabase project **uagswjbtipvlyeychfyb**, open **Edge Functions → Secrets** and privately configure:

| Secret | Value |
| --- | --- |
| `RESEND_API_KEY` | A Resend API key allowed to send email |
| `REPORT_EMAIL_FROM` | A sender address on a verified Resend domain, optionally with the POS INVENTORY display name |
| `INVITATION_APP_URL` | Optional; defaults to `https://posinventory.shop`. Use the exact origin without a trailing slash. |

Do not put secret values in source control or chat. The `employee-invitations` function is deployed. It verifies the caller with Supabase Auth and checks current owner authority before generating an authentication link. Authentication links and application acceptance secrets are never returned to the owner.

Saved unsent drafts expire after seven days. Sending or resending starts a **one-hour acceptance window**, matching Supabase's default email OTP lifetime. Verify the project's email OTP expiry is at least 3,600 seconds before testing; a shorter provider setting can expire confirmation sooner. Each send uses a new link. The owner can resend after one minute; creation is limited to 30 invitations per owner per hour.

If the sender is missing, the owner sees **Invitation email is not configured** and the invitation remains **Not sent**. No membership is activated. Failed or uncertain delivery is shown separately and can be retried.

Password recovery still uses the existing Supabase Auth mail configuration. Configuring the custom invitation sender does not automatically configure Auth SMTP or verify recovery delivery.

## Verification completed

- Production build, TypeScript and zero-warning lint passed.
- 119 unit/component tests passed, including explicit confirmation before token consumption, locked email, password setup, existing-account handling and interrupted acceptance.
- All 21 database suites passed. Invitation checks cover owner authorization, pending access denial, store-specific module grants, email-change guard, expiry, cancellation, old-link rejection, closed registration, existing-account acceptance and duplicate retries.
- Membership bypass checks reject the legacy API, direct insertion and replacement of a membership's user identity.
- Backup/restore reproduced 67 tables with matching data and access rules, including synthetic pending/accepted invitations and managed identities. Stock and credit reconciliation passed.
- Owner invitation review checked at 390px and 1280px: no horizontal overflow or browser errors.
- Both invitation migrations and the delivery function are deployed. Hosted schema compatibility check passed.

The security advisor reports private tables with intentionally no client policies, deliberately exposed authorization-checking functions, and the pre-existing leaked-password-protection setting. The new private tables have RLS and no browser grants. No additional unindexed foreign keys were introduced. [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter).

## Remaining live acceptance checks

The user confirmed Resend is not configured. No invitation emails were sent during this implementation. The available database query connection is read-only and no test-account Auth credentials were provided, so a direct live Auth email-change request has not been verified. SQL guard tests are not a substitute for that provider test.

After email configuration, use a designated test employee to verify:

1. New-user email delivery, confirmation on another device, profile/password setup and assigned store/module access.
2. A direct Auth email-change request is rejected; password setup and password recovery still succeed.
3. Existing-account acceptance preserves the password; resend, cancellation and expired links cannot activate access.
4. A preview/scanner opening the link does not consume confirmation. An explicit confirmation click is required.

Keep public signup open until these pass. Closing registration is a separate rollout: a trusted operator calls the service-only `set_registration_open(false)` function. Owners cannot reopen registration. Closed-mode direct signup and business-creation denial are covered by local database tests; repeat the provider journey in staging before closing production.

Licensing, device approval and IP restrictions are not enabled by this release.
