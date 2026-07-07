// Lazy Leaflet map — loaded only when the user taps "Map view", because map
// tiles are the single most expensive thing this app can download and the
// list view answers most questions for free. Circle markers (no image assets,
// no bundler icon issues). OSM attribution is mandatory (ODbL) and kept on.

import { useEffect, useRef } from "react";
import type { Yard } from "../lib/yards";

interface Props {
  center: { lat: number; lng: number };
  yards: Yard[];
  onSelect: (yard: Yard) => void;
}

export default function YardMap({ center, yards, onSelect }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !divRef.current || mapRef.current) return;

      const map = L.map(divRef.current, { zoomControl: true, attributionControl: true });
      mapRef.current = map;
      map.setView([center.lat, center.lng], 10);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // You
      L.circleMarker([center.lat, center.lng], {
        radius: 7,
        color: "#FBBF24",
        fillColor: "#FBBF24",
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup("You");

      // Yards
      const bounds: Array<[number, number]> = [[center.lat, center.lng]];
      yards.forEach((y) => {
        bounds.push([y.lat, y.lng]);
        L.circleMarker([y.lat, y.lng], {
          radius: 9,
          color: "rgb(var(--a-400))",
          fillColor: "rgb(var(--a-400))",
          fillOpacity: 0.85,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(
            `<b>${y.name.replace(/</g, "&lt;")}</b><br>${y.miles} mi · ${y.kind}`
          )
          .on("popupopen", () => {
            /* popup is informative; selection happens via tap-through below */
          })
          .on("click", () => onSelect(y));
      });
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is created once per mount; yard updates remount via key upstream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={divRef} className="w-full h-72 rounded-xl overflow-hidden border border-white/10" />;
}
