# September 10 evening document changes

Implemented the requests in System Changes.docx, Dashboard (1).docx and Products (2).docx.

- All business locations uses each location's configured currency from the authenticated store list. Changing the active store does not change another location's currency. A missing currency is explicitly shown as unavailable instead of guessing.
- The sidebar and operational content have separate scrolling within the available viewport height. The header stays visible. Opening another page resets content scrolling. Wide tables retain their own scrolling, and print styling releases the viewport constraints for long receipts.
- Shared buttons, native buttons, button links and dashboard quick actions use the Create Quotes pink. Existing sizes and actions are retained. Disabled buttons remain dimmed and inactive. Selected payment and customer choices have a white inset outline and accessible pressed state. Destructive actions retain their labels and existing confirmations.
- New and existing products have an optional multiline Description below Barcode, limited to 1,000 characters. It appears on the product detail page and can be cleared. Old records start blank. Old clients that omit the description preserve it. Creation and editing remain atomic, with existing barcode, expiry and access checks retained.

Validation: 135 application tests, 26 database suites, type/lint checks and a production build passed. Browser checks at 1440px and 390px verified independent scrolling, no page-wide horizontal overflow, disabled button state, product forms and print overflow. Live database compatibility checks passed after the additive migration. Security advisor categories remain unchanged; the new creation RPC checks store access and module permission and is unavailable to anonymous callers.

Account creation remains available for testing. Document email sender configuration remains unconfirmed from the earlier release.
