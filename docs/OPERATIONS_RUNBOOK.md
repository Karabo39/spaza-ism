# Release checks and recovery

## Deploying this release

Apply the tested migrations in order before deploying the matching application:

1. 20260907084234_release_compatibility_contract.sql
2. 20260907084244_store_module_access.sql
3. 20260907084247_daily_cash_up.sql

The release contract requires BRD v1.02, store module access and daily cash-up.
Run **npm run release:check** against the intended environment. Vercel runs this
check automatically before building. A missing capability or unreachable database
fails the build; the check never applies migrations itself.

The authenticated app also checks compatibility before loading store data and
uses a recovery screen if the service is unavailable. **/api/health** returns
HTTP 200 with {"status":"ready"} or HTTP 503 with {"status":"unavailable"};
it does not need a session or expose configuration and customer data.

GitHub's Application and database checks workflow runs unit checks, a production
build, all migrations on a disposable PostgreSQL 17 database, the database
regressions, and competing payment/count/access tests. It uses synthetic data
and does not contact the production database.

## Errors and alerts

The operational_error events written by our instrumentation contain a route
template, timestamp, error code and support reference. They omit raw error
messages, stack traces, cookies, request headers, query strings and transaction
contents. Next.js and hosting-provider logs are managed separately.

An optional server-only **OPERATIONS_ALERT_WEBHOOK** environment variable enables
HTTPS delivery of these redacted events. Configure a destination you control in
Vercel, redeploy, and verify receipt in staging. No destination is configured as
part of this release. Identical events are limited to one per minute per server
instance; configure receiver-side deduplication for multiple instances.

For an incident, use the support reference and time to locate the hosting log.
Check health and schema compatibility first. If a sale or payment response was
uncertain, check its history before retrying; preserve the original request ID.
Do not paste session cookies or full customer transactions into issue reports.

## Recovery status and procedure

On 7 September 2026 the linked production project's backup listing returned
no downloadable backups and pitr_enabled=false. This does not establish a
recoverable production backup. No production restoration or paid plan change
was performed.

The local drill uses a consistent PostgreSQL snapshot containing synthetic
sales, credit, cash-up and permission data. It restores into a separate empty
database, compares all 60 table checksums, function definitions and RLS policies,
then reconciles stock and credit ledgers. That drill passed. It is a procedure
test, not proof that production data can currently be recovered.

To repeat it, create an empty disposable local database and configure:

~~~text
BACKUP_SOURCE_DATABASE_URL=postgresql://...@127.0.0.1:.../source_fixture
RESTORE_TEST_DATABASE_URL=postgresql://...@127.0.0.1:.../empty_restore
POSTGRES_BIN=path to matching PostgreSQL binaries (optional if on PATH)
node scripts/verify-backup-restore.mjs
~~~

The script rejects remote hosts, nonempty targets and identical source/target
URLs. It does not drop databases. Archives and verification reports stay in the
ignored node_modules/.cache/restore-drill-* directory.

For production recovery readiness, an owner still needs to arrange an available
managed backup or a protected off-site CLI export, then restore it into a separate
compatible Supabase environment. Verify Auth, Storage files, app configuration,
row counts, module access and ledger balances before considering any cutover.
Database backups alone do not include Storage file contents. Keep production
exports and credentials outside Git and public build artifacts.

Official references: [Supabase database backups](https://supabase.com/docs/guides/platform/backups),
[restore to a new project](https://supabase.com/docs/guides/platform/clone-project),
and [Vercel runtime logs](https://vercel.com/docs/logs/runtime).

## Rollback

Keep the previous Vercel deployment available. These schema additions preserve
the existing app's interfaces; rolling back the app does not require deleting
cash-up history or module grants. Do not undo migrations with table drops. Use a
tested forward migration for schema fixes, and verify existing grants before
restoring an older app that did not hide module navigation.
