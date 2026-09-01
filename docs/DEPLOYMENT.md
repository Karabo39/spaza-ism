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
   or run each file in [`supabase/migrations`](../supabase/migrations) `0001 → 0012`
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

- [ ] Migrations `0001–0012` applied to the production database.
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

- **Adding staff:** the person signs up, then an owner adds them by email under
  **Users** (`add_member_by_email`). Role changes and deactivation are immediate.
- **Fixing a stock discrepancy:** use **Adjust Stock** (audited) — never edit the
  database directly; direct edits bypass the ledger and break reconciliation.
- **Expired/damaged stock:** write it off through Adjust Stock with the matching
  reason so it lands in reports and the audit trail.
