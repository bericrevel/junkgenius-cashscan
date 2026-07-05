// JunkGenius CashScan — /go/<channel> QR redirect counter (Vercel, Node runtime).
//
// Purpose: the printed flyers/cards carry QR codes like aerkatech.com/go/f.
// This function counts the hit (a tally — nothing else) and forwards to the
// Play Store listing. Per-channel counts tell you which placements work:
//
//   f = flyer · c = counter card · yard = scrapyard cards · lib = library
//   press = news pitch · fb = Facebook posts · rd = Reddit · ws = workshops
//   (any lowercase [a-z0-9-] name works — no registration needed)
//
// PRIVACY RULES (these are load-bearing — see privacy.html):
// - We increment a counter. No IPs, no user agents, no cookies, no
//   fingerprints, no per-hit timestamps are stored. A number goes up.
// - Obvious bots are redirected but not counted (keeps numbers honest).
//
// RELIABILITY RULE: the redirect ALWAYS happens, even if counting fails or
// storage isn't configured. A dead QR on printed paper is the one
// unforgivable failure. Counting gets 1.5 seconds, then we move on.
//
// Storage: Upstash Redis over its REST API (free tier is plenty — a scan
// costs 4 commands, free tier allows 10k/day). No npm dependency.
//
// Env vars:
//   UPSTASH_REDIS_REST_URL    (from Upstash — via Vercel Marketplace or upstash.com)
//   UPSTASH_REDIS_REST_TOKEN
//   PLAY_STORE_URL            optional override. Default = the live listing URL.
//                             TIP: during closed testing, set this to your
//                             testing opt-in link so early QRs recruit testers.
//   APP_SHARED_KEY            gates the stats endpoint (same key as the app)
//
// Routing: vercel.json rewrites /go/:channel -> /api/go?channel=:channel
//
// Read your numbers:  GET /go/stats?key=<APP_SHARED_KEY>
//   -> { "channels": { "f": { "total": 42, "today": 3 }, ... } }

const PLAY_URL =
  process.env.PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.aerkatech.cashscan";

const CHANNEL_RE = /^[a-z0-9-]{1,32}$/;
const BOT_RE = /bot|crawl|spider|preview|scan(?:ner)?|monitor|fetch|curl|wget|facebookexternalhit|slurp|headless/i;
const DAY_TTL_SECONDS = String(90 * 24 * 60 * 60); // daily keys live 90 days

type UpstashReply = Array<{ result?: unknown }>;

async function upstash(commands: string[][]): Promise<UpstashReply | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // not configured — counting silently off
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as UpstashReply;
  } catch {
    return null; // never let counting break the redirect
  } finally {
    clearTimeout(timer);
  }
}

function todayKey(channel: string): string {
  return `go:day:${channel}:${new Date().toISOString().slice(0, 10)}`;
}

interface NodeReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
}
interface NodeRes {
  setHeader(name: string, value: string): void;
  status(code: number): NodeRes;
  json(body: unknown): void;
  end(): void;
}

export default async function handler(req: NodeReq, res: NodeRes) {
  const raw = req.query?.channel;
  const channel = (typeof raw === "string" ? raw : "").toLowerCase();

  // ---- stats (gated) ----
  if (channel === "stats") {
    const sharedKey = process.env.APP_SHARED_KEY;
    const provided = typeof req.query?.key === "string" ? req.query.key : "";
    if (!sharedKey || provided !== sharedKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const listed = await upstash([["SMEMBERS", "go:channels"]]);
    const channels = Array.isArray(listed?.[0]?.result) ? (listed![0].result as string[]) : [];
    if (channels.length === 0) {
      res.status(200).json({ channels: {}, note: "No hits counted yet (or storage not configured)." });
      return;
    }
    const reads: string[][] = [];
    for (const ch of channels) {
      reads.push(["GET", `go:count:${ch}`]);
      reads.push(["GET", todayKey(ch)]);
    }
    const values = (await upstash(reads)) || [];
    const out: Record<string, { total: number; today: number }> = {};
    channels.forEach((ch, i) => {
      out[ch] = {
        total: parseInt(String(values[i * 2]?.result ?? "0"), 10) || 0,
        today: parseInt(String(values[i * 2 + 1]?.result ?? "0"), 10) || 0,
      };
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ channels: out });
    return;
  }

  // ---- count (best-effort), then redirect (always) ----
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";
  const isBot = BOT_RE.test(ua);
  if (CHANNEL_RE.test(channel) && !isBot) {
    const day = todayKey(channel);
    await upstash([
      ["INCR", `go:count:${channel}`],
      ["SADD", "go:channels", channel],
      ["INCR", day],
      ["EXPIRE", day, DAY_TTL_SECONDS],
    ]);
  }

  res.setHeader("Location", PLAY_URL);
  res.setHeader("Cache-Control", "no-store"); // every scan must reach us, not a CDN cache
  res.status(302).end();
}
