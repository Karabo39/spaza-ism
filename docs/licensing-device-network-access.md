# Licensing, approved devices and approved networks

Status: proposed design. No licensing, network or device restrictions have been activated.

This extends the invitation-only employee onboarding design. Knowing the URL or having a valid password must not be sufficient to use POS INVENTORY.

## Access decision

Business access requires all of the following:

1. A valid signed-in user with completed onboarding and active membership.
2. An active business licence whose expiry has not been reached.
3. An approved, non-revoked device within the licensed device limits.
4. A request from an approved network for the selected store.
5. Permission for that store, module and action.

Check access on protected requests and database operations, not only at login. Changing stores requires another store-specific check. A licence or device restriction never grants extra module permissions.

## Licence administration

Licences belong to a customer business and cover its licensed stores. Keep expiry, status, maximum registered devices and any per-user device limit configurable; exact commercial limits have not been selected.

Only the product operator can issue, renew, suspend or change licence limits. Customer business owners can view their licence and usage but cannot extend their own expiry or increase purchased limits. Keep platform administration separate from customer Owner permissions and require strong authentication for it.

Suggested states: Trial, Active, Expired, Suspended. Trials also have an expiry. Use a server-controlled, exclusive expiry timestamp, displayed clearly in the business timezone. Evaluate expiry during access checks so blocking does not depend on a scheduled task running on time. Suspension takes precedence over a future expiry date.

At expiry, block business screens, reads, writes, reports, downloads and new transactions for employees and owners. Keep a limited licence-expired screen with support/renewal instructions and sign-out available. Do not delete business records. Renewal restores access only if membership, device, network and module checks also pass. Proposed default is no automatic grace period; any extension is explicit and audited.

Show owners advance expiry notices, for example 30, 7 and 1 day before expiry. These notice timings are proposed defaults rather than agreed commercial terms.

If payment-based automatic renewal is added later, verified server-side payment events must control activation. A browser success page must never extend a licence.

## Device registration

An invited user may request registration of the device they are using from an approved network. They give it a recognizable name, such as Front till or Stockroom tablet. The owner approves the request within the business licence capacity. Default states: Pending, Approved, Revoked. Pending requests do not provide business access.

Enforce device caps transactionally so simultaneous approvals cannot exceed the limit. A total business device cap is distinct from a simultaneous-session cap. A per-user device cap is optional and configured separately. Shared store terminals may have several authorized users; approving the terminal does not replace individual employee sign-in or permissions.

Owners can inspect registered devices and revoke a lost or replaced device. Revocation must affect subsequent protected requests, including existing sessions. Replacing a device releases its slot only when its approval has actually been revoked. A reduction in licensed capacity must produce a clear over-limit resolution flow rather than silently choosing which tills to disable.

Browser cookies can support device registration convenience, but they identify browser installations and can be copied or cleared. Browser fingerprints, user-agent strings and IP addresses are not trustworthy physical-device identity. A browser-only implementation must not be described as a guarantee that a particular computer is being used.

For the requested stronger restriction, use managed device enrollment with a private-access gateway and device certificate or supported device-posture checks. Prefer hardware-backed/non-exportable credentials where supported. Device credentials must be checked against the approved inventory; do not trust a device ID supplied by a web form. Ordinary synced passkeys alone should not be treated as a physical-device count.

## Approved networks

Maintain approved public IP addresses or network ranges per store. Business-wide ranges may cover explicitly approved central-office or private-network access. The default is to deny an unlisted network, including for owners.

Use the source network verified by trusted hosting/gateway infrastructure. Never accept an arbitrary browser-submitted IP or an unvalidated forwarded header. Cover IPv4 and IPv6 so one protocol cannot bypass the other.

An IP address identifies an internet connection, not a device. Many devices can share the same public address, so network restrictions must be combined with approved-device checks. Private addresses such as 192.168.x.x are not a store's public internet address.

Stores with changing public addresses need a static public address or an approved VPN/private-access gateway with stable egress. Mobile data or a hotspot will otherwise be blocked. Owners should use a controlled network-change process; never auto-approve a new network merely because a login succeeded there.

The initial network/device bootstrap must be performed through the product operator's controlled administration path. Provide an audited recovery process for a replaced router or lost owner device so the customer cannot permanently lock themselves out. Recovery must not become an unrestricted bypass account.

