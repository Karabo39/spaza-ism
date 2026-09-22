# POS INVENTORY performance implementation — 22 September 2026

The performance changes are deployed to production. Five main implementation commits were pushed to `main`, ending at `a8ef33b9143d6433a71a9e048eab494f73dc3ce8`, followed by the offline reservation correction `d892c5a`. Vercel reported a successful performance deployment, and authenticated production responses confirm that functions now execute in **Dublin (`dub1`)**, replacing Washington (`iad1`). Supabase remains in Ireland (`eu-west-1`). The measurements below were captured from the first performance deployment.

[Verified Vercel deployment](https://vercel.com/karabo39s-projects/spaza-ism/8fscAem9cNiNQfcjXWotxYUYYQ3P)

## Measured result

Authenticated HTTP measurements used the same account, store, machine and method as the original diagnosis. Each figure is the median of three complete HTML responses, including network transfer. These are small verification samples, not browser LCP, INP, p95 or load-test results. Cash-up and Goods Out timings measure their initial page responses; their client-side interactions are separate.

| Page | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Dashboard | 1,844 ms | 730 ms | 60% |
| Goods Out / sale | 1,591 ms | 802 ms | 50% |
| Stock | 1,527 ms | 576 ms | 62% |
| Products | 1,601 ms | 657 ms | 59% |
| Sales report | 1,548 ms | 618 ms | 60% |
| Movements | 1,547 ms | 652 ms | 58% |
| Cash-up | 1,313 ms | 625 ms | 52% |
| Warehouse | 1,463 ms | 776 ms | 47% |
| Audit | 3,749 ms | 958 ms | 74% |

Audit's decoded initial HTML fell from **1,115,154 to 158,253 bytes** (86% smaller). Movement HTML fell from **266,448 to 157,673 bytes** (41% smaller). Audit now renders 50 summaries instead of 300 full records. The movement page also renders at most 50 rows. Smaller catalogue payloads were not the main gain in this store because its catalogue already fitted on one page.

All 27 authenticated page requests returned HTTP 200 with `cpt1::dub1::…` response identifiers. The `cpt1` prefix is the request ingress; `dub1` identifies the function region. Public login and health checks also returned HTTP 200. Audit next-page navigation was verified by authenticated HTTP, and its separate detail query returned the expected record.

The new exact-code RPC returned product, selling price and stock in one request: **228–263 ms** in the live checks, including the client-to-Ireland network journey. This is not a database execution-time measurement. Live tests also verified catalogue search, non-overlapping catalogue/activity cursors, the change manifest, changed-product payloads, Dashboard totals and Cash-up summary. The test account has no assigned warehouse, so the live Warehouse check covered the empty state; populated warehouse behavior was covered by local database fixtures.

## Changes delivered

| Area | Files / configuration | Result |
| --- | --- | --- |
| Session bootstrap | `src/lib/session.ts`, `src/lib/supabase/middleware.ts`, `src/lib/store-context.tsx` | One `session_bootstrap()` RPC loads setup state, memberships, stores, profile and module grants. A fresh server `getUser()` remains, while the proxy uses signature-verified `getClaims()`. Schema readiness moved out of normal page requests and remains in release checks/health. Refreshed cookies survive redirects. No shared permission cache was added. |
| Permission refresh | `src/lib/store-context.tsx` | The minute timer and visibility/reconnect events check a 34-byte revision response. A full refresh occurs only after the revision changes or an invalid-token response, not on every timer tick. Checks are coalesced and skipped when hidden/offline. Database authorization continues to enforce current access on every operation. |
| Region | `vercel.json` | Production functions configured with `regions: ["dub1"]`; deployment succeeded and live headers confirm Dublin. |
| Catalogue queries | `supabase/migrations/20260922134320_performance_catalog_and_sync.sql` | Flattened `v_product_stock` and `v_product_catalog` while retaining their contracts and invoker security. `catalog_page()` selects an authorized bounded base page before loading related data for those IDs. Added name trigram and `(store_id,name,id)` indexes. Exact SKU/barcode matching is separate from indexable name substring search. |
| Exact lookup / product search | `src/features/scan/lookup.ts`, `product-search-dialog.tsx` | `resolve_product_code()` returns authorized product, price and stock in one HTTP call, with barcode precedence over SKU. Permission errors never fall back to stale local records. Network/offline fallback remains. Product search forwards cancellation signals and uses a short cache interval. |
| Offline sync | `src/lib/offline/db.ts`, `sync.ts`, `offline-context.tsx` | A paged ID/version manifest identifies changes; only changed products and their active barcodes are downloaded. Deletions and deactivated barcodes are reconciled. Full 5,000/10,000-row truncation limits are removed. Complete manifests are committed atomically, overlapping syncs coalesce, and queued sales are flushed first. Unsent quantities remain reserved locally. Barcode keys include the store, and the IndexedDB upgrade preserves products, barcodes and the sales outbox. |
| Audit / activity queries | `supabase/migrations/20260922134846_performance_report_pages.sql` | `activity_page()` selects authorized base IDs with stable `(created_at,id)` cursors, then enriches only visible rows. Added matching business/store/date/ID indexes. Audit summaries omit before/after payloads. Sales return payment summaries and item counts rather than full receipts and item lists. |
| List pages | `src/app/(app)/products/page.tsx`, `check-stock/page.tsx`, `audit/page.tsx`, `reports/goods-out/page.tsx`, `reports/movements/page.tsx`, `warehouse/page.tsx`, `warehouse/[warehouseId]/stock/page.tsx` | Catalogue pages use 20 rows; Audit, reports and warehouse stock use 50. Warehouse summary, metadata and stock requests run independently in parallel. Sales summary cards explicitly describe the current page. |
| Pagination controls | `src/lib/data-pages.ts`, `src/components/ui/cursor-pagination.tsx`, `src/components/shell/toolbar-search.tsx`, `list-filter.tsx`, `src/features/reports/date-filter.tsx` | Validated cursors, bounded traversal and repeated-cursor detection. Filters reset the cursor. First/Next links preserve filters; browser Back returns to the previous visited page. Pagination links avoid eager prefetch. Search no longer replaces its own unchanged URL on mount. |
| Details / exports | `src/features/reports/audit-details.tsx`, `activity-data.ts`, `paged-export.tsx`, `export-button.tsx`, `src/features/stock/stock-export.tsx` | Audit details fetch only when opened. Stock export no longer queries on page load. Full Audit, movements, sales, stock and warehouse exports fetch bounded pages only on explicit export/email actions. Products keeps its explicitly labelled current-page export. Uncertain email retries retain the identical payload and idempotency key. No test emails were sent. |
| Camera | `src/features/scan/scan-input.tsx` | Camera/ZXing is dynamically imported and rendered only when camera scanning is opened. |
| Telemetry | `src/components/performance-insights.tsx`, `src/app/layout.tsx`, `src/proxy.ts`, `package.json`, `package-lock.json` | Added Vercel Speed Insights 2.0.0. Query strings, fragments and UUID record identifiers are removed from reported URLs. Vercel telemetry paths bypass the auth proxy. The production telemetry script returns HTTP 200. |
| Release / types | `release-contract.json`, `src/lib/db/database.types.ts`, `scripts/test-db-local.mjs` | Typed the new RPCs, added the `performance_v1` deployment capability, and included the performance regression suite in local database validation. |

The normal authenticated server page now performs fresh user validation, one bootstrap RPC and its page-data read(s), rather than the previous sequence of separate bootstrap reads. Cold JWT key discovery or token refresh can still add requests. The previous nine-request Audit trace was not recaptured in a browser during this implementation session.

### Applied database migrations

| Repository migration | Live Supabase migration version |
| --- | --- |
| `20260922134036_performance_bootstrap.sql` | `20260922140608` |
| `20260922134320_performance_catalog_and_sync.sql` | `20260922140632` |
| `20260922134846_performance_report_pages.sql` | `20260922140653` |

The version timestamps differ because the Supabase migration tool records its execution timestamp. Names and applied contents correspond to the repository files.

New public read RPCs: `session_bootstrap`, `session_access_revision`, `resolve_product_code`, `catalog_page`, `catalog_manifest`, `catalog_sync_products`, `activity_page`. All seven were checked live as **STABLE / SECURITY INVOKER**; anonymous execution is revoked. Existing RLS, tenant/module boundaries and approval functions remain in force. A private trigger maintains `app.catalog_versions`; clients have authorized SELECT access only, not permission to write change tokens.

### Implementation commits

- `dffa7ed` — database page queries, indexes, manifest and release contract.
- `241bbcf` — session bootstrap and access revision checks.
- `1dbe3a8` — incremental offline sync and cache upgrade.
- `9a44086` — paginated screens, one-request lookup, on-demand detail/export/camera work.
- `a8ef33b` — Dublin region and web-vitals telemetry.
- `d892c5a` — removing a queued sale invalidates its cached product versions so discarded reservations reconcile on the next sync; an older in-flight manifest cannot erase this invalidation.

## Validation

- **207 unit tests passed across 57 files**, including the new cursor, cancellation, offline sync/upgrade, store-barcode isolation and email-retry tests.
- After the reservation correction, all 16 affected offline tests passed again, along with lint and type checking.
- ESLint and TypeScript checks passed. The local production build passed, and Vercel's production deployment succeeded.
- The release contract passed against the live database before deployment; production health remained successful afterward.
- All migrations and the existing database regression suite passed on a disposable local PostgreSQL instance. The new `supabase/tests/performance.sql` checks 505-product pagination, manifest boundaries, wildcard escaping, code resolution, token invalidation, audit detail exclusion, equal-timestamp cursors, module revocation, anonymous denial and cross-tenant isolation.
- Checkout retry and owner-control concurrency suites passed: one sale/stock deduction for retries, stale permission edits rejected, payment/refund idempotency, cash count/approval races, competing tills and handovers, and warehouse-disable races.
- Live validation was read-only apart from creating and signing out the verification login sessions. No production checkout, stock change, cash-up submission, transfer or outgoing email was created for testing.
- Supabase advisors were checked. They report existing unindexed foreign keys/unused indexes and existing authorization-function notices; the new public read RPCs are not security-definer functions. Broad unrelated index or authorization changes were not mixed into this release.

New unit files: `performance-data.test.ts`, `incremental-sync.test.ts`, `offline-upgrade.test.ts`, `export-retry.test.tsx`. Updated coverage: `session.test.ts`, `release-status.test.ts`, `offline-db.test.ts`, `product-search-dialog.test.tsx`, `stock-export.test.tsx`.

## Remaining verification and operating notes

- The browser-control service was unavailable in this session. Authenticated HTML, RPCs, production deployment status and region were verified directly. Browser hydration, camera hardware, visual interactions, real LCP/INP and client jank were not remeasured. The deployed telemetry integration and script are verified; dashboard ingestion and a representative real-user sample remain to be checked when browser access is restored.
- Existing offline devices perform one initial full refresh to establish version tokens. Subsequent syncs transfer the manifest plus changed records. The manifest itself remains proportional to catalogue size, in pages of 500 lightweight ID/version pairs.
- Keyset pagination avoids fixed-batch truncation and offset drift. A product renamed while someone traverses the catalogue can move between pages; multi-page exports are not a database-wide snapshot during concurrent edits. Large exports still assemble the requested file in client memory and are deliberately separate from ordinary browsing.
- No database data-region move, capacity upgrade or paid telemetry-plan change was made. Dublin is configured in the repository and verified on production functions.

Raw before/after HTTP timings are preserved alongside this report in `performance-validation/2026-09-22-before.json` and `performance-validation/2026-09-22-after.json`. They contain timing/size/status/region evidence only, without credentials or page contents.
