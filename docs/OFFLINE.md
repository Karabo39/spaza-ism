# Camera scanning & offline capability

Two features aimed squarely at the target user: a shop owner on a phone with
patchy signal.

## Camera barcode scanning

Every scan screen (Goods In, Goods Out, Check Price, Adjust Stock) has a
**Camera** button next to the scan field. It opens a full-screen live scanner
that decodes barcodes (EAN/UPC/Code-128/QR and more) and feeds each code into
the *same* pipeline a USB scanner uses — so unknown barcodes still prompt
product registration, known ones add to the cart, etc.

- Uses [`@zxing/browser`](https://github.com/zxing-js/library) for cross-browser
  decoding; prefers the back camera (`facingMode: environment`).
- Keeps scanning after each hit (with a ~1.4s duplicate guard) so several items
  can be added in a row; a torch toggle appears where the device supports it.
- The button only shows when a camera is present (`enumerateDevices`), so
  desktops with only a USB scanner aren't cluttered.
- Camera decoding needs a real camera + a `getUserMedia`-capable browser over
  HTTPS (or localhost); where unavailable it degrades to the USB/keyboard field.

`src/features/scan/camera-scanner.tsx`, wired through `src/features/scan/scan-input.tsx`.

## Offline-first (safe by construction)

The guiding rule: **the server is always the source of truth for stock and
credit.** Offline support is a *cache + outbox*, never an independent ledger — so
it can never corrupt stock the way a naive offline system would.

### What works offline
| Capability | How |
|---|---|
| Open & run the app | Service worker caches the app shell + static assets (after the first online visit). |
| Scan / look up products, check price, search | An IndexedDB **mirror** of the store's products + barcodes, refreshed while online. |
| Record **cash** sales | Captured to a local **outbox** and replayed through `complete_sale` on reconnect. Local mirror stock is reduced optimistically so subsequent scans are coherent. |

### What requires a connection (on purpose)
- **Credit sales** — the credit-limit check needs live server state; allowing
  them offline could silently exceed a customer's limit. The Goods Out screen
  disables Credit while offline and tells the operator why.
- Goods In, adjustments, stock takes — authoritative multi-step operations kept
  online in v1.

### Sync & conflicts
- A top-bar indicator shows **Offline**, **N to sync**, or **N to review**.
- On reconnect (and on load), queued cash sales replay through the real RPC:
  - success → removed from the outbox;
  - a **network** blip → left pending, retried later;
  - a **business** rejection (e.g. `INSUFFICIENT_STOCK` because someone else sold
    the last units) → marked **failed / to review** rather than dropped, so the
    operator can re-do it correctly. Stock is never silently wrong.

### Files
- `public/sw.js` — runtime-caching service worker. **Never** caches Supabase
  API/auth responses (cross-origin requests are passed straight through), so
  offline reads always come from the IndexedDB mirror, never stale API data.
- `src/lib/offline/db.ts` — IndexedDB mirror + outbox (via `idb`).
- `src/lib/offline/sync.ts` — mirror refresh + outbox flush.
- `src/lib/offline/offline-context.tsx` — connectivity state, auto-sync, badge.
- `src/components/pwa/register-sw.tsx` — registers the SW (production only).

### Install as an app (PWA)
`manifest.webmanifest` + the service worker make the app installable to a phone
home screen (Add to Home Screen), so it launches full-screen like a native app.

### Limitations / future work
- Offline is scoped to the **active store** mirror; switching stores offline is
  limited to already-mirrored data.
- Credit offline, offline Goods In, and background-sync (Web Background Sync API)
  are candidates for a later phase.
