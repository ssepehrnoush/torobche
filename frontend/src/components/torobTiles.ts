import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/* The OpenStreetMap tiles redrawn in Torob's own map colours: a light lavender-grey ground, white streets (the
   orange and yellow main roads too), soft blue water, soft green parks, and the street names and shop icons faded
   into the ground. Each tile is recoloured in a canvas as it arrives (OSM allows reading its tiles). */

const SRC = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const LAND = [235, 235, 240], LAND2 = [229, 229, 236], BUILD = [222, 222, 230];
const WATER = [176, 196, 239], PARK = [186, 218, 180], ROAD = [255, 255, 255], CASE = [214, 215, 224];

function recolor(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const sat = mx ? (mx - mn) / mx : 0;
    let c = lum < 0.86 ? BUILD : lum < 0.905 ? LAND2 : LAND;
    if (lum < 0.55) c = LAND2; // labels and icons
    else if (g > r + 10 && g > b + 6) c = PARK;
    else if (b > r + 18 && b >= g && sat > 0.12) c = WATER;
    else if (mn >= 250 || (sat > 0.18 && lum > 0.72 && r >= g && g >= b - 10) || (r > 200 && r > g + 40 && r > b + 20 && lum > 0.6)) c = ROAD;
    else if (sat > 0.25 && lum > 0.5 && lum <= 0.72 && r > g && g >= b - 10) c = CASE;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  }
}

const TorobLayer = L.GridLayer.extend({
  createTile(coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const g = tile.getContext("2d", { willReadFrequently: true });
      if (!g) return done(undefined, tile);
      g.drawImage(img, 0, 0);
      try {
        const d = g.getImageData(0, 0, 256, 256);
        recolor(d.data);
        g.putImageData(d, 0, 0);
      } catch {
        /* a tile that cannot be read stays in its own colours */
      }
      done(undefined, tile);
    };
    img.onerror = () => done(new Error("tile"), tile);
    img.src = SRC.replace("{z}", String(coords.z)).replace("{x}", String(coords.x)).replace("{y}", String(coords.y));
    return tile;
  },
});

/** Inside a MapContainer, in place of a TileLayer. */
export function TorobTiles() {
  const map = useMap();
  useEffect(() => {
    const layer = new (TorobLayer as unknown as new (o: L.GridLayerOptions & { attribution: string }) => L.GridLayer)({ attribution: "&copy; OpenStreetMap", maxZoom: 19 });
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map]);
  return null;
}
