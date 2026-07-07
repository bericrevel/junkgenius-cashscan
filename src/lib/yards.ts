// Scrap yard finder — REAL OpenStreetMap data via the Overpass API.
// Rule #1: if OSM has no yards mapped nearby, the honest answer is "none
// mapped near you," never invented pins. OSM coverage varies by county —
// the UI says that too.
//
// Fair use: public Overpass instance, queried only on explicit user action,
// results cached on-device for 24h per ~1km grid cell.

import { getItem, setItem } from "./storage";
import { milesBetween } from "./geo";

export interface Yard {
  id: string; // osm type + id, e.g. "node/123"
  name: string;
  lat: number;
  lng: number;
  miles: number;
  phone?: string;
  hours?: string;
  address?: string;
  website?: string;
  kind: string; // "scrap yard" | "metal recycling centre"
}

export interface YardLogEntry {
  material: string;
  perLb: number;
  date: number;
}

export interface YardNote {
  note: string;
  prices: YardLogEntry[];
  /** Yard display name captured at write time, so logs stay attributable
   *  even when the yard isn't in the currently-loaded search area. */
  name?: string;
}

const OVERPASS = "https://overpass-api.de/api/interpreter";
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheKey(lat: number, lng: number, radiusMi: number): string {
  // ~1km grid so small moves reuse the cache
  return `junkgenius:yards:${lat.toFixed(2)},${lng.toFixed(2)},${radiusMi}`;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function parseYard(el: OverpassElement, fromLat: number, fromLng: number): Yard | null {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat === undefined || lng === undefined) return null;
  const t = el.tags || {};
  const isScrapYard = t.shop === "scrap_yard" || t.industrial === "scrap_yard";
  const addressParts = [
    [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "),
    t["addr:city"],
  ].filter(Boolean);
  return {
    id: `${el.type}/${el.id}`,
    name: t.name || (isScrapYard ? "Scrap yard (unnamed on OSM)" : "Metal recycling centre (unnamed on OSM)"),
    lat,
    lng,
    miles: Math.round(milesBetween(fromLat, fromLng, lat, lng) * 10) / 10,
    phone: t.phone || t["contact:phone"] || undefined,
    hours: t.opening_hours || undefined,
    address: addressParts.length ? addressParts.join(", ") : undefined,
    website: t.website || t["contact:website"] || undefined,
    kind: isScrapYard ? "scrap yard" : "metal recycling centre",
  };
}

/**
 * Find scrap yards / metal recycling centres near a point. Real OSM data,
 * cached 24h. radiusMi: 25 default, 50 for "search wider".
 */
export async function findYards(
  lat: number,
  lng: number,
  radiusMi: number,
  opts: { force?: boolean } = {}
): Promise<{ yards: Yard[]; fromCache: boolean; fetchedAt: number }> {
  const key = cacheKey(lat, lng, radiusMi);
  if (!opts.force) {
    const raw = await getItem(key);
    if (raw) {
      try {
        const cached = JSON.parse(raw) as { yards: Yard[]; fetchedAt: number };
        if (Date.now() - cached.fetchedAt < CACHE_TTL) {
          return { yards: cached.yards, fromCache: true, fetchedAt: cached.fetchedAt };
        }
      } catch {
        /* fall through to network */
      }
    }
  }

  const radiusM = Math.round(radiusMi * 1609.34);
  const query = `[out:json][timeout:25];
(
  nwr["shop"="scrap_yard"](around:${radiusM},${lat},${lng});
  nwr["industrial"="scrap_yard"](around:${radiusM},${lat},${lng});
  nwr["amenity"="recycling"]["recycling_type"="centre"](around:${radiusM},${lat},${lng});
  nwr["amenity"="recycling"]["recycling:scrap_metal"="yes"](around:${radiusM},${lat},${lng});
);
out center tags 60;`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new Error("The map service took too long — weak signal maybe. Try again.");
    throw new Error("Couldn't reach the map service. Check your signal and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error("The free map service is busy right now. Give it a minute and try again.");
    throw new Error("The map service hiccuped. Try again in a moment.");
  }
  const data = (await res.json()) as { elements?: OverpassElement[] };
  const seen = new Set<string>();
  const yards = (data.elements || [])
    .map((el) => parseYard(el, lat, lng))
    .filter((y): y is Yard => {
      if (!y) return false;
      if (seen.has(y.id)) return false;
      seen.add(y.id);
      return true;
    })
    .sort((a, b) => a.miles - b.miles);

  const fetchedAt = Date.now();
  await setItem(key, JSON.stringify({ yards, fetchedAt }));
  return { yards, fromCache: false, fetchedAt };
}

// ---------- Per-yard notes + YOUR logged prices (on-device, real data) ----------

const NOTES_KEY = "junkgenius:yardNotes";

export async function loadYardNotes(): Promise<Record<string, YardNote>> {
  const raw = await getItem(NOTES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, YardNote>) : {};
  } catch {
    return {};
  }
}

export async function saveYardNotes(notes: Record<string, YardNote>): Promise<void> {
  await setItem(NOTES_KEY, JSON.stringify(notes));
}

/** Every price the user has logged, newest first, across all yards. */
export function allLoggedPrices(
  notes: Record<string, YardNote>,
  yardName: (id: string) => string
): Array<YardLogEntry & { yardId: string; yardName: string }> {
  const out: Array<YardLogEntry & { yardId: string; yardName: string }> = [];
  for (const [yardId, n] of Object.entries(notes)) {
    for (const p of n.prices || []) {
      out.push({ ...p, yardId, yardName: yardName(yardId) });
    }
  }
  return out.sort((a, b) => b.date - a.date);
}
