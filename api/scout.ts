// JunkGenius — API proxy (Vercel, Node.js runtime).
//
// Task-locked: system prompts live HERE, server-side; the app can only name
// a task and send validated data. CORS for the Capacitor WebView, optional
// shared app key, best-effort per-IP rate limiting, per-task max_tokens.
//
// TWO upstream models, split by cost/quality fit (verified July 2026):
//   - identify (the photo-scan call, fires on EVERY scan, by far the highest
//     volume) → Gemini 3.1 Flash-Lite. ~$0.0003/image vs ~$0.0048/image on
//     Claude Sonnet — roughly 16x cheaper on the call that dominates spend.
//   - guide / chat / listing / buyer (opt-in, far lower volume, benefit from
//     stronger reasoning for safety-sensitive or persuasive text) → Claude
//     Sonnet, unchanged.
//
// identify also returns MULTIPLE items per photo: point at a whole pile,
// get every sellable/scrappable thing in it back as a list.
//
// Env vars: GEMINI_API_KEY (required for identify), ANTHROPIC_API_KEY
// (required for guide/chat/listing/buyer), APP_SHARED_KEY (optional),
// ANTHROPIC_MODEL (optional, default claude-sonnet-4-6).

type Task = "identify" | "guide" | "chat" | "listing" | "buyer";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_TOKENS: Record<Exclude<Task, "identify">, number> = {
  guide: 2000, // raised so a repair guide never truncates mid-safety-step
  chat: 1000,
  listing: 900,
  buyer: 1500,
};
const IDENTIFY_MAX_TOKENS = 3000; // multi-item arrays need more headroom than one object

const IDENTIFY_SYSTEM = `You identify EVERY distinct sellable or scrappable item visible in a photo for JunkGenius, an app that helps low-income and rural workers turn found and discarded items into cash — either at the scrap yard or by reselling. A photo may show a single item or a whole pile — find each separate item, up to 8, ordered by highest total value first.

Respond with ONLY a raw JSON object (no markdown fences, no preamble):
{
  "items": [
    {
      "item": "short item name",
      "category": "short tag like 'appliance', 'auto part', 'electronics', 'furniture', 'tool', 'scrap metal'",
      "condition": "one short plain line on visible condition",
      "materials": [{"name": "copper", "estLbs": 2.5}],
      "weightLbs": number (rough total weight estimate),
      "scrapLow": number, "scrapHigh": number,
      "resaleLow": number, "resaleHigh": number,
      "move": "resell" | "scrap" | "part_out" | "skip",
      "reason": "one short plain-spoken line explaining the move",
      "safetyWarning": "short warning string, or empty string if none"
    }
  ]
}
Rules: scrap values reflect realistic US scrap-yard payouts (well below commodity spot). Resale values reflect realistic used-market prices for the visible condition. Be decisive, never inflate, and prefer "skip" when something is genuinely not worth the effort. All dollar values are ESTIMATES and will be labeled as such in the app. If the photo shows nothing identifiable or is too unclear, return {"items": []}. Don't invent items that aren't visible.`;

