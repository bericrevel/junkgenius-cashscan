// Buyer finder — AI triage of the user's REAL on-device inventory: which
// items are worth the listing hassle, which should become same-day yard cash.

import { useState } from "react";
import { Loader2, AlertTriangle, Tag, Recycle, Scale } from "lucide-react";
import { analyzeInventory, BuyerVerdict } from "../lib/scout";
import type { InventoryItem } from "../lib/inventory";

const VERDICT_STYLE: Record<BuyerVerdict["verdict"], { label: string; color: string; icon: typeof Tag }> = {
  list_online: { label: "LIST IT", color: "rgb(var(--a-400))", icon: Tag },
  scrap_now: { label: "SCRAP NOW", color: "#60A5FA", icon: Recycle },
  either: { label: "EITHER WAY", color: "#FBBF24", icon: Scale },
};

interface Props {
  inventory: InventoryItem[];
  onDraftListing: (item: InventoryItem) => void;
  onAiAction?: () => void;
}

export default function BuyerScreen({ inventory, onDraftListing, onAiAction }: Props) {
  const [verdicts, setVerdicts] = useState<BuyerVerdict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onHand = inventory.filter((i) => i.status === "have");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await analyzeInventory(
        onHand.map((i) => ({
          item: i.item,
          category: i.category,
          scrapHigh: i.scrapHigh,
          resaleHigh: i.resaleHigh,
        }))
      );
      onAiAction?.(); // successful triages only
      setVerdicts(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't run the triage. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const findInventoryItem = (name: string): InventoryItem | undefined =>
    onHand.find((i) => i.item.toLowerCase() === name.toLowerCase()) ||
    onHand.find((i) => name.toLowerCase().includes(i.item.toLowerCase()) || i.item.toLowerCase().includes(name.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
      <div className="text-sm text-faint">
        The scout reads your on-hand inventory and calls it: worth the listing hassle, or
        same-day yard cash?
      </div>

      {onHand.length === 0 ? (
        <div className="panel rounded-xl p-5 text-sm text-faint">
          Nothing on hand to triage. Scan items and add them to your inventory first.
        </div>
      ) : (
        <>
          <div className="panel rounded-xl px-4 py-3 text-sm text-mist">
            {onHand.length} item{onHand.length === 1 ? "" : "s"} on hand
          </div>
          {error && (
            <div className="panel border-2 border-rose/40 rounded-xl p-3 text-sm flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0" color="#FB7185" />
              <span>{error}</span>
            </div>
          )}
          {!verdicts && (
            <button
              onClick={run}
              disabled={busy}
              className="w-full py-4 rounded-xl font-mono font-extrabold text-lg flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : null} TRIAGE MY PILE
            </button>
          )}
        </>
      )}

      {verdicts && (
        <>
          <div className="flex flex-col gap-2">
            {verdicts.map((v, i) => {
              const style = VERDICT_STYLE[v.verdict];
              const Icon = style.icon;
              const invItem = findInventoryItem(v.item);
              return (
                <div key={i} className="panel rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-white font-medium truncate">{v.item}</div>
                    <div
                      className="font-mono text-[10px] font-bold tracking-wider px-2 py-1 rounded flex items-center gap-1 flex-shrink-0"
                      style={{ background: `${style.color}22`, color: style.color }}
                    >
                      <Icon size={11} /> {style.label}
                    </div>
                  </div>
                  <div className="text-xs text-faint mt-1">{v.why}</div>
                  {v.verdict !== "scrap_now" && invItem && (
                    <button
                      onClick={() => onDraftListing(invItem)}
                      className="mt-2 px-3 py-1.5 rounded-lg font-mono font-bold text-[11px]"
                      style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
                    >
                      DRAFT THE LISTING
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={run}
            disabled={busy}
            className="py-2.5 rounded-xl border border-white/10 text-sm text-mist flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Re-run triage
          </button>
          <div className="text-[11px] text-faint text-center pb-3">
            AI judgment on your real inventory — estimates in, judgment out. You know your time
            and your town best.
          </div>
        </>
      )}
    </div>
  );
}
