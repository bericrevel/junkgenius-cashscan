# JunkGenius CashScan · v0.2

Scan a piece of junk. Know what it's worth. Know what to do next.

Native Android app (Capacitor 8 + React/TS/Vite) with a Vercel proxy that keeps
the Anthropic key server-side. v0.2 is the post-audit build: every blocker,
high, and medium finding from the July 2026 ship-readiness audit is fixed.

## What changed in v0.2 (audit fixes)

**Blockers**
- **CORS**: the proxy now answers OPTIONS preflights and sets CORS headers on
  everything — previously *every* API call from the packaged app failed.
- **Build**: added the missing `src/vite-env.d.ts`; `npm run build` compiles now.
- **Capacitor 6 → 8**: Capacitor 6 targets SDK 34, which Google Play stopped
  accepting for new apps in Aug 2025 (and the bar rises to SDK 36 on
  Aug 31, 2026). Capacitor 8 targets SDK 36 — clears both.

**Security / correctness**
- The proxy is now **task-locked**: system prompts live server-side and the app
  can only request `identify` / `guide` / `listing` with validated data. It can't
  be repurposed as a general Claude relay. Plus: optional shared app key
  (`X-App-Key`), best-effort per-IP rate limiting, payload caps.
- Camera captures are capped at **1280px / quality 80** — under every payload
  limit, near-free on prepaid data, and still plenty to identify a lawnmower.
- Model output is validated (`normalizeScanResult`), and a React error boundary
  catches anything that slips through — no more white-screen risk.
- Guide generation checks `stop_reason`: a truncated repair guide shows a
  visible warning instead of silently ending mid-step.

**UX / reliability**
- 45s network timeout, offline detection, plain-language errors, and **Try
  Again** buttons that re-send the photo you already took (no re-upload cost).
- Android hardware back button navigates in-app instead of killing the app.
- **Scrap sales are trackable now** ("Sold it? Track the cash" on the result
  screen) and scrap gets a real guide (what's inside, what yards pay, what to
  strip first). The big verdict button always does something.
- Sale-price input accepts "$40" and friends; invalid input gets a hint instead
  of a silently dead button. Ledger entries can be removed (tap ✕).
- Accessibility: pinch-zoom re-enabled, button colors darkened to pass contrast.

**v0.3**: the Pro placeholder is now a **real Stripe paywall** — see the
"CashScan Pro" section below. Still intentionally open: the ledger is on-device
only (no cloud sync).

## Project layout

- `src/App.tsx` — the five screens (Scan, Result, Guide, Listing, Tracker)
- `src/lib/camera.ts` — native camera capture, size-capped
- `src/lib/storage.ts` — on-device persistence (Capacitor Preferences)
- `src/lib/claude.ts` — task calls to your proxy + output validation
- `api/claude.ts` — Vercel function (Node runtime) holding key + prompts
- `assets/` — icon + splash sources for `@capacitor/assets`

## Toolchain (Capacitor 8)

- Node **22+**
- Android Studio **Otter (2025.2.1)+**
- Java **21** recommended (AGP 8.13, SDK 36)

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Deploy the proxy to Vercel**
   ```bash
   npx vercel
   ```
   In Vercel Project Settings → Environment Variables set:
   - `ANTHROPIC_API_KEY` = your key (required)
   - `APP_SHARED_KEY` = output of `openssl rand -hex 24` (recommended)
   - `ANTHROPIC_MODEL` = optional override (default `claude-sonnet-4-6`)

   **Also set a monthly spend cap + usage alerts in the Anthropic console.**
   That's the backstop for everything else.

3. **Point the app at the proxy**
   Copy `.env.example` → `.env` and set:
   ```
   VITE_API_BASE_URL=https://your-project.vercel.app
   VITE_APP_KEY=<same value as APP_SHARED_KEY>
   ```

4. **Build the web assets**
   ```bash
   npm run build
   ```

5. **Add the native Android project** (once)
   ```bash
   npx cap add android
   ```

6. **Generate launcher icons + splash screens** (once, after step 5)
   ```bash
   npm run assets
   ```

7. **Sync and open** (every code change)
   ```bash
   npx cap sync
   npx cap open android
   ```

## Before you publish — the store checklist

- [x] **appId: DECIDED & LOCKED — `com.aerkatech.cashscan`.** Suite convention:
  `com.aerkatech.<app>` — flat org root, one lowercase single-word segment per
  app, never a rebrandable family name in the ID. (Display names keep full
  branding; only the ID is permanent after first Play upload.)
- [ ] **Keystore**: generate once, back it up in **two** places. Losing it
  orphans the app forever.
- [x] **Privacy policy: SHIPPED** at `public/privacy.html` — live at
  `https://<your-project>.vercel.app/privacy.html` after deploy; that's the URL
  for the Play form. ⚠ Replace the placeholder contact `support@aerkatech.com`
  with a real inbox before submitting.
- [x] **Data Safety form: answers prepared** — four data types (Photos, Email,
  Purchase history, Device IDs), all "shared: No" via the service-provider
  exemption, plus the not-collected list and AI-content guidance. See the
  "Data Safety Answer Sheet" delivered alongside this build. Do NOT declare
  "Payment info" — cards never touch the app (Stripe hosted checkout).
