import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { fa } from "../../fmt";
import type { PlaceArea } from "../../types";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TEHRAN: [number, number] = [35.72, 51.41];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const chosenIcon = L.divIcon({ className: "", html: '<div class="pickpin"><i></i></div>', iconSize: [0, 0] });

/** Taps anywhere on the map become a chosen point. */
function Taps({ onTap }: { onTap: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onTap(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Fly to a place chosen outside the map (search, GPS); stay put when the tap came from the map itself. */
function Follow({ at }: { at: { lat: number; lon: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (at && !map.getBounds().pad(-0.15).contains([at.lat, at.lon])) map.flyTo([at.lat, at.lon], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, at?.lat, at?.lon]); // eslint-disable-line
  return null;
}

/** Bubbles that would cover a busier neighbourhood's bubble wait for a closer zoom, so names never pile up. */
function Areas({ areas, chosen, onArea }: { areas: PlaceArea[]; chosen: string | null; onArea: (a: PlaceArea) => void }) {
  const map = useMap();
  const [shown, setShown] = useState<PlaceArea[]>([]);
  const layout = () => {
    const kept: { x: number; y: number; w: number }[] = [];
    const out: PlaceArea[] = [];
    for (const a of [...areas].sort((x, y) => (x.label === chosen ? -1 : y.label === chosen ? 1 : y.shops - x.shops))) {
      const pt = map.latLngToContainerPoint([a.lat, a.lon]);
      const w = a.label.length * 7 + 20;
      if (kept.some((k) => Math.abs(k.x - pt.x) < (k.w + w) / 2 + 4 && Math.abs(k.y - pt.y) < 26)) continue;
      kept.push({ x: pt.x, y: pt.y, w });
      out.push(a);
    }
    setShown(out);
  };
  useMapEvents({ zoomend: layout, moveend: layout });
  useEffect(() => {
    if (areas.length && !chosen) map.fitBounds(L.latLngBounds(areas.map((a) => [a.lat, a.lon] as [number, number])), { padding: [36, 36] });
    layout();
  }, [areas.length, chosen]); // eslint-disable-line
  return (
    <>
      {shown.map((a) => (
        <Marker key={a.id} position={[a.lat, a.lon]} eventHandlers={{ click: () => onArea(a) }} title={`${a.label}، ${fa(a.shops)} فروشگاه`}
          icon={L.divIcon({
            className: "",
            html: `<div class="areapin${a.shops >= 500 ? " big" : ""}${chosen === a.label ? " on" : ""}">${esc(a.label)}</div>`,
            iconSize: [0, 0],
          })} />
      ))}
    </>
  );
}

/** The place step's map: one bubble per neighbourhood that has shops, a tap anywhere drops the pin. */
export function PlaceMap({ areas, chosen, onArea, onTap }: {
  areas: PlaceArea[];
  chosen: { lat: number; lon: number; label: string } | null;
  onArea: (a: PlaceArea) => void;
  onTap: (lat: number, lon: number) => void;
}) {
  return (
    <div className="mapbox wz-map">
      <MapContainer center={chosen ? [chosen.lat, chosen.lon] : TEHRAN} zoom={chosen ? 14 : 12} minZoom={11}
        style={{ height: "100%", width: "100%" }} zoomControl={false} attributionControl>
        <TileLayer url={TILE_URL} attribution="&copy; OpenStreetMap" maxZoom={19} />
        <Taps onTap={onTap} />
        <Follow at={chosen} />
        <Areas areas={areas} chosen={chosen?.label ?? null} onArea={onArea} />
        {chosen && <Marker position={[chosen.lat, chosen.lon]} icon={chosenIcon} interactive={false} zIndexOffset={1000} />}
      </MapContainer>
    </div>
  );
}
