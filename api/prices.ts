// JunkGenius — metal spot prices (Vercel, Node runtime).
//
// RULE #1: real data or honest absence. This endpoint returns COMEX/LME-class
// spot prices from metalpriceapi.com when METALPRICE_API_KEY is configured,
// and { configured: false } when it isn't — the app then shows a setup state,
// NEVER invented numbers.
//
// Free-tier math: metalpriceapi's free plan is ~100 requests/month. Spot
// prices don't need per-user fetching, so this function caches server-side
// for 8 hours (≈90 upstream calls/month) and every user shares the cache.
// The response always carries fetchedAt so the UI can say "as of ...".
//
// Unit convention (verify on first setup — README explains how): metalpriceapi
// returns rates as units-of-metal per 1 USD (troy ounces). perOz = 1/rate.
// perLb = perOz * 14.5833 (troy oz per lb). Sanity check after setup: copper
// should land in the $3.50–6.50/lb neighborhood. If the numbers look wrong,
// the raw rates are included in the payload for auditing.
//
// Env vars:
//   METALPRICE_API_KEY   (optional — absence = honest setup state)
//   APP_SHARED_KEY       (optional, same gate as the other endpoints)

const SYMBOLS = ["XCU", "XAL", "XZN", "XPB", "XNI", "XAU", "XAG"] as const;

const METAL_META: Record<string, { name: string; unit: "lb" | "oz" }> = {
  XCU: { name: "Copper", unit: "lb" },
  XAL: { name: "Aluminum", unit: "lb" },
  XZN: { name: "Zinc", unit: "lb" },
  XPB: { name: "Lead", unit: "lb" },
  XNI: { name: "Nickel", unit: "lb" },
  XAU: { name: "Gold", unit: "oz" },
  XAG: { name: "Silver", unit: "oz" },
};

const TROY_OZ_PER_LB = 14.5833;
const CACHE_MS = 8 * 60 * 60 * 1000;

interface PricePoint {
  symbol: string;
  name: string;
  unit: "lb" | "oz";
  price: number; // USD per unit
  rawRate: number; // upstream rate, for auditing
}
let cache: { at: number; prices: PricePoint[] } | null = null;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
  "Access-Control-Max-Age": "86400",
};

interface NodeReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
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

  const apiKey = process.env.METALPRICE_API_KEY;
  if (!apiKey) {
    // Honest absence — the app renders its setup state from this.
    res.status(200).json({ configured: false });
    return;
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ configured: true, fetchedAt: cache.at, prices: cache.prices, source: "metalpriceapi.com", cached: true });
    return;
  }

  try {
    const url = `https://api.metalpriceapi.com/v1/latest?api_key=${apiKey}&base=USD&currencies=${SYMBOLS.join(",")}`;
    const upstream = await fetch(url);
    const data = (await upstream.json()) as {
      success?: boolean;
      rates?: Record<string, number>;
      error?: { message?: string; info?: string };
    };
    if (!upstream.ok || data.success === false || !data.rates) {
      // Real failure reported honestly — stale cache served if we have one.
      if (cache) {
        res.status(200).json({ configured: true, fetchedAt: cache.at, prices: cache.prices, source: "metalpriceapi.com", cached: true, stale: true });
        return;
      }
      res.status(502).json({
        configured: true,
        error: data.error?.message || data.error?.info || "Price source unavailable right now",
      });
      return;
    }

    const prices: PricePoint[] = [];
    for (const sym of SYMBOLS) {
      const rate = data.rates[sym];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
      const meta = METAL_META[sym];
      const perOz = 1 / rate;
      const price = meta.unit === "lb" ? perOz * TROY_OZ_PER_LB : perOz;
      prices.push({
        symbol: sym,
        name: meta.name,
        unit: meta.unit,
        price: Math.round(price * 100) / 100,
        rawRate: rate,
      });
    }

    if (prices.length === 0) {
      res.status(502).json({ configured: true, error: "Price source returned no usable rates" });
      return;
    }

    cache = { at: Date.now(), prices };
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({ configured: true, fetchedAt: cache.at, prices, source: "metalpriceapi.com", cached: false });
  } catch (err) {
    if (cache) {
      res.status(200).json({ configured: true, fetchedAt: cache.at, prices: cache.prices, source: "metalpriceapi.com", cached: true, stale: true });
      return;
    }
    res.status(500).json({ configured: true, error: err instanceof Error ? err.message : "Price fetch failed" });
  }
}