const CLAUDE_SYSTEM: Record<Exclude<Task, "identify">, string> = {
  guide: `You are the hands-on guide for JunkGenius. You'll get an item plus its scan data, including the recommended move. Write the guide for THAT move:

- move "resell" or "part_out": a practical repair/part-out path — numbered test order (cheapest/fastest check first), tool list split into "No tools", "Basic tools", "Best tools", a skill level, a time estimate, parts likely needed with rough prices, a safety warning if relevant, and a clear "stop here, scrap it instead" line so nobody sinks money into a loser.
- move "scrap": a scrapping guide — what materials/metals are inside and roughly what scrapyards pay for each, what's worth stripping or separating first for more money, how to find and call a yard (and what to ask), what to bring (ID — yards require it), and safety (fuel, oil, refrigerant, capacitors, sharp edges).
- move "skip": a short honest note on why it's not worth the effort, and one alternative (donate, free pile, or curb) if relevant.

Be concrete and plain-spoken, written for someone who may have no tools and no spare cash. Short headers, numbered steps, no fluff. Always include the safety line if there's any electrical, fuel, or sharp-edge risk.`,

  chat: `You are the JunkGenius assistant — a seasoned, plain-spoken scrapper's buddy for people turning junk into cash. You know scrap metal grades and separation (copper #1 vs #2, insulated wire, brass, stainless, cast vs light iron), yard etiquette (call ahead, bring ID, how weigh-ins work), part-out strategies, flipping basics, and safety (fuel, refrigerant, capacitors, batteries, sharp edges — take these seriously and warn plainly).
Rules: keep answers short and concrete — a few sentences or a tight list, written for someone who may have no tools and no spare cash. NEVER invent current market prices or claim live rates; when asked for today's prices, say prices move and point them to the app's Prices tab and to calling their yard. Never invent laws for a specific state — say rules vary and to check the yard's requirements. If something is dangerous (refrigerant venting, tank cutting, battery fires), say clearly not to do it and what the legal path is.`,

  listing: `You write marketplace listing drafts for JunkGenius users selling used/salvaged items. Respond with ONLY a raw JSON object (no markdown fences): {"title": "eBay-style title, max 80 characters, keyword-rich but honest", "description": "3-5 honest sentences: what it is, visible condition, what works/what's untested, pickup/shipping note", "price": number, "pricingNote": "one line on pricing strategy (e.g. price firm vs room to haggle, or start-high-drop-weekly)", "platform": "eBay" | "Facebook Marketplace" | "Craigslist" | "OfferUp"}
Rules: never oversell condition, never invent specs you weren't given, honest flaws stated plainly sell faster. Pick the platform that fits the item (heavy/local → FB or Craigslist; shippable/collectible → eBay).`,

  buyer: `You are JunkGenius's inventory triage. Given a list of items the user has on hand (with AI-estimated scrap and resale values), decide for each: is it worth listing online, or should they just scrap it now for fast cash? Respond with ONLY a raw JSON object (no markdown fences): {"verdicts": [{"item": "name exactly as given", "verdict": "list_online" | "scrap_now" | "either", "why": "one short plain line"}]}
Rules: weigh effort and time-to-cash, not just price — listing online means photos, messages, no-shows; scrapping is same-day money. Bulky low-value metal → scrap. Working electronics/tools/parts with real resale gap → list. When the gap is small, say "either" and note the tradeoff. Keep every "why" under 15 words.`,
};

// ---------- CORS / rate limiting ----------
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
  "Access-Control-Max-Age": "86400",
};

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 40; // chat is conversational — a bit more headroom
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
  if (hits.size > 5000) hits.clear();
  return false;
}

// ---------- validation helpers ----------
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_B64_CHARS = 5_000_000;
const MOVES = ["resell", "scrap", "part_out", "skip"];

function cleanStr(v: unknown, max = 400): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function cleanNum(v: unknown): number {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(1_000_000, n)) : 0;
}

interface TaskResult {
  text: string;
  truncated: boolean;
}

async function callGemini(apiKey: string, imageB64: string, mediaType: string): Promise<TaskResult> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: IDENTIFY_SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: imageB64 } },
            { text: "Find every item in this photo and return the JSON." },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: IDENTIFY_MAX_TOKENS,
        temperature: 0.4,
      },
    }),
  });
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message || "Gemini API error");
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) throw new Error("Empty response from model");
  return { text, truncated: cand?.finishReason === "MAX_TOKENS" };
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: unknown[],
  maxTokens: number
): Promise<TaskResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages }),
  });
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message || "Anthropic API error");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
  if (!text) throw new Error("Empty response from model");
  return { text, truncated: data.stop_reason === "max_tokens" };
}

type Message = { role: string; content: unknown };

