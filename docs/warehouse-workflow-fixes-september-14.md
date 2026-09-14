# Warehouse fixes — 14 September 2026 evening

Implemented from the updated `docs/Warehouse.docx` saved at 20:59.

## Screens and navigation

- Warehouse quantities above zero and **In Stock** status display green; zero/negative quantities and **Out of Stock** display red.
- Total warehouse value cards use green backgrounds for positive values and red for zero/negative values. Existing typography is preserved.
- Warehouse action buttons use the requested coloured background. Transfers is now **Transfer to Store**.
- **Add Warehouse** is beside Sync Products. Its form opens only after clicking, and remains open after a successful addition, ready for the next warehouse.
- View Stock, Receive Stock, Unpack Bulk Stock, Adjust Stock and Stock Take use dedicated warehouse pages with an explicit warehouse ID. They do not change the selected selling store.
- Store screens, including Products, Check Stock and Check Price, use the selected selling store. An old warehouse cookie falls back to an assigned selling store in the same business when possible. Warehouse-only staff cannot open a store screen without a store assignment.
- Warehouse unpacking lists configured packs with positive warehouse stock. Receiving and stock-take location choices stay within their current store/warehouse context.
- The warehouse overview shows the current user's transfers between the warehouse cards and Warehouse Stock View, including expandable item details and transfer references.

## Transfers

1. Open **Warehouse → Transfer to Store** and select the destination store.
2. Choose a source product. The destination is matched by its existing product link, SKU or barcode and is read-only. An ambiguous or missing match requires correcting the catalogue; names alone do not establish identity. Units, expiry tracking and currency must match.
3. Add items and save a draft. **Edit draft** allows adding/removing lines before submission. Concurrent edits are rejected rather than overwriting another user's draft.
4. **Submit to Store** performs submission and dispatch atomically. Warehouse stock decreases once and stays in transit. No separate Dispatch or Receive action is shown in the warehouse.
5. The destination-store user opens **Goods In → Receive Stock Transfer / Warehouse → Store**. Pending receipts appear first; completed receipts remain visible below. This section has no Excel, Export or Email controls.
6. **Receive stock** adds destination quantities and applies the cost and selling prices captured when the new warehouse workflow submitted the transfer. Retrying does not duplicate quantities or price changes. Legacy already-dispatched transfers without a selling-price snapshot retain the destination's selling price.

Sending retains the existing submit and dispatch permissions; owners must grant both where staff should send transfers. Receiving retains the destination's Receive Stock Transfer permission. A warehouse-only account cannot receive for an unassigned store. Existing store-to-store transfer processing remains available separately.

Draft edits, dispatch and receipt are audited. Product price history remains intact. Cancelling an in-transit transfer uses the existing audited stock restoration process. Historical transfer records are retained.

## Reports

**Stock Movements** uses selling-store stock only. **Warehouse Stock Movements** is a separate report with a permitted warehouse selector. A warehouse card's Movement reports button opens this report for that warehouse. Report exports use the warehouse context as well.

## Validation

The full local migration bootstrap and all 33 database regression suites passed. The new suite verifies matching, draft edits and retries, stale-edit rejection, stock in transit, receiving context, destination-only employee receipt, price updates and duplicate-receipt prevention. All 172 application tests passed across 47 suites (the existing long-report PDF test passed on a separate rerun after a machine-load timeout). Type checking, lint and the production build passed. The live migration is applied and the release compatibility check passes. Deployment completion is recorded in the task completion message.

No production stock movements, test purchases or emails are created for validation.
