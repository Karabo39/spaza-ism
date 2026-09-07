# POS INVENTORY branding

The public product name is **POS INVENTORY**. The original supplied artwork is
in `POS-Inventory-Brand-Kit-1/POS-Inventory-Brand-Kit/`; the SVG wordmarks already
contain outlined type and require no extra font downloads.

## Asset usage

| Surface | Supplied asset |
| --- | --- |
| Sign-in, signup and public navigation | `source-svg/logo-horizontal-dark.svg` |
| Sidebar product name | `source-svg/wordmark-dark.svg` |
| Default business icon | `source-svg/icon-mark.svg` |
| Browser favicon | `favicon/favicon.ico` |
| Installed-app icons | `favicon/android-chrome-192.png`, `favicon/android-chrome-512.png` |
| Apple touch icon | `favicon/apple-touch-icon-180.png` |
| Android maskable icon | `app-icons/android/maskable-icon-512.png` |
| Sharing previews | `web/og-image-1200x630-white.png`, `web/twitter-card-1200x600-white.png` |

Runtime logos and sharing images are copied unchanged to `public/brand/`.
Run `npm run icons` to restore the supplied favicon and app icons to the paths
used by Next.js and `public/manifest.webmanifest`.

`src/lib/brand.ts` provides the product name, description and public origin.
Reports, import templates, email subjects and page metadata use this identity.
The manifest and service worker are static files and carry the name explicitly.

## Compatibility

The service-worker cache is now `pos-inventory-v2`, so a new worker replaces
cached pages and icons from the previous brand. An installed app may need to be
closed and reopened online before its name/icon refreshes; the browser controls
when installed-app metadata updates.

The IndexedDB database `spaza-ism` and active-store cookie `sism_store` retain
their existing keys to preserve pending offline sales and store selection.
Customer-uploaded business logos continue to appear in the business icon slot.
The original BRD and handover retain their historical wording. This rebrand
requires no database migration or authentication change.

## Verification — 7 September 2026

- All 64 unit/component tests passed.
- Production build and its TypeScript check passed.
- Lint reported zero errors and ten existing warnings in other components.
- The browser preview confirmed the POS INVENTORY page title, loaded logos,
  and clear sign-in/signup layouts in a 422-pixel viewport. Sign-in had no
  horizontal overflow. Public navigation uses normal document flow to avoid
  overlapping the form branding in short windows.
- The supplied ICO is served from `public/favicon.ico` via layout metadata;
  Next.js's file-based metadata decoder rejects its indexed PNG payload.