function buildClaudeMessages(
  task: Exclude<Task, "identify">,
  body: Record<string, unknown>
): Message[] | { error: string; status: number } {
  if (task === "guide") {
    const item = (body.item || {}) as Record<string, unknown>;
    if (!cleanStr(item.item)) return { error: "Item data is required", status: 400 };
    const move = MOVES.includes(item.move as string) ? (item.move as string) : "scrap";
    const lines = [
      `Item: ${cleanStr(item.item)}`,
      `Category: ${cleanStr(item.category)}`,
      `Recommended move: ${move}`,
      `Reason: ${cleanStr(item.reason)}`,
      `Condition: ${cleanStr(item.condition) || "not described"}`,
      `Scrap value range: $${cleanNum(item.scrapLow)}-$${cleanNum(item.scrapHigh)}`,
      `Resale value range: $${cleanNum(item.resaleLow)}-$${cleanNum(item.resaleHigh)}`,
    ];
    return [{ role: "user", content: lines.join("\n") }];
  }

  if (task === "chat") {
    const raw = Array.isArray(body.messages) ? (body.messages as unknown[]) : [];
    const msgs: Message[] = [];
    for (const m of raw.slice(-12)) {
      const mm = (m || {}) as Record<string, unknown>;
      const role = mm.role === "assistant" ? "assistant" : mm.role === "user" ? "user" : null;
      const content = cleanStr(mm.content, 2000);
      if (role && content) msgs.push({ role, content });
    }
    if (msgs.length === 0 || msgs[msgs.length - 1].role !== "user") {
      return { error: "A question is required", status: 400 };
    }
    if (msgs[0].role !== "user") msgs.shift(); // Anthropic requires user-first
    return msgs;
  }

  if (task === "listing") {
    const item = (body.item || {}) as Record<string, unknown>;
    if (!cleanStr(item.item)) return { error: "Item data is required", status: 400 };
    const lines = [
      `Item: ${cleanStr(item.item)}`,
      `Category: ${cleanStr(item.category)}`,
      `Condition: ${cleanStr(item.condition) || "unknown — user hasn't described it"}`,
      `AI-estimated resale range: $${cleanNum(item.resaleLow)}-$${cleanNum(item.resaleHigh)}`,
      cleanStr(item.notes, 600) ? `Seller notes: ${cleanStr(item.notes, 600)}` : "",
    ].filter(Boolean);
    return [{ role: "user", content: lines.join("\n") }];
  }

  // buyer
  const raw = Array.isArray(body.items) ? (body.items as unknown[]) : [];
  const items = raw
    .slice(0, 25)
    .map((i) => {
      const it = (i || {}) as Record<string, unknown>;
      return {
        item: cleanStr(it.item, 120),
        category: cleanStr(it.category, 60),
        scrapHigh: cleanNum(it.scrapHigh),
        resaleHigh: cleanNum(it.resaleHigh),
      };
    })
    .filter((i) => i.item);
  if (items.length === 0) return { error: "At least one item is required", status: 400 };
  const lines = items.map(
    (i, n) => `${n + 1}. ${i.item} (${i.category || "misc"}) — est. scrap up to $${i.scrapHigh}, est. resale up to $${i.resaleHigh}`
  );
  return [{ role: "user", content: `My on-hand inventory:\n${lines.join("\n")}\n\nTriage it and return the JSON.` }];
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

  const sharedKey = process.env.APP_SHARED_KEY;
  if (sharedKey && req.headers["x-app-key"] !== sharedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
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

  const body = (req.body || {}) as Record<string, unknown>;
  const task = body.task as Task;
  if (!["identify", "guide", "chat", "listing", "buyer"].includes(task)) {
    res.status(400).json({ error: "Unknown task" });
    return;
  }

  try {
    if (task === "identify") {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
        return;
      }
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
      const result = await callGemini(geminiKey, data, mediaType);
      res.status(200).json(result);
      return;
    }

    // Everything else runs on Claude.
    const claudeKey = process.env.ANTHROPIC_API_KEY;
    if (!claudeKey) {
      res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
      return;
    }
    const messages = buildClaudeMessages(task, body);
    if (!Array.isArray(messages)) {
      res.status(messages.status).json({ error: messages.error });
      return;
    }
    const result = await callClaude(claudeKey, CLAUDE_SYSTEM[task], messages, MAX_TOKENS[task]);
    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Proxy request failed" });
  }
}
