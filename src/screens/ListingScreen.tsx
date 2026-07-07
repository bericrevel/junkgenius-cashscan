// Listing generator — pick an on-hand item (or arrive prefilled from a scan),
// add optional honest notes, generate an editable draft, copy it, and jump to
// the real posting pages. Real eBay asks panel included for pricing sanity.

import { useState } from "react";
import { Loader2, Copy, Check, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { Browser } from "@capacitor/browser";
import { generateListing, ListingDraft, ListingInput } from "../lib/scout";
import type { InventoryItem } from "../lib/inventory";
import EbayCompsPanel from "../components/EbayCompsPanel";

const POST_LINKS: Array<{ label: string; url: string }> = [
  { label: "Post on Facebook Marketplace", url: "https://www.facebook.com/marketplace/create/item" },
  { label: "Sell on eBay", url: "https://www.ebay.com/sl/sell" },
  { label: "Post on Craigslist", url: "https://post.craigslist.org/" },
];

interface Props {
  inventory: InventoryItem[];
  prefill: ListingInput | null;
  onAiAction?: () => void;
}

export default function ListingScreen({ inventory, prefill, onAiAction }: Props) {
  const [input, setInput] = useState<ListingInput | null>(prefill);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onHand = inventory.filter((i) => i.status === "have");

  const run = async () => {
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const d = await generateListing({ ...input, notes: notes.trim() || undefined });
      onAiAction?.(); // successful drafts only
      setDraft(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft the listing. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copyAll = () => {
    if (!draft) return;
    const text = `${draft.title}\n\n${draft.description}\n\n$${draft.price}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
      {/* Item picker */}
      {!input && (
        <>
          <div className="text-sm text-faint">
            Pick something from your inventory to draft a listing for:
          </div>
          {onHand.length === 0 ? (
            <div className="bg-panel border border-edge rounded-xl p-5 text-sm text-faint">
              Nothing on hand yet. Scan an item and add it to your inventory first — then this
              tool writes the ad.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {onHand.map((i) => (
                <button
                  key={i.id}
                  onClick={() =>
                    setInput({
                      item: i.item,
                      category: i.category,
                      resaleLow: i.resaleLow,
                      resaleHigh: i.resaleHigh,
                    })
                  }
                  className="text-left bg-panel border border-edge rounded-xl px-4 py-3"
                >
                  <div className="text-sm text-white font-medium">{i.item}</div>
                  <div className="text-xs text-faint mt-0.5">
                    est. resale ${i.resaleLow}–${i.resaleHigh}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {input && !draft && (
        <>
          <div className="bg-panel border border-edge rounded-xl px-4 py-3">
            <div className="text-sm text-white font-semibold">{input.item}</div>
            <div className="text-xs text-faint mt-0.5">
              est. resale ${input.resaleLow}–${input.resaleHigh}
              {input.condition ? ` · ${input.condition}` : ""}
            </div>
            <button onClick={() => setInput(null)} className="text-xs text-faint underline mt-1">
              pick a different item
            </button>
          </div>
          <div>
            <div className="term-font text-[10px] tracking-widest text-faint mb-2">
              ANYTHING THE BUYER SHOULD KNOW? (OPTIONAL)
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Runs but pull cord sticks. Garage kept. Cash only..."
              className="w-full bg-panel border border-edge rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-scout resize-none"
            />
          </div>
          {error && (
            <div className="bg-panel border-2 border-alert rounded-xl p-3 text-sm flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0" color="#F87171" />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={run}
            disabled={busy}
            className="w-full py-4 rounded-xl term-font font-extrabold text-lg flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "#4ADE80", color: "#0A0E1A" }}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : null} DRAFT THE LISTING
          </button>
          <EbayCompsPanel query={input.item} />
        </>
      )}

      {input && draft && (
        <>
          <div>
            <div className="term-font text-[10px] tracking-widest text-faint mb-1.5">TITLE</div>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value.slice(0, 80) })}
              className="w-full bg-panel border border-edge rounded-xl px-4 py-3 text-sm text-white font-semibold outline-none focus:border-scout"
            />
            <div className="text-[10px] text-faint mt-1 text-right">{draft.title.length}/80</div>
          </div>
          <div>
            <div className="term-font text-[10px] tracking-widest text-faint mb-1.5">DESCRIPTION</div>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={5}
              className="w-full bg-panel border border-edge rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-scout resize-none"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="term-font text-[10px] tracking-widest text-faint mb-1.5">PRICE ($)</div>
              <input
                value={String(draft.price)}
                onChange={(e) => {
                  const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                  setDraft({ ...draft, price: Number.isFinite(n) ? n : 0 });
                }}
                inputMode="decimal"
                className="w-full bg-panel border border-edge rounded-xl px-4 py-3 text-sm text-white font-semibold outline-none focus:border-scout"
              />
            </div>
            <div className="flex-1">
              <div className="term-font text-[10px] tracking-widest text-faint mb-1.5">BEST PLATFORM</div>
              <div className="bg-ink border border-edge rounded-xl px-4 py-3 text-sm text-mist">{draft.platform}</div>
            </div>
          </div>
          {draft.pricingNote && <div className="text-xs text-faint italic">{draft.pricingNote}</div>}

          <button
            onClick={copyAll}
            className="w-full py-3.5 rounded-xl font-semibold border flex items-center justify-center gap-2"
            style={{ borderColor: "#4ADE80", color: "#4ADE80" }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy the whole listing"}
          </button>

          <div className="flex flex-col gap-2">
            {POST_LINKS.map((l) => (
              <button
                key={l.label}
                onClick={() => Browser.open({ url: l.url })}
                className="w-full py-3 rounded-xl font-semibold text-sm border border-edge text-mist flex items-center justify-center gap-2"
              >
                <ExternalLink size={14} /> {l.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-faint text-center">
            Copy first, then paste into the posting page. Add your real photos there — honest
            photos sell faster than good words.
          </div>

          <EbayCompsPanel query={input.item} />

          <button
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
            className="text-center text-sm text-faint underline flex items-center justify-center gap-1 pb-4"
          >
            <RefreshCw size={12} /> redraft
          </button>
        </>
      )}
    </div>
  );
}