- [ ] Store listing: screenshots, feature graphic, short/full description.
- [ ] Device pass: one low-end phone (2–3 GB RAM) + one modern one — airplane
  mode, weak signal, font size cranked up, hardware back from every screen,
  full scan → sell → ledger loop.

## CashScan Pro (Stripe)

**The deal (mission-designed):** everything is free until CashScan has either
put **$100 of tracked cash** in the user's pocket **or run 150 scans** —
whichever lands first. After that, *new scans* need Pro — but the ledger, the
numbers, and every past result stay free forever. Never ransom someone's own
data. `past_due` subscriptions keep access while Stripe retries the card —
don't cut a struggling user off mid-retry.

**Why two triggers:** the ledger is self-reported, and the lie that benefits a
user is silence — scan forever, never log a sale. The 150-scan counter is the
honor-system backstop. It's counted on-device (failed reads don't count), a
reinstall resets it, and that's accepted: reinstall-dodgers were never going to
pay, scans cost pennies, and verifying honestly would mean surveilling the
ledger — which would break the app's core privacy promise. If free-riding ever
actually shows up in the API bill, the escalation path is a server-side
per-device scan tally (needs a small KV store) — documented here so future-you
doesn't reinvent it. **Marketing note:** anywhere the flyer/listing says "free
until it makes you $100," the fine print must carry "or 150 scans, whichever
comes first" — the deal only builds trust if it's stated whole.

**Architecture — account-less, database-less:**
- Identity is an anonymous device UUID (Capacitor Preferences). No accounts,
  no passwords, no PII in the app.
- Checkout = Stripe Checkout opened in an **Android Custom Tab** (a real
  browser — Stripe blocks embedded WebViews, and card details never touch the
  app).
- Entitlement = Stripe subscription search by `metadata.deviceId`. **Stripe is
  the only database.** New phone? "Restore my Pro" re-binds by receipt email.
- Weak-signal rules: entitlement is cached 6h, and a previously-Pro device
  stays Pro through a **7-day offline grace window**.
- Cancel = Stripe customer portal, two taps, in-app button.

**Setup:**
1. In the Stripe dashboard: create a product "CashScan Pro" with two prices —
   $3.99/month and $24/year (or your own; if you change them, also update
   `PRICE_MONTHLY_LABEL` / `PRICE_ANNUAL_LABEL` at the top of `src/App.tsx` —
   the app displays those strings, Stripe charges the real price).
2. Enable the **customer portal** (Settings → Billing → Customer portal →
   activate) so "Manage / cancel subscription" works.
3. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` on
   the Vercel project and redeploy.
4. Test end-to-end with `sk_test_` keys + Stripe test cards before going live.

**Google Play policy (verified July 2026):** under the Epic v. Google
injunction, US Play apps **may** offer alternative billing / external payment
flows like this — but you must **enroll in Google's US alternative-billing
program in Play Console** first (Google requires the option be presented
alongside Play Billing per program terms; no Google service fee is currently
assessed on these US transactions, though Google has said fees may come).
Practical guidance:
- Enroll in the program **before** enabling the paywall in a Play build.
- Keep distribution **US-only** until you add Google Play Billing — outside
  the US, Play still requires Play Billing for digital goods.
- The entitlement layer (`src/lib/pro.ts`) is deliberately payment-agnostic so
  a Play Billing adapter can slot in beside Stripe later for the side-by-side
  requirement.
- Source: Google Play Console Help, "Offering an alternative billing system
  for users in the United States." Re-check it before submission — this policy
  area moves.

## Go-links (QR redirect counter)

The printed flyer and counter card carry QR codes pointing at
`aerkatech.com/go/f` and `/go/c`. `api/go.ts` counts the hit (a tally — no
IPs, no cookies, nothing about the person) and 302-redirects to the Play
listing. Per-channel counts tell you which placements actually work.

**Reliability rule baked in:** the redirect always happens even if counting
fails or storage isn't configured — a dead QR on printed paper is the one
unforgivable failure.

**Setup:**
1. Create a free Upstash Redis database (Vercel Marketplace → Upstash, or
   upstash.com). Free tier ≈ 10k commands/day; a scan costs 4 — plenty.
2. Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` on the Vercel
   project (the Marketplace integration injects them automatically).
3. Attach your domain (Vercel → Domains) once registered, so
   `aerkatech.com/go/f` resolves. Until then test on
   `https://<project>.vercel.app/go/f`.
4. Read your numbers: `GET /go/stats?key=<APP_SHARED_KEY>` →
   `{ "channels": { "f": { "total": 42, "today": 3 } } }`

**Channel names** (any lowercase `[a-z0-9-]` works, no registration needed):
`f` flyer · `c` counter card · `yard` scrapyard · `lib` library · `press` ·
`fb` Facebook · `rd` Reddit · `ws` workshops.

**Pre-launch trick:** set `PLAY_STORE_URL` to your closed-testing opt-in link
during the 14-day tester phase — early QR placements recruit Founding
Scrappers, then flip the env var to the live listing at launch. Nothing gets
reprinted.

## Permissions

None. `saveToGallery: false` means the Camera plugin needs no manifest entries:
taking a photo uses the system camera intent, picking uses the permission-free
Android Photo Picker.
