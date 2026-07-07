// JunkGenius Pro entitlement — account-less: an anonymous device UUID rides
// in Stripe subscription metadata. Cached 6h, 7-day offline grace — being
// Pro never depends on bars.

import { Browser } from "@capacitor/browser";
import { getItem, setItem } from "./storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const APP_KEY = import.meta.env.VITE_APP_KEY || "";
const TIMEOUT_MS = 30_000;

const DEVICE_KEY = "junkgenius:deviceId";
const PRO_CACHE_KEY = "junkgenius:pro";
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProState {
  pro: boolean;
  checkedAt: number;
  source: "network" | "cache" | "grace" | "none";
}

export async function getDeviceId(): Promise<string> {
  let id = await getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
    await setItem(DEVICE_KEY, id);
  }
  return id;
}

async function readCache(): Promise<ProState | null> {
  const raw = await getItem(PRO_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { pro?: boolean; checkedAt?: number };
    if (typeof parsed.pro !== "boolean" || typeof parsed.checkedAt !== "number") return null;
    return { pro: parsed.pro, checkedAt: parsed.checkedAt, source: "cache" };
  } catch {
    return null;
  }
}

async function writeCache(pro: boolean): Promise<ProState> {
  const state: ProState = { pro, checkedAt: Date.now(), source: "network" };
  await setItem(PRO_CACHE_KEY, JSON.stringify({ pro: state.pro, checkedAt: state.checkedAt }));
  return state;
}

async function billingCall(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!API_BASE) throw new Error("The app isn't connected to its server. (Build with VITE_API_BASE_URL set.)");
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    throw new Error("No connection right now. Try again when you've got signal.");
  }
  const deviceId = await getDeviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/billing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(APP_KEY ? { "X-App-Key": APP_KEY } : {}),
      },
      body: JSON.stringify({ action, deviceId, ...extra }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new Error("That took too long — probably a weak signal. Try again.");
    throw new Error("Couldn't reach the server. Check your signal and try again.");
  } finally {
    clearTimeout(timer);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Server hiccup (${res.status}). Try again in a moment.`);
  }
  const data = (await res.json()) as Record<string, unknown> & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Try again.");
  }
  return data;
}

export async function refreshEntitlement(opts: { force?: boolean } = {}): Promise<ProState> {
  const cached = await readCache();
  if (!opts.force && cached && Date.now() - cached.checkedAt < CACHE_FRESH_MS) return cached;
  try {
    const data = await billingCall("entitlement");
    return await writeCache(!!data.pro);
  } catch {
    if (cached?.pro && Date.now() - cached.checkedAt < OFFLINE_GRACE_MS) return { ...cached, source: "grace" };
    if (cached) return cached;
    return { pro: false, checkedAt: 0, source: "none" };
  }
}

export async function startCheckout(plan: "monthly" | "annual"): Promise<void> {
  const data = await billingCall("checkout", { plan });
  if (typeof data.url !== "string") throw new Error("Didn't get a checkout link. Try again.");
  await Browser.open({ url: data.url });
}

export async function restoreByEmail(email: string): Promise<{ pro: boolean; message?: string }> {
  const data = await billingCall("restore", { email });
  if (data.pro) await writeCache(true);
  return { pro: !!data.pro, message: typeof data.message === "string" ? data.message : undefined };
}

export async function openPortal(): Promise<void> {
  const data = await billingCall("portal");
  if (typeof data.url !== "string") throw new Error("Couldn't open subscription settings. Try again.");
  await Browser.open({ url: data.url });
}

// ---------- AI-action counter (the second gate trigger) ----------
// Counts only actions that cost real money to serve: scans, chat turns,
// listing drafts, buyer triages. Failed calls never count. On-device,
// honor-system — same accepted limitation as CashScan's scan counter.

const AI_COUNT_KEY = "junkgenius:aiCount";

export async function loadAiCount(): Promise<number> {
  const raw = await getItem(AI_COUNT_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

export async function bumpAiCount(current: number): Promise<number> {
  const next = current + 1;
  await setItem(AI_COUNT_KEY, String(next));
  return next;
}