## Private access and the existing architecture

Hiding the URL, removing search-engine indexing or installing the site as an app does not enforce access restrictions. A private-access gateway can require an approved identity/device before serving protected pages. A private hostname reached through an enrolled network client is the stronger option if the requirement is that the service itself should not be publicly reachable. This may require hosting changes; the current Vercel deployment is not automatically a private service.

Protect every alternate entry point: the custom domain, hosting-provider/default deployment domains, preview deployments, backend APIs, RPCs, file downloads and real-time connections. A gateway protecting only posinventory.shop is insufficient if the same data is reachable directly elsewhere.

The current browser calls Supabase directly. Supabase database network restrictions do not restrict its HTTPS Auth, REST or Storage APIs. Therefore strict device/IP enforcement requires a trusted server/gateway architecture and corresponding backend authorization changes; it cannot be delivered solely by adding a website IP check.

Before implementation, prove how direct backend calls will be denied when they lack the approved access context. Retain tenant/store/module authorization and do not replace it with unrestricted service-role access. Cached token claims alone cannot guarantee immediate expiry or revocation; validate current policy at protected operations and bound any unavoidable caching explicitly.

Invitation confirmation, password recovery and licence support need narrowly scoped entry routes. Under the strict policy, complete device enrollment and business access from an approved network. If off-site invitation setup is allowed later, that exception must expose only account setup, not business data.

Public registration may remain available during testing as previously requested. It must not exempt an account from licence, device or network checks for an existing business. Test exceptions should be explicit, temporary and limited to test tenants.

## Offline behavior

Recommended default for this strict policy: block new offline business transactions. The app cannot establish its current public network, immediate revocation or current server state while disconnected. Client clock checks and browser storage are insufficient to promise strict enforcement.

Preserve already queued sales and unsynced work from the existing system; do not silently delete them. After connectivity and licence/device/network access are restored, use the normal authorized reconciliation path, with duplicate protection. Previously downloaded information cannot be made unknown to a person or guaranteed erased remotely; minimize offline caches and remove sensitive local state on sign-out/revocation where possible.

An offline grace arrangement would be a separate, explicitly weaker policy using time-limited authorization and a documented revocation delay. It is not part of the strict default described here.

## Proposed records and administration

- Business licences: business, status, validity, limits and revision.
- Approved devices: business, trusted credential identifier, label, approval/revocation details and last seen time.
- User/device associations: permitted users of a registered device, preserving shared-till support.
- Store network rules: store, normalized public IP/range, activation and audit details.
- Audit events: licence changes, device approval/revocation, network changes and rejected access decisions. Never record passwords or bearer credentials.

Customer-facing administration can show Licence, Devices and Allowed networks. Product-operator controls remain separately protected. Exact device limits, approved addresses, private-access provider and operating costs remain configuration/rollout decisions; no values or purchases are assumed.

## Delivery and acceptance

1. Confirm a gateway/device-enrollment approach compatible with hosting and all direct backend paths. Demonstrate that bypass attempts are rejected before promising physical-device restrictions.
2. Implement authoritative licence checks and separate product-operator administration.
3. Add device requests/approval, concurrent cap enforcement and revocation.
4. Add store network restrictions, trusted request identity and controlled recovery.
5. Integrate invitations, store switching, expiry screens and the strict offline policy.
6. Exercise a test tenant first, then roll out live restrictions after its actual networks and devices have been enrolled. Do not activate an empty allowlist on the existing live business.

Tests must include expiry during an active session, renewal, suspension, revoked devices, copied browser identifiers, concurrent approvals at the device cap, store changes, spoofed IP headers, IPv6, changing networks, expired licences with otherwise-valid tokens, direct Supabase requests, alternate deployment URLs, recovery links and preserved offline queues. Test that owners cannot renew their own licence and that blocked users cannot reach cached sensitive responses from shared server caches.

## Sources

- [Supabase network restriction scope](https://supabase.com/docs/guides/platform/network-restrictions): database restrictions do not cover HTTPS APIs.
- [Private-access policy design](https://developers.cloudflare.com/reference-architecture/design-guides/designing-ztna-access-policies/): device enrollment, identity and access-policy options. Cloudflare is a candidate approach, not a selected or installed provider.
- [Private IP/hostname access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/self-hosted-private-app/): private routing requires the corresponding network connectivity, not just a hidden hostname.
