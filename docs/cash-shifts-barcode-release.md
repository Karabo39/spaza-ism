# Cash up shifts and barcode editing

Date: 9 September 2026
Source documents: Products (1).docx, Cashup (1).docx and GoodsReturn (2).docx.

## Product changes

The duplicate product-name filter is removed. The existing search continues to find names and barcodes. Old name-filter links no longer restrict the list.

Edit product now includes a barcode field. Changing it retires that active barcode, creates its replacement and records the change in the audit history. Stock quantities and sales remain unchanged. Other active barcodes remain available. For products with multiple active barcodes, the edit form initially shows the oldest active barcode. Concurrent edits are checked against the original value, and duplicate active codes within the store are rejected. Products with no barcode may keep it blank or add one.

## Cash up changes

Each store can have sequential shifts on the same business date. The first shift follows the existing opening workflow. After manager approval, Start next shift opens a separate record for the signed-in user. If another employee is taking over, that employee signs in before starting the next shift. Existing module permissions and manager approval rules apply; the starter, person counting and approver are retained in history.

The next opening cash defaults to the previous counted amount. A different amount requires a handover note, for example cash banked or a different amount handed to the next user. It is not counted as new sales income.

Only one unapproved shift is allowed per store and business date. Concurrent start requests cannot create two successors. Retrying the same start request returns its existing shift. Further same-day shifts require approval of the current one. New successor shifts can only be started for today.

The screen lists shifts by number, user and status. Shift totals exclude the earlier shifts' recorded transactions, while the whole-day net collected includes all daily payments once. Payments arriving after the earlier count carry into the next shift. This includes delayed synchronized sales; tills should still sync before counting or handover.

Once a successor starts, the earlier approved shift cannot be reopened or edited. Before handover, a manager may reopen the latest shift for corrections using the existing reason and revision history. Cash movements shown in the separate history list are explicitly labelled as whole-day movements.

## Verification

- 120 application tests passed across 35 files.
- All 23 database suites passed, including three consecutive shifts, opening-cash differences, payments between shifts, immutable earlier approvals, duplicate and stale barcode edits, and authorization failures.
- Eight concurrency scenarios passed, including competing handovers creating exactly one next shift.
- Backup restoration passed across 67 tables with matching records and access rules, including the new three-shift and barcode fixtures; stock and credit reconciled.
- Lint, TypeScript and production build passed. Final store-selection changes also passed TypeScript and lint.
- Desktop (1440px) and phone (390px) component checks confirmed barcode entry, starting a new shift and read-only earlier shifts. No page overflow or browser runtime errors were observed. These used fictional local data.
- Live migration cash_up_shifts_and_barcode_edit applied and required database capability check passed.
- Security and performance advisors reviewed. New authenticated entry points intentionally enforce store/module permissions; private helpers and shift-start actions are not available to anonymous callers. Existing project advisories remain outside this change.

Goods Return requirements in the new document were all marked DONE and were preserved. Testing registration remains available.
