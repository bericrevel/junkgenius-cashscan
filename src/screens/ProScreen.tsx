// JunkGenius Pro — the fair gate, same economics as both predecessor apps:
// free until $100 REAL cash collected or 150 AI actions, whichever first.
// Everything that's YOURS (inventory, pins, plan, yards, prices, laws)
// stays free forever. Only new AI actions gate.

import { useState } from "react";
import { Loader2, Zap, Settings, RefreshCw } from "lucide-react";
import { ProState, refreshEntitlement, startCheckout, restoreByEmail, openPortal } from "../lib/pro";

// Display strings only — REAL prices live in Stripe (README). Change both.
const PRICE_MONTHLY_LABEL = "$3.99 / month";
const PRICE_ANNUAL_LABEL = "$24 / year";

interface Props {
  proState: ProState | null;
  onProChange: (s: ProState) => void;
  gateReason: "cash" | "actions" | null;
  cashCollected: number;
  aiLimit: number;
  goScan: () => void;
}

export default function ProScreen({ proState, onProChange, gateReason, cashCollected, aiLimit, goScan }: Props) {
  const [busy, setBusy] = useState<"" | "monthly" | "annual" | "check" | "restore" | "portal">("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreEmail, setRestoreEmail] = useState("");

  const isPro = !!proState?.pro;

  const buy = async (plan: "monthly" | "annual") => {
    setBusy(plan);
    setError(null);
    setNotice(null);
    try {
      await startCheckout(plan);
      setNotice('Finish up in the browser tab, then come back and tap "I finished paying — check now."');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start checkout. Try again.");
    } finally {
      setBusy("");
    }
  };

  const check = async () => {
    setBusy("check");
    setError(null);
    try {
      const s = await refreshEntitlement({ force: true });
      onProChange(s);
      if (!s.pro) setNotice("Not showing yet — fresh payments can take up to a minute to register. Give it a moment and tap again.");
      else setNotice(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check. Try again.");
    } finally {
      setBusy("");
    }
  };

  const restore = async () => {
    setBusy("restore");
    setError(null);
    setNotice(null);
    try {
      const r = await restoreByEmail(restoreEmail.trim());
      if (r.pro) {
        onProChange({ pro: true, checkedAt: Date.now(), source: "network" });
        setRestoreEmail("");
      } else {
        setError(r.message || "No active Pro found for that email.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't restore. Try again.");
    } finally {
      setBusy("");
    }
  };

  const portal = async () => {
    setBusy("portal");
    setError(null);
    try {
      await openPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open subscription settings. Try again.");
    } finally {
      setBusy("");
    }
  };

  if (isPro) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col items-center text-center gap-3 mt-8">
          <Zap size={48} color="#4ADE80" />
          <div className="term-font font-bold text-2xl text-white">You're Pro. ⚡</div>
          <div className="text-sm text-faint max-w-xs">
            Unlimited scans, chat, listings, and triage — and your few bucks keep this tool alive
            for the next scrapper digging out. Thank you.
          </div>
          <button
            onClick={goScan}
            className="w-full max-w-xs py-4 mt-2 rounded-xl term-font font-extrabold text-lg tracking-wide"
            style={{ background: "#4ADE80", color: "#0A0E1A" }}
          >
            SCAN SOMETHING
          </button>
          <button
            onClick={portal}
            disabled={busy === "portal"}
            className="flex items-center gap-2 py-3 px-5 rounded-xl border border-edge text-mist font-semibold text-sm disabled:opacity-50"
          >
            <Settings size={15} /> {busy === "portal" ? "Opening…" : "Manage / cancel subscription"}
          </button>
          {error && <div className="w-full bg-panel border-2 border-alert rounded-xl p-3 text-sm">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Zap size={32} color="#4ADE80" className="flex-shrink-0" />
        <div className="term-font font-bold text-2xl text-white leading-tight">
          {gateReason === "cash"
            ? `JunkGenius helped you collect $${cashCollected.toFixed(0)}.`
            : `${aiLimit} AI actions on the house.`}
        </div>
      </div>
      <div className="text-[15px] text-mist">
        {gateReason === "cash"
          ? `The deal: free until you've collected $100 or used ${aiLimit} AI actions — whichever lands first. You hit the hundred. Pro keeps it rolling for less than a cup of gas-station coffee a week.`
          : `The deal: free until you've collected $100 or used ${aiLimit} AI actions — whichever lands first. You hit the actions. Every scan, chat, and draft costs us real money to run — Pro keeps them coming for less than a cup of gas-station coffee a week.`}
      </div>

      <div className="bg-panel border border-edge rounded-xl p-4 text-sm">
        <div className="text-white font-semibold mb-2">Free forever, Pro or not:</div>
        <ul className="flex flex-col gap-1 text-faint list-disc pl-5">
          <li>Your inventory, your pins, your plan, your logged prices</li>
          <li>The yard finder, metal prices, and the law guide</li>
          <li>Canceling — two taps, no phone calls</li>
        </ul>
      </div>

      <button
        onClick={() => buy("monthly")}
        disabled={busy !== ""}
        className="w-full py-4 rounded-xl term-font font-extrabold text-lg tracking-wide flex items-center justify-center gap-2 disabled:opacity-60"
        style={{ background: "#4ADE80", color: "#0A0E1A" }}
      >
        {busy === "monthly" ? <Loader2 size={20} className="animate-spin" /> : null}
        {PRICE_MONTHLY_LABEL}
      </button>
      <button
        onClick={() => buy("annual")}
        disabled={busy !== ""}
        className="w-full py-4 rounded-xl term-font font-extrabold text-lg tracking-wide flex items-center justify-center gap-2 disabled:opacity-60 border-2"
        style={{ borderColor: "#4ADE80", color: "#4ADE80" }}
      >
        {busy === "annual" ? <Loader2 size={20} className="animate-spin" /> : null}
        {PRICE_ANNUAL_LABEL} <span className="sans-font text-sm font-semibold">— save 50%</span>
      </button>

      {notice && <div className="bg-panel border-2 rounded-xl p-3 text-sm" style={{ borderColor: "#FBBF24" }}>{notice}</div>}
      {error && <div className="bg-panel border-2 border-alert rounded-xl p-3 text-sm">{error}</div>}

      <button
        onClick={check}
        disabled={busy !== ""}
        className="w-full py-3.5 rounded-xl border border-edge text-mist font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {busy === "check" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        I finished paying — check now
      </button>

      <div className="mt-2 pt-4 border-t border-edge">
        <div className="text-sm text-white font-semibold mb-1">Already Pro on another phone?</div>
        <div className="text-sm text-faint mb-2">Enter the email from your receipt and we'll move it over.</div>
        <input
          value={restoreEmail}
          onChange={(e) => setRestoreEmail(e.target.value)}
          placeholder="you@example.com"
          inputMode="email"
          autoCapitalize="none"
          className="w-full bg-panel border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout mb-2"
        />
        <button
          onClick={restore}
          disabled={busy !== "" || restoreEmail.trim() === ""}
          className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 border"
          style={{ borderColor: "#60A5FA", color: "#60A5FA" }}
        >
          {busy === "restore" ? <Loader2 size={16} className="animate-spin" /> : null}
          Restore my Pro
        </button>
      </div>

      <div className="text-xs text-faint text-center pb-3">
        Payments run through Stripe in your browser — card details never touch this app. Cancel
        anytime. Everything of yours stays on your phone either way.
      </div>
    </div>
  );
}
