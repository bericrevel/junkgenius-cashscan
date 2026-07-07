// Location layer — two honest paths, because permissions get denied:
// 1) Device GPS via Capacitor Geolocation (coarse accuracy — city-level is
//    plenty for finding yards, kinder to battery, kinder to privacy).
// 2) Typed city/ZIP search via Nominatim (OpenStreetMap's geocoder) —
//    no permission needed at all.
// The last-used location is cached on-device so the yards screen works
// instantly on reopen. Location never leaves the device except inside the
// Overpass/Nominatim queries themselves.

import { Geolocation } from "@capacitor/geolocation";
import { getItem, setItem } from "./storage";

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

const LOC_KEY = "junkgenius:lastLocation";

export async function getCachedPlace(): Promise<Place | null> {
  const raw = await getItem(LOC_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Place;
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null;
  } catch {
    return null;
  }
}

export async function cachePlace(p: Place): Promise<void> {
  await setItem(LOC_KEY, JSON.stringify(p));
}

/** Device GPS. Throws a plain-language error on denial/failure. */
export async function locateMe(): Promise<Place> {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 10 * 60 * 1000,
    });
    const p: Place = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      label: "My location",
    };
    await cachePlace(p);
    return p;
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("denied") || msg.includes("permission")) {
      throw new Error("Location is off for this app. Type your city or ZIP below instead — works just as well.");
    }
    throw new Error("Couldn't get a fix. Type your city or ZIP below instead.");
  }
}

/**
 * Nominatim place search (OpenStreetMap). Public endpoint, fair-use policy:
 * we call it only on explicit user action (typing + search), never in a loop.
 */
export async function searchPlace(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=0`,
      { headers: { "Accept-Language": "en" }, signal: controller.signal }
    );
    if (!res.ok) throw new Error();
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    return data
      .map((d) => ({
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        label: (d.display_name || "").split(",").slice(0, 2).join(",").trim() || q,
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } catch {
    throw new Error("Couldn't look that up right now. Check your signal and try again.");
  } finally {
    clearTimeout(timer);
  }
}

/** Great-circle distance in miles. */
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
