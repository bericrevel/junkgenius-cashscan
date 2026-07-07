// Real eBay comps client — live ACTIVE listings via the server's Browse API
// proxy. Three honest states the UI renders distinctly:
//   setup  → dev key not configured (Rule #1: never invented listings)
//   ok     → real asks: count, low/median/high, sample listings with links
//   error  → plain-language failure
// Results are cached 6h on-device per query (server caches 6h too).
//
// Language matters: these are ASKS (what sellers want), not sold prices —
// the UI says so. Real sold data is behind eBay's restricted API; pretending
// otherwise is how the old app went wrong.

import { getItem, setItem } from "./storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const APP_KEY = import.meta.env.VITE_APP_KEY || "";
const CACHE_PREFIX = "junkgenius:ebay:";
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface EbaySample {
  title: string;
  price: number;
  condition?: string;
  url: string;
}

export interface EbayComps {
  state: "setup" | "ok" | "error";
  count: number;
  low: number;
  median: number;
  high: number;
  samples: EbaySample[];
  searchUrl: string;
  fetchedAt: number | null;
  message?: string;
}

export async function getEbayComps(query: string, opts: { force?: boolean } = {}): Promise<EbayComps> {
  const q = query.trim().slice(0, 120);
  const empty: Omit<EbayComps, "state"> = {
    count: 0,
    low: 0,
    median: 0,
    high: 0,
    samples: [],
    searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
    fetchedAt: null,
  };
  if (!q) return { state: "error", ...empty, message: "Nothing to search for." };

  const cacheKey = `${CACHE_PREFIX}${q.toLowerCase()}`;
  if (!opts.force) {
    const raw = await getItem(cacheKey);
    if (raw) {
      try {
        const cached = JSON.parse(raw) as EbayComps & { at: number };
        if (Date.now() - cached.at < CACHE_MS) return { ...cached, state: "ok" };
      } catch {
        /* fall through */
      }
    }
  }

  if (!API_BASE) return { state: "error", ...empty, message: "The app isn't connected to its server yet." };
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    return { state: "error", ...empty, message: "No connection right now. Try again when you've got signal." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API_BASE}/api/ebay?q=${encodeURIComponent(q)}`, {
      headers: APP_KEY ? { "X-App-Key": APP_KEY } : undefined,
      signal: controller.signal,
    });
    const data = (await res.json()) as {
      configured?: boolean;
      count?: number;
      low?: number;
      median?: number;
      high?: number;
      samples?: EbaySample[];
      searchUrl?: string;
      fetchedAt?: number;
      error?: string;
    };
    if (data.configured === false) return { state: "setup", ...empty };
    if (!res.ok || data.error) {
      return { state: "error", ...empty, message: data.error || "eBay lookup failed. Try again in a moment." };
    }
    const comps: EbayComps = {
      state: "ok",
      count: data.count || 0,
      low: data.low || 0,
      median: data.median || 0,
      high: data.high || 0,
      samples: Array.isArray(data.samples) ? data.samples : [],
      searchUrl: data.searchUrl || empty.searchUrl,
      fetchedAt: data.fetchedAt || Date.now(),
    };
    await setItem(cacheKey, JSON.stringify({ ...comps, at: Date.now() }));
    return comps;
  } catch {
    return { state: "error", ...empty, message: "Couldn't reach eBay right now. Try again in a moment." };
  } finally {
    clearTimeout(timer);
  }
}
