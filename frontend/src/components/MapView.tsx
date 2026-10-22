import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";

export type MapPin = { id: number; lat: number; lon: number; label: string; tone?: "normal" | "closed" | "pick" };

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
  }, [map, points.map((p) => p.join(",")).join("|")]); // eslint-disable-line
  return null;
}

const youIcon = L.divIcon({ className: "", html: '<div class="youpin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/* With a label, the person's own spot pulses (two soft rings) and names itself, so it is obvious at a
   glance that the location was understood and the map is drawn around it. */
export const liveIcon = (label: string) => L.divIcon({
  className: "",
  html: `<div class="youpin live"><span class="youlabel">${esc(label)}</span></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export function MapView({ you, youLabel, pins, route, onPick, small }: {
  you: { lat: number; lon: number };
  youLabel?: string;
  pins: MapPin[];
  route?: [number, number][];
  onPick?: (id: number) => void;
  small?: boolean;
}) {
  const pts: [number, number][] = [[you.lat, you.lon], ...pins.map((p) => [p.lat, p.lon] as [number, number])];
  return (
    <div className={"mapbox" + (small ? " small" : "")}>
      <MapContainer center={[you.lat, you.lon]} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={false} attributionControl>
        <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
        <Fit points={pts} />
        <Marker position={[you.lat, you.lon]} icon={youLabel ? liveIcon(youLabel) : youIcon} zIndexOffset={youLabel ? 1000 : 0} />
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#e91e33", weight: 4, opacity: 0.85, dashArray: "2 9", lineCap: "round" }} />}
        {pins.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            icon={L.divIcon({
              className: "",
              html: `<div class="pricepin ${p.tone === "closed" ? "closed" : p.tone === "pick" ? "pick" : ""}">${p.label}</div>`,
              iconSize: [0, 0],
            })}
            eventHandlers={{ click: () => onPick?.(p.id) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
