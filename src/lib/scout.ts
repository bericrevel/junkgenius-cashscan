// JunkGenius client API layer — 45s timeout, offline detection, plain-
// language errors the UI can show directly, and VALIDATED model output
// (never a blind cast). Every task calls our own /api/scout proxy, never
// Gemini or Anthropic directly — the client never sees or needs to know
// which upstream model serves which task.

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const APP_KEY = import.meta.env.VITE_APP_KEY || "";
const TIMEOUT_MS = 45_000;

interface RawTaskResult {
  text?: string;
  truncated?: boolean;
  error?: string;
}

async function callTask(task: string, payload: Record<string, unknown>): Promise<RawTaskResult> {
  if (!API_BASE) {
    throw new Error("The app isn't connected to its server. (Build with VITE_API_BASE_URL set — see .env.example.)");
  }
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    throw new Error("No connection right now. Tap Try Again when you've got signal.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/scout`, {
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
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 413) throw new Error("That photo is too big to send. Try again from a bit further back.");
    throw new Error(`Server hiccup (${res.status}). Tap Try Again in a moment.`);
  }
  const data = (await res.json()) as RawTaskResult;
  if (!res.ok || data.error) {
    if (res.status === 401) throw new Error("This copy of the app isn't authorized. Update or reinstall the app.");
    if (res.status === 429) throw new Error("Easy there — too many scans at once. Wait a minute and try again.");
    throw new Error(data.error ? `Problem: ${data.error}` : "Something went wrong. Tap Try Again.");
  }
  if (!data.text) throw new Error("Got an empty answer back. Tap Try Again.");
  return data;
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

// ---------- Scan result (now MULTI-ITEM: one photo → every item found) ----------

export interface MaterialEstimate {
  name: string;
  estLbs: number;
}

export interface ScoutResult {
  item: string;
  category: string;
  condition: string;
  materials: MaterialEstimate[];
  weightLbs: number;
  scrapLow: number;
  scrapHigh: number;
  resaleLow: number;
  resaleHigh: number;
  move: "resell" | "scrap" | "part_out" | "skip";
  reason: string;
  safetyWarning: string;
}

const MOVES = ["resell", "scrap", "part_out", "skip"] as const;

function asNum(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : 0;
}
function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function normalizeOneResult(raw: Record<string, unknown>): ScoutResult | null {
  const item = asStr(raw.item).trim();
  if (!item) return null;
  const move = (MOVES as readonly string[]).includes(raw.move as string)
    ? (raw.move as ScoutResult["move"])
    : "scrap";
  const materials: MaterialEstimate[] = Array.isArray(raw.materials)
    ? (raw.materials as unknown[])
        .map((m) => {
          const mm = (m || {}) as Record<string, unknown>;
          return { name: asStr(mm.name), estLbs: asNum(mm.estLbs) };
        })
        .filter((m) => m.name)
        .slice(0, 6)
    : [];
  return {
    item,
    category: asStr(raw.category, "misc"),
    condition: asStr(raw.condition),
    materials,
    weightLbs: asNum(raw.weightLbs),
    scrapLow: Math.round(asNum(raw.scrapLow)),
    scrapHigh: Math.round(asNum(raw.scrapHigh)),
    resaleLow: Math.round(asNum(raw.resaleLow)),
    resaleHigh: Math.round(asNum(raw.resaleHigh)),
    move,
    reason: asStr(raw.reason),
    safetyWarning: asStr(raw.safetyWarning),
  };
}

/**
 * Scan a photo for every sellable/scrappable item it contains. Returns an
 * empty array (not an error) when nothing identifiable was found — the UI
 * shows an honest "didn't find anything" state rather than a fake result.
 */
export async function identifyItems(base64Image: string, mediaType: string): Promise<ScoutResult[]> {
  const { text } = await callTask("identify", { image: { data: base64Image, mediaType } });
  const raw = extractJSON(text);
  const list = Array.isArray(raw.items) ? (raw.items as unknown[]) : [];
  const out: ScoutResult[] = [];
  for (const it of list) {
    const normalized = normalizeOneResult((it || {}) as Record<string, unknown>);
    if (normalized) out.push(normalized);
  }
  return out.slice(0, 8);
}

// ---------- Guide (repair / part-out / scrap / skip) ----------

export interface GuideReply {
  text: string;
  truncated: boolean;
}

/** The "Show me how" guide for a scan result's recommended move. */
export async function getGuide(result: ScoutResult): Promise<GuideReply> {
  const { text, truncated } = await callTask("guide", {
    item: {
      item: result.item,
      category: result.category,
      condition: result.condition,
      move: result.move,
      reason: result.reason,
      scrapLow: result.scrapLow,
      scrapHigh: result.scrapHigh,
      resaleLow: result.resaleLow,
      resaleHigh: result.resaleHigh,
    },
  });
  return { text, truncated: !!truncated };
}

// ---------- Chat ----------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** One chat turn. History is capped client-side; server re-validates. */
export async function chatWithScout(history: ChatMessage[]): Promise<string> {
  const { text } = await callTask("chat", {
    messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
  });
  return text.trim();
}

// ---------- Listing generator ----------

export interface ListingDraft {
  title: string;
  description: string;
  price: number;
  pricingNote: string;
  platform: string;
}

export interface ListingInput {
  item: string;
  category: string;
  condition?: string;
  resaleLow: number;
  resaleHigh: number;
  notes?: string;
}

export async function generateListing(input: ListingInput): Promise<ListingDraft> {
  const { text } = await callTask("listing", { item: input });
  const raw = extractJSON(text);
  const price =
    typeof raw.price === "number" && Number.isFinite(raw.price)
      ? Math.max(0, Math.round(raw.price))
      : input.resaleLow;
  return {
    title: asStr(raw.title, input.item).slice(0, 80),
    description: asStr(raw.description),
    price,
    pricingNote: asStr(raw.pricingNote),
    platform: asStr(raw.platform, "Facebook Marketplace"),
  };
}

// ---------- Buyer finder / inventory triage ----------

export interface BuyerVerdict {
  item: string;
  verdict: "list_online" | "scrap_now" | "either";
  why: string;
}

const VERDICTS = ["list_online", "scrap_now", "either"] as const;

export async function analyzeInventory(
  items: Array<{ item: string; category: string; scrapHigh: number; resaleHigh: number }>
): Promise<BuyerVerdict[]> {
  const { text } = await callTask("buyer", { items: items.slice(0, 25) });
  const raw = extractJSON(text);
  const list = Array.isArray(raw.verdicts) ? (raw.verdicts as unknown[]) : [];
  const out: BuyerVerdict[] = [];
  for (const v of list) {
    const vv = (v || {}) as Record<string, unknown>;
    const item = asStr(vv.item).trim();
    const verdict = (VERDICTS as readonly string[]).includes(vv.verdict as string)
      ? (vv.verdict as BuyerVerdict["verdict"])
      : "either";
    if (item) out.push({ item, verdict, why: asStr(vv.why) });
  }
  if (out.length === 0) {
    throw new Error("Couldn't get a clean read on the triage. Tap Try Again.");
  }
  return out;
}
