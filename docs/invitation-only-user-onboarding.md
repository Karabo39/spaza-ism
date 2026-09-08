# Invitation-only employee onboarding

Status: implemented for testing, 8 September 2026. Database and application checks pass. Email delivery configuration and live email/Auth acceptance checks remain pending; see the [release and setup notes](employee-invitations-release.md). Public registration remains enabled.

Related design: [Licensing, approved devices and approved networks](licensing-device-network-access.md). Those restrictions remain a separate proposed implementation. Store/module permissions are enforced now.

## Intended experience

The owner adds employees directly from Users. Employees do not need to register first. The owner chooses their email, role, stores and module access, then sends an invitation. The employee confirms ownership of that email, fills in their details and chooses their own password. Access starts only when setup is complete.

Public registration remains enabled during testing. A deployment-controlled registration mode will later close public registration at both the application and authentication-provider levels. Invitations, existing-user sign-in and password recovery must continue working in closed mode. Uninvited people must not be able to create a business through a direct API call when registration is closed.

## Owner: Add user

Entry point: Users → Add user.

1. Enter the employee's email address. Name, surname and phone may be entered as provisional details for the employee to check.
2. Choose Employee or Manager. Only an owner may grant the Owner role. Existing owners retain access to all business locations; show that explicitly instead of offering misleading restricted-store selections.
3. Select the employee's stores. Require at least one store for a non-owner invitation.
4. Set module permissions separately for every selected store. For example, Goods Out and Check Stock at Main Street, and Check Stock only at Eastside. Unselected modules are denied. Existing transaction approval and refund controls still apply.
5. Review the email and access summary, then choose **Send invitation**. Owners never enter or receive the employee's password.

The user list shows the invited email, name when available, role, stores and status. Distinguish an invitation waiting for acceptance from one whose email failed to send. Offer Resend invitation, Cancel invitation and Edit assigned access while pending. Correcting an invited email cancels the old invitation and creates a new one; it does not transfer a confirmed identity silently.

Default authority follows the current system: owners manage users. A manager title alone does not grant invitation or access-management rights. Any future delegation must be explicit and cannot let managers grant permissions or locations beyond their own authorized scope.

## Employee: Complete your account

The invitation email identifies POS INVENTORY, the inviting business and the expiry time. Its primary action is **Accept invitation**.

After email verification, show a focused setup page:

| Field | Behavior |
| --- | --- |
| Email address | Visible and locked to the invitation. Explain: “Your email is managed by your employer.” |
| First name(s) | Required; employee can enter or correct it. |
| Surname | Required; employee can enter or correct it. |
| Phone number | Required; validate format. Do not describe it as verified without a separate verification process. |
| Password | New users choose their own password using the configured password policy. |
| Confirm password | Must match. |
| Assigned access | Read-only summary of the business, stores and modules. |

Primary action: **Save and continue**. Show **Your account is ready** after successful completion, then open an authorized landing page in an assigned store. An employee must never be sent to the business-creation onboarding page. If no usable modules remain, show an access-pending page with instructions to contact the owner.

Existing accounts with the same verified email sign in and accept the new business membership. Do not create a duplicate account or force a password reset that would affect their other memberships. Ask them to complete any missing profile details.

## State and access rules

Invitation states: Pending acceptance, Accepted, Expired, Cancelled. Delivery state is separate: Queued, Sent, Failed. An invitation can expire before or after email delivery; neither delivery nor opening a link activates business access.

Account setup is resumable if the connection fails after the password is saved but before membership activation. The completion action must be safe to retry and must not create duplicate memberships. Activation verifies the current invitation, authenticated identity, completed profile and required password setup, then atomically applies the latest owner-approved store/module assignments and marks acceptance.

An invitation is single-use and time-limited. Resending replaces the previous acceptance link. Cancelled or expired invitations cannot activate access, including when an authentication session was already created from the link. Email confirmation and invitation validity are separate checks.

An authenticated but unfinished account can access only setup, sign-out and recovery paths. Enforce this through database permissions and membership state as well as page navigation. Store/module assignments come from trusted invitation records, never from editable user metadata or form-supplied role values.

The email lock must apply to direct authentication API calls, not just the disabled input. Before implementation, verify a supported provider-level restriction or a carefully scoped identity-change guard. Do not consider the requirement complete until a direct email-change attempt is rejected while invitation confirmation, password setup and recovery still pass. A locked application profile field alone is insufficient.

## Fit with the existing database

- Keep the existing authentication identity, profiles, memberships, store_memberships and store_module_access relationships.
- Add business-scoped invitations linked to the inviter and normalized email, with expiry, acceptance/cancellation timestamps and an eventual authentication user ID. Keep only hashed application acceptance secrets; never store passwords in these tables.
- Store proposed store/module assignments against the invitation until acceptance. Validate business ownership of every referenced store and preserve existing role limits.
- Add separate first-name and surname profile fields. Preserve the current full_name display field for compatibility; do not guess a surname by splitting existing names automatically.
- Maintain audit events for invitation creation, delivery attempts, cancellation, acceptance and access changes. Never include passwords or acceptance secrets in logs.
- Use a server-only authentication admin integration for invitations. Check the requesting owner's authority before making privileged calls. Privileged keys must never reach the browser.
- Use a retryable delivery operation with a stable request identity. Show an invitation as sent only after the delivery provider accepts the request; this is not a claim that it reached the inbox.

## Implementation sequence

1. Add invitation records, access staging, registration-mode controls and permission tests.
2. Replace “add existing user by email” with the owner invitation form, including store/module assignment and the existing-account path.
3. Add invitation delivery, acceptance, profile/password setup and recovery from partial completion.
4. Add invitation status, resend/cancel handling, email immutability enforcement and audit coverage.
5. Test the complete journey and deploy with public testing registration still enabled. Switch to closed registration in a separately controlled rollout after invitation delivery and recovery have been verified.

## Acceptance checks

- Invite a new employee, confirm email, save profile/password, and enter only assigned stores/modules.
- Give the same employee different module rights in two stores and verify both allow and deny cases through direct API calls.
- Reject employee self-assignment, unauthorized manager invitations and cross-business store assignments.
- Reject changed email, changed invitation identity, expired/cancelled links, duplicate acceptance and old links after resend.
- Preserve a safe retry after delivery failure or interrupted account setup.
- Accept an existing account without duplicating or resetting its identity.
- Recheck changed or revoked access at acceptance; pending links cannot resurrect removed permissions.
- In closed mode, block direct public sign-up and unauthorized business creation while allowing invitations, login and recovery.
- Verify the email link on another device and handle email-scanner previews without unintentionally completing acceptance.

## Provider references

[Supabase email invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) provide the admin invitation primitive. [Password authentication](https://supabase.com/docs/guides/auth/passwords) documents password setup/recovery. [Before User Created hooks](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) support registration admission checks; that creation hook does not, by itself, enforce the separate requirement to prevent later email changes.
