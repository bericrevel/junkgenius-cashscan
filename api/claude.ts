// JunkGenius CashScan — API proxy (Vercel, Node.js runtime).
//
// This function is the ONLY thing that ever talks to api.anthropic.com.
// The app calls this instead, so your key never ships inside the APK.
//
// Design notes (from the ship-readiness audit):
// - Node runtime, NOT edge: edge's ~25s initial-response ceiling is too tight
//   for long guide generations. maxDuration is set in vercel.json.
// - CORS: the packaged app's WebView runs at https://localhost, so every call
//   is cross-origin and preflighted. OPTIONS must succeed or nothing works.
// - Task-locked: the client can only ask for one of three predefined tasks.
//   System prompts live HERE, server-side — the proxy cannot be repurposed as
//   a general Claude relay even if someone extracts the app key from the APK.
// - Defense layers: app key check, per-IP rate limit (best-effort), strict
//   input validation, per-task max_tokens. Set a monthly spend cap in the
//   Anthropic console too — that bounds the blast radius of everything else.
//
// Env vars (Vercel Project Settings > Environment Variables):
//   ANTHROPIC_API_KEY  (required)  your Anthropic key
//   APP_SHARED_KEY     (optional)  must match the app's VITE_APP_KEY; if unset,
//                                  the key check is skipped (dev convenience)
//   ANTHROPIC_MODEL    (optional)  defaults to claude-sonnet-4-6

type Task = "identify" | "guide" | "listing";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const MAX_TOKENS: Record<Task, number> = {
  identify: 1000,
  guide: 2000, // raised from 1200 — a cut-off repair step is a safety problem
  listing: 800,
};

const SYSTEM: Record<Task, string> = {
  identify: `You identify scanned junk/scrap items for JunkGenius CashScan, an app that helps low-income and rural workers turn discarded items into cash. Respond with ONLY a raw JSON object (no markdown fences, no preamble) with exactly these fields:
{
  "item": "short item name",
  "valueRepairedLow": number, "valueRepairedHigh": number,
  "valueScrapLow": number, "valueScrapHigh": number,
  "difficulty": "easy" | "moderate" | "hard",
  "timeEstimate": "short string like '45-90 min'",
  "move": "repair" | "part_out" | "repurpose" | "scrap" | "avoid",
  "profitLow": number, "profitHigh": number,
  "reason": "one short plain-spoken line explaining the move",
  "safetyWarning": "short warning string, or empty string if none",
  "category": "a short category tag like 'small appliance', 'yard equipment', 'electronics'"
}
Be decisive and realistic. Never inflate value. If the photo is unclear, set "item" to "unclear" and explain in "reason".`,

  guide: `You are the hands-on guide for JunkGenius CashScan. You'll get an item plus its scan data, including the recommended move. Write the guide for THAT move:

- move "repair" or "part_out": a practical repair/part-out path — numbered test order (cheapest/fastest check first), tool list split into "No tools", "Basic tools", "Best tools", a skill level, a time estimate, parts likely needed with rough prices, a safety warning if relevant, and a clear "stop here, scrap it instead" line so nobody sinks money into a loser.
- move "repurpose": name 2-3 concrete things this could become, pick the most sellable one, then give numbered build steps with the same three tool tiers and a realistic selling price for the finished piece.
- move "scrap": a scrapping guide — what materials/metals are inside and roughly what scrapyards pay for each, what's worth stripping or separating first for more money, how to find and call a yard (and what to ask), what to bring (ID — yards require it), and safety (fuel, oil, refrigerant, capacitors, sharp edges).

Be concrete and plain-spoken, written for someone who may have no tools and no spare cash. Short headers, numbered steps, no fluff. Always include the safety line if there's any electrical, fuel, or sharp-edge risk.`,

  listing: `You write auto-generated marketplace listings for JunkGenius CashScan. Given an item, write ONLY a raw JSON object (no markdown fences) with fields: "title", "description" (2-3 honest sentences, no overselling), "price" (a number), "platform" (one of: Facebook Marketplace, eBay, Craigslist, OfferUp), "photoTips" (short string), "safetyDisclaimer" (empty string if none needed).`,
};

// ---------- CORS ----------
// The WebView origin is https://localhost (capacitor.config androidScheme).
// "*" would also work — this endpoint holds no user session — but being
// explicit documents intent. X-App-Key must be listed or preflight fails.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
  "Access-Control-Max-Age": "86400",
};

