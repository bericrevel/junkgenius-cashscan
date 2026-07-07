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
const FOUNDER_KEY = "junkgenius:founder";
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProState {
  pro: boolean;
  checkedAt: number;
  source: "network" | "cache" | "grace" | "none" | "founder";
  /** "sub" (subscription) or "founders" ($99 lifetime, one of 250). */
  plan?: "sub" | "founders";
  /** Founding Scrapper number (1–250) when plan === "founders". */
  founderNo?: number;
}

/** Owner unlock — set once when the server confirms the founder code
 *  (typed into the Restore box). Permanent on this device, works offline
 *  forever, survives every entitlement re-check. */
export async function isFounder(): Promise<boolean> {
  return (await getItem(FOUNDER_KEY)) === "1";
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
    const parsed = JSON.parse(raw) as { pro?: boolean; checkedAt?: number; plan?: "sub" | "founders"; founderNo?: number };
    if (typeof parsed.pro !== "boolean" || typeof parsed.checkedAt !== "number") return null;
    return { pro: parsed.pro, checkedAt: parsed.checkedAt, source: "cache", plan: parsed.plan, founderNo: parsed.founderNo };
  } catch {
    return null;
  }
}

async function writeCache(pro: boolean, extra: { plan?: "sub" | "founders"; founderNo?: number } = {}): Promise<ProState> {
  const state: ProState = { pro, checkedAt: Date.now(), source: "network", ...extra };
  await setItem(
    PRO_CACHE_KEY,
    JSON.stringify({ pro: state.pro, checkedAt: state.checkedAt, plan: state.plan, founderNo: state.founderNo })
  );
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
  if (await isFounder()) return { pro: true, checkedAt: Date.now(), source: "founder" };
  const cached = await readCache();
  if (!opts.force && cached && Date.now() - cached.checkedAt < CACHE_FRESH_MS) return cached;
  try {
    const data = await billingCall("entitlement");
    return await writeCache(!!data.pro, {
      plan: data.plan === "founders" ? "founders" : data.plan === "sub" ? "sub" : undefined,
      founderNo: typeof data.number === "number" ? data.number : undefined,
    });
  } catch {
    if (cached?.pro && Date.now() - cached.checkedAt < OFFLINE_GRACE_MS) return { ...cached, source: "grace" };
    if (cached) return cached;
    return { pro: false, checkedAt: 0, source: "none" };
  }
}

export async function startCheckout(plan: "monthly" | "annual" | "founders"): Promise<void> {
  const data = await billingCall("checkout", { plan });
  if (data.soldOut) throw new Error("All 250 Founders Editions are claimed.");
  if (typeof data.url !== "string") throw new Error("Didn't get a checkout link. Try again.");
  await Browser.open({ url: data.url });
}

/** Live Founders Edition availability — real Stripe numbers or an error;
 *  the UI shows nothing rather than a made-up count. */
export async function foundersStatus(): Promise<{ sold: number; remaining: number; cap: number }> {
  const data = await billingCall("founders");
  if (typeof data.sold !== "number" || typeof data.remaining !== "number" || typeof data.cap !== "number") {
    throw new Error("Couldn't load Founders availability.");
  }
  return { sold: data.sold, remaining: data.remaining, cap: data.cap };
}

export async function restoreByEmail(
  email: string
): Promise<{ pro: boolean; founder?: boolean; message?: string }> {
  const data = await billingCall("restore", { email });
  if (data.founder === true) await setItem(FOUNDER_KEY, "1");
  if (data.pro)
    await writeCache(true, {
      plan: data.plan === "founders" ? "founders" : data.plan === "sub" ? "sub" : undefined,
      founderNo: typeof data.number === "number" ? data.number : undefined,
    });
  return {
    pro: !!data.pro,
    founder: data.founder === true,
    message: typeof data.message === "string" ? data.message : undefined,
  };
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
