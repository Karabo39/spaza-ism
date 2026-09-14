# Warehouse and Operations changes — 14 September 2026

Source documents: `docs/Warehouse.docx` and `docs/Operations.docx`, added on 14 September.

## Warehouse product synchronisation

Owners with Warehouse access can open **Warehouse → Sync Products** beside the Excel export. Select a warehouse and choose a preferred selling store, or select the most recently updated product across stores. Every active selling store in the business is checked. The preferred store wins when matching products have different descriptions or prices; remaining products come from the other stores.

The first successful **Sync products and save schedule** saves the rule. Leave **Run automatically every 30 minutes** selected for background updates. The database scheduler runs at minute 00 and 30, even when the application is closed. Each warehouse needs its rule saved once. To pause, load its saved settings, clear the checkbox and sync/save; that final manual sync runs, then future automatic runs stop.

- New warehouse products start at zero quantity.
- Existing quantities, expiry batches and goods movements do not change.
- Details include names, SKU, description, units, prices, stock thresholds, category, supplier, expiry tracking and active barcodes.
- Linked store product IDs survive later SKU or barcode edits. Otherwise matching uses SKU or barcode, never name alone.
- Conflicting identities, different currencies, inactive warehouse products and unsafe unit/expiry changes are skipped with a reason. No currency conversion is invented.
- Warehouse products are not automatically deleted or deactivated when a source product disappears.
- Bulk conversion ratios are still configured in **Unpack Bulk Stock**.
- Sync and metadata changes are audited. Background execution rechecks the configuring owner's access. Overlapping runs are serialised; revoked owners cannot continue syncing.
- Maximum 10,000 source products per sync. Larger catalogues require filtered templates.

## Manual template fallback

Inside the same panel, select a specific selling store and download its product template. Filter by name, SKU or barcode when more than 200 products match. Existing product `.xlsx` templates can also be uploaded (maximum 200 rows, 2 MB).

Review the preview, then choose **Apply product details to warehouse**. The current implementation imports product details only: quantity and expiry-date columns never create warehouse stock or batches. Omitted metadata is preserved on existing products. Enter stock through Goods In, transfers or an authorised stock adjustment.

A file can be parsed and its preview saved on the device while offline. **Restore saved offline draft** reopens it for that user and warehouse. Applying it requires reconnection and rechecks permissions. Offline review requires an already loaded application; it does not make the server available without a connection.

## Warehouse details and navigation

- Warehouse cards show the code and provide **Edit warehouse details** for authorised owners/managers with Settings or Stores access.
- Catalog contains Products, Suppliers, and Data Imports & Exports.
- The old Catalog Operations link is removed.
- **Unpack Bulk Stock** is under Stock Control, immediately after Expiry. Existing Operations permission still controls access; no permission grants are broadened.
- Old Operations/Unpack bookmarks redirect to the new page. Warehouse cards retain stock, transfers and receiving actions.

## Bulk stock behaviour

Both supported workflows were verified:

1. Unpack at the warehouse and transfer individual units.
2. Transfer sealed packs, receive them at the store, then unpack there.

Stock decreases at dispatch, remains in transit, and increases at the destination only on receipt. Unpacking uses the configured pack-to-unit ratio with stock movement and unpacking audit records. Employees can use permitted conversions but cannot change their ratios.

## Verification

- Full local migration bootstrap and 32 database regression suites, with all test data rolled back.
- Catalogue tests cover repeat syncs, source priority, renamed source identity, stock preservation, partial templates, conflicting identifiers, different currencies, cross-business rejection, schedule pausing, owner revocation and function grants.
- Bulk-flow tests conserve the total underlying units across warehouse/store unpacking and both transfer forms.
- 46 unit/component suites, 167 tests passed, including offline preview, guarded submission, duplicate-click prevention and navigation permissions.
- Type checking, lint and production build passed. The live migration is applied; the release compatibility check passes and the 30-minute cron job is active. The scheduled job has not yet completed its first timed run. Live web deployment verification is recorded in the task completion report.

Production test sales, receipts, stock adjustments and emails are not used to validate this release. Email scheduling remains disabled. Public account creation remains available for testing.
