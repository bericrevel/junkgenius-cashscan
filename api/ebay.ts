// JunkGenius — real eBay comps (Vercel, Node runtime).
//
// RULE #1: real data or honest absence. This endpoint hits eBay's Browse API
// — genuinely LIVE, ACTIVE listings (real asking prices, real counts). It is
// deliberately labeled "asks" in the app, because that's what it is: what
// sellers are asking today, not what buyers paid. (Sold-price data lives
// behind eBay's restricted Marketplace Insights API that almost nobody gets —
// which is exactly why the old app's instant "sold counts" were fake.)
//
// Without EBAY_CLIENT_ID / EBAY_CLIENT_SECRET this returns
// { configured: false } and the app shows its setup state — never invented
// listings.
//
// Setup (free): developer.ebay.com → create account → create an app
// (production keyset) → copy App ID (client id) + Cert ID (client secret)
// into Vercel env. Default quota: 5,000 Browse calls/day — plenty.
//
// Env vars:
//   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET  (absence = honest setup state)
//   APP_SHARED_KEY                      (optional, same gate as elsewhere)

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

let tokenCache: { token: string; expiresAt: number } | null = null;

interface CompsSample {
  title: string;
  price: number;
  condition?: string;
  url: string;
}
interface CompsPayload {
  query: string;
  count: number;
  low: number;
  median: number;
  high: number;
  samples: CompsSample[];
  searchUrl: string;
  fetchedAt: number;
}
const compsCache = new Map<string, CompsPayload>();
const COMPS_TTL = 6 * 60 * 60 * 1000;

async function getToken(id: string, secret: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "eBay auth failed — check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET");
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 7200) * 1000 };
  return tokenCache.token;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
  "Access-Control-Max-Age": "86400",
};

interface NodeReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
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
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const sharedKey = process.env.APP_SHARED_KEY;
  if (sharedKey && req.headers["x-app-key"] !== sharedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    res.status(200).json({ configured: false });
    return;
  }

  const raw = req.query?.q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 120);
  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }

  const cacheKey = q.toLowerCase();
  const cached = compsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < COMPS_TTL) {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=21600");
    res.status(200).json({ configured: true, ...cached, cached: true });
    return;
  }

  try {
    const token = await getToken(id, secret);
    const url = `${BROWSE_URL}?q=${encodeURIComponent(q)}&limit=25&filter=${encodeURIComponent("buyingOptions:{FIXED_PRICE|AUCTION}")}`;
    const upstream = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    const data = (await upstream.json()) as {
      total?: number;
      itemSummaries?: Array<{
        title?: string;
        price?: { value?: string; currency?: string };
        condition?: string;
        itemWebUrl?: string;
      }>;
      errors?: Array<{ message?: string }>;
    };
    if (!upstream.ok) {
      res.status(502).json({ configured: true, error: data.errors?.[0]?.message || "eBay search failed" });
      return;
    }

    const prices: number[] = [];
    const samples: CompsSample[] = [];
    for (const it of data.itemSummaries || []) {
      const p = parseFloat(it.price?.value || "");
      if (!Number.isFinite(p) || p <= 0) continue;
      if ((it.price?.currency || "USD") !== "USD") continue;
      prices.push(p);
      if (samples.length < 3 && it.title && it.itemWebUrl) {
        samples.push({
          title: it.title.slice(0, 90),
          price: Math.round(p * 100) / 100,
          condition: it.condition,
          url: it.itemWebUrl,
        });
      }
    }

    if (prices.length === 0) {
      // Honest zero — not an error, just no live listings matched.
      const payload: CompsPayload = {
        query: q,
        count: 0,
        low: 0,
        median: 0,
        high: 0,
        samples: [],
        searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
        fetchedAt: Date.now(),
      };
      compsCache.set(cacheKey, payload);
      res.status(200).json({ configured: true, ...payload });
      return;
    }

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const payload: CompsPayload = {
      query: q,
      count: typeof data.total === "number" ? data.total : prices.length,
      low: Math.round(prices[0] * 100) / 100,
      median: Math.round(median * 100) / 100,
      high: Math.round(prices[prices.length - 1] * 100) / 100,
      samples,
      searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
      fetchedAt: Date.now(),
    };
    if (compsCache.size > 2000) compsCache.clear();
    compsCache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=21600");
    res.status(200).json({ configured: true, ...payload });
  } catch (err) {
    res.status(500).json({ configured: true, error: err instanceof Error ? err.message : "eBay lookup failed" });
  }
}
