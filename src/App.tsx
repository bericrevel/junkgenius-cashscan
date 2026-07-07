import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
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
  MapPin,
  Phone,
  Navigation,
  Globe,
  Star,
  Search,
  LocateFixed,
  Map as MapIcon,
  List,
  Clock,
  TrendingUp,
  NotebookPen,
  MessageSquare,
  Scale,
  Tag,
  Pin,
  CalendarDays,
  Landmark,
  Share2,
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
  isFounder,
  foundersStatus,
} from "./lib/pro";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { Place, getCachedPlace, cachePlace, locateMe, searchPlace } from "./lib/geo";
import {
  Yard,
  YardNote,
  findYards,
  loadYardNotes,
  saveYardNotes,
  allLoggedPrices,
} from "./lib/yards";
import { getSpotPrices, SpotResult } from "./lib/prices";
import type { ListingInput } from "./lib/scout";
import ChatScreen from "./screens/ChatScreen";
import ListingScreen from "./screens/ListingScreen";
import BuyerScreen from "./screens/BuyerScreen";
import SpotsScreen from "./screens/SpotsScreen";
import PlannerScreen from "./screens/PlannerScreen";
import LawsScreen from "./screens/LawsScreen";

const YardMap = lazy(() => import("./components/YardMap"));

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

// ---- Finishes (themes) — chrome constant, glass color swaps. ----
// Stored on this device only (Preferences), like everything else personal.
// The palettes themselves live in src/index.css as [data-theme] variables;
// the SWATCH gradients below are literal on purpose: each picker dot must
// preview ITS OWN finish regardless of which finish is currently active.
const THEME_KEY = "junkgenius:theme";
type ThemeId = "emerald" | "sapphire" | "gold" | "liberty";
const THEMES: Array<{ id: ThemeId; label: string; swatch: string }> = [
  {
    id: "emerald",
    label: "Emerald",
    swatch: "linear-gradient(155deg, rgba(52,211,153,.45), rgba(4,120,87,.75) 60%, rgba(2,44,34,.95)), #061913",
  },
  {
    id: "sapphire",
    label: "Sapphire",
    swatch: "linear-gradient(155deg, rgba(96,165,250,.45), rgba(29,78,216,.75) 60%, rgba(23,37,84,.95)), #060B17",
  },
  {
    id: "gold",
    label: "Gold",
    swatch: "linear-gradient(155deg, rgba(251,191,36,.45), rgba(180,83,9,.75) 60%, rgba(69,26,3,.95)), #170F04",
  },
];
function isThemeId(v: unknown): v is ThemeId {
  return v === "emerald" || v === "sapphire" || v === "gold" || v === "liberty";
}

// Founders Edition exclusive finish — appears in the picker only for
// Founding Scrappers (or the owner). Old-Glory navy with a red glint.
const LIBERTY_THEME: { id: ThemeId; label: string; swatch: string } = {
  id: "liberty",
  label: "Liberty",
  swatch: "linear-gradient(155deg, rgba(199,215,242,.5), rgba(178,34,52,.55) 38%, rgba(36,80,154,.8) 62%, rgba(10,27,56,.95)), #060A14",
};

// Quick-pick chips for logging what a yard actually paid — the most honest
// price data in the app (the user's own receipts, on-device only).
const MATERIAL_CHIPS = [
  "Copper #1",
  "Copper #2",
  "Insulated wire",
  "Brass",
  "Aluminum",
  "Alu cans",
  "Stainless",
  "Light iron",
  "Cast iron",
  "Lead",
];

type Screen =
  | "onboarding"
  | "home"
  | "scan"
  | "verdict"
  | "guide"
  | "inventory"
  | "yards"
  | "yardDetail"
  | "prices"
  | "chat"
  | "listing"
  | "buyer"
  | "spots"
  | "planner"
  | "laws"
  | "pro";

