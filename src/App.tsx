import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera as CameraIcon,
  Loader2,
  Wrench,
  Tag,
  TrendingUp,
  Copy,
  Check,
  AlertTriangle,
  ChevronLeft,
  Image as ImageIcon,
  RefreshCw,
  X,
  DollarSign,
  Zap,
  Settings,
} from "lucide-react";
import { App as CapApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { takePhoto, pickPhoto, isCancel, CapturedPhoto } from "./lib/camera";
import { getItem, setItem } from "./lib/storage";
import { identifyItem, getGuide, getListing, ScanResult, Listing } from "./lib/claude";
import { refreshEntitlement, startCheckout, restoreByEmail, openPortal, ProState } from "./lib/pro";

// Colors darkened from v0.1 so white labels pass WCAG contrast —
// this audience skews toward older eyes and sun-glared screens.
const MOVES: Record<string, { label: string; color: string }> = {
  repair: { label: "REPAIR IT", color: "#24702f" },
  part_out: { label: "PART IT OUT", color: "#b06f00" },
  repurpose: { label: "MAKE SOMETHING ELSE", color: "#275f8f" },
  scrap: { label: "SCRAP IT", color: "#454545" },
  avoid: { label: "SKIP THIS ONE", color: "#b0332b" },
};

// Every move gets a real guide now — scrapping is a skill too, and for the
// users with no tools it's the fastest cash path.
const GUIDE_TITLES: Record<string, string> = {
  repair: "Repair Guide",
  part_out: "Part-Out Guide",
  repurpose: "Repurpose Guide",
  scrap: "Scrap-It Guide",
};

const LEDGER_KEY = "cashscan:ledger";
interface LedgerEntry {
  id: string;
  item: string;
  category: string;
  profit: number;
  date: number;
}
async function loadLedger(): Promise<LedgerEntry[]> {
  const raw = await getItem(LEDGER_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function saveLedger(ledger: LedgerEntry[]) {
  await setItem(LEDGER_KEY, JSON.stringify(ledger));
}

type Screen = "scan" | "result" | "guide" | "listing" | "tracker" | "pro";

// The deal: everything is free until CashScan has either put $100 of tracked
// cash in your pocket OR run 150 scans — whichever lands first. After that,
// NEW scans need Pro. Your ledger, your numbers, and your past results stay
// free forever. Never ransom someone's own data.
//
// Why two triggers: the ledger is self-reported, and the lie that benefits a
// user is silence (scan forever, never log a sale). The scan counter is the
// honor-system backstop — it catches the heavy-scanner-who-never-logs without
// surveilling anyone. It lives on-device like everything else; a reinstall
// resets it, and we accept that: anyone motivated enough to reinstall monthly
// was never going to pay, and scans only cost us pennies.
const PRO_TRIGGER = 100;
const SCAN_TRIGGER = 150;
const SCANS_KEY = "cashscan:scanCount";
// Display strings only — the REAL prices live in Stripe (see README).
// If you change them in Stripe, change them here too.
const PRICE_MONTHLY_LABEL = "$3.99 / month";
const PRICE_ANNUAL_LABEL = "$24 / year";

function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 bg-[#1a1a1a] text-white">
      <div className="flex items-center gap-2 min-w-0">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
            <ChevronLeft size={22} />
          </button>
        )}
        <span className="display-font text-lg tracking-wide truncate">{title}</span>
      </div>
      {right}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("scan");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const [guideText, setGuideText] = useState<string | null>(null);
  const [guideTruncated, setGuideTruncated] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);

  const [listing, setListing] = useState<Listing | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [listingLoading, setListingLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [saleModal, setSaleModal] = useState(false);
  const [salePrice, setSalePrice] = useState("");

  const [scanCount, setScanCount] = useState(0);
  const [proState, setProState] = useState<ProState | null>(null);
  const [proBusy, setProBusy] = useState<"" | "monthly" | "annual" | "check" | "restore" | "portal">("");
  const [proNotice, setProNotice] = useState<string | null>(null);
  const [proError, setProError] = useState<string | null>(null);
  const [restoreEmail, setRestoreEmail] = useState("");

  useEffect(() => {
    loadLedger().then(setLedger);
    refreshEntitlement().then(setProState);
    getItem(SCANS_KEY).then((v) => setScanCount(v ? parseInt(v, 10) || 0 : 0));
  }, []);

  const totalProfit = ledger.reduce((s, l) => s + l.profit, 0);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekProfit = ledger.filter((l) => l.date > weekAgo).reduce((s, l) => s + l.profit, 0);
  const categoryTotals = ledger.reduce<Record<string, number>>((acc, l) => {
    acc[l.category] = (acc[l.category] || 0) + l.profit;
    return acc;
  }, {});
  const bestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  const isPro = !!proState?.pro;
  // Gate NEW scans only, once either trigger lands. When both have landed,
  // the profit story wins the copy — it's the flattering one.
  const profitGate = totalProfit >= PRO_TRIGGER;
  const scanGate = scanCount >= SCAN_TRIGGER;
  const proGateActive = (profitGate || scanGate) && !isPro;
  const gateReason: "profit" | "scans" | null = !proGateActive ? null : profitGate ? "profit" : "scans";

  // People type "$40" when the placeholder is "$" — strip it instead of
  // silently doing nothing (the old behavior looked like a dead button).
  const cleanedPrice = salePrice.replace(/[^0-9.]/g, "");
  const parsedPrice = parseFloat(cleanedPrice);
  const priceValid = cleanedPrice !== "" && Number.isFinite(parsedPrice) && parsedPrice >= 0;

  const resetScan = useCallback(() => {
    setPhoto(null);
    setResult(null);
    setScanError(null);
    setGuideText(null);
    setGuideTruncated(false);
    setGuideError(null);
    setListing(null);
    setListingError(null);
    setScreen("scan");
  }, []);

  // ---- Android hardware back button (Capacitor) ----
  // Without this, hardware back exits the app from ANY screen, dumping the
  // scan (and costing another upload + API call to get it back). Map it to
  // the same in-app navigation the on-screen back arrows use.
  const screenRef = useRef<Screen>("scan");
  const saleModalRef = useRef(false);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    saleModalRef.current = saleModal;
  }, [saleModal]);
  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let unmounted = false;
    CapApp.addListener("backButton", () => {
      if (saleModalRef.current) {
        setSaleModal(false);
        return;
      }
      const s = screenRef.current;
      if (s === "guide" || s === "listing") setScreen("result");
      else if (s === "tracker" || s === "pro") setScreen("scan");
      else if (s === "result") resetScan();
      else CapApp.exitApp();
    }).then((h) => {
      if (unmounted) h.remove();
      else handle = h;
    });
    return () => {
      unmounted = true;
      handle?.remove();
    };
  }, [resetScan]);

  // Re-check Pro when the app comes back to the foreground — this is how the
  // unlock lands after the user finishes Stripe Checkout in the browser tab.
  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let unmounted = false;
    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      // Force a network check if they're sitting on the Pro screen (they
      // probably just paid); otherwise the 6h cache is fine.
      refreshEntitlement({ force: screenRef.current === "pro" }).then(setProState);
    }).then((h) => {
      if (unmounted) h.remove();
      else handle = h;
    });
    return () => {
      unmounted = true;
      handle?.remove();
    };
  }, []);

  // ---- Scan flow ----
  const runScan = async (p: CapturedPhoto) => {
    setPhoto(p);
    setScanError(null);
    setScanning(true);
    try {
      const parsed = await identifyItem(p.base64, p.mediaType);
      if (parsed.item === "unclear") {
        setScanError(parsed.reason || "Couldn't get a clear read. Try one more angle, closer up.");
      } else {
        // Count only scans that delivered a usable verdict — failed reads and
        // network errors never count against the 150 free scans.
        const n = scanCount + 1;
        setScanCount(n);
        setItem(SCANS_KEY, String(n));
        setResult(parsed);
        setScreen("result");
      }
    } catch (err) {
      // Messages from lib/claude.ts are already written for the user.
      setScanError(err instanceof Error ? err.message : "Scan failed. Tap Try Again.");
    } finally {
      setScanning(false);
    }
  };

  const onTakePhoto = async () => {
    if (proGateActive) {
      setScreen("pro");
      return;
    }
    try {
      const p = await takePhoto();
      await runScan(p);
    } catch (err) {
      if (isCancel(err)) return; // backing out of the camera isn't an error
      setScanError(err instanceof Error ? err.message : "Camera failed. Try again.");
    }
  };

  const onPickPhoto = async () => {
    if (proGateActive) {
      setScreen("pro");
      return;
    }
    try {
      const p = await pickPhoto();
      await runScan(p);
    } catch (err) {
      if (isCancel(err)) return;
      setScanError(err instanceof Error ? err.message : "Couldn't open photos. Try again.");
    }
  };

  // Retry re-sends the photo we already have — a retake costs the user data
  // and time; a retry costs nothing.
  const retryScan = () => {
    if (photo) runScan(photo);
  };

  // ---- Guide flow (repair / part-out / repurpose / scrap) ----
  const runGuide = useCallback(async () => {
    if (!result) return;
    setGuideLoading(true);
    setGuideError(null);
    setGuideTruncated(false);
    setScreen("guide");
    try {
      const reply = await getGuide(result);
      setGuideText(reply.text);
      setGuideTruncated(reply.truncated);
    } catch (err) {
      setGuideText(null);
      setGuideError(err instanceof Error ? err.message : "Couldn't load the guide. Try again.");
    } finally {
      setGuideLoading(false);
    }
  }, [result]);

  // ---- Listing flow ----
  const runListing = useCallback(async () => {
    if (!result) return;
    setListingLoading(true);
    setListingError(null);
    setScreen("listing");
    try {
      setListing(await getListing(result));
    } catch (err) {
      setListing(null);
      setListingError(err instanceof Error ? err.message : "Couldn't build the listing. Try again.");
    } finally {
      setListingLoading(false);
    }
  }, [result]);

  const copyListing = () => {
    if (!listing) return;
    const text = `${listing.title}\n\n${listing.description}\n\n$${listing.price}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // ---- Sale tracking ----
  const confirmSale = async () => {
    if (!priceValid || !result) return;
    const entry: LedgerEntry = {
      id: `${Date.now()}`,
      item: result.item,
      category: result.category,
      profit: parsedPrice,
      date: Date.now(),
    };
    const next = [...ledger, entry];
    setLedger(next);
    await saveLedger(next);
    setSaleModal(false);
    setSalePrice("");
    setScreen("tracker");
  };

  const deleteEntry = async (id: string) => {
    const next = ledger.filter((l) => l.id !== id);
    setLedger(next);
    setPendingDelete(null);
    await saveLedger(next);
  };

  // ---- Pro (Stripe) ----
  const buyPlan = async (plan: "monthly" | "annual") => {
    setProBusy(plan);
    setProError(null);
    setProNotice(null);
    try {
      await startCheckout(plan); // opens Stripe Checkout in a browser tab
      setProNotice('Finish up in the browser tab, then come back and tap "I finished paying — check now."');
    } catch (err) {
      setProError(err instanceof Error ? err.message : "Couldn't start checkout. Try again.");
    } finally {
      setProBusy("");
    }
  };

  const checkPayment = async () => {
    setProBusy("check");
    setProError(null);
    try {
      const s = await refreshEntitlement({ force: true });
      setProState(s);
      if (s.pro) {
        setProNotice(null);
      } else {
        setProNotice("Not showing yet — fresh payments can take up to a minute to register. Give it a moment and tap again.");
      }
    } catch (err) {
      setProError(err instanceof Error ? err.message : "Couldn't check. Try again.");
    } finally {
      setProBusy("");
    }
  };

  const doRestore = async () => {
    setProBusy("restore");
    setProError(null);
    setProNotice(null);
    try {
      const r = await restoreByEmail(restoreEmail.trim());
      if (r.pro) {
        // Restore verified the subscription directly — no need to wait for
        // Stripe's search index to catch up.
        setProState({ pro: true, checkedAt: Date.now(), source: "network" });
        setRestoreEmail("");
      } else {
        setProError(r.message || "No active Pro found for that email.");
      }
    } catch (err) {
      setProError(err instanceof Error ? err.message : "Couldn't restore. Try again.");
    } finally {
      setProBusy("");
    }
  };

  const managePlan = async () => {
    setProBusy("portal");
    setProError(null);
    try {
      await openPortal();
    } catch (err) {
      setProError(err instanceof Error ? err.message : "Couldn't open subscription settings. Try again.");
    } finally {
      setProBusy("");
    }
  };

  const move = result ? MOVES[result.move] || MOVES.scrap : null;

  const bigButtonAction = () => {
    if (!result) return;
    if (result.move === "avoid") resetScan();
    else runGuide(); // every other move has a real guide now — scrap included
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#f2ede3] text-[#1a1a1a] overflow-hidden">
      {/* SCAN */}
      {screen === "scan" && (
        <>
          <TopBar
            title="CashScan"
            right={
              <button onClick={() => setScreen("tracker")} className="p-1" aria-label="Your numbers">
                <TrendingUp size={22} />
              </button>
            }
          />
          <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
            {photo && !result && (
              <img src={photo.previewUrl} alt="scanned item" className="w-48 h-48 object-cover rounded-lg border-4 border-[#1a1a1a]" />
            )}
            {!photo && (
              <>
                <CameraIcon size={56} strokeWidth={1.5} />
                <div className="text-center sans-font text-[#4a4a4a] max-w-xs">
                  Scan a piece of junk. We'll tell you what it's worth and what to do next.
                </div>
              </>
            )}
            {scanError && (
              <div className="w-full max-w-sm bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-4 text-sm sans-font flex gap-2">
                <AlertTriangle size={18} className="flex-shrink-0 text-[#b0332b]" />
                <span>{scanError}</span>
              </div>
            )}
            {scanning && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={40} className="animate-spin" color="#b06f00" />
                <div className="sans-font text-[#4a4a4a]">Reading it...</div>
              </div>
            )}
            {!scanning && photo && scanError && (
              <div className="w-full max-w-sm flex flex-col gap-3">
                <button
                  onClick={retryScan}
                  className="w-full py-5 rounded-xl huge-font text-xl tracking-wide flex items-center justify-center gap-3"
                  style={{ background: "#1a1a1a", color: "#f2ede3" }}
                >
                  <RefreshCw size={20} /> TRY AGAIN
                </button>
                <button
                  onClick={resetScan}
                  className="w-full py-3 rounded-xl sans-font font-semibold border-2 border-[#1a1a1a]"
                >
                  Scan a different item
                </button>
              </div>
            )}
            {!scanning && !(photo && scanError) && (
              <div className="w-full max-w-sm flex flex-col gap-3">
                <button
                  onClick={onTakePhoto}
                  className="w-full py-5 rounded-xl huge-font text-xl tracking-wide"
                  style={{ background: "#1a1a1a", color: "#f2ede3" }}
                >
                  SCAN IT
                </button>
                <button
                  onClick={onPickPhoto}
                  className="w-full py-3 rounded-xl sans-font font-semibold border-2 border-[#1a1a1a] flex items-center justify-center gap-2"
                >
                  <ImageIcon size={16} /> Choose from gallery
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* RESULT */}
      {screen === "result" && result && move && (
        <>
          <TopBar title="Result" onBack={resetScan} />
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {photo && (
                <img src={photo.previewUrl} alt={result.item} className="w-16 h-16 object-cover rounded-lg border-2 border-[#1a1a1a] flex-shrink-0" />
              )}
              <div className="display-font text-2xl leading-tight">{result.item}</div>
            </div>

            <div className="sans-font text-sm text-[#4a4a4a]">
              ${result.valueRepairedLow}–${result.valueRepairedHigh} fixed &nbsp;·&nbsp; ${result.valueScrapLow}–${result.valueScrapHigh} scrap
            </div>

            <button
              className="w-full rounded-xl py-6 flex flex-col items-center gap-1 shadow-sm"
              style={{ background: move.color }}
              onClick={bigButtonAction}
            >
              <span className="huge-font text-2xl text-white tracking-wide">{move.label}</span>
              <span className="sans-font text-sm text-white/95">
                {result.move === "scrap" || result.move === "avoid"
                  ? result.reason
                  : `Est. profit: $${result.profitLow}–$${result.profitHigh}`}
              </span>
              <span className="sans-font text-xs text-white/80 mt-0.5">
                {result.move === "avoid" ? "Tap to scan the next one" : "Tap for the how-to"}
              </span>
            </button>

            {result.safetyWarning && (
              <div className="bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-3 text-sm sans-font flex gap-2">
                <AlertTriangle size={18} className="flex-shrink-0 text-[#b0332b]" />
                <span>{result.safetyWarning}</span>
              </div>
            )}

            <div className="sans-font text-sm text-[#4a4a4a]">
              {result.difficulty.charAt(0).toUpperCase() + result.difficulty.slice(1)} · {result.timeEstimate}
            </div>

            <div className="flex gap-3 mt-2">
              {result.move !== "avoid" && (
                <button
                  onClick={runGuide}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg border-2 border-[#1a1a1a] sans-font font-semibold"
                >
                  <Wrench size={16} /> Show me how
                </button>
              )}
              {(result.move === "repair" || result.move === "part_out") && (
                <button
                  onClick={runListing}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-lg sans-font font-semibold text-white"
                  style={{ background: "#1a1a1a" }}
                >
                  <Tag size={16} /> List it
                </button>
              )}
            </div>

            {/* Scrap sales are cash too — the ledger used to be unreachable
                unless the move produced a listing. Now every sellable outcome
                can be tracked, including a scrapyard payout. */}
            {result.move !== "avoid" && (
              <button
                onClick={() => setSaleModal(true)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg border-2 sans-font font-semibold"
                style={{ borderColor: "#24702f", color: "#24702f" }}
              >
                <DollarSign size={16} /> Sold it? Track the cash
              </button>
            )}

            <button onClick={resetScan} className="mt-2 text-center text-sm sans-font text-[#4a4a4a] underline">
              Scan another item
            </button>
          </div>
        </>
      )}

      {/* GUIDE (repair / part-out / repurpose / scrap) */}
      {screen === "guide" && (
        <>
          <TopBar title={(result && GUIDE_TITLES[result.move]) || "Guide"} onBack={() => setScreen("result")} />
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {guideLoading ? (
              <div className="flex flex-col items-center gap-3 mt-12">
                <Loader2 size={32} className="animate-spin" color="#b06f00" />
                <div className="sans-font text-[#4a4a4a]">Working out the plan...</div>
              </div>
            ) : guideError ? (
              <div className="flex flex-col gap-4 mt-8 items-center">
                <div className="w-full bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-4 text-sm sans-font flex gap-2">
                  <AlertTriangle size={18} className="flex-shrink-0 text-[#b0332b]" />
                  <span>{guideError}</span>
                </div>
                <button
                  onClick={runGuide}
                  className="flex items-center gap-2 py-3 px-6 rounded-lg sans-font font-semibold text-white"
                  style={{ background: "#1a1a1a" }}
                >
                  <RefreshCw size={16} /> Try again
                </button>
              </div>
            ) : (
              <>
                <div className="sans-font text-[15px] leading-relaxed whitespace-pre-wrap">{guideText}</div>
                {guideTruncated && (
                  <div className="mt-4 bg-[#fff7e0] border-2 border-[#b06f00] rounded-lg p-3 text-sm sans-font flex flex-col gap-2">
                    <div className="flex gap-2">
                      <AlertTriangle size={18} className="flex-shrink-0 text-[#b06f00]" />
                      <span>
                        This guide got cut off — the last step may be incomplete. Don't start work
                        based on a half step.
                      </span>
                    </div>
                    <button
                      onClick={runGuide}
                      className="self-start flex items-center gap-2 py-2 px-4 rounded-lg sans-font font-semibold text-white text-sm"
                      style={{ background: "#b06f00" }}
                    >
                      <RefreshCw size={14} /> Reload the full guide
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* LISTING */}
      {screen === "listing" && (
        <>
          <TopBar title="List It" onBack={() => setScreen("result")} />
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {listingLoading ? (
              <div className="flex flex-col items-center gap-3 mt-12">
                <Loader2 size={32} className="animate-spin" color="#b06f00" />
                <div className="sans-font text-[#4a4a4a]">Writing the listing...</div>
              </div>
            ) : listing ? (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs sans-font text-[#4a4a4a] uppercase tracking-wide">Title</label>
                  <input
                    value={listing.title}
                    onChange={(e) => setListing({ ...listing, title: e.target.value })}
                    className="w-full mt-1 bg-white border-2 border-[#1a1a1a] rounded-lg px-3 py-2.5 sans-font font-semibold"
                  />
                </div>
                <div>
                  <label className="text-xs sans-font text-[#4a4a4a] uppercase tracking-wide">Description</label>
                  <textarea
                    value={listing.description}
                    onChange={(e) => setListing({ ...listing, description: e.target.value })}
                    rows={4}
                    className="w-full mt-1 bg-white border-2 border-[#1a1a1a] rounded-lg px-3 py-2.5 sans-font resize-none"
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs sans-font text-[#4a4a4a] uppercase tracking-wide">Price</label>
                    <input
                      value={String(listing.price)}
                      onChange={(e) => setListing({ ...listing, price: e.target.value })}
                      className="w-full mt-1 bg-white border-2 border-[#1a1a1a] rounded-lg px-3 py-2.5 sans-font font-semibold"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs sans-font text-[#4a4a4a] uppercase tracking-wide">Platform</label>
                    <div className="mt-1 bg-[#e8e2d3] rounded-lg px-3 py-2.5 sans-font">{listing.platform}</div>
                  </div>
                </div>
                {listing.photoTips && <div className="text-sm sans-font text-[#4a4a4a] italic">Photo tip: {listing.photoTips}</div>}
                {listing.safetyDisclaimer && (
                  <div className="bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-3 text-sm sans-font">{listing.safetyDisclaimer}</div>
                )}
                <button
                  onClick={copyListing}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-lg border-2 border-[#1a1a1a] sans-font font-semibold"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy listing"}
                </button>
                <button
                  onClick={() => setSaleModal(true)}
                  className="py-3.5 rounded-lg sans-font font-semibold text-white"
                  style={{ background: "#24702f" }}
                >
                  Mark as sold
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 mt-8 items-center">
                <div className="w-full bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-4 text-sm sans-font flex gap-2">
                  <AlertTriangle size={18} className="flex-shrink-0 text-[#b0332b]" />
                  <span>{listingError || "Couldn't build the listing."}</span>
                </div>
                <button
                  onClick={runListing}
                  className="flex items-center gap-2 py-3 px-6 rounded-lg sans-font font-semibold text-white"
                  style={{ background: "#1a1a1a" }}
                >
                  <RefreshCw size={16} /> Try again
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* PROFIT TRACKER */}
      {screen === "tracker" && (
        <>
          <TopBar title="Your Numbers" onBack={() => setScreen("scan")} />
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
            <div className="text-center py-6 bg-white rounded-xl border-2 border-[#1a1a1a]">
              <div className="huge-font text-4xl">${totalProfit.toFixed(0)}</div>
              <div className="sans-font text-sm text-[#4a4a4a] mt-1">total tracked cash</div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 text-center py-4 bg-white rounded-xl border-2 border-[#1a1a1a]">
                <div className="display-font text-xl">${weekProfit.toFixed(0)}</div>
                <div className="text-xs sans-font text-[#4a4a4a]">this week</div>
              </div>
              <div className="flex-1 text-center py-4 bg-white rounded-xl border-2 border-[#1a1a1a]">
                <div className="display-font text-lg truncate px-1">{bestCategory ? bestCategory[0] : "—"}</div>
                <div className="text-xs sans-font text-[#4a4a4a]">best category</div>
              </div>
            </div>

            {isPro ? (
              <div className="bg-[#1a1a1a] text-white rounded-xl p-4 sans-font">
                <div className="flex items-center gap-2 font-semibold">
                  <Zap size={16} color="#f2c94c" /> CashScan Pro — active
                </div>
                <div className="text-sm text-white/80 mt-1">
                  Unlimited scans. Thanks for keeping this tool alive.
                </div>
                <button
                  onClick={managePlan}
                  disabled={proBusy === "portal"}
                  className="mt-3 flex items-center gap-2 text-sm font-semibold underline text-white/90 disabled:opacity-50"
                >
                  <Settings size={14} /> {proBusy === "portal" ? "Opening…" : "Manage / cancel subscription"}
                </button>
              </div>
            ) : proGateActive ? (
              <div className="bg-[#1a1a1a] text-white rounded-xl p-4 sans-font">
                <div className="font-semibold mb-1">
                  {gateReason === "profit"
                    ? `You've cleared $${totalProfit.toFixed(0)} in tracked cash. 🎉`
                    : `You've put ${SCAN_TRIGGER} scans to work.`}
                </div>
                <div className="text-sm text-white/80">
                  {gateReason === "profit"
                    ? "CashScan stays free until it earns you $100 — and it has. Pro keeps the scans coming. Your ledger stays free forever either way."
                    : `The free deal is $100 tracked or ${SCAN_TRIGGER} scans, whichever comes first. Pro keeps the scans coming — your ledger and past results stay free forever either way.`}
                </div>
                <button
                  onClick={() => setScreen("pro")}
                  className="mt-3 w-full py-2.5 rounded-lg huge-font text-sm tracking-wide"
                  style={{ background: "#f2c94c", color: "#1a1a1a" }}
                >
                  SEE PRO
                </button>
              </div>
            ) : scanCount >= Math.floor(SCAN_TRIGGER / 2) ? (
              <div className="bg-white rounded-xl border border-[#d8d2c3] p-3.5 sans-font text-sm text-[#4a4a4a]">
                Free scans used: <b className="text-[#1a1a1a]">{scanCount} of {SCAN_TRIGGER}</b>. The
                deal: free until $100 tracked cash or {SCAN_TRIGGER} scans — whichever lands first.
              </div>
            ) : null}

            <div className="sans-font">
              <div className="text-xs uppercase tracking-wide text-[#4a4a4a] mb-2">Recent sales</div>
              {ledger.length === 0 ? (
                <div className="text-sm text-[#8a8275]">Nothing tracked yet. Sell your first item to start your numbers.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...ledger].reverse().map((l) =>
                    pendingDelete === l.id ? (
                      <div key={l.id} className="flex items-center justify-between bg-[#fdecea] border border-[#b0332b] rounded-lg px-3 py-2.5 gap-2">
                        <span className="text-sm">Remove "{l.item}"?</span>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => deleteEntry(l.id)}
                            className="text-sm font-semibold text-white rounded px-3 py-1.5"
                            style={{ background: "#b0332b" }}
                          >
                            Remove
                          </button>
                          <button
                            onClick={() => setPendingDelete(null)}
                            className="text-sm font-semibold rounded px-3 py-1.5 border border-[#1a1a1a]"
                          >
                            Keep
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={l.id} className="flex items-center justify-between bg-white rounded-lg border border-[#d8d2c3] px-3 py-2.5 gap-2">
                        <span className="truncate">{l.item}</span>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="font-semibold">${l.profit.toFixed(0)}</span>
                          {/* Fat-fingered $4000 instead of $40 shouldn't corrupt
                              your numbers forever. */}
                          <button
                            onClick={() => setPendingDelete(l.id)}
                            className="p-1 text-[#8a8275]"
                            aria-label={`Remove ${l.item}`}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => setScreen("scan")}
              className="py-3.5 rounded-lg huge-font text-lg text-white"
              style={{ background: "#1a1a1a" }}
            >
              SCAN ANOTHER
            </button>
          </div>
        </>
      )}

      {/* PRO */}
      {screen === "pro" && (
        <>
          <TopBar title="CashScan Pro" onBack={() => setScreen("scan")} />
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
            {isPro ? (
              <div className="flex flex-col items-center text-center gap-3 mt-8">
                <Zap size={48} color="#b06f00" />
                <div className="display-font text-2xl">You're Pro. ⚡</div>
                <div className="sans-font text-sm text-[#4a4a4a] max-w-xs">
                  Unlimited scans — and your few bucks keep this tool alive for the next person
                  digging their way out. Thank you.
                </div>
                <button
                  onClick={() => setScreen("scan")}
                  className="w-full max-w-xs py-4 mt-2 rounded-xl huge-font text-lg tracking-wide"
                  style={{ background: "#1a1a1a", color: "#f2ede3" }}
                >
                  SCAN SOMETHING
                </button>
                <button
                  onClick={managePlan}
                  disabled={proBusy === "portal"}
                  className="flex items-center gap-2 py-3 px-5 rounded-lg border-2 border-[#1a1a1a] sans-font font-semibold text-sm disabled:opacity-50"
                >
                  <Settings size={15} /> {proBusy === "portal" ? "Opening…" : "Manage / cancel subscription"}
                </button>
                {proError && (
                  <div className="w-full bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-3 text-sm sans-font">{proError}</div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Zap size={32} color="#b06f00" className="flex-shrink-0" />
                  <div className="display-font text-2xl leading-tight">
                    {gateReason === "scans"
                      ? `${SCAN_TRIGGER} scans on the house.`
                      : `This app made you $${totalProfit.toFixed(0)}.`}
                  </div>
                </div>
                <div className="sans-font text-[15px] text-[#4a4a4a]">
                  {gateReason === "scans"
                    ? `The deal: CashScan is free until it's either made you $100 in tracked cash or run ${SCAN_TRIGGER} scans — whichever lands first. You hit the scans. Every scan costs us real money to run, so Pro keeps them coming — for less than one cup of gas-station coffee a week.`
                    : "CashScan stays free until it's put $100 in your pocket. You're past that. Pro keeps the scans coming — for less than one cup of gas-station coffee a week."}
                </div>

                <div className="bg-white rounded-xl border-2 border-[#1a1a1a] p-4 sans-font text-sm">
                  <div className="font-semibold mb-2">Free forever, Pro or not:</div>
                  <ul className="flex flex-col gap-1 text-[#4a4a4a] list-disc pl-5">
                    <li>Your numbers and your sales ledger</li>
                    <li>Every result you've already scanned</li>
                    <li>Canceling — two taps, no phone calls</li>
                  </ul>
                </div>

                <button
                  onClick={() => buyPlan("monthly")}
                  disabled={proBusy !== ""}
                  className="w-full py-4 rounded-xl huge-font text-lg tracking-wide flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: "#1a1a1a", color: "#f2ede3" }}
                >
                  {proBusy === "monthly" ? <Loader2 size={20} className="animate-spin" /> : null}
                  {PRICE_MONTHLY_LABEL}
                </button>
                <button
                  onClick={() => buyPlan("annual")}
                  disabled={proBusy !== ""}
                  className="w-full py-4 rounded-xl huge-font text-lg tracking-wide flex items-center justify-center gap-2 text-white disabled:opacity-60"
                  style={{ background: "#24702f" }}
                >
                  {proBusy === "annual" ? <Loader2 size={20} className="animate-spin" /> : null}
                  {PRICE_ANNUAL_LABEL} <span className="sans-font text-sm font-semibold">— save 50%</span>
                </button>

                {proNotice && (
                  <div className="bg-[#fff7e0] border-2 border-[#b06f00] rounded-lg p-3 text-sm sans-font">{proNotice}</div>
                )}
                {proError && (
                  <div className="bg-[#fdecea] border-2 border-[#b0332b] rounded-lg p-3 text-sm sans-font">{proError}</div>
                )}

                <button
                  onClick={checkPayment}
                  disabled={proBusy !== ""}
                  className="w-full py-3.5 rounded-lg border-2 border-[#1a1a1a] sans-font font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {proBusy === "check" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  I finished paying — check now
                </button>

                <div className="mt-2 pt-4 border-t border-[#d8d2c3] sans-font">
                  <div className="text-sm font-semibold mb-1">Already Pro on another phone?</div>
                  <div className="text-sm text-[#4a4a4a] mb-2">
                    Enter the email from your receipt and we'll move it over.
                  </div>
                  <input
                    value={restoreEmail}
                    onChange={(e) => setRestoreEmail(e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                    autoCapitalize="none"
                    className="w-full bg-white border-2 border-[#1a1a1a] rounded-lg px-3 py-2.5 sans-font mb-2"
                  />
                  <button
                    onClick={doRestore}
                    disabled={proBusy !== "" || restoreEmail.trim() === ""}
                    className="w-full py-3 rounded-lg sans-font font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ background: "#275f8f" }}
                  >
                    {proBusy === "restore" ? <Loader2 size={16} className="animate-spin" /> : null}
                    Restore my Pro
                  </button>
                </div>

                <div className="text-xs sans-font text-[#8a8275] text-center mt-1">
                  Payments run through Stripe in your browser — card details never touch this app.
                  Cancel anytime. Your ledger lives on your phone and stays yours.
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* SALE MODAL */}
      {saleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50" onClick={() => setSaleModal(false)}>
          <div className="w-full bg-[#f2ede3] rounded-t-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="display-font text-xl mb-3">What'd it sell for?</div>
            <input
              autoFocus
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              placeholder="40"
              inputMode="decimal"
              className="w-full bg-white border-2 border-[#1a1a1a] rounded-lg px-3 py-3 text-lg sans-font mb-2"
            />
            {salePrice.trim() !== "" && !priceValid && (
              <div className="text-sm sans-font text-[#b0332b] mb-2">
                Just the number — like 40 or 12.50
              </div>
            )}
            <button
              onClick={confirmSale}
              disabled={!priceValid}
              className="w-full py-3.5 rounded-lg text-white font-semibold sans-font disabled:opacity-40"
              style={{ background: "#24702f" }}
            >
              Save it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
