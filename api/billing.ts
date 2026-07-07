// JunkGenius — Stripe billing (Vercel, Node.js runtime).
// Direct port of CashScan's audited billing stack: task-based, Stripe is the
// only database (anonymous device ID in subscription metadata), no accounts.
//
//   checkout    → Stripe Checkout session (subscription OR founders one-time)
//   entitlement → is this device Pro? (subscription OR founders purchase)
//   founders    → live Founders Edition count — REAL number from Stripe,
//                 never invented (Rule #1 applies to scarcity too)
//   restore     → new phone: re-bind by receipt email
//   portal      → Stripe customer portal (manage / cancel anytime)
//
// Founders Edition: $99 once, lifetime Pro, capped at 250 forever — for
// America's 250th year. The cap and the live count both come from Stripe
// payment-intent search (metadata edition=founders250); Stripe stays the
// only database. Buyers get a number: their position in real purchase order.
//
// Env vars: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_ANNUAL,
//           STRIPE_PRICE_FOUNDERS ($99 one-time price id),
//           APP_SHARED_KEY (optional gate),
//           FOUNDER_CODE (optional owner unlock — typed into the app's
//           "Restore my Pro" box; grants permanent Pro on that device with
//           no Stripe record. Lives only here, never in the client bundle).
// Note: entitlement uses Stripe Search (eventually consistent, ~1 min) — the
// app copes with a polite "can take a minute" retry flow.

/** Constant-time-ish string compare — a plain === can, in principle, leak
 *  match-prefix length through timing. Cheap to do right, so do it right. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
  "Access-Control-Max-Age": "86400",
};

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const DEVICE_ID_RE = /^[a-f0-9-]{16,64}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
// past_due keeps access while Stripe retries the card — never cut a
// struggling user off mid-retry.
const PRO_STATUSES = ["active", "trialing", "past_due"];

interface StripeSub {
  id: string;
  status: string;
  customer: string;
}

async function stripe(
  key: string,
  path: string,
  opts: { method?: "GET" | "POST"; params?: Record<string, string> } = {}
): Promise<Record<string, unknown>> {
  const url = new URL(`https://api.stripe.com${path}`);
  let body: string | undefined;
  if (opts.method === "POST") {
    body = new URLSearchParams(opts.params || {}).toString();
  } else if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

async function findSubByDevice(key: string, deviceId: string): Promise<StripeSub | null> {
  const found = (await stripe(key, "/v1/subscriptions/search", {
    params: { query: `metadata['deviceId']:'${deviceId}'`, limit: "10" },
  })) as { data?: StripeSub[] };
  return (found.data || []).find((s) => PRO_STATUSES.includes(s.status)) || null;
}

const FOUNDERS_CAP = 250;
const FOUNDERS_EDITION = "founders250";

interface FoundersPI {
  id: string;
  status: string;
  created: number;
  customer?: string | null;
  metadata?: Record<string, string>;
}

/** Every succeeded Founders payment, oldest first — the honest ledger.
 *  250 max means ≤3 search pages; cached briefly per warm instance. */
let foundersCache: { at: number; list: FoundersPI[] } | null = null;
async function listFounders(key: string, force = false): Promise<FoundersPI[]> {
  if (!force && foundersCache && Date.now() - foundersCache.at < 60_000) return foundersCache.list;
  const out: FoundersPI[] = [];
  let page: string | undefined;
  for (let i = 0; i < 5; i++) {
    const params: Record<string, string> = {
      query: `metadata['edition']:'${FOUNDERS_EDITION}' AND status:'succeeded'`,
      limit: "100",
    };
    if (page) params.page = page;
    const res = (await stripe(key, "/v1/payment_intents/search", { params })) as {
      data?: FoundersPI[];
      has_more?: boolean;
      next_page?: string;
    };
    out.push(...(res.data || []));
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }
  out.sort((a, b) => a.created - b.created);
  foundersCache = { at: Date.now(), list: out };
  return out;
}

/** This device's founders purchase (if any) plus its 1-based number. */
async function findFoundersByDevice(
  key: string,
  deviceId: string
): Promise<{ pi: FoundersPI; number: number } | null> {
  const all = await listFounders(key);
  const idx = all.findIndex((p) => p.metadata?.deviceId === deviceId);
  return idx === -1 ? null : { pi: all[idx], number: idx + 1 };
}

interface NodeReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}
interface NodeRes {
  setHeader(name: string, value: string): void;
  status(code: number): NodeRes;
  json(body: unknown): void;
  end(): void;
}