function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/[.06] relative z-10">
      {onBack && (
        <button onClick={onBack} className="p-1 -ml-1" aria-label="Back">
          <ChevronLeft size={22} className="text-mist" />
        </button>
      )}
      <span className="font-disp font-bold text-lg chrome-text truncate">{title}</span>
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
  const [proBusy, setProBusy] = useState<"" | "monthly" | "annual" | "founders" | "check" | "restore" | "portal">("");
  const [proNotice, setProNotice] = useState<string | null>(null);
  const [proError, setProError] = useState<string | null>(null);
  const [restoreEmail, setRestoreEmail] = useState("");
  const [founder, setFounder] = useState(false);
  // Live Founders Edition availability — real Stripe count or nothing.
  const [foundersLeft, setFoundersLeft] = useState<{ sold: number; remaining: number; cap: number } | null>(null);

  // ---- Yards state (ported from ScrapScout — real OpenStreetMap data) ----
  const [place, setPlace] = useState<Place | null>(null);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<Place[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [yards, setYards] = useState<Yard[]>([]);
  const [yardsLoading, setYardsLoading] = useState(false);
  const [yardsError, setYardsError] = useState<string | null>(null);
  const [yardsFetchedAt, setYardsFetchedAt] = useState<number | null>(null);
  const [radius, setRadius] = useState(25);
  const [showMap, setShowMap] = useState(false);
  const [selectedYard, setSelectedYard] = useState<Yard | null>(null);
  const [yardNotes, setYardNotes] = useState<Record<string, YardNote>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [logMaterial, setLogMaterial] = useState("");
  const [logPrice, setLogPrice] = useState("");

  // ---- Prices state ----
  const [spot, setSpot] = useState<SpotResult | null>(null);
  const [spotLoading, setSpotLoading] = useState(false);

  // ---- Listing generator prefill (from buyer triage or the toolbox) ----
  const [listingPrefill, setListingPrefill] = useState<ListingInput | null>(null);
  const [listingSession, setListingSession] = useState(0);

  // ---- Finish (theme) ----
  const [theme, setThemeState] = useState<ThemeId>("emerald");
  const applyTheme = (t: ThemeId) => {
    // "emerald" is the :root default; keeping the attribute off for it means
    // even a pre-hydration flash renders in a valid finish.
    if (t === "emerald") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };
  const setTheme = (t: ThemeId) => {
    setThemeState(t);
    applyTheme(t);
    setItem(THEME_KEY, t); // fire-and-forget; a lost write just means default next launch
  };

  useEffect(() => {
    getItem(ONBOARD_KEY).then((v) => {
      if (!v) setScreen("onboarding");
      setCheckingOnboard(false);
    });
    getItem(THEME_KEY).then((v) => {
      if (isThemeId(v)) {
        setThemeState(v);
        applyTheme(v);
      }
    });
    loadInventory().then(setInventory);
    refreshEntitlement().then(setProState);
    loadAiCount().then(setAiCount);
    isFounder().then(setFounder);
    loadYardNotes().then(setYardNotes);
    getCachedPlace().then(setPlace);
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
      else if (s === "yardDetail") setScreen("yards");
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
  const buyPlan = async (plan: "monthly" | "annual" | "founders") => {
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
        if (r.founder) setFounder(true);
        setProState({ pro: true, checkedAt: Date.now(), source: r.founder ? "founder" : "network" });
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

  // ---- Yards flow (ported from ScrapScout, unchanged logic) ----
  const searchYards = useCallback(async (p: Place, r: number, force = false) => {
    setYardsLoading(true);
    setYardsError(null);
    try {
      const res = await findYards(p.lat, p.lng, r, { force });
      setYards(res.yards);
      setYardsFetchedAt(res.fetchedAt);
    } catch (err) {
      setYardsError(err instanceof Error ? err.message : "Couldn't load yards. Try again.");
    } finally {
      setYardsLoading(false);
    }
  }, []);

  const openYards = () => {
    setScreen("yards");
    if (place && yards.length === 0 && !yardsLoading) {
      searchYards(place, radius);
    }
  };

  const useMyLocation = async () => {
    setPlaceBusy(true);
    setYardsError(null);
    setPlaceResults(null);
    try {
      const p = await locateMe();
      setPlace(p);
      await searchYards(p, radius);
    } catch (err) {
      setYardsError(err instanceof Error ? err.message : "Couldn't get your location.");
    } finally {
      setPlaceBusy(false);
    }
  };

  const runPlaceSearch = async () => {
    if (!placeQuery.trim()) return;
    setPlaceBusy(true);
    setYardsError(null);
    try {
      const results = await searchPlace(placeQuery);
      if (results.length === 0) {
        setYardsError("Couldn't find that place. Try a city name or ZIP.");
        setPlaceResults(null);
      } else {
        setPlaceResults(results);
      }
    } catch (err) {
      setYardsError(err instanceof Error ? err.message : "Search failed. Try again.");
    } finally {
      setPlaceBusy(false);
    }
  };

  const pickPlace = async (p: Place) => {
    setPlace(p);
    setPlaceResults(null);
    setPlaceQuery("");
    await cachePlace(p);
    await searchYards(p, radius);
  };

  const widenSearch = () => {
    const r = 50;
    setRadius(r);
    if (place) searchYards(place, r);
  };

  const openYardDetail = (y: Yard) => {
    setSelectedYard(y);
    setNoteDraft(yardNotes[y.id]?.note || "");
    setNoteSaved(false);
    setLogMaterial("");
    setLogPrice("");
    setScreen("yardDetail");
  };

  const saveNote = async () => {
    if (!selectedYard) return;
    const next = {
      ...yardNotes,
      [selectedYard.id]: {
        ...(yardNotes[selectedYard.id] || { prices: [] }),
        note: noteDraft,
        name: selectedYard.name,
      },
    };
    setYardNotes(next);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1500);
    await saveYardNotes(next);
  };

  const cleanedLog = logPrice.replace(/[^0-9.]/g, "");
  const parsedLog = parseFloat(cleanedLog);
  const logValid = cleanedLog !== "" && Number.isFinite(parsedLog) && parsedLog >= 0 && logMaterial.trim() !== "";

  const logYardPrice = async () => {
    if (!selectedYard || !logValid) return;
    const existing = yardNotes[selectedYard.id] || { note: "", prices: [] };
    const next = {
      ...yardNotes,
      [selectedYard.id]: {
        ...existing,
        name: selectedYard.name,
        prices: [{ material: logMaterial.trim(), perLb: parsedLog, date: Date.now() }, ...(existing.prices || [])],
      },
    };
    setYardNotes(next);
    setLogMaterial("");
    setLogPrice("");
    await saveYardNotes(next);
  };

  // ---- Prices flow ----
  const loadSpot = async (force = false) => {
    setSpotLoading(true);
    const res = await getSpotPrices({ force });
    setSpot(res);
    setSpotLoading(false);
  };

  const openPrices = () => {
    setScreen("prices");
    if (!spot && !spotLoading) loadSpot();
  };

  const myPrices = allLoggedPrices(yardNotes, (id) => yardNotes[id]?.name || "a yard");

  const openExternal = (url: string) => Browser.open({ url });

  /** Route to an AI screen, or to the Pro pitch when the gate is active. */
  const openGated = (go: () => void) => {
    if (proGateActive) setScreen("pro");
    else go();
  };

  // Live Founders availability whenever the Pro pitch is on screen.
  useEffect(() => {
    if (screen !== "pro" || isPro) return;
    let stale = false;
    foundersStatus()
      .then((f) => { if (!stale) setFoundersLeft(f); })
      .catch(() => { if (!stale) setFoundersLeft(null); }); // no fake scarcity — show nothing
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, isPro]);

  // ---- Toolbox navigation ----
  const openListingFor = (input: ListingInput | null) => {
    setListingPrefill(input);
    setListingSession((n) => n + 1);
    setScreen("listing");
  };

  const draftFromInventory = (i: InventoryItem) =>
    openListingFor({
      item: i.item,
      category: i.category,
      resaleLow: i.resaleLow,
      resaleHigh: i.resaleHigh,
    });

  const TabBar = () => (
    <div className="flex border-t border-white/[.06] bg-ink2/60 backdrop-blur relative z-10">
      {(
        [
          { id: "home", label: "Home", icon: HomeIcon, go: () => setScreen("home") },
          { id: "scan", label: "Scan", icon: ScanLine, go: resetScan },
          { id: "yards", label: "Yards", icon: MapPin, go: openYards },
          { id: "prices", label: "Prices", icon: TrendingUp, go: openPrices },
          { id: "inventory", label: "Items", icon: Boxes, go: () => setScreen("inventory") },
        ] as const
      ).map((t) => {
        const active =
          screen === t.id ||
          (t.id === "scan" && (screen === "verdict" || screen === "guide")) ||
          (t.id === "yards" && screen === "yardDetail");
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
          <h1 className="font-disp font-bold text-[28px] chrome-text mt-8 text-center leading-tight">Scan anything.</h1>
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
                <div className="font-disp font-bold text-lg chrome-text leading-tight">
                  JunkGenius
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

              {/* Toolbox — every ScrapScout tool, chrome/glass tiles */}
              <div>
                <div className="font-mono text-[10px] tracking-widest text-faint mb-2">TOOLBOX</div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { icon: MessageSquare, title: "Ask the scout", sub: "grades, yard runs, safety", go: () => openGated(() => setScreen("chat")) },
                      { icon: Scale, title: "Triage my pile", sub: "list it vs scrap it now", go: () => openGated(() => setScreen("buyer")) },
                      { icon: Pin, title: "My spots", sub: "your pins + free-stuff launchers", go: () => setScreen("spots") },
                      { icon: CalendarDays, title: "The plan", sub: "curb days, runs, reminders", go: () => setScreen("planner") },
                      { icon: Landmark, title: "Know the rules", sub: "ID, cats, curb law, never-scrap list", go: () => setScreen("laws") },
                      { icon: Tag, title: "Draft a listing", sub: "ad copy + real eBay asks", go: () => openGated(() => openListingFor(null)) },
                    ] as const
                  ).map((t) => {
                    const Icon = t.icon;
                    return (
                      <button key={t.title} onClick={t.go} className="panel p-4 text-left">
                        <Icon size={18} style={{ color: "rgb(var(--a-400))" }} />
                        <div className="text-sm text-white font-semibold mt-2">{t.title}</div>
                        <div className="text-[11px] text-faint mt-0.5">{t.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {isPro ? (
                <div className="panel p-4" style={{ borderColor: "rgb(var(--a-500) / .35)" }}>
                  <div className="flex items-center gap-2 text-sm text-white font-semibold"><Zap size={15} className="green-text" /> JunkGenius Pro — active</div>
                  <button onClick={() => setScreen("pro")} className="text-xs text-faint underline mt-1">manage subscription</button>
                </div>
              ) : proGateActive ? (
                <div className="panel p-4" style={{ borderColor: "rgb(var(--a-500) / .35)" }}>
                  <div className="text-sm text-white font-semibold">
                    {gateReason === "cash" ? `You've collected $${cash.toFixed(0)} with JunkGenius. 🎉` : `You've used your ${AI_TRIGGER} free AI actions.`}
                  </div>
                  <div className="text-xs text-faint mt-1">The free deal was $100 collected or {AI_TRIGGER} AI actions. Your inventory, pins, plan, yards, and prices stay free forever either way.</div>
                  <button onClick={() => setScreen("pro")} className="gbtn mt-3 w-full py-2.5 rounded-xl font-disp font-bold text-sm"><span>SEE PRO</span></button>
                </div>
              ) : aiCount >= Math.floor(AI_TRIGGER / 2) ? (
                <div className="panel px-4 py-3 text-[11px] text-faint">
                  Free AI actions used: <b className="text-mist">{aiCount} of {AI_TRIGGER}</b>. Free until $100 collected or {AI_TRIGGER} actions.
                </div>
              ) : null}

              {/* Finish picker — same watch, different crystal */}
              <div className="panel p-4">
                <div className="font-mono text-[10px] tracking-widest text-faint mb-3">FINISH</div>
                <div className="flex items-stretch">
                  {(founder || proState?.plan === "founders" ? [...THEMES, LIBERTY_THEME] : THEMES).map((t) => {
                    const active = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id)}
                        className="flex-1 flex flex-col items-center gap-1.5"
                        aria-label={`${t.label} finish${active ? " (current)" : ""}`}
                        aria-pressed={active}
                      >
                        <div
                          className="bezel rounded-full"
                          style={{
                            width: 42,
                            height: 42,
                            ...(active ? { boxShadow: "0 0 0 2px rgba(255,255,255,.4), 0 2px 6px rgba(0,0,0,.5)" } : {}),
                          }}
                        >
                          <div className="bezel-face" style={{ background: t.swatch, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {active && <Check size={15} color="#fff" strokeWidth={3} />}
                          </div>
                        </div>
                        <span className={`font-mono text-[9px] tracking-widest ${active ? "text-white" : "text-faint"}`}>
                          {t.label.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() =>
                  Share.share({
                    title: "JunkGenius",
                    text: "Scan junk for scrap + resale value, find yards, get paid. Free until it's made you $100.",
                    url: "https://github.com/bericrevel/junkgenius-cashscan/releases/latest",
                  }).catch(() => {})
                }
                className="w-full py-3 rounded-xl border border-white/10 text-mist text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Share2 size={14} /> Tell another scrapper
              </button>

              <div className="text-[11px] text-faint text-center pt-1">
                Values are AI estimates — yards and buyers set real prices. Your inventory stays on this phone. ·{" "}
                <button onClick={() => openExternal(`${import.meta.env.VITE_API_BASE_URL || "https://junkgenius-cashscan.vercel.app"}/privacy.html`)} className="underline">
                  privacy
                </button>
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
                <div className="font-disp font-bold text-lg chrome-text leading-tight">{result.item}</div>
                <div className="text-[11px] text-faint mt-0.5">{result.condition || result.category}</div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 rounded-2xl p-3.5" style={{ background: "linear-gradient(180deg,rgba(170,182,184,.10),rgba(170,182,184,.02))", border: "1px solid rgba(170,182,184,.25)" }}>
                <div className="font-mono text-[9px] tracking-widest uppercase text-faint">At the yard</div>
                <div className="font-mono font-extrabold text-xl text-white mt-1.5">${result.scrapLow}–${result.scrapHigh}</div>
                {result.weightLbs > 0 && <div className="text-[10px] text-faint mt-1 flex items-center gap-1"><Weight size={10} /> ~{result.weightLbs} lbs</div>}
              </div>
              <div className="flex-1 rounded-2xl p-3.5" style={{ background: "linear-gradient(180deg,rgb(var(--a-500) / .14),rgb(var(--a-500) / .02))", border: "1px solid rgb(var(--a-500) / .3)" }}>
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
                <div className="flex-1 rounded-2xl h-11 flex items-center justify-center gap-2 text-xs font-bold" style={{ border: "1px solid rgb(var(--a-500) / .4)", color: "rgb(var(--a-400))", background: "rgb(var(--a-500) / .06)" }}>
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
      {screen === "yards" && (
        <>
          <TopBar title="Yards Near You" onBack={() => setScreen("home")} />
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
            {/* Location chooser — GPS or typed, both honest paths */}
            <div className="flex gap-2">
              <button
                onClick={useMyLocation}
                disabled={placeBusy || yardsLoading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono font-bold text-xs disabled:opacity-50"
                style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
              >
                {placeBusy ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
                MY LOCATION
              </button>
              <div className="flex-1 flex gap-2">
                <input
                  value={placeQuery}
                  onChange={(e) => setPlaceQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runPlaceSearch()}
                  placeholder="city or ZIP"
                  className="min-w-0 flex-1 panel rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-abright/50"
                />
                <button
                  onClick={runPlaceSearch}
                  disabled={placeBusy || !placeQuery.trim()}
                  className="px-3 rounded-xl border border-white/10 disabled:opacity-40"
                  aria-label="Search place"
                >
                  <Search size={16} color="#B9C4BE" />
                </button>
              </div>
            </div>

            {placeResults && (
              <div className="flex flex-col gap-1.5">
                {placeResults.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => pickPlace(p)}
                    className="text-left panel rounded-xl px-4 py-2.5 text-sm text-mist"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {place && (
              <div className="flex items-center justify-between text-xs text-faint">
                <span className="truncate">
                  Near <b className="text-mist">{place.label}</b> · {radius} mi
                </span>
                {yardsFetchedAt && (
                  <button onClick={() => place && searchYards(place, radius, true)} className="underline flex-shrink-0 ml-2">
                    refresh
                  </button>
                )}
              </div>
            )}

            {yardsError && (
              <div className="panel border-2 border-rose/40 rounded-xl p-3.5 text-sm flex gap-2">
                <AlertTriangle size={17} className="flex-shrink-0" color="#FB7185" />
                <span>{yardsError}</span>
              </div>
            )}

            {yardsLoading && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 size={32} className="animate-spin" color="rgb(var(--a-400))" />
                <div className="font-mono text-xs tracking-widest text-faint">SEARCHING OPENSTREETMAP...</div>
              </div>
            )}

            {!place && !yardsLoading && !placeResults && (
              <div className="panel rounded-xl p-5 text-sm text-faint">
                Pick a location — tap <b className="text-mist">MY LOCATION</b> or type a city/ZIP.
                Yards come from real OpenStreetMap data.
              </div>
            )}

            {place && !yardsLoading && yards.length > 0 && (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowMap(false)}
                    className="flex-1 py-2 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-1.5 border"
                    style={
                      !showMap
                        ? { background: "rgba(255,255,255,.07)", color: "rgb(var(--a-400))", borderColor: "rgb(var(--a-400) / .5)" }
                        : { color: "#7C8983", borderColor: "rgba(255,255,255,.12)" }
                    }
                  >
                    <List size={13} /> LIST
                  </button>
                  <button
                    onClick={() => setShowMap(true)}
                    className="flex-1 py-2 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-1.5 border"
                    style={
                      showMap
                        ? { background: "rgba(255,255,255,.07)", color: "rgb(var(--a-400))", borderColor: "rgb(var(--a-400) / .5)" }
                        : { color: "#7C8983", borderColor: "rgba(255,255,255,.12)" }
                    }
                  >
                    <MapIcon size={13} /> MAP
                  </button>
                </div>

                {showMap && (
                  <Suspense
                    fallback={
                      <div className="w-full h-72 rounded-xl border border-white/10 flex items-center justify-center">
                        <Loader2 size={24} className="animate-spin" color="rgb(var(--a-400))" />
                      </div>
                    }
                  >
                    <YardMap key={`${place.lat},${place.lng},${yards.length}`} center={place} yards={yards} onSelect={openYardDetail} />
                  </Suspense>
                )}

                {!showMap && (
                  <div className="flex flex-col gap-2">
                    {yards.map((y) => (
                      <button
                        key={y.id}
                        onClick={() => openYardDetail(y)}
                        className="text-left panel rounded-xl px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm text-white font-semibold truncate">{y.name}</div>
                          <div className="font-mono text-xs flex-shrink-0" style={{ color: "rgb(var(--a-400))" }}>
                            {y.miles} mi
                          </div>
                        </div>
                        <div className="text-xs text-faint mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{y.kind}</span>
                          {y.phone && (
                            <span className="flex items-center gap-1">
                              <Phone size={10} /> yes
                            </span>
                          )}
                          {y.hours && (
                            <span className="flex items-center gap-1 truncate">
                              <Clock size={10} /> {y.hours.slice(0, 28)}
                            </span>
                          )}
                          {yardNotes[y.id]?.note && (
                            <span className="flex items-center gap-1" style={{ color: "#FBBF24" }}>
                              <NotebookPen size={10} /> note
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {radius === 25 && (
                  <button onClick={widenSearch} className="py-2.5 rounded-xl border border-white/10 text-sm text-mist">
                    Search wider — 50 mi
                  </button>
                )}
                <div className="text-[11px] text-faint text-center pb-3">
                  Data © OpenStreetMap contributors. OSM doesn't list every yard — ask around
                  locally too.
                </div>
              </>
            )}

            {place && !yardsLoading && !yardsError && yards.length === 0 && yardsFetchedAt && (
              <div className="panel rounded-xl p-5 text-sm text-faint flex flex-col gap-3">
                <span>
                  <b className="text-mist">No yards mapped within {radius} mi</b> on OpenStreetMap.
                  That doesn't mean there are none — OSM coverage varies by county. Ask at the
                  hardware store, or search a nearby city.
                </span>
                {radius === 25 && (
                  <button
                    onClick={widenSearch}
                    className="self-start px-4 py-2 rounded-lg font-mono font-bold text-xs"
                    style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
                  >
                    SEARCH 50 MI
                  </button>
                )}
              </div>
            )}
          </div>
          <TabBar />
        </>
      )}

      {/* ============ YARD DETAIL ============ */}
      {screen === "yardDetail" && selectedYard && (
        <>
          <TopBar title={selectedYard.name} onBack={() => setScreen("yards")} />
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            <div className="text-xs text-faint">
              {selectedYard.kind} · {selectedYard.miles} mi away
              {selectedYard.address ? ` · ${selectedYard.address}` : ""}
            </div>
            {selectedYard.hours && (
              <div className="panel rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                <Clock size={15} className="flex-shrink-0 mt-0.5" color="rgb(var(--a-400))" />
                <span className="text-mist">{selectedYard.hours}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {selectedYard.phone && (
                <button
                  onClick={() => {
                    window.location.href = `tel:${selectedYard.phone}`;
                  }}
                  className="py-3 rounded-xl font-mono font-bold text-sm flex items-center justify-center gap-2"
                  style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
                >
                  <Phone size={15} /> CALL
                </button>
              )}
              <button
                onClick={() =>
                  openExternal(
                    `https://www.google.com/maps/dir/?api=1&destination=${selectedYard.lat},${selectedYard.lng}`
                  )
                }
                className="py-3 rounded-xl font-mono font-bold text-sm flex items-center justify-center gap-2 border"
                style={{ borderColor: "rgb(var(--a-400) / .5)", color: "rgb(var(--a-400))" }}
              >
                <Navigation size={15} /> DIRECTIONS
              </button>
              <button
                onClick={() =>
                  openExternal(
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${selectedYard.name} ${selectedYard.lat},${selectedYard.lng}`
                    )}`
                  )
                }
                className="py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border border-white/10 text-mist"
              >
                <Star size={15} /> Reviews on Google
              </button>
              {selectedYard.website && (
                <button
                  onClick={() => openExternal(selectedYard.website!)}
                  className="py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 border border-white/10 text-mist"
                >
                  <Globe size={15} /> Website
                </button>
              )}
            </div>

            {!selectedYard.phone && (
              <div className="text-xs text-faint -mt-1">
                No phone listed on OpenStreetMap for this one — check its Google listing.
              </div>
            )}

            {/* My note — real user data, on-device */}
            <div>
              <div className="font-mono text-[10px] tracking-widest text-faint mb-2">MY NOTE</div>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
                placeholder="Gate hours, who to ask for, what they're picky about..."
                className="w-full panel rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-abright/50 resize-none"
              />
              <button
                onClick={saveNote}
                className="mt-2 px-4 py-2 rounded-lg font-mono font-bold text-xs flex items-center gap-2"
                style={
                  noteSaved
                    ? { background: "rgb(var(--a-400) / .15)", color: "rgb(var(--a-400))" }
                    : { background: "rgb(var(--a-400))", color: "#0A0D0C" }
                }
              >
                {noteSaved ? (
                  <>
                    <Check size={13} /> SAVED
                  </>
                ) : (
                  "SAVE NOTE"
                )}
              </button>
            </div>

            {/* What THIS yard paid me — the most honest price data there is */}
            <div>
              <div className="font-mono text-[10px] tracking-widest text-faint mb-2">WHAT THEY PAID ME ($/LB)</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {MATERIAL_CHIPS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setLogMaterial(m)}
                    className="px-2.5 py-1 rounded-full text-[11px] border"
                    style={
                      logMaterial === m
                        ? { borderColor: "rgb(var(--a-400) / .5)", color: "rgb(var(--a-400))" }
                        : { borderColor: "rgba(255,255,255,.12)", color: "#7C8983" }
                    }
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={logMaterial}
                  onChange={(e) => setLogMaterial(e.target.value)}
                  placeholder="material"
                  className="min-w-0 flex-1 panel rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-abright/50"
                />
                <input
                  value={logPrice}
                  onChange={(e) => setLogPrice(e.target.value)}
                  placeholder="$/lb"
                  inputMode="decimal"
                  className="w-24 panel rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-abright/50"
                />
                <button
                  onClick={logYardPrice}
                  disabled={!logValid}
                  className="px-3.5 rounded-xl font-mono font-bold text-xs disabled:opacity-40"
                  style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
                >
                  LOG
                </button>
              </div>
              {(yardNotes[selectedYard.id]?.prices || []).length > 0 && (
                <div className="flex flex-col gap-1.5 mt-3">
                  {(yardNotes[selectedYard.id]?.prices || []).slice(0, 10).map((p, i) => (
                    <div key={i} className="flex justify-between text-sm panel rounded-lg px-3 py-2">
                      <span className="text-mist">{p.material}</span>
                      <span className="font-mono text-white">
                        ${p.perLb.toFixed(2)}/lb{" "}
                        <span className="text-faint text-xs">{new Date(p.date).toLocaleDateString()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[11px] text-faint text-center pb-3">
              Notes and logged prices live on this phone only.
            </div>
          </div>
          <TabBar />
        </>
      )}

      {/* ============ PRICES ============ */}
      {screen === "prices" && (
        <>
          <TopBar title="Metal Prices" onBack={() => setScreen("home")} />
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {/* Spot section — real API or honest setup state */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-[10px] tracking-widest text-faint">EXCHANGE SPOT</div>
                {spot?.state === "ok" && (
                  <button
                    onClick={() => loadSpot(true)}
                    disabled={spotLoading}
                    className="text-xs text-faint underline disabled:opacity-40"
                  >
                    refresh
                  </button>
                )}
              </div>

              {spotLoading && !spot && (
                <div className="flex justify-center py-8">
                  <Loader2 size={28} className="animate-spin" color="rgb(var(--a-400))" />
                </div>
              )}

              {spot?.state === "setup" && (
                <div className="panel rounded-xl p-4 text-sm text-faint flex flex-col gap-2">
                  <div className="text-white font-semibold">Spot prices aren't connected yet.</div>
                  <span>
                    They need a one-time free API key on the server (see README →{" "}
                    <span className="font-mono text-xs">METALPRICE_API_KEY</span>). No fake numbers
                    here in the meantime — log what <b className="text-mist">your</b> yard pays below;
                    that's the number that actually matters.
                  </span>
                </div>
              )}

              {spot?.state === "error" && (
                <div className="panel border-2 border-rose/40 rounded-xl p-3.5 text-sm flex flex-col gap-2">
                  <div className="flex gap-2">
                    <AlertTriangle size={17} className="flex-shrink-0" color="#FB7185" />
                    <span>{spot.message}</span>
                  </div>
                  <button
                    onClick={() => loadSpot(true)}
                    className="self-start px-4 py-1.5 rounded-lg font-mono font-bold text-xs"
                    style={{ background: "rgb(var(--a-400))", color: "#0A0D0C" }}
                  >
                    TRY AGAIN
                  </button>
                </div>
              )}

              {spot?.state === "ok" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    {spot.prices.map((p) => (
                      <div key={p.symbol} className="flex justify-between items-center panel rounded-lg px-4 py-2.5">
                        <span className="text-sm text-white">{p.name}</span>
                        <span className="font-mono text-sm" style={{ color: "rgb(var(--a-400))" }}>
                          ${p.price.toFixed(2)}
                          <span className="text-faint text-xs">/{p.unit}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-faint mt-2">
                    Spot via metalpriceapi.com
                    {spot.fetchedAt ? ` · as of ${new Date(spot.fetchedAt).toLocaleString()}` : ""}
                    {spot.stale ? " · cached (couldn't refresh)" : ""}
                  </div>
                  <div className="panel rounded-xl px-4 py-3 text-xs text-faint mt-2">
                    <b className="text-mist">Yards pay under spot — usually 30–60% under</b> — and
                    set their own prices day to day. Call ahead. Brass, steel, and insulated wire
                    aren't exchange metals at all: for those, your logged yard prices below are the
                    real data.
                  </div>
                </>
              )}
            </div>

            {/* My yard prices — the user's own real numbers */}
            <div>
              <div className="font-mono text-[10px] tracking-widest text-faint mb-2">WHAT MY YARDS PAID ($/LB)</div>
              {myPrices.length === 0 ? (
                <div className="panel rounded-xl p-4 text-sm text-faint">
                  Nothing logged yet. When a yard pays you, log the $/lb on that yard's page —
                  your own numbers beat any spot feed.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {myPrices.slice(0, 20).map((p, i) => (
                    <div key={i} className="panel rounded-lg px-4 py-2.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-white">{p.material}</span>
                        <span className="font-mono" style={{ color: "rgb(var(--a-400))" }}>
                          ${p.perLb.toFixed(2)}/lb
                        </span>
                      </div>
                      <div className="text-[11px] text-faint mt-0.5">
                        {p.yardName} · {new Date(p.date).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <TabBar />
        </>
      )}

      {/* ============ INVENTORY ============ */}
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

      {/* ============ ASK THE SCOUT (CHAT) ============ */}
      {screen === "chat" && (
        <>
          <TopBar title="Ask the Scout" onBack={() => setScreen("home")} />
          <ChatScreen onAiAction={onAiAction} />
          <TabBar />
        </>
      )}

      {/* ============ LISTING GENERATOR ============ */}
      {screen === "listing" && (
        <>
          <TopBar title="Draft a Listing" onBack={() => setScreen("home")} />
          <ListingScreen key={listingSession} inventory={inventory} prefill={listingPrefill} onAiAction={onAiAction} />
          <TabBar />
        </>
      )}

      {/* ============ BUYER TRIAGE ============ */}
      {screen === "buyer" && (
        <>
          <TopBar title="Triage My Pile" onBack={() => setScreen("home")} />
          <BuyerScreen inventory={inventory} onDraftListing={draftFromInventory} onAiAction={onAiAction} />
          <TabBar />
        </>
      )}

      {/* ============ MY SPOTS ============ */}
      {screen === "spots" && (
        <>
          <TopBar title="My Spots" onBack={() => setScreen("home")} />
          <SpotsScreen />
          <TabBar />
        </>
      )}

      {/* ============ THE PLAN ============ */}
      {screen === "planner" && (
        <>
          <TopBar title="The Plan" onBack={() => setScreen("home")} />
          <PlannerScreen />
          <TabBar />
        </>
      )}

      {/* ============ KNOW THE RULES ============ */}
      {screen === "laws" && (
        <>
          <TopBar title="Know the Rules" onBack={() => setScreen("home")} />
          <LawsScreen onAskScout={() => openGated(() => setScreen("chat"))} />
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
                <div className="font-disp font-bold text-2xl chrome-text">
                  {founder ? "Owner access. ⚡" : proState?.plan === "founders" ? "Founding Scrapper." : "You're Pro. ⚡"}
                </div>
                {proState?.plan === "founders" && (
                  <div className="panel px-5 py-3 flex flex-col items-center gap-1" style={{ borderColor: "rgb(var(--a-400) / .35)" }}>
                    <div className="font-mono font-extrabold text-lg green-text">
                      №{proState.founderNo ?? "—"} of 250
                    </div>
                    <div className="font-mono text-[9px] tracking-[.2em] text-faint">FOUNDERS EDITION · AMERICA'S 250TH · 1776–2026</div>
                  </div>
                )}
                <div className="text-sm text-faint max-w-xs">
                  {founder
                    ? "Full Pro, permanent on this device — no subscription, nothing to manage."
                    : proState?.plan === "founders"
                    ? "Lifetime access — one of 250, ever. No subscription, nothing to cancel. The Liberty finish is yours on the Home screen."
                    : "Unlimited scans and guides — and your few bucks keep this tool alive for the next person digging out. Thank you."}
                </div>
                <button onClick={resetScan} className="gbtn w-full max-w-xs py-4 mt-2 rounded-2xl font-disp font-bold text-lg"><span>SCAN SOMETHING</span></button>
                {!founder && proState?.plan !== "founders" && (
                  <div className="cbtn w-full max-w-xs h-12">
                    <button onClick={managePlan} disabled={proBusy === "portal"} className="cbtn-in w-full h-full flex items-center gap-2 text-sm font-bold disabled:opacity-50">
                      <Settings size={15} /> {proBusy === "portal" ? "Opening…" : "Manage / cancel subscription"}
                    </button>
                  </div>
                )}
                {proError && <div className="panel w-full p-3 text-sm" style={{ borderColor: "rgba(251,113,133,.3)" }}>{proError}</div>}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="bezel rounded-2xl" style={{ width: 48, height: 48 }}><div className="bezel-face green"><Zap size={22} /></div></div>
                  <div className="font-disp font-bold text-xl chrome-text leading-tight">
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
                {/* Founders Edition — real cap, real live count, never faked */}
                <div className="panel p-4 relative overflow-hidden" style={{ borderColor: "rgb(var(--a-400) / .3)" }}>
                  <div className="font-mono text-[9px] tracking-[.2em] text-faint">FOUNDERS EDITION · 1776–2026</div>
                  <div className="font-disp font-bold text-lg chrome-text mt-1">$99 once. Yours for life.</div>
                  <div className="text-[12.5px] text-mist mt-1.5 leading-relaxed">
                    250 ever, for America's 250th year — numbered, lifetime Pro, nothing to cancel,
                    plus the Founders-only <b className="text-white">Liberty</b> finish.
                  </div>
                  {foundersLeft && foundersLeft.remaining > 0 && (
                    <div className="font-mono text-[11px] mt-2 green-text">{foundersLeft.remaining} of {foundersLeft.cap} remaining</div>
                  )}
                  {foundersLeft && foundersLeft.remaining <= 0 ? (
                    <div className="mt-3 w-full py-3 rounded-xl border border-white/10 text-center text-sm text-faint font-bold">
                      All 250 claimed — thank you, Founders.
                    </div>
                  ) : (
                    <button onClick={() => buyPlan("founders")} disabled={proBusy !== ""} className="gbtn mt-3 w-full py-3.5 rounded-xl font-disp font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60">
                      {proBusy === "founders" && <Loader2 size={17} className="animate-spin" />} <span>BECOME A FOUNDER — $99</span>
                    </button>
                  )}
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
                  <div className="text-xs text-faint mb-2">Enter the email from your receipt — or an unlock code.</div>
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
            <div className="font-disp font-bold text-xl chrome-text mb-1">{cashModal.as === "sold" ? "What'd it sell for?" : "What'd the yard pay?"}</div>
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
