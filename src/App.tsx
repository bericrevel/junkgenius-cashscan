import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera as CameraIcon,
  Loader2,
  Wrench,
  Check,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  RefreshCw,
  X,
  Home as HomeIcon,
  Boxes,
  ScanLine,
  DollarSign,
  Weight,
  Plus,
  Zap,
  Settings,
  Sparkles,
} from "lucide-react";
import { App as CapApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { getItem, setItem } from "./lib/storage";
import { takePhoto, pickPhoto, isCancel, CapturedPhoto } from "./lib/camera";
import { identifyItems, getGuide, ScoutResult } from "./lib/scout";
import {
  InventoryItem,
  loadInventory,
  saveInventory,
  fromScan,
  estimatedValue,
  realizedCash,
} from "./lib/inventory";
import {
  ProState,
  refreshEntitlement,
  loadAiCount,
  bumpAiCount,
  startCheckout,
  restoreByEmail,
  openPortal,
} from "./lib/pro";

// ---- Move styling — chrome/emerald identity ----
const MOVES: Record<string, { label: string; sub: string }> = {
  resell: { label: "RESELL IT", sub: "Worth more whole than as metal" },
  scrap: { label: "SCRAP IT", sub: "Fastest cash — take it to the yard" },
  part_out: { label: "PART IT OUT", sub: "The pieces beat the whole" },
  skip: { label: "SKIP IT", sub: "Not worth your time" },
};

const ONBOARD_KEY = "junkgenius:onboarded";
// Fair gate (unchanged philosophy): free until either trigger lands.
const CASH_TRIGGER = 100;
const AI_TRIGGER = 150;
const PRICE_MONTHLY_LABEL = "$3.99 / month";
const PRICE_ANNUAL_LABEL = "$24 / year";

type Screen = "onboarding" | "home" | "scan" | "verdict" | "guide" | "inventory" | "pro";

function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/[.06] relative z-10">
      {onBack && (
        <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
          <ChevronLeft size={22} className="text-mist" />
        </button>
      )}
      <span className="font-disp font-bold text-lg text-white truncate">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <div className="bezel rounded-xl flex-shrink-0" style={{ width: size, height: size }}>
      <div className="bezel-face green">
        <Sparkles size={size * 0.46} />
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [checkingOnboard, setCheckingOnboard] = useState(true);

  // ---- Scan / multi-item verdict ----
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [results, setResults] = useState<ScoutResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());

  const [guideText, setGuideText] = useState<string | null>(null);
  const [guideTruncated, setGuideTruncated] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);

  // ---- Inventory ----
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [cashModal, setCashModal] = useState<{ id: string; as: "sold" | "scrapped" } | null>(null);
  const [cashPrice, setCashPrice] = useState("");

  // ---- Pro gate ----
  const [proState, setProState] = useState<ProState | null>(null);
  const [aiCount, setAiCount] = useState(0);
  const [proBusy, setProBusy] = useState<"" | "monthly" | "annual" | "check" | "restore" | "portal">("");
  const [proNotice, setProNotice] = useState<string | null>(null);
  const [proError, setProError] = useState<string | null>(null);
  const [restoreEmail, setRestoreEmail] = useState("");

  useEffect(() => {
    getItem(ONBOARD_KEY).then((v) => {
      if (!v) setScreen("onboarding");
      setCheckingOnboard(false);
    });
    loadInventory().then(setInventory);
    refreshEntitlement().then(setProState);
    loadAiCount().then(setAiCount);
  }, []);

  const screenRef = useRef<Screen>("home");
  const cashModalRef = useRef(false);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    cashModalRef.current = cashModal !== null;
  }, [cashModal]);

  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let unmounted = false;
    CapApp.addListener("backButton", () => {
      if (cashModalRef.current) {
        setCashModal(null);
        return;
      }
      const s = screenRef.current;
      if (s === "guide") setScreen("verdict");
      else if (s === "verdict") resetScan();
      else if (s === "home") CapApp.exitApp();
      else setScreen("home");
    }).then((h) => {
      if (unmounted) h.remove();
      else handle = h;
    });
    return () => {
      unmounted = true;
      handle?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let handle: PluginListenerHandle | undefined;
    let unmounted = false;
    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
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

  const est = estimatedValue(inventory);
  const cash = realizedCash(inventory);
  const onHand = inventory.filter((i) => i.status === "have");

  const isPro = !!proState?.pro;
  const cashGate = cash >= CASH_TRIGGER;
  const actionsGate = aiCount >= AI_TRIGGER;
  const proGateActive = (cashGate || actionsGate) && !isPro;
  const gateReason: "cash" | "actions" | null = !proGateActive ? null : cashGate ? "cash" : "actions";

  const onAiAction = () => setAiCount((prev) => { bumpAiCount(prev); return prev + 1; });

  const resetScan = useCallback(() => {
    setPhoto(null);
    setResults([]);
    setActiveIndex(0);
    setSavedIdx(new Set());
    setScanError(null);
    setGuideText(null);
    setGuideTruncated(false);
    setGuideError(null);
    setScreen("scan");
  }, []);

  const finishOnboarding = async () => {
    await setItem(ONBOARD_KEY, "1");
    setScreen("home");
  };

  // ---- Scan flow ----
  const runScan = async (p: CapturedPhoto) => {
    setPhoto(p);
    setScanError(null);
    setScanning(true);
    try {
      const items = await identifyItems(p.base64, p.mediaType);
      if (items.length === 0) {
        setScanError("Couldn't find anything to price in that photo. Try again with better light, closer up.");
      } else {
        onAiAction(); // one successful scan action, regardless of item count
        setResults(items);
        setActiveIndex(0);
        setSavedIdx(new Set());
        setScreen("verdict");
      }
    } catch (err) {
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
      if (isCancel(err)) return;
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

  const retryScan = () => {
    if (photo) runScan(photo);
  };

  const result = results[activeIndex] as ScoutResult | undefined;
  const move = result ? MOVES[result.move] || MOVES.scrap : null;

  const goNextItem = () => {
    setGuideText(null);
    setGuideError(null);
    setActiveIndex((i) => Math.min(i + 1, results.length - 1));
  };
  const goPrevItem = () => {
    setGuideText(null);
    setGuideError(null);
    setActiveIndex((i) => Math.max(i - 1, 0));
  };

  // ---- Guide ----
  const runGuide = useCallback(async () => {
    if (!result) return;
    setGuideLoading(true);
    setGuideError(null);
    setGuideTruncated(false);
    setScreen("guide");
    try {
      const reply = await getGuide(result);
      onAiAction();
      setGuideText(reply.text);
      setGuideTruncated(reply.truncated);
    } catch (err) {
      setGuideText(null);
      setGuideError(err instanceof Error ? err.message : "Couldn't load the guide. Try again.");
    } finally {
      setGuideLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // ---- Inventory ----
  const addActiveToInventory = async () => {
    if (!result || savedIdx.has(activeIndex)) return;
    const next = [fromScan(result), ...inventory];
    setInventory(next);
    setSavedIdx((s) => new Set(s).add(activeIndex));
    await saveInventory(next);
  };

  const cleanedPrice = cashPrice.replace(/[^0-9.]/g, "");
  const parsedPrice = parseFloat(cleanedPrice);
  const priceValid = cleanedPrice !== "" && Number.isFinite(parsedPrice) && parsedPrice >= 0;

  const confirmCash = async () => {
    if (!cashModal || !priceValid) return;
    const next = inventory.map((i) =>
      i.id === cashModal.id ? { ...i, status: cashModal.as, cashedFor: parsedPrice, cashedAt: Date.now() } : i
    );
    setInventory(next);
    setCashModal(null);
    setCashPrice("");
    await saveInventory(next);
  };

  const deleteItem = async (id: string) => {
    const next = inventory.filter((i) => i.id !== id);
    setInventory(next);
    setPendingDelete(null);
    await saveInventory(next);
  };

  // ---- Pro actions ----
  const buyPlan = async (plan: "monthly" | "annual") => {
    setProBusy(plan);
    setProError(null);
    setProNotice(null);
    try {
      await startCheckout(plan);
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
      setProNotice(s.pro ? null : "Not showing yet — fresh payments can take a minute. Give it a moment and tap again.");
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

  const TabBar = () => (
    <div className="flex border-t border-white/[.06] bg-ink2/60 backdrop-blur relative z-10">
      {(
        [
          { id: "home", label: "Home", icon: HomeIcon, go: () => setScreen("home") },
          { id: "scan", label: "Scan", icon: ScanLine, go: resetScan },
          { id: "inventory", label: "Items", icon: Boxes, go: () => setScreen("inventory") },
          { id: "pro", label: "Pro", icon: Zap, go: () => setScreen("pro") },
        ] as const
      ).map((t) => {
        const active = screen === t.id || (t.id === "scan" && (screen === "verdict" || screen === "guide"));
        const Icon = t.icon;
        return (
          <button key={t.id} onClick={t.go} className="flex-1 flex flex-col items-center gap-1 py-2.5">
            <Icon size={19} className={active ? "text-abright" : "text-faint"} strokeWidth={active ? 2.4 : 2} />
            <span className={`font-mono text-[9.5px] tracking-widest ${active ? "text-abright" : "text-faint"}`}>
              {t.label.toUpperCase()}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (checkingOnboard) {
    return <div className="h-screen w-full bg-ink" />;
  }

  return (
    <div className="h-screen w-full flex flex-col bg-ink text-mist overflow-hidden font-sans">
      {/* ============ ONBOARDING ============ */}
      {screen === "onboarding" && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 relative">
          <div className="chromering" style={{ width: 186, height: 186 }}>
            <div className="glint" />
            <div className="core">
              <div className="core-content font-mono text-[11px] font-bold leading-tight">14K GOLD<br />RING</div>
            </div>
          </div>
          <h1 className="font-disp font-bold text-[28px] text-white mt-8 text-center leading-tight">Scan anything.</h1>
          <div className="mt-3 font-mono text-[10.5px] tracking-widest uppercase text-abright border border-abright/30 bg-abright/[.06] rounded-full px-4 py-1.5">
            Point · Identify · Get paid
          </div>
          <p className="mt-5 text-center text-[13.5px] text-faint leading-relaxed max-w-[280px]">
            Point your camera at a whole pile — electronics, appliances, jewelry, auto parts, scrap. JunkGenius finds every item, prices each one, and tells you the smartest move.
          </p>
          <div className="absolute left-6 right-6 bottom-8">
            <button onClick={finishOnboarding} className="gbtn w-full py-4 rounded-2xl font-disp font-bold text-base">
              <span>Get started</span>
            </button>
          </div>
        </div>
      )}

      {/* ============ HOME ============ */}
      {screen === "home" && (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 pt-9 pb-5 flex items-center gap-3">
              <LogoMark size={34} />
              <div>
                <div className="font-disp font-bold text-lg text-white leading-tight">
                  Junk<span className="green-text">Genius</span>
                </div>
                <div className="text-[11px] text-faint">Point. Identify. Get paid.</div>
              </div>
              {isPro && (
                <div className="ml-auto flex items-center gap-1 text-[10px] font-mono text-abright border border-abright/30 bg-abright/[.06] rounded-full px-2.5 py-1">
                  <Zap size={11} /> PRO
                </div>
              )}
            </div>

            <div className="px-6 flex flex-col gap-4 pb-6">
              <button onClick={resetScan} className="gbtn w-full py-6 rounded-2xl font-disp font-bold text-xl tracking-wide flex items-center justify-center gap-3">
                <ScanLine size={24} /> <span>SCAN SOMETHING</span>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <div className="panel p-4">
                  <div className="font-mono font-bold text-lg text-white">${est.low}–${est.high}</div>
                  <div className="text-[10.5px] text-faint mt-1">est. value on hand · {onHand.length} item{onHand.length === 1 ? "" : "s"}</div>
                </div>
                <div className="panel p-4">
                  <div className="font-mono font-bold text-lg green-text">${cash.toFixed(0)}</div>
                  <div className="text-[10.5px] text-faint mt-1">real cash collected</div>
                </div>
              </div>

              {inventory.length > 0 ? (
                <div>
                  <div className="font-mono text-[10px] tracking-widest text-faint mb-2">RECENT</div>
                  <div className="flex flex-col gap-2">
                    {inventory.slice(0, 4).map((i) => (
                      <button key={i.id} onClick={() => setScreen("inventory")} className="panel flex items-center justify-between px-4 py-3 text-left">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-medium truncate">{i.item}</div>
                          <div className="text-[11px] text-faint">{i.status === "have" ? "ON HAND" : i.status.toUpperCase()}</div>
                        </div>
                        <div className="font-mono text-sm text-mist flex-shrink-0 ml-3">
                          {i.status === "sold" || i.status === "scrapped" ? `$${(i.cashedFor || 0).toFixed(0)}` : `$${Math.max(i.scrapHigh, i.resaleHigh)}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="panel p-5 text-sm text-faint">
                  Nothing scanned yet. Point the camera at that busted thing in the yard — let's see what it's worth.
                </div>
              )}

              {isPro ? (
                <div className="panel p-4" style={{ borderColor: "rgba(16,185,129,.35)" }}>
                  <div className="flex items-center gap-2 text-sm text-white font-semibold"><Zap size={15} className="green-text" /> JunkGenius Pro — active</div>
                  <button onClick={() => setScreen("pro")} className="text-xs text-faint underline mt-1">manage subscription</button>
                </div>
              ) : proGateActive ? (
                <div className="panel p-4" style={{ borderColor: "rgba(16,185,129,.35)" }}>
                  <div className="text-sm text-white font-semibold">
                    {gateReason === "cash" ? `You've collected $${cash.toFixed(0)} with JunkGenius. 🎉` : `You've used your ${AI_TRIGGER} free AI actions.`}
                  </div>
                  <div className="text-xs text-faint mt-1">The free deal was $100 collected or {AI_TRIGGER} AI actions. Your inventory stays free forever either way.</div>
                  <button onClick={() => setScreen("pro")} className="gbtn mt-3 w-full py-2.5 rounded-xl font-disp font-bold text-sm"><span>SEE PRO</span></button>
                </div>
              ) : aiCount >= Math.floor(AI_TRIGGER / 2) ? (
                <div className="panel px-4 py-3 text-[11px] text-faint">
                  Free AI actions used: <b className="text-mist">{aiCount} of {AI_TRIGGER}</b>. Free until $100 collected or {AI_TRIGGER} actions.
                </div>
              ) : null}

              <div className="text-[11px] text-faint text-center pt-1">
                Values are AI estimates — yards and buyers set real prices. Your inventory stays on this phone.
              </div>
            </div>
          </div>
          <TabBar />
        </>
      )}

      {/* ============ SCAN ============ */}
      {screen === "scan" && (
        <>
          <TopBar title="Scan" onBack={() => setScreen("home")} />
          <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
            {photo && (
              <img src={photo.previewUrl} alt="scanned" className="w-48 h-48 object-cover rounded-2xl border-2 border-white/10" />
            )}
            {!photo && (
              <>
                <div className="bezel rounded-full" style={{ width: 88, height: 88 }}>
                  <div className="bezel-face green"><CameraIcon size={38} /></div>
                </div>
                <div className="text-center text-mist max-w-xs text-sm">
                  Electronics, appliances, auto parts, furniture, tools, or a whole pile — point at it and JunkGenius finds every item.
                </div>
              </>
            )}
            {scanError && (
              <div className="panel w-full max-w-sm p-4 text-sm flex gap-2" style={{ borderColor: "rgba(251,113,133,.3)" }}>
                <AlertTriangle size={18} className="flex-shrink-0 text-rose" />
                <span>{scanError}</span>
              </div>
            )}
            {scanning && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={40} className="animate-spin green-text" />
                <div className="font-mono text-sm tracking-widest text-faint">IDENTIFYING...</div>
              </div>
            )}
            {!scanning && photo && scanError && (
              <div className="w-full max-w-sm flex flex-col gap-3">
                <button onClick={retryScan} className="gbtn w-full py-4 rounded-2xl font-disp font-bold text-lg flex items-center justify-center gap-2">
                  <RefreshCw size={18} /> <span>TRY AGAIN</span>
                </button>
                <div className="cbtn w-full h-[52px]"><button onClick={resetScan} className="cbtn-in w-full h-full">Scan a different item</button></div>
              </div>
            )}
            {!scanning && !(photo && scanError) && (
              <div className="w-full max-w-sm flex flex-col gap-3">
                <button onClick={onTakePhoto} className="gbtn w-full py-5 rounded-2xl font-disp font-bold text-xl tracking-wide"><span>SCAN IT</span></button>
                <div className="cbtn w-full h-[52px]">
                  <button onClick={onPickPhoto} className="cbtn-in w-full h-full flex items-center justify-center gap-2">
                    <ImageIcon size={16} /> Choose from gallery
                  </button>
                </div>
              </div>
            )}
          </div>
          <TabBar />
        </>
      )}

      {/* ============ VERDICT (multi-item aware) ============ */}
      {screen === "verdict" && result && move && (
        <>
          <TopBar title="Verdict" onBack={resetScan} />
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {results.length > 1 && (
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] tracking-widest text-faint">
                  FOUND {results.length} ITEMS · SHOWING {activeIndex + 1} OF {results.length}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={goPrevItem} disabled={activeIndex === 0} className="cbtn w-8 h-8 disabled:opacity-30">
                    <div className="cbtn-in"><ChevronLeft size={15} /></div>
                  </button>
                  <button onClick={goNextItem} disabled={activeIndex === results.length - 1} className="cbtn w-8 h-8 disabled:opacity-30">
                    <div className="cbtn-in"><ChevronRight size={15} /></div>
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {photo && <img src={photo.previewUrl} alt={result.item} className="w-14 h-14 object-cover rounded-xl border border-white/10 flex-shrink-0" />}
              <div className="min-w-0">
                <div className="font-disp font-bold text-lg text-white leading-tight">{result.item}</div>
                <div className="text-[11px] text-faint mt-0.5">{result.condition || result.category}</div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 rounded-2xl p-3.5" style={{ background: "linear-gradient(180deg,rgba(170,182,184,.10),rgba(170,182,184,.02))", border: "1px solid rgba(170,182,184,.25)" }}>
                <div className="font-mono text-[9px] tracking-widest uppercase text-faint">At the yard</div>
                <div className="font-mono font-extrabold text-xl text-white mt-1.5">${result.scrapLow}–${result.scrapHigh}</div>
                {result.weightLbs > 0 && <div className="text-[10px] text-faint mt-1 flex items-center gap-1"><Weight size={10} /> ~{result.weightLbs} lbs</div>}
              </div>
              <div className="flex-1 rounded-2xl p-3.5" style={{ background: "linear-gradient(180deg,rgba(16,185,129,.14),rgba(16,185,129,.02))", border: "1px solid rgba(16,185,129,.3)" }}>
                <div className="font-mono text-[9px] tracking-widest uppercase text-faint">Resold whole</div>
                <div className="font-mono font-extrabold text-xl green-text mt-1.5">${result.resaleLow}–${result.resaleHigh}</div>
                <div className="text-[10px] text-faint mt-1">used market</div>
              </div>
            </div>

            <div className="gbtn rounded-2xl p-4 text-center">
              <div className="font-disp font-bold text-xl">{move.label}</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: "rgba(255,255,255,.8)" }}>{result.reason || move.sub}</div>
            </div>

            {result.safetyWarning && (
              <div className="rounded-xl p-3 text-sm flex gap-2" style={{ background: "rgba(251,113,133,.08)", border: "1px solid rgba(251,113,133,.28)" }}>
                <AlertTriangle size={17} className="flex-shrink-0 text-rose" />
                <span style={{ color: "#ffd3da" }}>{result.safetyWarning}</span>
              </div>
            )}

            {result.materials.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.materials.map((m, i) => (
                  <span key={i} className="font-mono text-[10px] text-mist border border-white/10 rounded-full px-3 py-1 bg-white/[.03]">
                    {m.name}{m.estLbs > 0 ? ` · ~${m.estLbs} lb` : ""}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2.5">
              <div className="cbtn flex-1 h-11"><button onClick={runGuide} className="cbtn-in w-full h-full flex items-center justify-center gap-2 text-xs"><Wrench size={14} /> Show me how</button></div>
              {savedIdx.has(activeIndex) ? (
                <div className="flex-1 rounded-2xl h-11 flex items-center justify-center gap-2 text-xs font-bold" style={{ border: "1px solid rgba(16,185,129,.4)", color: "#34D399", background: "rgba(16,185,129,.06)" }}>
                  <Check size={14} /> IN INVENTORY
                </div>
              ) : (
                <button onClick={addActiveToInventory} className="gbtn flex-1 h-11 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold">
                  <Plus size={14} /> <span>ADD TO INVENTORY</span>
                </button>
              )}
            </div>

            {results.length > 1 && activeIndex < results.length - 1 && (
              <button onClick={goNextItem} className="cbtn h-11"><div className="cbtn-in flex items-center justify-center gap-1.5 text-sm">Next item <ChevronRight size={15} /></div></button>
            )}

            <button onClick={resetScan} className="text-center text-sm text-faint underline pb-2">Scan something else</button>
            <div className="text-[11px] text-faint text-center pb-4 -mt-2">Estimates, not appraisals. Yard prices vary — call ahead.</div>
          </div>
          <TabBar />
        </>
      )}

      {/* ============ GUIDE ============ */}
      {screen === "guide" && (
        <>
          <TopBar title="Show Me How" onBack={() => setScreen("verdict")} />
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {guideLoading ? (
              <div className="flex flex-col items-center gap-3 mt-14">
                <Loader2 size={30} className="animate-spin green-text" />
                <div className="font-mono text-xs tracking-widest text-faint">WORKING OUT THE PLAN...</div>
              </div>
            ) : guideError ? (
              <div className="flex flex-col gap-4 mt-8 items-center">
                <div className="panel w-full p-4 text-sm flex gap-2" style={{ borderColor: "rgba(251,113,133,.3)" }}>
                  <AlertTriangle size={18} className="flex-shrink-0 text-rose" />
                  <span>{guideError}</span>
                </div>
                <button onClick={runGuide} className="gbtn flex items-center gap-2 py-3 px-6 rounded-xl font-bold text-sm"><RefreshCw size={16} /><span>Try again</span></button>
              </div>
            ) : (
              <>
                <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-mist">{guideText}</div>
                {guideTruncated && (
                  <div className="mt-4 rounded-xl p-3 text-sm flex flex-col gap-2" style={{ background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.3)" }}>
                    <div className="flex gap-2"><AlertTriangle size={17} className="flex-shrink-0" style={{ color: "#FBBF24" }} /><span>This guide got cut off — the last step may be incomplete. Don't start based on a half step.</span></div>
                    <button onClick={runGuide} className="self-start flex items-center gap-2 py-2 px-4 rounded-lg font-bold text-white text-xs" style={{ background: "#FBBF24", color: "#1a1a1a" }}><RefreshCw size={13} /> Reload the full guide</button>
                  </div>
                )}
              </>
            )}
          </div>
          <TabBar />
        </>
      )}

      {/* ============ INVENTORY / NUMBERS ============ */}
      {screen === "inventory" && (
        <>
          <TopBar title="Your Numbers" onBack={() => setScreen("home")} />
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div className="panel relative p-6 text-center overflow-hidden">
              <div className="cash-halo" />
              <div className="relative font-mono font-extrabold text-[42px] green-text">${cash.toFixed(0)}</div>
              <div className="relative text-xs text-faint mt-1">real cash collected</div>
            </div>
            <div className="flex gap-3">
              <div className="panel flex-1 p-3.5 text-center"><div className="font-mono font-bold text-base text-white">${est.low}–${est.high}</div><div className="text-[10px] text-faint mt-0.5">est. on hand</div></div>
              <div className="panel flex-1 p-3.5 text-center"><div className="font-mono font-bold text-base text-white">{onHand.length}</div><div className="text-[10px] text-faint mt-0.5">items on hand</div></div>
            </div>

            {inventory.length === 0 ? (
              <div className="panel p-5 text-sm text-faint">Empty so far. Scan something and tap "Add to inventory" — the pile starts here.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {inventory.map((i) =>
                  pendingDelete === i.id ? (
                    <div key={i.id} className="panel flex items-center justify-between px-4 py-3 gap-2" style={{ borderColor: "rgba(251,113,133,.35)" }}>
                      <span className="text-sm">Remove "{i.item}"?</span>
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => deleteItem(i.id)} className="text-xs font-bold rounded-lg px-3 py-1.5" style={{ background: "#FB7185", color: "#1a0a0c" }}>Remove</button>
                        <button onClick={() => setPendingDelete(null)} className="text-xs font-bold rounded-lg px-3 py-1.5 border border-white/15 text-mist">Keep</button>
                      </div>
                    </div>
                  ) : (
                    <div key={i.id} className="panel px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-medium truncate">{i.item}</div>
                          <div className="text-[11px] text-faint mt-0.5">
                            {i.status === "sold" || i.status === "scrapped" ? `${i.status.toUpperCase()} · $${(i.cashedFor || 0).toFixed(0)}` : `scrap $${i.scrapLow}–$${i.scrapHigh} · resale $${i.resaleLow}–$${i.resaleHigh}`}
                          </div>
                        </div>
                        <button onClick={() => setPendingDelete(i.id)} className="p-1 flex-shrink-0" aria-label={`Remove ${i.item}`}><X size={16} className="text-faint" /></button>
                      </div>
                      {i.status === "have" && (
                        <div className="flex gap-2 mt-2.5">
                          <button onClick={() => setCashModal({ id: i.id, as: "sold" })} className="gbtn flex-1 py-2 rounded-lg text-[11px] font-bold"><span>SOLD IT</span></button>
                          <div className="cbtn flex-1 h-8"><button onClick={() => setCashModal({ id: i.id, as: "scrapped" })} className="cbtn-in w-full h-full text-[11px]">SCRAPPED IT</button></div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
            <div className="text-[11px] text-faint text-center pb-4">Your inventory lives on this phone only. We can't see it.</div>
          </div>
          <TabBar />
        </>
      )}

      {/* ============ PRO ============ */}
      {screen === "pro" && (
        <>
          <TopBar title="JunkGenius Pro" onBack={() => setScreen("home")} />
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isPro ? (
              <div className="flex flex-col items-center text-center gap-3 mt-8">
                <div className="bezel rounded-full" style={{ width: 64, height: 64 }}><div className="bezel-face green"><Zap size={28} /></div></div>
                <div className="font-disp font-bold text-2xl text-white">You're Pro. ⚡</div>
                <div className="text-sm text-faint max-w-xs">Unlimited scans and guides — and your few bucks keep this tool alive for the next person digging out. Thank you.</div>
                <button onClick={resetScan} className="gbtn w-full max-w-xs py-4 mt-2 rounded-2xl font-disp font-bold text-lg"><span>SCAN SOMETHING</span></button>
                <div className="cbtn w-full max-w-xs h-12">
                  <button onClick={managePlan} disabled={proBusy === "portal"} className="cbtn-in w-full h-full flex items-center gap-2 text-sm font-bold disabled:opacity-50">
                    <Settings size={15} /> {proBusy === "portal" ? "Opening…" : "Manage / cancel subscription"}
                  </button>
                </div>
                {proError && <div className="panel w-full p-3 text-sm" style={{ borderColor: "rgba(251,113,133,.3)" }}>{proError}</div>}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="bezel rounded-2xl" style={{ width: 48, height: 48 }}><div className="bezel-face green"><Zap size={22} /></div></div>
                  <div className="font-disp font-bold text-xl text-white leading-tight">
                    {gateReason === "cash" ? `JunkGenius helped you collect $${cash.toFixed(0)}.` : proGateActive ? `${AI_TRIGGER} AI actions on the house.` : "Free until it's made you $100."}
                  </div>
                </div>
                <div className="text-[13.5px] text-mist">
                  The deal: free until you've collected $100 or used {AI_TRIGGER} AI actions — whichever lands first{proGateActive ? " — you're there." : "."} Pro keeps it rolling for less than a cup of gas-station coffee a week.
                </div>
                <div className="panel p-4 text-sm">
                  <div className="text-white font-semibold mb-2">Free forever, Pro or not:</div>
                  <ul className="flex flex-col gap-1 text-faint list-disc pl-5">
                    <li>Your inventory and every dollar you log</li>
                    <li>Canceling — two taps, no phone calls</li>
                  </ul>
                </div>
                <button onClick={() => buyPlan("monthly")} disabled={proBusy !== ""} className="gbtn w-full py-4 rounded-2xl font-disp font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-60">
                  {proBusy === "monthly" && <Loader2 size={18} className="animate-spin" />} <span>{PRICE_MONTHLY_LABEL}</span>
                </button>
                <div className="cbtn h-14">
                  <button onClick={() => buyPlan("annual")} disabled={proBusy !== ""} className="cbtn-in w-full h-full flex items-center justify-center gap-2 font-disp font-bold text-base disabled:opacity-60">
                    {proBusy === "annual" && <Loader2 size={18} className="animate-spin" />} {PRICE_ANNUAL_LABEL} <span className="text-xs font-sans font-semibold text-faint">— save 50%</span>
                  </button>
                </div>
                {proNotice && <div className="panel p-3 text-sm" style={{ borderColor: "rgba(251,191,36,.3)" }}>{proNotice}</div>}
                {proError && <div className="panel p-3 text-sm" style={{ borderColor: "rgba(251,113,133,.3)" }}>{proError}</div>}
                <div className="cbtn h-12">
                  <button onClick={checkPayment} disabled={proBusy !== ""} className="cbtn-in w-full h-full flex items-center justify-center gap-2 text-sm font-bold disabled:opacity-60">
                    {proBusy === "check" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} I finished paying — check now
                  </button>
                </div>
                <div className="pt-3 border-t border-white/[.07]">
                  <div className="text-sm text-white font-semibold mb-1">Already Pro on another phone?</div>
                  <div className="text-xs text-faint mb-2">Enter the email from your receipt and we'll move it over.</div>
                  <input value={restoreEmail} onChange={(e) => setRestoreEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoCapitalize="none"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-abright/50 mb-2" />
                  <button onClick={doRestore} disabled={proBusy !== "" || restoreEmail.trim() === ""} className="gbtn w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    {proBusy === "restore" && <Loader2 size={15} className="animate-spin" />} <span>Restore my Pro</span>
                  </button>
                </div>
                <div className="text-[11px] text-faint text-center pb-4">Payments run through Stripe in your browser — card details never touch this app. Cancel anytime.</div>
              </div>
            )}
          </div>
          <TabBar />
        </>
      )}

      {/* ============ CASH MODAL ============ */}
      {cashModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={() => setCashModal(null)}>
          <div className="w-full bg-ink2 border-t border-white/10 rounded-t-3xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="font-disp font-bold text-xl text-white mb-1">{cashModal.as === "sold" ? "What'd it sell for?" : "What'd the yard pay?"}</div>
            <div className="text-xs text-faint mb-3">Just the number — like 40 or 12.50</div>
            <input autoFocus value={cashPrice} onChange={(e) => setCashPrice(e.target.value)} placeholder="40" inputMode="decimal"
              className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3.5 text-lg text-white mb-2 outline-none focus:border-abright/50" />
            {cashPrice.trim() !== "" && !priceValid && <div className="text-sm mb-2 text-rose">Numbers only — like 40 or 12.50</div>}
            <button onClick={confirmCash} disabled={!priceValid} className="gbtn w-full py-4 rounded-2xl font-disp font-bold disabled:opacity-40 flex items-center justify-center gap-2">
              <DollarSign size={18} /> <span>LOG THE CASH</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
