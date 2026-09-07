# Store setup, module access and cash-up

## Add a store

Open **My Stores → Add store**, enter the name and choose Selling store or
Warehouse. The new location becomes active. Use its setup links to assign staff,
review Access Control, add/import products and receive opening stock.

Owners can access every location. Other users must be assigned in **Users**.
Each location keeps its own stock. Warehouses cannot make sales or cash up.

## Access Control

Select the store using the top store switcher, open **Access Control**, choose a
team member, select their modules and save. Repeat for each store that person
works at. Saving at one store does not affect another store.

Owners retain full access. Manager-only and owner-only functions still require
those roles. Existing assigned staff start with their current role's defaults.
Modules required by a higher role cannot be enabled for a lower role. Reassigning
an existing location preserves its grants; removing a location removes those
grants, and a later new assignment starts with role defaults.

Changes are checked on every database operation, as well as in routes and menus.
Open screens refresh permissions on reconnect, on returning to the tab, and
every minute while visible online. Pending offline work is preserved; a revoked
operation cannot sync until the owner restores the relevant access.

Modules include shared lookup data needed for their work: for example checkout
needs products and customers, and Reports can read the underlying transactions.
This is module access, not column-level or individual-record masking. Linked
actions may require both modules, such as allocating return credit to an invoice.
Dashboard includes business metrics; deny Dashboard as well when those figures
should be hidden.

If two owners edit the same user's store permissions, an outdated save is
rejected. Reload to review the other owner's changes rather than overwriting them.

## Daily cash-up

There is one cash-up per store per South African business date.

1. Sync every till and resolve failed offline sales.
2. Open **Cash-up**, choose the date and enter the float present before trading.
3. Check the cash sources: checkout receipts, invoice payments, credit payments,
   cash refunds, and other drawer movements.
4. Enter the counted total, or count ZAR notes and coins. Explain any difference.
5. Submit the count for a manager or owner to approve.

Expected cash is opening float + cash receipts + other cash added − cash refunds
− cash removed/banked. Card/EFT and unpaid credit sales are excluded. Invoice
payments mirrored in the credit ledger are counted once.

New standalone credit payments require a Cash or Card/EFT method and safely
reuse the same request on retry. Older payments without a recorded method must
be classified by a manager using receipt/bank evidence before cash-up submission.
The cash-up page identifies the customer, amount, time and payment reference.

Managers can record other drawer movements with a reason, or correct a float
while a cash-up is open. These actions are audited and do not change stock or
customer balances. Do not enter sales or refunds again as drawer movements.

If activity arrives during a count, submission/approval is rejected as stale.
If cash activity arrives after approval, the page flags it for reopening and
recounting. Previous counts and approvals stay in history. A variance needs a
note from the counter and a note when a manager approves it.

Offline sales belong to the date they reach the server. Close only after all
devices have synced. Manager approval does not require a different person from
the counter; a manager or owner can approve their own count.
