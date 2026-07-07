# JunkGenius · v0.2 — the full merge

<!-- build signature pinned via scripts/debug-keystore.b64 -->

Scan anything. Know what it's worth. Know what to do next.

JunkGenius is the merged flagship — **ScrapScout + JunkGenius CashScan, united**
into one app, with a full visual redesign. It replaces both standalone apps.
Same audited architecture and mission as its predecessors (Ærk-A-Tech suite):
steady income for people turning free, abundant discarded junk into cash.

## RULE #1 — ABSOLUTELY NO MOCK DATA

Unchanged from both predecessor apps, and it outranks everything else here.
No fabricated facts, ever. AI estimates are fine when labeled as estimates;
invented "live" data is not. Real source or an honest empty/setup state —
always. If a feature can't be built without faking its data, the feature waits.

## The design: Mirrored Chrome / Deep Emerald Glass (v4.1)

Three directions were mocked and compared before any real code was written
(see `design/flagship-v2.html`, `v3-gloss.html`, `v4-chrome.html` in the
project workspace). The approved direction: **real embossed chrome** —
bezels, rings, and buttons with true inset highlights and shadows, like
actually-stamped metal — wrapping **deep, translucent emerald glass**, not
opaque paint. Think a premium watch case: a chrome bezel around a smoked
emerald crystal you can almost see into. Money values render in a brighter,
flat, legible emerald (never the deep glass tones, which are for surface
fills only) — Space Grotesk for display type, Inter for body, JetBrains Mono
for every dollar amount.

## Why two AI providers

Verified July 2026: Gemini 3.1 Flash-Lite costs roughly **$0.0003/image**
vs. Claude Sonnet's **~$0.0048/image** — about 16x cheaper. The photo-scan
call fires on *every single scan* and dominates spend by volume, so:

- **`identify`** (the scan) → **Gemini 3.1 Flash-Lite**. Cheapest call, by far
  the highest volume, and vision-only work doesn't need Claude-tier reasoning.
- **`guide` / `chat` / `listing` / `buyer`** → **Claude Sonnet**, unchanged.
  These are opt-in, much lower volume, and benefit from stronger reasoning
  for safety-sensitive repair guidance and persuasive listing copy.

Two API keys, two signups — see Setup below. Both required.

## Multi-item scanning

Point the camera at a whole pile, not just one object. `identify` returns
**every distinct sellable/scrappable item** it finds (up to 8), each with its
own full dual-value verdict. The Verdict screen shows "Found N items —
showing X of N" with Next/Previous, and each item can be added to inventory
independently.

## Three finishes (v4.2)

Same watch, three crystals: **Emerald** (default), **Sapphire**, and
**Gold**. The chrome never changes; the glass color family — buttons, bezel
faces, glows, money text, mirrored lettering, even the near-black base tint —
swaps as one. Picked on the Home screen ("FINISH"), stored on-device via
Preferences like everything else personal, no account. Palettes live as
`[data-theme]` CSS variables in `src/index.css`; Tailwind's accent/ink tokens
read the same variables, so every `text-abright`-style usage follows the
active finish automatically.

## Everything is wired in (no phases)

Every feature from both predecessor apps is live in navigation, reskinned in
the chrome/jewel-glass system, in all three finishes:

| Feature (from ScrapScout / CashScan) | Status |
|---|---|
| Multi-item scan + dual valuation | **✓ rebuilt on Gemini** |
| Repair/scrap/part-out guide | **✓ ported from CashScan, on Claude** |
| Inventory + real-cash tracking | **✓** |
| Pro gate (Stripe two-trigger + owner FOUNDER_CODE unlock) | **✓** |
| Yard finder (OpenStreetMap) + yard notes + logged prices | **✓ tab** |
| Metal spot prices (real API or honest setup state) | **✓ tab** |
| My Spots, The Plan, Know the Rules | **✓ home toolbox** |
| Ask the scout (chat), Listing generator (+ real eBay asks), Buyer triage | **✓ home toolbox** |
| Referral share | **✓ home** |

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Get both AI keys**
   - Gemini: free at [aistudio.google.com](https://aistudio.google.com) → Create API Key
   - Anthropic: [console.anthropic.com](https://console.anthropic.com) → API Keys
     → **set a monthly spend cap** in Billing

3. **Deploy the backend**
   ```bash
   npx vercel
   ```
   Vercel env vars: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, optionally
   `APP_SHARED_KEY` (+ matching `VITE_APP_KEY` locally).

4. **Point the app at it, build, sync**
   ```bash
   cp .env.example .env   # set VITE_API_BASE_URL (+ VITE_APP_KEY if used)
   npm run build
   npx cap add android     # first time only
   npm run assets          # first time only, needs assets/icon.png
   npx cap sync
   npx cap open android
   ```

Toolchain: Node 22+, Android Studio Otter+, Java 21 (Capacitor 8).

## Suite identity

- appId: `com.aerkatech.junkgenius` (suite convention: `com.aerkatech.<app>`,
  flat, one word, permanent after first Play upload)
- Repo: rebuilt inside the existing `junkgenius-cashscan` GitHub repo, so the
  live Vercel backend and the phone install bookmark
  (`github.com/<you>/junkgenius-cashscan/releases/latest`) carry over —
  push this code, add the Gemini key alongside the existing Anthropic one,
  and the next build IS JunkGenius.
- ScrapScout (standalone) is retired per owner decision once this is
  confirmed working — its repo/backend can be deleted from their respective
  dashboards (GitHub Settings → Danger Zone; Vercel project Settings →
  Delete) whenever you're ready; nothing here does that automatically.

## Permissions

`ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION` — used only when you tap
MY LOCATION on the Yards screen (typed city/ZIP search works without them;
location permission is always optional). The build workflow injects them
into the generated AndroidManifest. Camera needs no manifest entries
(`saveToGallery: false`).
