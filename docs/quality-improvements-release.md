# Existing workflow improvements — 7 September 2026

This release improves existing workflows without adding product features.

| Area | Change | Verification |
| --- | --- | --- |
| Payment accuracy | Immediate submission lock closes the gap before a button disables. Uncertain requests retain their retry identity even when another action succeeds. Confirmed saves are distinguished from display-refresh failures. Refunds require whole cents; order estimates reject unsupported precision and excessive totals. | Unit tests cover rapid clicks, connection loss, independent retries, partial refunds and decimal rounding. Concurrent database tests produce one receipt/refund per retry and reject competing refunds beyond the remaining credit. |
| Workflow consistency | Readable status labels across orders, invoices, quotations and returns. Refund entry explains amount precision. Search and offline queues distinguish loading, failure and empty results. | Existing order-completion and return-control tests pass. |
| Mobile usability | Shared buttons and dialog close controls have a 44-pixel minimum touch target on small screens. Search results wrap long names; return controls and action groups fit narrow widths. | Quotation and return views checked at 390 and 1280 pixels with no page overflow or browser exceptions. Customer selection also checked on mobile. |
| Performance | Customer, quotation and order-product searches wait for typing to pause. Stale product results cannot be selected while waiting. Return sources request only needed fields and build names with indexed lookups. Quotations omit duplicate request payloads. Three RLS policies calculate the signed-in identity once per statement. | Four rapid customer keystrokes produce one request in the regression test. Live performance advisors no longer report the three `auth_rls_initplan` warnings. |
| Maintenance | Dialogs initialize on mounting instead of resetting state in effects. Camera cleanup retains the latest detection callback. The quotation editor and return-source loading are separate components/hooks. Removed the lint-rule downgrade and require zero warnings. | Lint, TypeScript and production build checks. |
| Operational reliability | Offline sync failures are handled without discarding pending sales. Every CI push/PR runs a restoration drill containing synthetic quotations, PO file bytes, invoices and refunds. | 63 tables restored with matching records, policies, functions and table/column/function grants. Stock and credit ledgers reconcile. |

## Database change

`20260907212303_cache_policy_identity.sql` only changes how three policies obtain the current user ID. Their store, role and membership checks are preserved. Applied live under migration name `cache_policy_identity` (live history version `20260907213042`). As with earlier MCP-applied migrations, local and live timestamps differ; compare names and SQL before any future migration-history repair.

The optimization follows [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select). Existing foreign-key/index advice and intentionally restricted internal tables/RPCs were reviewed separately; this release does not indiscriminately add or remove indexes or broaden permissions.

## Measurements and limits

- Live query statistics showed the most frequently executed product-stock query at 1,138 calls and 5.07 ms mean database execution time. Other sampled product-stock query shapes averaged 5.31–43.76 ms. These are database timings, not full screen load times, and do not establish an end-to-end speedup.
- The local restoration proof is `node_modules/.cache/restore-drill-1788816311263/proof.json`. It uses synthetic data and a fresh local target; it does not prove that a production backup can be recovered. The drill never drops or overwrites a database.
- Restoration compares effective default owner grants as well as explicit grants, because PostgreSQL may omit an explicit owner-only grant when restoring an equivalent default.
- Vercel runtime logs were not accessible through connected tools, and no signed-in Vercel browser session was available. Production error-history review remains pending access. Live health and database compatibility can be checked independently.

To rerun the local database and restore checks, use an empty disposable localhost database with `BRD_TEST_DATABASE_URL`, run `scripts/test-db-local.mjs`, `scripts/test-owner-controls-concurrency.mjs`, then `scripts/test-restore-local.mjs`. Set `POSTGRES_BIN` to matching PostgreSQL client tools when they are not on the path. CI installs PostgreSQL 17 clients to match its database service.
