# Owner controls and release reliability

Requested 7 September 2026: release compatibility checks/error alerts/backup recovery;
My Stores and guided setup; daily cash-up; access control for each module.

## Decisions

- Module permissions are per user **and per store**, as requested.
- Owners keep full access; module grants never bypass location membership or
  manager approval requirements. Existing assigned users retain their current
  role-appropriate module access until an owner changes it.
- Cash-up uses one count per store per South African business day, with
  immutable revisions when a manager reopens it.
- Use the current POS INVENTORY design. Preserve existing ledgers, offline
  queue identity, and released migrations.

## Delivery batches

1. Release reliability: schema contract, build gate, safe error screens,
   redacted error reporting, health checks and backup restore verification.
2. My Stores: dedicated owner navigation, store creation, setup checklist,
   staff assignment and catalogue setup links.
3. Access control: per-store grants, database enforcement, route/navigation
   protection, owner editor, and denial/regression tests.
4. Cash-up: cash-source reconciliation, daily records, counted denominations,
   submission/approval/history, and concurrency/ledger tests.

Code changes will be committed in groups of five. Database migrations must be
tested and applied before the matching application release. Remote setup that
requires credentials or a verified recipient will be recorded explicitly.

## Verification status

- Application code for all four areas is implemented. The production database
  migrations are applied and the compatibility check passes.
- All 84 unit tests across 27 files passed; lint passed with existing warnings.
- Fresh local bootstrap: 37 migrations, 18 SQL suites and 2 upgrade fixtures passed.
- Four concurrency cases passed (permissions, duplicate payments, sale vs
  approval, competing cash counts).
- Local restore drill: all 60 tables and access rules match; stock and credit
  ledgers reconcile. Production backup availability remains unresolved.
- The final production build passed, including all new routes.
- Browser checks used the real components with fictional local data and a mocked
  database adapter. Store creation/selection, per-store permissions, cash count
  submission and approval passed. Desktop and 390-pixel phone layouts were checked
  without horizontal overflow. This was not authenticated production testing.
- The first GitHub run found missing optional WebAssembly dependency entries in
  the existing lock file. A follow-up fix regenerates those entries with npm
  11.19.1; existing locked package versions are unchanged.
- Error events will be recorded in hosting logs after deployment; no webhook
  destination has been provided or configured.

## Production release — 7 September 2026

- Applied only the anonymous-safe compatibility probe. Local migration
  `20260907084234_release_compatibility_contract.sql` is recorded in hosted history
  as `20260907100110_release_compatibility_contract`.
- The release check initially blocked deployment while the feature migrations
  were absent. The owner subsequently explicitly approved both live migrations.
- Applied `20260907084244_store_module_access.sql`, recorded in hosted history as
  `20260907102555_store_module_access`.
- Applied `20260907084247_daily_cash_up.sql`, recorded in hosted history as
  `20260907102614_daily_cash_up`.
- The production release check passes with all required capabilities present.
  All 24 modules are registered; existing role defaults remain in effect.
- Stock quantities, stock movements, credit entries/balances, active memberships
  and store assignments matched the pre-migration checks. The live login page
  returned HTTP 200.
- The complete implementation comprises 15 commits in three batches of five,
  pushed to main at `c0724dc`, followed by the clean-install lock-file correction.
- Vercel reported successful deployment of `c0724dc`. Production `/api/health`
  returned HTTP 200 with `status: ready`; login returned 200 and the three new
  module routes correctly redirected unauthenticated requests to login.

Verify the hosted build and health endpoint after pushing to main. Do not reapply
these migrations or alter existing hosted migration history. Production backup
recovery and an alert delivery destination remain outstanding setup items.
