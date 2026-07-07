// Spot prices client. Three honest outcomes, each rendered differently:
//  - configured:false  → setup state ("connect a price source")
//  - prices + fetchedAt → real numbers, timestamped, with the yards-pay-less framing
//  - error             → plain-language failure, cached-if-available shown as stale
// Client also caches the last good payload 6h (server caches 8h upstream).

import { getItem, setItem } from "./storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const APP_KEY = import.meta.env.VITE_APP_KEY || "";
const CACHE_KEY = "junkgenius:spotPrices";
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface SpotPrice {
  symbol: string;
  name: string;
  unit: "lb" | "oz";
  price: number;
}

export interface SpotResult {
  state: "setup" | "ok" | "error";
  prices: SpotPrice[];
  fetchedAt: number | null;
  stale: boolean;
  message?: string;
}

export async function getSpotPrices(opts: { force?: boolean } = {}): Promise<SpotResult> {
  if (!opts.force) {
    const raw = await getItem(CACHE_KEY);
    if (raw) {
      try {
        const cached = JSON.parse(raw) as { at: number; prices: SpotPrice[] };
        if (Date.now() - cached.at < CACHE_MS && cached.prices.length > 0) {
          return { state: "ok", prices: cached.prices, fetchedAt: cached.at, stale: false };
        }
      } catch {
        /* fall through */
      }
    }
  }

  if (!API_BASE) {
    return { state: "error", prices: [], fetchedAt: null, stale: false, message: "The app isn't connected to its server yet." };
  }
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    const stale = await readStale();
    if (stale) return stale;
    return { state: "error", prices: [], fetchedAt: null, stale: false, message: "No connection right now. Try again when you've got signal." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API_BASE}/api/prices`, {
      headers: APP_KEY ? { "X-App-Key": APP_KEY } : undefined,
      signal: controller.signal,
    });
    const data = (await res.json()) as {
      configured?: boolean;
      prices?: SpotPrice[];
      fetchedAt?: number;
      stale?: boolean;
      error?: string;
    };
    if (data.configured === false) {
      return { state: "setup", prices: [], fetchedAt: null, stale: false };
    }
    if (!res.ok || data.error || !Array.isArray(data.prices)) {
      const stale = await readStale();
      if (stale) return stale;
      return { state: "error", prices: [], fetchedAt: null, stale: false, message: data.error || "Price source unavailable right now." };
    }
    await setItem(CACHE_KEY, JSON.stringify({ at: data.fetchedAt || Date.now(), prices: data.prices }));
    return {
      state: "ok",
      prices: data.prices,
      fetchedAt: data.fetchedAt || Date.now(),
      stale: !!data.stale,
    };
  } catch {
    const stale = await readStale();
    if (stale) return stale;
    return { state: "error", prices: [], fetchedAt: null, stale: false, message: "Couldn't reach the price source. Try again in a moment." };
  } finally {
    clearTimeout(timer);
  }
}

async function readStale(): Promise<SpotResult | null> {
  const raw = await getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as { at: number; prices: SpotPrice[] };
    if (!cached.prices?.length) return null;
    return { state: "ok", prices: cached.prices, fetchedAt: cached.at, stale: true };
  } catch {
    return null;
  }
}
