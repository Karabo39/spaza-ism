# Changes from the four documents — 26 September 2026

## Delivered behaviour

- **My Stores (1):** Each card opens a dedicated store setup page. Team assignment, product creation, product/opening-stock Excel imports and receiving are inside that store. Exit My Store returns to the list. The previous bottom setup block is removed. Module permissions remain in Access Control.
- **Warehouse (3):** The landing page loads warehouse summaries rather than stock and transfer history. Open Warehouse reveals the selected warehouse’s actions, paginated stock, export and transfer history. Exit Warehouse is available throughout its workspace. Existing edit permissions and warehouse codes are retained. Cancelled and Pending Store Receipt indicators are red; Received remains green.
- **Products (4):** Sync Products appears beside Import Excel. Select an authorised warehouse in the same business, preview, then confirm. Existing store cost and selling prices are preserved. Names, descriptions, categories and missing identifiers can be refreshed. Existing stock, batches and movements are not changed. New products and their compatible bulk definitions start with zero stock; warehouse prices are used only for matching currencies. Existing store-only products and barcodes remain.
- **Access Control_New (1):** Employees no longer see the View invoices shortcut in Orders. Their existing limited invoicing, stock/price visibility, credit-limit and own-cash-up rules remain. Returns approvals and bulk product configuration restrictions remain in force.
- Shared application tables have opaque sticky headers in bounded scrollable regions, with keyboard access and print overrides. Receipt print layouts retain their normal tables.

## Location and data protection

Store setup actions use `/stores/[storeId]/...`, independently of the active-store cookie. Each server entry checks owner access and the required module for that specific store. The client provider is scoped to that same store. The receiving destination is locked in store setup, and its import screen only offers products and opening stock. The team operation changes only one membership/location pair and audits it; it cannot edit another business or alter another store’s assignments.

Product sync checks manager-or-owner product access at the destination and warehouse access at the source. Matching uses saved product links, SKU and active barcode; names alone never establish a match. Conflicting identifiers, inactive matches, incompatible units/expiry/bulk configuration and new products needing another currency are reported and skipped. Each product plus its bulk definitions is atomic. Repeating a sync does not create duplicates. Successful sync invalidates the destination’s sale, order and receiving product-picker caches. Confirmation revalidates current database data. Preview uses the same validation inside a rolled-back subtransaction, persisting no products, links, audits or catalog revisions. The current operation explicitly rejects catalogues exceeding 10,000 active records.

## Main files and database changes

- `src/features/stores/my-stores.tsx`, `store-team.tsx`, `src/lib/store-setup-session.ts`, and `src/app/(app)/stores/[storeId]/[[...section]]/page.tsx`: store setup navigation and scoped actions.
- `src/features/imports/import-console.tsx`: products-only import mode for store setup.
- `src/app/(app)/warehouse/page.tsx`, `[warehouseId]/page.tsx`, layout and stock page; `warehouse-locations.tsx`, `warehouse-catalog-tools.tsx`, `transfers-console.tsx`: warehouse navigation, selected-location controls, exports and statuses.
- `src/features/products/sync-store-products.tsx` and Products page: sync selection, preview, conflicts and confirmation.
- `src/components/ui/table.tsx`, `src/app/globals.css`: sticky table headers and printing.
- `src/features/billing/orders-console.tsx`: employee shortcut visibility.
- Migration `20260926155732_store_setup_catalog_sync.sql`: guarded `sync_store_products` and `set_store_member_access` APIs, private helpers, audited changes and release capability. Applied to the live Supabase project before frontend publication.
- Database types, release contract and regression tests updated.

## Validation

- 229 application tests across 60 files passed; the final receiving-scope/cache refinements passed all 7 targeted tests, including two additional destination-selection cases (231 distinct tests).
- TypeScript, lint and production build passed.
- Fresh local database: the full SQL regression runner passed, including the new sync/assignment suite and warehouse-disable concurrency checks. Additional checks cover revoked product permission and inactive destinations.
- Sync tests cover 100 warehouse units and 20 store units remaining unchanged, existing cost/selling prices, preview rollback, retry safety, bulk configuration, conflicts, currencies, employee denial and cross-business denial.
- Live release capability check passed. Anonymous sync access and direct authenticated access to the private copier are denied.
- Security advisor comparison: two additional authenticated-only guarded API wrappers are reported as expected; no new anonymous function exposure. Existing private-table policy notices and authentication settings are unchanged. [Supabase’s definer-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) explains the advisory.

Live browser and deployment verification are reported with the delivery message. Production transactions and employee assignments are not used as test fixtures.