// ---------- Best-effort per-IP rate limit ----------
// In-memory, so it resets on cold starts and isn't shared across instances.
// It still stops naive loop abuse. For real limiting at scale, back this with
// Upstash Redis or a Vercel WAF rule. The Anthropic spend cap is the backstop.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory guard
  return false;
}

// ---------- Validation helpers ----------
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MOVES = ["repair", "part_out", "repurpose", "scrap", "avoid"];
// ~5M base64 chars ≈ 3.75MB raw — Anthropic's per-image ceiling.
const MAX_IMAGE_B64_CHARS = 5_000_000;
const MAX_FIELD_CHARS = 400;

function cleanStr(v: unknown): string {
  return typeof v === "string" ? v.slice(0, MAX_FIELD_CHARS) : "";
}
function cleanNum(v: unknown): number {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(1_000_000, n)) : 0;
}

interface NodeReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}
interface NodeRes {
  setHeader(name: string, value: string): void;
  status(code: number): NodeRes;
  json(body: unknown): void;
  end(): void;
}

export default async function handler(req: NodeReq, res: NodeRes) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
    return;
  }

  // App key check (skipped when APP_SHARED_KEY isn't set, so local dev works).
  const sharedKey = process.env.APP_SHARED_KEY;
  if (sharedKey) {
    const provided = req.headers["x-app-key"];
    if (provided !== sharedKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const ip =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : "") ||
    req.socket?.remoteAddress ||
    "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many requests — try again in a few minutes" });
    return;
  }

  // Vercel parses JSON bodies automatically (and enforces its 4.5MB body cap
  // upstream of this code with a 413).
  const body = (req.body || {}) as Record<string, unknown>;
  const task = body.task as Task;
  if (task !== "identify" && task !== "guide" && task !== "listing") {
    res.status(400).json({ error: "Unknown task" });
    return;
  }

  // Build the messages SERVER-SIDE from validated fields only.
  let messages: unknown[];

  if (task === "identify") {
    const image = body.image as { data?: unknown; mediaType?: unknown } | undefined;
    const data = typeof image?.data === "string" ? image.data : "";
    const mediaType = typeof image?.mediaType === "string" ? image.mediaType : "";
    if (!data || !ALLOWED_MEDIA.includes(mediaType)) {
      res.status(400).json({ error: "A photo is required" });
      return;
    }
    if (data.length > MAX_IMAGE_B64_CHARS) {
      res.status(413).json({ error: "Photo too large" });
      return;
    }
    messages = [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: "Identify this item and return the JSON." },
        ],
      },
    ];
  } else {
    const item = (body.item || {}) as Record<string, unknown>;
    const move = MOVES.includes(item.move as string) ? (item.move as string) : "scrap";
    const lines = [
      `Item: ${cleanStr(item.item)}`,
      `Category: ${cleanStr(item.category)}`,
      `Recommended move: ${move}`,
      `Reason: ${cleanStr(item.reason)}`,
    ];
    if (task === "guide") {
      lines.push(
        `Difficulty: ${cleanStr(item.difficulty)}`,
        `Time estimate: ${cleanStr(item.timeEstimate)}`,
        `Scrap value range: $${cleanNum(item.valueScrapLow)}-$${cleanNum(item.valueScrapHigh)}`
      );
    } else {
      lines.push(
        `Repaired value range: $${cleanNum(item.valueRepairedLow)}-$${cleanNum(item.valueRepairedHigh)}`
      );
    }
    if (!cleanStr(item.item)) {
      res.status(400).json({ error: "Item data is required" });
      return;
    }
    messages = [{ role: "user", content: lines.join("\n") }];
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS[task],
        system: SYSTEM[task],
        messages,
      }),
    });

    const data = (await anthropicRes.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      error?: { message?: string };
    };

    if (!anthropicRes.ok) {
      res
        .status(anthropicRes.status)
        .json({ error: data.error?.message || "Anthropic API error" });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("");

    if (!text) {
      res.status(502).json({ error: "Empty response from model" });
      return;
    }

    // truncated: the model hit max_tokens — the client warns the user rather
    // than silently showing a repair guide that stops mid-step.
    res.status(200).json({ text, truncated: data.stop_reason === "max_tokens" });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Proxy request failed" });
  }
}
