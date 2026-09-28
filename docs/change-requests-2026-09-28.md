# September 28 document changes

Implemented from Customers.docx, Orders (6).docx, Goods Return (1).docx, My Stores (2).docx, Invoicing (1).docx and Quotes.docx.

## Customer profiles

The Customers module supports individual and business customers separately from credit eligibility. Profiles include name, phone, email and structured postal address. Profile edits reject stale changes and preserve existing balances. Only managers/owners can change credit eligibility. New customers created through the picker default to cash/card; existing customers retain their eligibility. Credit-disabled customers cannot start new credit transactions or receive unpaid invoice goods.

## Document numbers

New orders, invoices, returns and quotes use ORD-, INV-, RET- and QUO-YYYYMMDD-NNN. Each business has its own sequence per document type and South African calendar day. Numbers are assigned transactionally, cannot be edited and grow beyond 999. Existing references remain unchanged. Concurrent allocation is tested.

## Stores and requested styling

Edit Store is available on store cards and beside Exit My Store. It reuses the existing guarded location update. View Stock opens the selected store's Products view. Store changes preserve catalogue prices, quantities and transaction history. The requested quote, return and product actions use the existing red primary-button style.

## Recurring invoices

Invoices now links to Recurring Invoice. Managers with the existing invoice/order permissions can create, edit, activate/deactivate and inspect schedules and invoice history. Schedules support daily, weekly and monthly billing, dates, agreed line prices, tax, payment terms, due days, customer and email recipient. Monthly billing is the default; month-end billing clamps to February and returns to the original day in March. Services can use existing sales-only catalogue products.

Defaults are inactive, 30-day payment terms and manual email review. Automatic email requires an explicit opt-in. Prices and line descriptions are saved with the schedule; customer details are snapshotted when each invoice is generated. Generated invoices appear in the normal invoice workspace. Generating an invoice creates the receivable but does not deduct physical stock; the existing Issue goods process remains responsible for stock movement.

The private scheduler runs every five minutes in batches of at most 50. It rechecks the configuring user's current permissions, store/customer/product availability and credit limits. One invoice per schedule and billing date is enforced by locking and a unique index. Missed periods catch up one period per schedule per run. Failures roll back fully and retry after an hour; saving a corrected schedule clears its failure state.

The Hostinger email worker runs every ten minutes, claims at most ten opted-in invoices and sends a PDF from `invoice@posinventory.store`. Its random credential stays encrypted in Supabase Vault; server-only validation returns a boolean, never the secret. Delivery reservations prevent automatic duplicate mail. Uncertain SMTP outcomes require review in invoice history instead of blind retries. Changing or deactivating a schedule affects future generation, not previously issued invoices or their already-queued deliveries.

## Validation and operating notes

- Production build, lint, type checking and database release-contract check passed.
- Full application suite: 235 tests passed; two additional worker-authentication tests also passed.
- Full local database suite passed, including customer edits, balances, permissions, tenant isolation, schedules, snapshots, credit limits and month-end dates.
- Separate concurrent-connection tests passed for five simultaneous document allocations and simultaneous generation of the same billing period.
- Live migrations and worker deployment completed. All 18 authenticated page checks returned HTTP 200 from Dublin (`dub1`), including Customers, Recurring Invoice, store setup and View Stock. Both cron jobs ran successfully; the email worker returned HTTP 200 with zero queued deliveries.
- Existing invoices have no newly invented address snapshot; their historical references remain unchanged.
- No customer invoices or customer emails are created solely for deployment testing. Local automated tests cover generation/delivery behaviour; actual inbox delivery is only exercised when an opted-in schedule runs.
- Supabase reports the expected guarded SECURITY DEFINER RPCs and the deliberately inaccessible private sequence table. Existing leaked-password protection and other legacy advisor findings are outside this change. The non-relocatable pg_net extension uses its own `net` schema but is registered under `public`, which the advisor flags.

Implementation: six schema migrations dated 20260928; customer and billing features under `src/features`; store/product routes under `src/app/(app)`; scheduled email under `supabase/functions/recurring-invoices`; database tests in `supabase/tests/customer_recurring.sql` and `customer-recurring-race.mjs`. Employee-created customers are cash/card-only at the database boundary, including direct requests.
