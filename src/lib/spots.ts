// Opportunity spots — THE USER'S OWN pins: curb piles they've seen, good
// dumpster spots, estate sales, the alley behind the strip mall. Rule #1
// made this feature: the old app plotted AI-invented dumpster coordinates
// for real people to drive to. Here every pin exists because the user
// dropped it. All on-device.

import { getItem, setItem } from "./storage";

export type SpotType = "curb" | "dumpster" | "estate" | "garage" | "freepile" | "other";

export const SPOT_META: Record<SpotType, { label: string; color: string }> = {
  curb: { label: "Curb pile", color: "#4ADE80" },
  dumpster: { label: "Dumpster spot", color: "#60A5FA" },
  estate: { label: "Estate sale", color: "#FBBF24" },
  garage: { label: "Garage sale", color: "#F59E0B" },
  freepile: { label: "Free pile", color: "#34D399" },
  other: { label: "Other", color: "#B8C0CC" },
};

export interface Spot {
  id: string;
  type: SpotType;
  label: string;
  note?: string;
  lat: number;
  lng: number;
  createdAt: number;
  /** Optional event date (estate/garage sales). */
  date?: number;
}

const KEY = "junkgenius:spots";

export async function loadSpots(): Promise<Spot[]> {
  const raw = await getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Spot[]) : [];
  } catch {
    return [];
  }
}

export async function saveSpots(spots: Spot[]): Promise<void> {
  await setItem(KEY, JSON.stringify(spots));
}

export function newSpot(
  type: SpotType,
  label: string,
  lat: number,
  lng: number,
  extras: { note?: string; date?: number } = {}
): Spot {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    label: label.trim() || SPOT_META[type].label,
    note: extras.note?.trim() || undefined,
    lat,
    lng,
    createdAt: Date.now(),
    date: extras.date,
  };
}
