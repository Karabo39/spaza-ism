# September 11 detailed access and Orders changes

Implemented Access Control.docx and Orders (2).docx.

## Setting access

Open Access Control, choose the store and team member, then expand Dashboard, Orders or Invoicing. Each child has its own checkbox. Save access applies the choices only to that store. Turning off a parent disables its children without erasing their saved choices. Linked-module requirements appear below the relevant options. Owners retain full recovery access and existing manager restrictions still apply.

The same expandable choices are available when preparing an employee invitation. Existing grants and pending invitations inherit eligible child options where no explicit choice exists. Older access screens cannot erase saved child denials when saving root permissions.

- Dashboard controls its Goods In, Goods Out, Check Stock, Check Price, Adjust Stock and Credit shortcuts, All Business Locations, Invoicing and Recent Stock Movements. Stock overview cards follow Dashboard Check Stock; credit overview cards follow Dashboard Credit. Linked destination access is also required. All Business Locations remains owner-only.
- Orders controls New Order and Recent Orders separately. Creating a draft does not require access to the order history. Opening, confirming or cancelling existing orders requires Recent Orders.
- Invoicing controls Create Quotes, View All Quotes, Create from Order and View Invoices. The nested Invoicing checkbox controls the summary section, with separate checks for Invoiced, Paid / Allocated, Outstanding, Overdue, Credit Notes and Invoiced This Month. Create from Order also requires Orders / Recent Orders. Editing an existing quote requires both quote creation and quote viewing.
- View Invoices controls invoice details, printing, payment actions and invoice emailing. Summary-only users can see their allowed totals without loading the invoice list. Unchecked summary values are omitted by the database, not replaced with misleading zeroes.

Permissions govern their named module, action or widget. Separately authorized Reports, Credit, Returns or Orders workflows retain the document information they require; hiding an Invoicing summary card does not revoke these other permissions.

## Orders appearance

Choose Customer and Once-off Customer sit beside each other on the same row, including the mobile preview. Both buttons and Add Item use the existing pink View invoices treatment. Disabled Add Item remains visibly disabled. The restored button styles elsewhere and the pink Back button remain unchanged.

## Verification

141 application tests and 27 database suites passed. Database tests cover store isolation, parent and destination dependencies, role limits, direct reads and actions, selective summary output, independent creation permissions and legacy-editor compatibility. Desktop and mobile previews at 1440px and 390px verified the expandable tree, retained child choices, restricted employee screens and Orders alignment. Type checking, lint, the production build and nine simultaneous-user scenarios passed. The live migration and compatibility check succeeded; security advisor categories were unchanged.

No customer data was changed during testing. Account creation remains available for testing.
