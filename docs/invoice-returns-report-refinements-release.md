# Invoicing, returns and report refinements

Implemented from Reports.docx, Invoices (1).docx and GoodsReturn (3).docx, added on 9 September 2026.

- Invoicing replaces the Invoices navigation label. Create Quotes opens a new quote directly; View all quotes opens a paginated list.
- Quotes support existing customers and one-off contacts with a required name and optional phone/address. One-off contacts stay out of the registered credit-customer picker. They use an internal contact record so invoice settlement and return refunds retain a consistent customer ledger.
- Accepting a quote asks whether to add a purchase order. Its details are saved before acceptance; the purchase-order form is hidden and server changes are blocked after acceptance or conversion. Existing attachments remain stored.
- Paid – To be Delivered appears for fully paid invoices awaiting goods release, including the invoice filter and export. Credit-note settlement is not labelled as full payment.
- Payment fields follow Transaction, Payment method, Amount. Credit Customer uses the invoice’s existing registered account without requiring or posting a receipt amount. It cannot transfer an issued invoice to a different customer. Goods release still enforces credit limits and manager approval. Posted prices, totals and customer identity remain immutable.
- Return source lists exclude fully returned or fully reserved documents. Partial returns display the remaining quantity. Submitted returns reserve quantities; rejection releases them. The original charged unit value remains the basis for return estimates. Return references and receipt links use outlined skyblue buttons.
- Goods Out reports and exports include Sold by and Override approved by, using the actual stored user IDs. Unavailable historical names are shown as unavailable rather than guessed.

Validation: 123 unit/component tests, 24 database suites, eight simultaneous-user scenarios, lint/type checks, production build and a 67-table backup/restore drill passed. Desktop (1440px) and mobile (390px) component previews covered quote creation, the acceptance popup, payment layout, credit selection and remaining return quantities without browser errors. These previews used fictional local data; no live financial transactions were created for testing.

The live migration was applied and the public release compatibility check passed before deployment. Security review found no new anonymous data access: authenticated business actions retain store/module checks. Supabase continues to flag the intentional authenticated SECURITY DEFINER API pattern ([guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)) and the existing disabled [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Create an account remains available for testing. Invitation, store/module permissions and return approval/refund rules are unchanged.
