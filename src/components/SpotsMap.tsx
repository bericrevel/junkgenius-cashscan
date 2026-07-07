// Lazy Leaflet map for the user's own opportunity pins. Same data-cost rules
// as YardMap: loaded only on demand, circle markers, OSM attribution on.

import { useEffect, useRef } from "react";
import type { Spot } from "../lib/spots";
import { SPOT_META } from "../lib/spots";

interface Props {
  center: { lat: number; lng: number };
  spots: Spot[];
  onSelect: (spot: Spot) => void;
}

export default function SpotsMap({ center, spots, onSelect }: Props) {
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
      map.setView([center.lat, center.lng], 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      L.circleMarker([center.lat, center.lng], {
        radius: 7,
        color: "#B9C4BE",
        fillColor: "#B9C4BE",
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup("You");

      const bounds: Array<[number, number]> = [[center.lat, center.lng]];
      spots.forEach((s) => {
        bounds.push([s.lat, s.lng]);
        const color = SPOT_META[s.type].color;
        L.circleMarker([s.lat, s.lng], {
          radius: 9,
          color,
          fillColor: color,
          fillOpacity: 0.85,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(`<b>${s.label.replace(/</g, "&lt;")}</b><br>${SPOT_META[s.type].label}`)
          .on("click", () => onSelect(s));
      });
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={divRef} className="w-full h-72 rounded-xl overflow-hidden border border-white/10" />;
}
