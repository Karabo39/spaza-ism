# POS INVENTORY — Brand Asset Pack

Vector-rebuilt from your original artwork. Every raster file below was exported from
the SVG masters in `source-svg/`, so nothing is upscaled or re-compressed from a JPG.

---

## Colour palette

| Role | Hex |
|---|---|
| Navy (POS wordmark, dark backgrounds) | `#111935` |
| Brand pink (INVENTORY, primary) | `#E8134F` |
| Pink light (gradient top) | `#FF3A74` |
| Pink deep (gradient bottom) | `#C30648` |
| Magenta (upper tray) | `#F82574` |
| Slate light (lower tray) | `#7A87B0` |
| Slate deep | `#525E88` |
| Tagline slate | `#5E668C` |
| Frame gradient | `#35306B` → `#8C2076` → `#E2166B` |

Typeface: **Montserrat** (ExtraBold for the wordmark, SemiBold for the tagline).
All type is converted to outlines in the SVGs, so nothing breaks if the font is missing.

---

## Folders

**`source-svg/`** — the masters. Infinitely scalable, transparent, editable in
Figma / Illustrator / Inkscape. Use these whenever you can.

**`logo/`** — PNG lockups on transparent background at 600 / 1200 / 2400 px wide.
`-dark` versions have white "POS" and a lighter tagline for dark backgrounds.
`-no-tagline` versions are for small placements like navbars.

**`app-icons/ios/`** — every size Apple asks for (20 → 1024), opaque white
background as required by the App Store. `alt-icon-*` are gradient alternatives if
you'd rather the icon read as a solid colour tile on the home screen.

**`app-icons/android/`** — `ic_launcher-*` at all densities, plus
`adaptive-icon-foreground-432.png` / `adaptive-icon-background-432.png` for
Android 8+ adaptive icons, and `maskable-icon-512.png` for PWAs (artwork sits
inside the 80 % safe circle so nothing gets clipped).

**`app-icons/transparent/`** — the mark alone on transparency, plus flat one-colour
versions (white / navy / pink) for watermarks, embroidery, receipts and stamps.

**`favicon/`** — `favicon.ico` (16/32/48 bundled), PNG favicons,
`apple-touch-icon-180.png`, Chrome 192/512 and a ready `site.webmanifest`.
Drop the whole folder at your web root.

**`backgrounds/icon/`** and **`backgrounds/logo/`** — the same artwork placed on 14
backgrounds: transparent, white, off-white, light slate, blush, navy, charcoal,
black, indigo, slate, solid pink, brand gradient, purple gradient, midnight.

**`web/`** — Open Graph (1200×630), Twitter card (1200×600), banners (1600×400),
app splash screens (1242×2208 and 1080×1920), navbar logos and an email-signature logo.

---

## Quick usage notes

- Keep clear space around the logo equal to the height of the "P" in POS.
- Minimum sizes: full lockup 120 px wide, icon alone 24 px.
- On busy photos use the flat white mark (`icon-mark-white`) rather than the gradient one.
- Don't recolour the wordmark, stretch the lockup, or place the gradient mark on a
  pink or purple background — use the white mark there instead.

### Web `<head>` snippet

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:image" content="/og-image-1200x630-white.png">
<meta name="theme-color" content="#E8134F">
```
