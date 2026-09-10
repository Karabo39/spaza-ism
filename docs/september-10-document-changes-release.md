# Changes from the six September 10 documents

Implemented Stock Take.docx, Orders (1).docx, GoodsReturn (4).docx, Invoices (2).docx, Settings.docx and Reports (1).docx.

- Each store has its own currency, searchable by currency code, currency name or country. The list includes 153 current tender currencies from Unicode CLDR. Existing stores inherit the business currency without changing any amounts. My Stores shows each store’s currency and a green stock-value badge above zero, red at zero or below.
- Currency is chosen before products, customers or trading records are added. Established stores cannot be relabelled, even after balances are cleared, because their historical reports must keep their original meaning. Different currencies require separate stores. Transfers between different currencies are blocked rather than silently changing price units. No automatic exchange-rate conversion is introduced.
- Price History displays the user who made the change; older records without an actor remain marked Not recorded. Reports, warehouse rows, search results and future invoice snapshots use the relevant store currency. Mixed warehouse exports include a currency column.
- New orders accept one-off customer names with optional phone/address. Retrying a save does not duplicate the customer or order. One-off contacts remain excluded from registered credit accounts.
- Pay – To be Delivered leads through invoice creation and payment. Selecting it does not create a payment: the invoice becomes Paid – To be Delivered only when fully paid and goods have not been released.
- Create from order, View invoices and View all quotes use the same primary pink button treatment as Create Quotes.
- Returns use one searchable source selector, hide items already added to the current return, and allow each reference to expand into returned items and quantities. Returned by uses the actual submitting user.
- Stock Take has Still the Same beside System at Count. Checking it fills Physical Count; the user must still save it. Existing count freshness, expiry and approval rules remain enforced.
- Both printable document views (invoice/payment receipt and approved return receipt) have Email document beside Print / save PDF. The form prefills the customer email and permits another recipient. The server loads the authorized document and creates the PDF; the browser cannot provide arbitrary totals. Sending uses module/store checks, daily limits, stable retry IDs and a delivery log. The UI says accepted for delivery after provider acceptance, not confirmed inbox delivery.

Email activation requires RESEND_API_KEY and REPORT_EMAIL_FROM in the application’s server environment, using a verified sender. Configuration has not been confirmed in this session. No customer emails were sent during testing; delivery was tested with a simulated provider.

Validation: 132 unit/component tests; 25 database suites; nine simultaneous-user scenarios including first product versus currency change; production build; lint/type checks; and a 67-table backup/restore drill. Desktop (1440px) and mobile (390px) previews covered currency selection, stock badges, count copying, one-off orders, return expansion/selection and email interaction. A PDF from the application renderer was visually checked.

Create an account stays available for testing. Existing invitation and per-store module rules remain in place.
