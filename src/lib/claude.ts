// All calls go through YOUR proxy (see /api/claude.ts), never directly to
// api.anthropic.com. The proxy holds the API key AND the system prompts —
// this file only names a task ("identify" | "guide" | "listing") and sends
// validated data. Set VITE_API_BASE_URL (and VITE_APP_KEY) in .env.
//
// Design notes (from the ship-readiness audit):
// - 45s timeout via AbortController: no infinite "Reading it..." spinner on a
//   dead connection.
// - navigator.onLine checked first: instant, honest offline message.
// - Every error thrown from here is written in plain language for the user —
//   the UI can show err.message directly.
// - Model output is VALIDATED (normalizeScanResult / normalizeListing), never
//   cast blindly. One malformed reply must not white-screen the app.

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const APP_KEY = import.meta.env.VITE_APP_KEY || "";
const TIMEOUT_MS = 45_000;

export interface TaskReply {
  text: string;
  truncated: boolean;
}

async function callTask(task: string, payload: Record<string, unknown>): Promise<TaskReply> {
  if (!API_BASE) {
    throw new Error(
      "The app isn't connected to its server. (Build with VITE_API_BASE_URL set — see .env.example.)"
    );
  }
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    throw new Error("No connection right now. Tap Try Again when you've got signal.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/claude`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(APP_KEY ? { "X-App-Key": APP_KEY } : {}),
      },
      body: JSON.stringify({ task, ...payload }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error("That took too long — probably a weak signal. Tap Try Again.");
    }
    throw new Error("Couldn't reach the server. Check your signal and tap Try Again.");
  } finally {
    clearTimeout(timer);
  }

  // Guard the parse: gateway/error pages aren't JSON, and res.json() on them
  // used to surface a raw SyntaxError to the user.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(friendlyStatus(res.status));
  }

  const data = (await res.json()) as { text?: string; truncated?: boolean; error?: string };
  if (!res.ok || data.error) {
    throw new Error(friendlyStatus(res.status, data.error));
  }
  if (!data.text) {
    throw new Error("Got an empty answer back. Tap Try Again.");
  }
  return { text: data.text, truncated: !!data.truncated };
}

function friendlyStatus(status: number, raw?: string): string {
  if (status === 401) return "This copy of the app isn't authorized to use the server. Update or reinstall the app.";
  if (status === 413) return "That photo is too big to send. Try again from a bit further back.";
  if (status === 429) return "Easy there — too many scans at once. Wait a minute and try again.";
  if (status >= 500) return "The server hiccuped. Tap Try Again in a moment.";
  return raw ? `Problem: ${raw}` : "Something went wrong. Tap Try Again.";
}

function extractJSON(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Couldn't get a clean read on that. Scan again — closer, with good light.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Couldn't get a clean read on that. Scan again — closer, with good light.");
  }
}

// ---------- Scan result ----------

export interface ScanResult {
  item: string;
  valueRepairedLow: number;
  valueRepairedHigh: number;
  valueScrapLow: number;
  valueScrapHigh: number;
  difficulty: "easy" | "moderate" | "hard";
  timeEstimate: string;
  move: "repair" | "part_out" | "repurpose" | "scrap" | "avoid";
  profitLow: number;
  profitHigh: number;
  reason: string;
  safetyWarning: string;
  category: string;
}

const MOVE_SET = ["repair", "part_out", "repurpose", "scrap", "avoid"] as const;
const DIFFICULTY_SET = ["easy", "moderate", "hard"] as const;

function asNum(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Validate + coerce whatever the model returned into a safe ScanResult.
 * Never trust a cast: one missing field used to be able to white-screen the
 * whole app (result.difficulty.charAt on undefined).
 */
export function normalizeScanResult(raw: Record<string, unknown>): ScanResult {
  const item = asStr(raw.item).trim();
  if (!item) {
    throw new Error("Couldn't get a clean read on that. Scan again — closer, with good light.");
  }
  const move = (MOVE_SET as readonly string[]).includes(raw.move as string)
    ? (raw.move as ScanResult["move"])
    : "scrap";
  const difficulty = (DIFFICULTY_SET as readonly string[]).includes(raw.difficulty as string)
    ? (raw.difficulty as ScanResult["difficulty"])
    : "moderate";
  return {
    item,
    valueRepairedLow: asNum(raw.valueRepairedLow),
    valueRepairedHigh: asNum(raw.valueRepairedHigh),
    valueScrapLow: asNum(raw.valueScrapLow),
    valueScrapHigh: asNum(raw.valueScrapHigh),
    difficulty,
    timeEstimate: asStr(raw.timeEstimate, "varies"),
    move,
    profitLow: asNum(raw.profitLow),
    profitHigh: asNum(raw.profitHigh),
    reason: asStr(raw.reason),
    safetyWarning: asStr(raw.safetyWarning),
    category: asStr(raw.category, "misc"),
  };
}

export async function identifyItem(base64Image: string, mediaType: string): Promise<ScanResult> {
  const { text } = await callTask("identify", {
    image: { data: base64Image, mediaType },
  });
  return normalizeScanResult(extractJSON(text));
}

// ---------- Guide (repair / part-out / repurpose / scrap) ----------

export async function getGuide(result: ScanResult): Promise<TaskReply> {
  return callTask("guide", {
    item: {
      item: result.item,
      category: result.category,
      difficulty: result.difficulty,
      timeEstimate: result.timeEstimate,
      move: result.move,
      reason: result.reason,
      valueScrapLow: result.valueScrapLow,
      valueScrapHigh: result.valueScrapHigh,
    },
  });
}

// ---------- Listing ----------

export interface Listing {
  title: string;
  description: string;
  price: number | string;
  platform: string;
  photoTips: string;
  safetyDisclaimer: string;
}

function normalizeListing(raw: Record<string, unknown>, result: ScanResult): Listing {
  const price =
    typeof raw.price === "number" || typeof raw.price === "string"
      ? raw.price
      : result.valueRepairedLow;
  return {
    title: asStr(raw.title, result.item),
    description: asStr(raw.description),
    price,
    platform: asStr(raw.platform, "Facebook Marketplace"),
    photoTips: asStr(raw.photoTips),
    safetyDisclaimer: asStr(raw.safetyDisclaimer),
  };
}

export async function getListing(result: ScanResult): Promise<Listing> {
  const { text } = await callTask("listing", {
    item: {
      item: result.item,
      category: result.category,
      move: result.move,
      reason: result.reason,
      valueRepairedLow: result.valueRepairedLow,
      valueRepairedHigh: result.valueRepairedHigh,
    },
  });
  return normalizeListing(extractJSON(text), result);
}
