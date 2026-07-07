// Opportunity Spots — the user's OWN map: curb piles, dumpster spots, estate
// sales, free piles they've actually seen. Plus honest free-stuff LAUNCHERS:
// smart search shortcuts into Craigslist free / FB Marketplace / Nextdoor /
// estatesales.net — queries, not pretend aggregation.

import { useState, useEffect, Suspense, lazy } from "react";
import {
  Loader2,
  AlertTriangle,
  MapPin,
  Plus,
  X,
  Navigation,
  Search,
  LocateFixed,
  Map as MapIcon,
  List,
  ExternalLink,
  Calendar,
} from "lucide-react";
import { Browser } from "@capacitor/browser";
import { Place, getCachedPlace, cachePlace, locateMe, searchPlace, milesBetween } from "../lib/geo";
import { Spot, SpotType, SPOT_META, loadSpots, saveSpots, newSpot } from "../lib/spots";

const SpotsMap = lazy(() => import("../components/SpotsMap"));

const QUERY_PACKS = [
  "free scrap metal",
  "broken lawn mower",
  "old appliances",
  "free swing set",
  "broken generator",
  "moving everything must go",
];

export default function SpotsScreen() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Add-pin flow
  const [adding, setAdding] = useState(false);
  const [pinType, setPinType] = useState<SpotType>("curb");
  const [pinLabel, setPinLabel] = useState("");
  const [pinNote, setPinNote] = useState("");
  const [pinDate, setPinDate] = useState("");
  const [pinPlaceQuery, setPinPlaceQuery] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  // Launchers
  const [freeQuery, setFreeQuery] = useState("");

  useEffect(() => {
    loadSpots().then(setSpots);
    getCachedPlace().then(setPlace);
  }, []);

  const persist = async (next: Spot[]) => {
    setSpots(next);
    await saveSpots(next);
  };

  const addAtMyLocation = async () => {
    setPinBusy(true);
    setError(null);
    try {
      const p = await locateMe();
      setPlace(p);
      await createPin(p.lat, p.lng);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get your location.");
    } finally {
      setPinBusy(false);
    }
  };

  const addAtSearchedPlace = async () => {
    if (!pinPlaceQuery.trim()) return;
    setPinBusy(true);
    setError(null);
    try {
      const results = await searchPlace(pinPlaceQuery);
      if (results.length === 0) {
        setError("Couldn't find that address. Try adding the city.");
        return;
      }
      const p = results[0];
      await cachePlace(p);
      setPlace(p);
      await createPin(p.lat, p.lng);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Address search failed. Try again.");
    } finally {
      setPinBusy(false);
    }
  };

  const createPin = async (lat: number, lng: number) => {
    const date = pinDate ? new Date(pinDate).getTime() : undefined;
    const s = newSpot(pinType, pinLabel, lat, lng, { note: pinNote, date });
    await persist([s, ...spots]);
    setAdding(false);
    setPinLabel("");
    setPinNote("");
    setPinDate("");
    setPinPlaceQuery("");
  };

  const deleteSpot = async (id: string) => {
    await persist(spots.filter((s) => s.id !== id));
    setConfirmDelete(null);
    setExpanded(null);
  };

  const launch = (url: string) => Browser.open({ url });
  const q = (s: string) => encodeURIComponent(s.trim());
  const activeFreeQuery = freeQuery.trim();

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
      <div className="text-sm text-faint">
        Your own pins — spots <b className="text-mist">you've</b> seen. Nothing on this map is
        invented; that's the point.
      </div>

      {error && (
        <div className="bg-panel border-2 border-alert rounded-xl p-3 text-sm flex gap-2">
          <AlertTriangle size={16} className="flex-shrink-0" color="#F87171" />
          <span>{error}</span>
        </div>
      )}

      {/* Add pin */}
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-3.5 rounded-xl term-font font-extrabold text-base flex items-center justify-center gap-2"
          style={{ background: "#4ADE80", color: "#0A0E1A" }}
        >
          <Plus size={17} /> DROP A PIN
        </button>
      ) : (
        <div className="bg-panel border border-edge rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="term-font text-[10px] tracking-widest text-faint">NEW SPOT</div>
            <button onClick={() => setAdding(false)} aria-label="Cancel">
              <X size={16} color="#7A8494" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SPOT_META) as SpotType[]).map((t) => (
              <button
                key={t}
                onClick={() => setPinType(t)}
                className="px-2.5 py-1.5 rounded-full text-[11px] border"
                style={
                  pinType === t
                    ? { borderColor: SPOT_META[t].color, color: SPOT_META[t].color }
                    : { borderColor: "#1F2937", color: "#7A8494" }
                }
              >
                {SPOT_META[t].label}
              </button>
            ))}
          </div>
          <input
            value={pinLabel}
            onChange={(e) => setPinLabel(e.target.value)}
            placeholder="label (e.g. blue house on Rt 9)"
            className="w-full bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout"
          />
          <input
            value={pinNote}
            onChange={(e) => setPinNote(e.target.value)}
            placeholder="note (optional)"
            className="w-full bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout"
          />
          {(pinType === "estate" || pinType === "garage") && (
            <label className="flex items-center gap-2 text-xs text-faint">
              <Calendar size={13} />
              <input
                type="datetime-local"
                value={pinDate}
                onChange={(e) => setPinDate(e.target.value)}
                className="flex-1 bg-ink border border-edge rounded-lg px-2 py-2 text-xs text-white outline-none focus:border-scout"
              />
            </label>
          )}
          <button
            onClick={addAtMyLocation}
            disabled={pinBusy}
            className="w-full py-3 rounded-xl term-font font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "#4ADE80", color: "#0A0E1A" }}
          >
            {pinBusy ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} />}
            PIN AT MY LOCATION
          </button>
          <div className="flex gap-2">
            <input
              value={pinPlaceQuery}
              onChange={(e) => setPinPlaceQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAtSearchedPlace()}
              placeholder="or type an address / cross street"
              className="min-w-0 flex-1 bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout"
            />
            <button
              onClick={addAtSearchedPlace}
              disabled={pinBusy || !pinPlaceQuery.trim()}
              className="px-3 rounded-xl border border-edge disabled:opacity-40"
              aria-label="Pin at address"
            >
              <Search size={15} color="#B8C0CC" />
            </button>
          </div>
        </div>
      )}

      {/* Pins list / map */}
      {spots.length > 0 && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setShowMap(false)}
              className="flex-1 py-2 rounded-lg text-xs term-font font-bold flex items-center justify-center gap-1.5 border"
              style={!showMap ? { background: "#1F2937", color: "#4ADE80", borderColor: "#4ADE80" } : { color: "#7A8494", borderColor: "#1F2937" }}
            >
              <List size={13} /> LIST
            </button>
            <button
              onClick={() => setShowMap(true)}
              className="flex-1 py-2 rounded-lg text-xs term-font font-bold flex items-center justify-center gap-1.5 border"
              style={showMap ? { background: "#1F2937", color: "#4ADE80", borderColor: "#4ADE80" } : { color: "#7A8494", borderColor: "#1F2937" }}
            >
              <MapIcon size={13} /> MAP
            </button>
          </div>

          {showMap && place && (
            <Suspense
              fallback={
                <div className="w-full h-72 rounded-xl border border-edge flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin" color="#4ADE80" />
                </div>
              }
            >
              <SpotsMap key={spots.length} center={place} spots={spots} onSelect={(s) => { setShowMap(false); setExpanded(s.id); }} />
            </Suspense>
          )}
          {showMap && !place && (
            <div className="bg-panel border border-edge rounded-xl p-4 text-sm text-faint">
              The map needs a center — drop a pin at your location once, or search a place on the
              Yards tab first.
            </div>
          )}

          {!showMap && (
            <div className="flex flex-col gap-2">
              {spots.map((s) => (
                <div key={s.id} className="bg-panel border border-edge rounded-xl px-4 py-3">
                  <button className="w-full text-left" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: SPOT_META[s.type].color }} />
                        <span className="text-sm text-white font-medium truncate">{s.label}</span>
                      </div>
                      {place && (
                        <span className="term-font text-xs text-faint flex-shrink-0">
                          {(Math.round(milesBetween(place.lat, place.lng, s.lat, s.lng) * 10) / 10).toFixed(1)} mi
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-faint mt-0.5">
                      {SPOT_META[s.type].label}
                      {s.date ? ` · ${new Date(s.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                    </div>
                  </button>
                  {expanded === s.id && (
                    <div className="mt-2.5 flex flex-col gap-2">
                      {s.note && <div className="text-xs text-mist bg-ink border border-edge rounded-lg px-3 py-2">{s.note}</div>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => launch(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`)}
                          className="flex-1 py-2 rounded-lg term-font font-bold text-[11px] flex items-center justify-center gap-1.5"
                          style={{ background: "#4ADE80", color: "#0A0E1A" }}
                        >
                          <Navigation size={12} /> GO
                        </button>
                        {confirmDelete === s.id ? (
                          <>
                            <button
                              onClick={() => deleteSpot(s.id)}
                              className="flex-1 py-2 rounded-lg text-[11px] font-bold"
                              style={{ background: "#F87171", color: "#0A0E1A" }}
                            >
                              REALLY REMOVE
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 rounded-lg text-[11px] border border-edge text-mist">
                              KEEP
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDelete(s.id)} className="flex-1 py-2 rounded-lg text-[11px] border border-edge text-mist">
                            Remove pin
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {spots.length === 0 && !adding && (
        <div className="bg-panel border border-edge rounded-xl p-5 text-sm text-faint">
          No pins yet. Saw a curb pile you couldn't grab today? A dumpster spot worth
          re-checking? Drop a pin so future-you can find it.
        </div>
      )}

      {/* Free stuff launchers — honest: search shortcuts, not aggregation */}
      <div>
        <div className="term-font text-[10px] tracking-widest text-faint mb-2">FREE-STUFF SEARCH LAUNCHERS</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {QUERY_PACKS.map((p) => (
            <button
              key={p}
              onClick={() => setFreeQuery(p)}
              className="px-2.5 py-1 rounded-full text-[11px] border"
              style={activeFreeQuery === p ? { borderColor: "#4ADE80", color: "#4ADE80" } : { borderColor: "#1F2937", color: "#7A8494" }}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          value={freeQuery}
          onChange={(e) => setFreeQuery(e.target.value)}
          placeholder="or type your own search"
          className="w-full bg-panel border border-edge rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-scout mb-2"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => launch(`https://www.craigslist.org/search/zza${activeFreeQuery ? `?query=${q(activeFreeQuery)}` : ""}`)}
            className="py-2.5 rounded-xl text-xs font-semibold border border-edge text-mist flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={12} /> Craigslist free
          </button>
          <button
            onClick={() => launch(activeFreeQuery ? `https://www.facebook.com/marketplace/search/?query=${q(activeFreeQuery)}` : "https://www.facebook.com/marketplace/category/free")}
            className="py-2.5 rounded-xl text-xs font-semibold border border-edge text-mist flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={12} /> FB Marketplace
          </button>
          <button
            onClick={() => launch(`https://nextdoor.com/search/?query=${q(activeFreeQuery || "free")}`)}
            className="py-2.5 rounded-xl text-xs font-semibold border border-edge text-mist flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={12} /> Nextdoor
          </button>
          <button
            onClick={() =>
              launch(
                place
                  ? `https://www.google.com/search?q=${q(`estate sales near ${place.label} this weekend`)}`
                  : "https://www.estatesales.net/"
              )
            }
            className="py-2.5 rounded-xl text-xs font-semibold border border-edge text-mist flex items-center justify-center gap-1.5"
          >
            <ExternalLink size={12} /> Estate sales
          </button>
        </div>
        <div className="text-[10px] text-faint mt-2">
          These open real searches on the real sites — what's there is what's there. Pin the good
          finds so they're on your map.
        </div>
      </div>
      <div className="pb-3" />
    </div>
  );
}
