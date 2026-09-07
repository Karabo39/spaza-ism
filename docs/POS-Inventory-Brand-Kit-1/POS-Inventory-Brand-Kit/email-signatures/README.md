# Email signatures

Four layouts, all built as HTML tables with inline styles — the format Outlook,
Gmail and Apple Mail all render reliably. Type falls back to Arial/Helvetica
because Montserrat won't load in a mail client; the logo image carries the brand
typeface.

| File | Use it for |
|---|---|
| `01-classic` | Default. Logo left, contact block right, divider rule. |
| `02-stacked` | Narrow columns and mobile-first inboxes. |
| `03-compact` | Replies and internal mail. Two lines, icon only. |
| `04-banner` | New business and outbound. Adds the tagline bar. |

## Which folder to use

**`paste-ready/`** — the logo is embedded in the file, so there is nothing to
host. Open the file in your browser, select everything inside the white box,
copy, and paste into your signature editor. This is the easiest route and works
for Gmail, Outlook on the web, and Apple Mail.

**`hosted-image/`** — raw HTML with `LOGO_URL_HERE` where the image goes. Upload
the matching file from `images/` to your website (e.g.
`https://posinventory.co.za/sig-logo-horizontal.png`) and swap that address in.
Use this for Outlook desktop, Microsoft 365 org-wide signatures, and marketing
tools, which often strip embedded images.

**`plain-text-signature.txt`** — fallback for plain-text mail.

## Fill in before using

Replace in whichever file you pick: `Your Name`, `Founder &amp; Director`,
`+27 00 000 0000`, `you@posinventory.co.za`, `www.posinventory.co.za`, and
`Johannesburg, South Africa`.

## Client notes

- Images are exported at roughly 2x and sized down in the HTML, so they stay
  sharp on retina screens.
- Keep the width under about 600 px. All four templates already are.
- Outlook ignores `border-radius`, so the banner bar shows as a square block
  there. That's expected and still on-brand.
- Don't add a drop shadow or animated GIF — several clients strip them and leave
  a broken frame.
- For dark-mode inboxes, `images/sig-logo-horizontal-dark.png` has white "POS"
  text. Most clients don't support swapping images by colour scheme, so the
  standard logo on its transparent background is the safer default.
