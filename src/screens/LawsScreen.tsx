// Scrap-law field guide — general, stable content shipped in-app (works
// offline), dated, with verify-locally launchers. Deliberately NOT a
// 50-state statute database: confidently-wrong specifics would violate
// Rule #1 where it matters most.

import { useState } from "react";
import { ChevronDown, ExternalLink, MessageSquare, ShieldAlert } from "lucide-react";
import { Browser } from "@capacitor/browser";
import { LAW_SECTIONS, LAWS_REVIEWED } from "../data/scraplaws";

export default function LawsScreen({ onAskScout }: { onAskScout: () => void }) {
  const [open, setOpen] = useState<number | null>(0);
  const [stateQuery, setStateQuery] = useState("");

  const verify = () => {
    const s = stateQuery.trim() || "my state";
    Browser.open({
      url: `https://www.google.com/search?q=${encodeURIComponent(`${s} scrap metal law seller requirements site:.gov`)}`,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
      <div className="panel rounded-xl p-4 text-sm text-faint flex gap-2.5">
        <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" color="#FBBF24" />
        <span>
          The stuff that's true almost everywhere — <b className="text-mist">not</b> legal advice,
          and state specifics vary. Reviewed {LAWS_REVIEWED}. Verify anything that matters with
          your yard or your state's site (buttons below).
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {LAW_SECTIONS.map((s, i) => (
          <div key={i} className="panel rounded-xl overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left"
            >
              <span className="text-sm text-white font-semibold">{s.title}</span>
              <ChevronDown
                size={16}
                color="#7C8983"
                style={{ transform: open === i ? "rotate(180deg)" : "none", transition: "transform .15s" }}
              />
            </button>
            {open === i && (
              <div className="px-4 pb-4 text-sm text-mist leading-relaxed whitespace-pre-wrap">{s.body}</div>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="font-mono text-[10px] tracking-widest text-faint mb-2">VERIFY FOR YOUR STATE</div>
        <div className="flex gap-2">
          <input
            value={stateQuery}
            onChange={(e) => setStateQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verify()}
            placeholder="your state (e.g. Ohio)"
            className="min-w-0 flex-1 panel rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-abright/50"
          />
          <button
            onClick={verify}
            className="px-4 rounded-xl font-mono font-bold text-xs flex items-center gap-1.5"
            style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
          >
            <ExternalLink size={13} /> .GOV SEARCH
          </button>
        </div>
        <button
          onClick={onAskScout}
          className="w-full mt-2 py-3 rounded-xl font-semibold text-sm border border-white/10 text-mist flex items-center justify-center gap-2"
        >
          <MessageSquare size={14} /> Ask the scout (it won't guess state law either)
        </button>
      </div>

      <div className="text-[11px] text-faint text-center pb-3">
        Best source of all: call your yard. The law binds them — they know it cold.
      </div>
    </div>
  );
}
