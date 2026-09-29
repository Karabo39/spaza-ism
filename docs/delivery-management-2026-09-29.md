# Delivery management — 29 September 2026

## Available workflow

Open **Orders → Manage delivery** on an order (also available from its invoice). Select Delivery required, expected date, delivery address and contact number. An issued, fully paid invoice generates exactly one linked delivery note automatically. Marking an already paid order as requiring delivery creates the note immediately.

Use **Orders → Deliveries** to browse current, scheduled/rescheduled, completed, cancelled or all deliveries. Pages contain up to 50 records; date filtering and customer-specific history are available. Future deliveries and rescheduled deliveries use the Scheduled queue. A rescheduled delivery stays there until dispatched.

Save the driver, vehicle registration, delivery reference and optional item remarks. Release goods through the existing invoice workflow, then mark Out for delivery. Dispatch does not deduct stock again. An authorised staff member confirms receipt, recording the recipient, optional contact and comments. Completion records the server time and confirming user, and changes the order summary to Completed.

A failed attempt records its reason. Rescheduling retains the original date, updates the printable note and moves the record out of the current queue. Rescheduling an out-for-delivery record also records a failed attempt. Cancellation requires one of the supplied reasons; Other requires an explanation. Cancelled records leave all outstanding queues and remain in customer/order history. Cancelling the paid order as well requires manager/owner authority.

## Documents and permissions

Delivery notes include the configured document logo, business contact details, order/invoice references, branch, customer/account details, items with ordered/delivery quantities, SKU/barcode/unit/remarks, driver details and delivery confirmation spaces. Print or save as PDF from the note page. Owner-only document contact settings were added under Settings. Customer/item/business text is snapshotted when generated; later address/driver/remarks changes are versioned and audited. The shared document logo uses the current business logo.

Store-level **Manage deliveries** permission follows the existing Orders permission hierarchy. Database checks enforce current store membership and module permission on every read/action, including retries. History is append-only, with actor and timestamps. Conflicting edits are rejected; identical uncertain retries do not duplicate an action. Queue/history reads use bounded cursor pages and omit full snapshots from history listings.

## Financial and operational boundaries

- Cancellation does not refund money, void the invoice or restore stock. Use the existing authorised returns/refund workflow. Cancelled orders cannot release previously unissued goods.
- Each note covers the full invoice quantities, matching the existing all-at-once goods release. Partial deliveries are not introduced.
- Receiver and driver signatures are handwritten on the printed note. Digital signature capture and uploaded proof-of-delivery are not included.
- Delivered date/time is the system confirmation time. Staff should record any earlier physical handover time in comments.
- Existing orders default to collection; no historical orders are automatically assumed to require delivery.

## Implementation

- Migration `20260929155110_delivery_management.sql`: delivery records, append-only events, payment generation triggers, cancellation/release safeguards, permission and contact fields, guarded RPCs and order summary states. Applied successfully to the live Supabase project.
- `src/features/deliveries/`: delivery configuration/actions, bounded queues/history and print control.
- `src/app/(app)/orders/deliveries/`: protected queue, order delivery and printable note pages.
- Orders, invoices, customer history, navigation and Settings expose the workflow. Module definitions, database types, friendly errors and release capability were updated.
- `supabase/tests/delivery_management.sql`, `supabase/tests/delivery-race.mjs`, `tests/unit/delivery-workflow.test.tsx`: payment gating, dispatch, completion, cancellation, queues, immutable history, stale updates, concurrent generation/retries and permissions.

## Validation

250 application tests passed. A fresh local database passed the full migration/regression runner (47 reported groups, including delivery cases), plus the new delivery concurrency suite. The delivery suite separately passed immediate module revocation and tenant isolation checks. Production build, type validation and lint passed. The printable template was inspected in the browser using sample data. Physical printer output was not tested.

Live migration policies and release capability were verified. The follow-up migration `20260929155542_delivery_active_queue_dates.sql` ensures early-dispatched or failed deliveries remain in the current queue; its regression test passed.

The five implementation commits (`cb69e75` through `e91aefd`) were pushed to main and Vercel reported successful deployment. Authenticated checks passed on 14 routes, including the delivery queue, an existing order's delivery detail, Dashboard, Products, Goods Out, Orders, Audit, Customers, Invoices, recurring invoices, Cash Up, Check Stock, Stores and Settings. All responses ran in Dublin (`dub1`). All five delivery queue API filters, the history projection and delivery-detail API passed. The live browser also displayed the new navigation, delivery filters and empty state correctly.

No customer orders, payments or stock were altered for live verification. Full lifecycle mutations were tested in the disposable local database; no existing live order was marked delivered or cancelled as a test. Supabase advisory review found no missing delivery RLS or foreign-key indexes; its authenticated security-definer advisory applies to the deliberately guarded RPCs, which enforce current membership/module access internally.
