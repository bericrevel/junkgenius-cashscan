// Inventory — on-device only (Capacitor Preferences), same privacy stance as
// CashScan's ledger: it never leaves the phone. That claim is load-bearing in
// the privacy story, so no sync code belongs in this file. Ever.

import { getItem, setItem } from "./storage";
import type { ScoutResult } from "./scout";

const KEY = "junkgenius:inventory";

export type ItemStatus = "have" | "sold" | "scrapped" | "skipped";

export interface InventoryItem {
  id: string;
  item: string;
  category: string;
  move: ScoutResult["move"];
  scrapLow: number;
  scrapHigh: number;
  resaleLow: number;
  resaleHigh: number;
  weightLbs: number;
  addedAt: number;
  status: ItemStatus;
  /** Actual cash received when sold/scrapped — the number that matters. */
  cashedFor?: number;
  cashedAt?: number;
}

export async function loadInventory(): Promise<InventoryItem[]> {
  const raw = await getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InventoryItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveInventory(items: InventoryItem[]): Promise<void> {
  await setItem(KEY, JSON.stringify(items));
}

export function fromScan(result: ScoutResult): InventoryItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    item: result.item,
    category: result.category,
    move: result.move,
    scrapLow: result.scrapLow,
    scrapHigh: result.scrapHigh,
    resaleLow: result.resaleLow,
    resaleHigh: result.resaleHigh,
    weightLbs: result.weightLbs,
    addedAt: Date.now(),
    status: "have",
  };
}

/** Best-case estimated value of everything still on hand (labeled estimate). */
export function estimatedValue(items: InventoryItem[]): { low: number; high: number } {
  return items
    .filter((i) => i.status === "have")
    .reduce(
      (acc, i) => ({
        low: acc.low + Math.max(i.scrapLow, i.resaleLow > 0 ? Math.min(i.resaleLow, i.scrapLow || i.resaleLow) : i.scrapLow),
        high: acc.high + Math.max(i.scrapHigh, i.resaleHigh),
      }),
      { low: 0, high: 0 }
    );
}

/** Real cash actually collected — the honest number, kept separate. */
export function realizedCash(items: InventoryItem[]): number {
  return items
    .filter((i) => (i.status === "sold" || i.status === "scrapped") && typeof i.cashedFor === "number")
    .reduce((s, i) => s + (i.cashedFor || 0), 0);
}
