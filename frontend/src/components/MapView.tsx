import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import type { MapPath } from "../types";
import { mascotHtml } from "./mascot";
import { pinHtml } from "./pins";
import { TorobTiles } from "./torobTiles";

export type MapPin = { id: number; lat: number; lon: number; label: string; tone?: "normal" | "closed" | "pick" | "cheap" };


function Fit({ points, top = 36 }: { points: [number, number][]; top?: number }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    const fit = () => {
      if (points.length === 1) map.setView(points[0], 15);
      else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [36, top], paddingBottomRight: [36, 36], maxZoom: 16 });
    };
    fit();
    // a map that grows or shrinks (the shops strip opening full size) redraws its tiles and fits its points again
    const box = map.getContainer();
    let last = box.clientHeight;
    const ro = new ResizeObserver(() => {
      if (box.clientHeight === last) return;
      last = box.clientHeight;
      map.invalidateSize();
      fit();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [map, key]); // eslint-disable-line
  return null;
}

const MASCOT_SIZE: [number, number] = [34, 40];
const MASCOT_ANCHOR: [number, number] = [17, 38]; // its feet stand on the spot
const youIcon = L.divIcon({ className: "", html: mascotHtml(), iconSize: MASCOT_SIZE, iconAnchor: MASCOT_ANCHOR });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/* With a label, the person's own spot names itself, so it is obvious at a glance that the location was
   understood and the map is drawn around it. */
export const liveIcon = (label: string) => L.divIcon({
  className: "",
  html: mascotHtml(esc(label)),
  iconSize: MASCOT_SIZE,
  iconAnchor: MASCOT_ANCHOR,
});

const RANK: Record<string, number> = { pick: 0, cheap: 1, normal: 2, closed: 3 };

/** Pins that would sit on a more important one wait for a closer zoom (shops in one mall share a spot), so the map
    never shows a pile: ticked shops first, then the cheapest, then the rest. */
function Pins({ pins, onPick, all, you, chips }: { pins: MapPin[]; onPick?: (id: number) => void; all?: boolean; you: { lat: number; lon: number }; chips?: boolean }) {
  const map = useMap();
  const [shown, setShown] = useState<MapPin[]>([]);
  const layout = () => {
    const me = map.latLngToContainerPoint([you.lat, you.lon]);
    // boxes by their centres: a label sits just above its point, the radish stands on its spot and keeps it clear
    const kept: { x: number; y: number; w: number; h: number }[] = [{ x: me.x, y: me.y - 19, w: 36, h: 40 }];
    const out: MapPin[] = [];
    for (const p of [...pins].sort((a, b) => RANK[a.tone ?? "normal"] - RANK[b.tone ?? "normal"])) {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      const box = chips ? { x: pt.x, y: pt.y - 27, w: Math.max(28, p.label.length * 5 + 14), h: 54 } : { x: pt.x, y: pt.y - 18, w: 26, h: 34 };
      if (!all && kept.some((k) => Math.abs(k.x - box.x) < (k.w + box.w) / 2 + 2 && Math.abs(k.y - box.y) < (k.h + box.h) / 2 + 2)) continue;
      kept.push(box);
      out.push(p);
    }
    setShown(out);
  };
  useMapEvents({ zoomend: layout, moveend: layout, resize: layout });
  useEffect(layout, [pins.map((p) => `${p.id}:${p.tone}`).join(",")]); // eslint-disable-line
  return (
    <>
      {shown.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          zIndexOffset={(3 - RANK[p.tone ?? "normal"]) * 100}
          icon={L.divIcon({ className: "", html: pinHtml(p.tone, p.label, !!chips), iconSize: [28, 36], iconAnchor: [14, 34] })}
          eventHandlers={{ click: () => onPick?.(p.id) }}
        />
      ))}
    </>
  );
}

const DOTTED = { color: "#e91e33", weight: 4, opacity: 0.85, dashArray: "2 9", lineCap: "round" as const };

/* A street-following stretch looks like a map app's route: a solid line on a white casing. */
function PathLine({ p }: { p: MapPath }) {
  if (!p.real) return <Polyline positions={p.points} pathOptions={DOTTED} />;
  return (
    <>
      <Polyline positions={p.points} pathOptions={{ color: "#fff", weight: 8, opacity: 0.9, lineCap: "round", lineJoin: "round" }} />
      <Polyline positions={p.points} pathOptions={{ color: "#e91e33", weight: 5, opacity: 0.9, lineCap: "round", lineJoin: "round" }} />
    </>
  );
}

export function MapView({ you, youLabel, pins, route, paths, onPick, small, height, allPins, chips }: {
  you: { lat: number; lon: number };
  youLabel?: string;
  pins: MapPin[];
  route?: [number, number][];
  paths?: MapPath[]; // drawn instead of `route` when given
  onPick?: (id: number) => void;
  small?: boolean;
  height?: number; // a set height instead of the small or the regular one
  allPins?: boolean; // every pin always (the stops of a route), none waiting for a closer zoom
  chips?: boolean; // each shop's price above its pin
}) {
  const pts: [number, number][] = [[you.lat, you.lon], ...pins.map((p) => [p.lat, p.lon] as [number, number]),
    ...(paths ?? []).flatMap((p) => (p.real ? p.points : []))];
  return (
    <div className={"mapbox" + (small ? " small" : "")} style={height ? { height } : undefined}>
      <MapContainer center={[you.lat, you.lon]} zoom={14} style={{ height: "100%", width: "100%" }} zoomControl={false} attributionControl>
        <TorobTiles />
        <Fit points={pts} top={youLabel ? 84 : 44} /* room above the radish (and its label) at the top edge */ />
        <Marker position={[you.lat, you.lon]} icon={youLabel ? liveIcon(youLabel) : youIcon} zIndexOffset={youLabel ? 1000 : 0} />
        {paths?.length ? paths.map((p, i) => <PathLine key={i} p={p} />)
          : route && route.length > 1 && <Polyline positions={route} pathOptions={DOTTED} />}
        <Pins pins={pins} onPick={onPick} all={allPins} you={you} chips={chips} />
      </MapContainer>
    </div>
  );
}
