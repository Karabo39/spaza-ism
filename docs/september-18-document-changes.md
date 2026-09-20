# Nine document requests — implemented 20 September 2026

## Changes

| Document | Result |
| --- | --- |
| Suppliers | Visible EDIT heading above the edit action. |
| GoodsIn | Received transfers display a green, disabled Received button. |
| Orders (4) | Recent Orders is a primary button that collapses and expands the list, beside View invoices. |
| Invoices (3) | Recent Invoices is a primary button that collapses and expands the list. |
| Goods Return | Recent Returns is a primary button that collapses and expands the list. |
| Products (3) | Item Type distinguishes Individual from Bulk Stock on Products and both warehouse stock views; supported exports include the column. |
| System Changes (3) | Reports follows Data Imports & Exports in Catalog; the separate Insights group is removed. |
| My Stores | Add Store opens the existing form in a dialog from the page header. The inline form is removed. |
| Warehouse (2) | Location-specific bulk receiving, configuration and availability; strict unpacking and compatible bulk transfers; warehouse action buttons use the supplied #2c142b background. |

Recent order, invoice and return lists start expanded. Collapsing preserves their content and selection. Existing warehouse transfer and receipt sections retain their previous defaults.

## Receiving and unpacking bulk stock

1. Open Goods In at the store, or Receive Stock inside the selected warehouse.
2. Choose Individual or Bulk Stock. Both remain available because the document contains conflicting instructions about bulk-only receiving.
3. A manager with New Stock, Products and Operations access can use **Create / link bulk product**. Choose an existing individual item at this location, then create a pack or link an existing catalogue product. Enter the number of individual units per pack.
4. Creating a pack creates no stock. Confirm receiving to add stock at this location.
5. Use **View available Bulk Stock** on Unpack Bulk Stock to see packs available at this location. Unpacking subtracts whole packs and adds their units to the existing linked individual item; it creates no individual product.
6. A warehouse transfer keeps bulk stock as bulk. Configure the destination pack with the same units per pack before preparing the transfer. Dispatch deducts the source; receipt adds the destination. Only then can the destination unpack it.

Each location maintains its own conversion and stock. Catalogue synchronisation does not automatically configure destination conversions. A conversion cannot change while a draft, submitted or dispatched transfer uses it. Whole packs are required for stock and transfers. Nested bulk conversions are rejected.

Unpacking cannot create missing packs through a count override. Correct a discrepancy through the existing stock-adjustment process first; previous unpacking and adjustment history remains intact. New pack creation reuses a request identifier on retries to prevent duplicate products.

## Verification

- 189 unit tests passed across the complete run and a focused rerun after updating navigation expectations and stock-counter fixtures.
- 35 SQL suites passed locally, covering location isolation, permissions, duplicate-request handling, transfer compatibility, whole packs, stock availability and retained history.
- Warehouse disable concurrency passed in both operation orders against the updated local schema.
- TypeScript, lint, whitespace checks and the production build passed.
- No production sales, stock movements or emails are needed for validation.

## Deployment

Apply `20260920131010_location_bulk_receiving.sql` before deploying the application. The release contract requires `location_bulk_receiving_v1` and prevents deploying against an older schema. The migration adds classification and validation; it does not receive, unpack or transfer existing stock.

The private request-deduplication table deliberately has RLS enabled without client policies and no client grants. The new authenticated function checks role, location and each required module. Other existing advisor findings remain separate from this change.

The live migration was applied successfully on 20 September 2026 and the live release compatibility check passed. Advisor changes are the intentionally private deduplication table, its new initially unused foreign-key index, and the authenticated permission-guarded creation function. Existing advisory findings are unchanged. See [Supabase database linter guidance](https://supabase.com/docs/guides/database/database-linter) for remediation details.