export default async function handler(req: NodeReq, res: NodeRes) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const sharedKey = process.env.APP_SHARED_KEY;
  if (sharedKey && req.headers["x-app-key"] !== sharedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ip =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : "") ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many requests — try again in a few minutes" });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const action = body.action as string;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  if (!DEVICE_ID_RE.test(deviceId)) {
    res.status(400).json({ error: "A valid deviceId is required" });
    return;
  }

  const host =
    (typeof req.headers["x-forwarded-host"] === "string" && req.headers["x-forwarded-host"]) ||
    (typeof req.headers["host"] === "string" && req.headers["host"]) ||
    "";
  const origin = host ? `https://${host}` : "";

  // ---- Founder unlock (owner convenience) ----
  // Checked BEFORE the Stripe gate so the owner's unlock works even on a
  // deployment where Stripe isn't configured yet. A non-matching attempt
  // falls through to the normal email-restore path below, so responses
  // never reveal that a code exists.
  if (action === "restore") {
    const founderCode = process.env.FOUNDER_CODE || "";
    const attempt = typeof body.email === "string" ? body.email.trim() : "";
    if (founderCode && attempt && safeEqual(attempt, founderCode)) {
      res.status(200).json({ pro: true, founder: true });
      return;
    }
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(500).json({ error: "STRIPE_SECRET_KEY not configured on server" });
    return;
  }

  try {
    if (action === "checkout") {
      const plan =
        body.plan === "annual" ? "annual" : body.plan === "monthly" ? "monthly" : body.plan === "founders" ? "founders" : null;
      if (!plan) {
        res.status(400).json({ error: "plan must be 'monthly', 'annual', or 'founders'" });
        return;
      }

      if (plan === "founders") {
        const price = process.env.STRIPE_PRICE_FOUNDERS;
        if (!price) {
          res.status(500).json({ error: "Founders Edition isn't configured on the server yet" });
          return;
        }
        // Hard cap — refuse to even open checkout past 250. Fresh count, not
        // cached: overselling a numbered edition is worse than a slow click.
        const sold = (await listFounders(stripeKey, true)).length;
        if (sold >= FOUNDERS_CAP) {
          res.status(200).json({ soldOut: true, error: "All 250 Founders Editions are claimed." });
          return;
        }
        const session = (await stripe(stripeKey, "/v1/checkout/sessions", {
          method: "POST",
          params: {
            mode: "payment",
            "line_items[0][price]": price,
            "line_items[0][quantity]": "1",
            client_reference_id: deviceId,
            "metadata[deviceId]": deviceId,
            "payment_intent_data[metadata][deviceId]": deviceId,
            "payment_intent_data[metadata][edition]": FOUNDERS_EDITION,
            success_url: `${origin}/pro-done.html?status=success`,
            cancel_url: `${origin}/pro-done.html?status=canceled`,
          },
        })) as { url?: string };
        if (!session.url) throw new Error("Stripe did not return a checkout URL");
        res.status(200).json({ url: session.url });
        return;
      }

      const price = plan === "annual" ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;
      if (!price) {
        res.status(500).json({ error: `Stripe price for ${plan} plan not configured` });
        return;
      }
      const session = (await stripe(stripeKey, "/v1/checkout/sessions", {
        method: "POST",
        params: {
          mode: "subscription",
          "line_items[0][price]": price,
          "line_items[0][quantity]": "1",
          client_reference_id: deviceId,
          "metadata[deviceId]": deviceId,
          "subscription_data[metadata][deviceId]": deviceId,
          allow_promotion_codes: "true",
          success_url: `${origin}/pro-done.html?status=success`,
          cancel_url: `${origin}/pro-done.html?status=canceled`,
        },
      })) as { url?: string };
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      res.status(200).json({ url: session.url });
      return;
    }

    if (action === "founders") {
      // Live, honest availability — straight from Stripe, briefly cached.
      const sold = (await listFounders(stripeKey)).length;
      res.status(200).json({ sold, remaining: Math.max(0, FOUNDERS_CAP - sold), cap: FOUNDERS_CAP });
      return;
    }

    if (action === "entitlement") {
      const sub = await findSubByDevice(stripeKey, deviceId);
      if (sub) {
        res.status(200).json({ pro: true, plan: "sub" });
        return;
      }
      const founders = await findFoundersByDevice(stripeKey, deviceId);
      if (founders) {
        res.status(200).json({ pro: true, plan: "founders", number: founders.number, cap: FOUNDERS_CAP });
        return;
      }
      res.status(200).json({ pro: false });
      return;
    }

    if (action === "restore") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ error: "Enter the email you used at checkout" });
        return;
      }
      const customers = (await stripe(stripeKey, "/v1/customers/search", {
        params: { query: `email:'${email.replace(/'/g, "")}'`, limit: "5" },
      })) as { data?: Array<{ id: string }> };
      for (const customer of customers.data || []) {
        const subs = (await stripe(stripeKey, "/v1/subscriptions", {
          params: { customer: customer.id, limit: "5" },
        })) as { data?: StripeSub[] };
        const live = (subs.data || []).find((s) => PRO_STATUSES.includes(s.status));
        if (live) {
          await stripe(stripeKey, `/v1/subscriptions/${live.id}`, {
            method: "POST",
            params: { "metadata[deviceId]": deviceId },
          });
          res.status(200).json({ pro: true });
          return;
        }
      }
      // No subscription — check for a Founders Edition purchase on that email.
      for (const customer of customers.data || []) {
        const pis = (await stripe(stripeKey, "/v1/payment_intents", {
          params: { customer: customer.id, limit: "20" },
        })) as { data?: FoundersPI[] };
        const owned = (pis.data || []).find(
          (p) => p.status === "succeeded" && p.metadata?.edition === FOUNDERS_EDITION
        );
        if (owned) {
          await stripe(stripeKey, `/v1/payment_intents/${owned.id}`, {
            method: "POST",
            params: { "metadata[deviceId]": deviceId, "metadata[edition]": FOUNDERS_EDITION },
          });
          foundersCache = null; // rebind changes the ledger — drop the cache
          const founders = await findFoundersByDevice(stripeKey, deviceId);
          res.status(200).json({ pro: true, plan: "founders", number: founders?.number, cap: FOUNDERS_CAP });
          return;
        }
      }
      res.status(200).json({
        pro: false,
        message: "No active Pro found for that email. Double-check the spelling, or subscribe fresh.",
      });
      return;
    }

    if (action === "portal") {
      const sub = await findSubByDevice(stripeKey, deviceId);
      if (!sub) {
        res.status(404).json({ error: "No active subscription found for this device" });
        return;
      }
      const portal = (await stripe(stripeKey, "/v1/billing_portal/sessions", {
        method: "POST",
        params: { customer: sub.customer, return_url: `${origin}/pro-done.html?status=portal` },
      })) as { url?: string };
      if (!portal.url) throw new Error("Stripe did not return a portal URL");
      res.status(200).json({ url: portal.url });
      return;
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Billing request failed" });
  }
}
