# Deployment & operations

Two moving parts: the **database** (Supabase) and the **web app** (Vercel or any
Node host). The app is stateless; all state is in Supabase.

## 1. Supabase project

1. Create a project (or use the existing one). Note the **Project URL** and the
   **publishable key** (Settings → API). The service-role key is **not** used by
   this app — don't put it anywhere in the frontend or its env.
2. Apply migrations in order. With the Supabase CLI linked to the project:
   ```bash
   supabase db push
   ```
   or run each file in [`supabase/migrations`](../supabase/migrations) `0001 → 0034`
   in the SQL editor, in numeric order.
3. **Auth settings** (Dashboard → Authentication):
   - Enable **Email** provider.
   - Decide on email confirmation. If **on**, new signups must confirm before
     first login (the signup screen already handles the "check your email" state).
   - Turn **on** "Leaked password protection" (advisor recommends it).
   - Set the **Site URL** and redirect URLs to your deployed domain.

There is no seed data to load — a new business is created through the in-app
onboarding flow (`create_business`).

## 2. Web app

### Environment variables
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```
Both are public by design (RLS governs access). Copy `.env.example` → `.env.local`
for local dev; set the same two vars in your host's dashboard for production.

### Vercel (recommended)
1. Import the GitHub repo.
2. Framework preset **Next.js** (build `next build`, output handled automatically).
3. Add the two env vars.
4. Deploy. Then set Supabase Auth **Site URL** to the Vercel domain.

### Any Node host
```bash
npm ci
npm run build
npm run start        # serves on $PORT (default 3000)
```

## 3. CI checks

Run these on every PR (all currently green):
```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (0 errors)
npm run test         # vitest unit tests
npm run build        # production build
```
Optional integration/E2E (need a database / browser):
```bash
psql "$DATABASE_URL" -f supabase/tests/rpc_integration.sql   # expect ...TESTS_PASSED
npx playwright install chromium && npm run test:e2e
```

## 4. Go-live checklist

- [ ] Migrations `0001–0034` applied to staging, accepted, then applied to production.
- [ ] Auth: Email provider on, Site URL + redirects set, **leaked-password
      protection on**, confirmation policy decided.
- [ ] Env vars set on the host (publishable key only; **no** service-role key).
- [ ] **Rotate the Supabase database password** (any password shared during
      development should be considered compromised).
- [ ] **Remove the dev demo account:**
      `delete from auth.users where email = 'demo@spazaism.co.za';`
- [ ] Run the security advisor (`Dashboard → Advisors`) and confirm only the
      expected `authenticated_security_definer_function_executable` notices
      remain (these are by design — see [DECISIONS.md](DECISIONS.md)).
- [ ] Enable Supabase automated backups / PITR for the project.
- [ ] Smoke-test the live URL: sign up → onboard → goods in → sale → dashboard.

## 5. Backups & recovery

Enable Supabase's scheduled backups (and Point-in-Time Recovery on paid tiers).
Because stock and credit are derived from append-only ledgers, a restore to any
point yields a consistent state, and `reconcile_stock()` can verify stock after
any recovery.

## 6. Operating notes

### BRD v1.02 foundation rollout

Apply `0013_location_access.sql` before deploying the matching app changes.
The migration is additive and preserves existing stock/ledger IDs. It adds
product/location foreign keys; any pre-existing mismatches must be investigated
before rollout rather than bypassing the constraints.

Single-store staff assignments are backfilled automatically. For a business with
multiple active stores, arrange owner access to **Users → Assign locations**
immediately after migration; managers and employees cannot resume until assigned.
New staff also need assignments. Owners create additional selling stores and
warehouses in **Settings → Stores & warehouses**. The location switcher opens
each location's own inventory; warehouses cannot record Goods Out.

Local database regression tests can run on a disposable empty PostgreSQL DB:

```powershell
$env:BRD_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55439/EMPTY_TEST_DATABASE'
node scripts/test-db-local.mjs
```

This runner refuses non-local hosts and non-empty databases. It bootstraps only
the auth contracts needed for RLS tests, applies migrations, verifies upgrade
backfill and runs the stock/credit and location tests with rollback. It does not
replace testing against Supabase's actual Auth and PostgREST services before
production deployment. Do not run `local_bootstrap.sql` on Supabase.

- **Adding staff:** the person signs up, then an owner adds them by email under
  **Users** (`add_member_by_email`). Role changes and deactivation are immediate.
- **Fixing a stock discrepancy:** use **Adjust Stock** (audited) — never edit the
  database directly; direct edits bypass the ledger and break reconciliation.
- **Expired/damaged stock:** write it off through Adjust Stock with the matching
  reason so it lands in reports and the audit trail.
# BRD v1.02 invoicing rollout

The stacked invoicing branch requires migrations 0013 through 0022 in order.
Do not deploy that app build against the old schema. Validate the stack in a
Supabase staging project before production rollout, including authenticated
employee/manager/owner flows, expired approvals, partial payments, returns,
refunds, store-credit allocation and reconciliation. The local PostgreSQL suite
uses minimal Supabase Auth contracts and is not a replacement for staging.

## BRD v1.02 final rollout (through 0034)

The final application requires every migration through **0034**. Apply missing
migrations in sequence to staging first, then complete
[BRD_V102_ACCEPTANCE.md](BRD_V102_ACCEPTANCE.md). Back up and verify the production
schema/data before applying the same migration stack and deploying the app.
Do not deploy this app against a partial schema.

### Upgrade steps that need attention

1. Assign existing multi-store managers/employees in **Users → Assign locations**.
   The single-store backfill is automatic; multiple-store access is intentionally
   explicit. Include any warehouse each person operates.
2. Finish existing stock takes before migration or re-save every counted line
   after upgrading to 0031. Old in-progress counts have no saved-at marker and
   cannot be approved until recounted. Completed history is retained.
3. Check that expiry-batch quantities cover tracked product quantities. New
   adjustments, stock counts, imports, returns and unpacking maintain the batch
   ledger. Missing legacy batch allocations need a reviewed data correction;
   never manufacture dates or edit posted ledgers to bypass validation.
4. Configure invoice tax, return reasons/approval and each manager's personal
   credit approval code. Defaults are zero tax and required return approval.
5. Validate the private `business-logos` bucket using actual Storage uploads.
   Migration 0029 defines the bucket and owner/member policies.
6. Configure server-only report email credentials and the Edge worker/schedule
   in [EMAIL_NOTIFICATIONS.md](EMAIL_NOTIFICATIONS.md). Keep preferences off until
   test delivery succeeds. The web app does not need a service-role key.

### Password recovery and domain configuration

Set Supabase Auth's Site URL to the final application origin and allow the
application's `/auth/callback` redirect, including the recovery destination
`?next=/reset-password`. Use the same configuration for a separate staging
project and its own host. Recheck it whenever the domain changes.

For recovery links that also work across devices, the Reset password email
template can use the supplied server-side token verification route:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password">Choose a new password</a>
```

The same-device callback flow is also supported. Verify actual email delivery,
expired links and the final password update before rollout. Reference:
[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
and [redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

### Local browser verification on Windows

The production server can be started separately for smoke tests so Playwright
does not need to stop a Windows child-process tree during teardown:

```powershell
npm run build
npm run start -- --port 3100
# In a second terminal:
$env:E2E_BASE_URL = 'http://localhost:3100'
npm run test:e2e -- --workers=2
```

Stop the local server when finished. These public-route smoke tests do not
replace authenticated staging acceptance, physical scanner/printer checks or a
backup/restore drill. Deployment and scheduler activation were not performed as
part of local development.
