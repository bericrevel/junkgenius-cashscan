// Real eBay asks panel. Fetch is button-triggered on purpose: comps cost API
// quota and user data, so nothing fires until asked. Renders all four honest
// outcomes: setup / real numbers / zero matches / failure.

import { useState } from "react";
import { Loader2, ExternalLink, Tag } from "lucide-react";
import { Browser } from "@capacitor/browser";
import { getEbayComps, EbayComps } from "../lib/ebay";

export default function EbayCompsPanel({ query }: { query: string }) {
  const [comps, setComps] = useState<EbayComps | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setComps(await getEbayComps(query));
    setBusy(false);
  };

  if (!comps) {
    return (
      <button
        onClick={run}
        disabled={busy || !query.trim()}
        className="w-full py-3 rounded-xl font-semibold text-sm border flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ borderColor: "rgb(var(--a-400))", color: "rgb(var(--a-400))" }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Tag size={15} />}
        Check real eBay asks
      </button>
    );
  }

  if (comps.state === "setup") {
    return (
      <div className="panel rounded-xl p-4 text-sm text-faint">
        <div className="text-white font-semibold mb-1">eBay comps aren't connected yet.</div>
        They need a one-time free eBay developer key on the server (README →{" "}
        <span className="font-mono text-xs">EBAY_CLIENT_ID</span>). No invented listings in the
        meantime —{" "}
        <button
          onClick={() => Browser.open({ url: comps.searchUrl })}
          className="underline text-mist"
        >
          search eBay yourself
        </button>
        .
      </div>
    );
  }

  if (comps.state === "error") {
    return (
      <div className="panel border-2 border-rose/40 rounded-xl p-3.5 text-sm flex flex-col gap-2">
        <span>{comps.message}</span>
        <button
          onClick={run}
          className="self-start px-4 py-1.5 rounded-lg font-mono font-bold text-xs"
          style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
        >
          TRY AGAIN
        </button>
      </div>
    );
  }

  if (comps.count === 0) {
    return (
      <div className="panel rounded-xl p-4 text-sm text-faint">
        No live eBay listings matched "{query}". Rarer than it looks — or worth trying different
        words.{" "}
        <button onClick={() => Browser.open({ url: comps.searchUrl })} className="underline text-mist">
          Search eBay directly
        </button>
        .
      </div>
    );
  }

  return (
    <div className="panel rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] tracking-widest text-faint">LIVE EBAY ASKS</div>
        <div className="text-[10px] text-faint">{comps.count} active listings</div>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-mono font-bold text-2xl" style={{ color: "rgb(var(--a-400))" }}>
          ${comps.median}
        </span>
        <span className="text-xs text-faint">median ask · ${comps.low}–${comps.high} range</span>
      </div>
      {comps.samples.map((s, i) => (
        <button
          key={i}
          onClick={() => Browser.open({ url: s.url })}
          className="text-left flex items-center justify-between gap-2 bg-ink border border-white/10 rounded-lg px-3 py-2"
        >
          <span className="text-xs text-mist truncate">{s.title}</span>
          <span className="font-mono text-xs text-white flex-shrink-0">${s.price}</span>
        </button>
      ))}
      <button
        onClick={() => Browser.open({ url: comps.searchUrl })}
        className="text-xs text-faint underline flex items-center gap-1 self-start"
      >
        <ExternalLink size={11} /> See all on eBay
      </button>
      <div className="text-[10px] text-faint">
        These are asking prices (live), not sold prices — real sold data isn't publicly
        available. Price a bit under the median to move fast.
      </div>
    </div>
  );
}
