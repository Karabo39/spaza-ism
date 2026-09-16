# Warehouse (1) changes — 16 September 2026

## Requested behaviour

- Edit Warehouse includes a red Disable warehouse button beside Cancel. Disabled warehouses disappear from active lists; stock, transfers and audit history are retained.
- Access Control has a per-warehouse **Warehouse → Disable Warehouse** permission. Owners retain access. Managers follow existing role defaults and can be denied this action independently of editing warehouse details. Employees cannot disable warehouses.
- Every product quantity must be zero. Draft, submitted and dispatched transfers must first be completed or cancelled. Disabling also pauses that warehouse’s automatic catalogue sync.
- Warehouse actions and Cancel buttons use the existing primary button design. Sync Products, export format, Export and Email match Add Warehouse.
- My warehouse transfers, Goods In’s pending/received warehouse transfers, and Saved receipts start collapsed. Expanding them preserves the existing details and actions.
- Suppliers has separate Purchase History and edit columns with proportionate widths and horizontal scrolling on smaller screens.
- Successful Goods Out sales open a centred Receipt Print dialog with green Print Receipt and red Don’t Print buttons. Escape and outside clicks cannot dismiss this decision. The previous success toast no longer overlaps it.
- Print Receipt opens the saved receipt in a separate tab and starts the existing print flow, including configured second-copy delay. Goods Out is ready for the next sale. If the browser blocks the tab, the prompt remains open with instructions.
- Don’t Print records the choice before closing. A failed request keeps the saved sale available for retry. No extra sale or stock movement is created by either receipt choice.

## Verification

- 182 unit tests passed across the full run and focused rerun. The release-check fixture was updated to include the new capability.
- 34 database suites passed on a fresh local database, including permission overrides, cross-business denial, nonzero stock, stock in transit, retained history, sync pausing and disabled-location writes.
- Two-connection concurrency tests passed in both orders: disabling first blocks a late stock write; receiving first prevents disabling a nonempty warehouse.
- TypeScript, lint and the production build passed.
- The new release capability was verified locally against every required capability.
- Physical printer output still depends on each store’s installed printer and browser print dialog; it cannot be verified remotely.

## Deployment order

Apply `20260916075014_warehouse_disable_controls.sql` before deploying the application. The release check requires `warehouse_disable_v1` and blocks an incompatible deployment. The migration adds the permission, guarded disable action and warehouse-only stock/transfer write safeguards; it does not disable any existing warehouse or alter quantities.

The user approved the live migration, which was applied successfully. The live release check passed. Security advisories retain the existing baseline plus the intentionally authenticated, permission-guarded disable action. No production test sales, stock movements or emails were created for these changes.


