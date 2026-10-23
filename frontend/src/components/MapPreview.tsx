import { mascotHtml } from "./mascot";
import { pinHtml, type PinTone } from "./pins";

/* The strip above the shops, drawn like the one on Torob's own site: a quiet illustrated map (lavender ground,
   white streets, a blue river, green parks) with a blue pin for each of the nearest shops, the person's own pin,
   and the hopping radish. It is a picture, not the map (the pins keep only the order of distance); a tap opens
   the real map. */

type P = { id: number; lat: number; lon: number; tone?: PinTone };

const STREETS = [
  "M0 22 L62 32 L112 96 L166 160", "M40 -5 L86 62", "M0 78 L112 96", "M150 -5 L232 58 L300 40 L362 -5",
  "M204 -5 L214 46", "M262 -5 L252 44", "M112 96 L172 62 L232 58", "M300 100 L344 160", "M326 84 L410 98",
  "M60 160 L86 118 L112 96", "M232 58 L250 104 L300 100", "M362 -5 L392 40 L410 44",
];

// where pins stand on the picture, on its streets, nearest to the radish first (the button keeps the corner free)
const SLOTS: [number, number][] = [[73, 24], [66, 58], [57, 35], [47, 63], [40, 24], [31, 50], [22, 30], [14, 62], [7, 36]];
const YOU: [number, number] = [88, 44];

/** The nearest shops, one to a spot, the closest on the spot closest to the radish. */
function place(you: { lat: number; lon: number }, pins: P[]) {
  const k = Math.cos((you.lat * Math.PI) / 180);
  const near = [...pins].sort((a, b) => Math.hypot((a.lon - you.lon) * k, a.lat - you.lat) - Math.hypot((b.lon - you.lon) * k, b.lat - you.lat));
  return near.slice(0, SLOTS.length).map((p, i) => ({ p, x: SLOTS[i][0], y: SLOTS[i][1] }));
}

export function MapPreview({ you, pins, onOpen, height }: { you: { lat: number; lon: number }; pins: P[]; onOpen: () => void; height: number }) {
  const pts = place(you, pins);
  return (
    <div className="mprev" style={{ height }} onClick={onOpen} role="button" tabIndex={0} aria-label="فروشگاه‌ها روی نقشه"
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}>
      <svg className="mprev-art" viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="400" height="150" fill="#ebebf1" />
        <path d="M296 -2 H402 V44 C372 42 330 26 296 -2Z" fill="#b8d8b2" />
        <path d="M-2 112 C28 106 56 126 62 152 H-2Z" fill="#b8d8b2" />
        <path d="M70 -12 C122 40 172 82 262 110 S364 142 424 150" stroke="#b1c5ef" strokeWidth="13" fill="none" strokeLinecap="round" />
        <path d="M96 -12 C142 30 192 70 282 98 S382 128 424 136" stroke="#fff" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M244 162 C266 92 330 58 424 52" stroke="#fff" strokeWidth="10" fill="none" strokeLinecap="round" />
        <path d="M206 162 C228 108 300 76 424 72" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" />
        {STREETS.map((d) => <path key={d} d={d} stroke="#fff" strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
      {pts.map(({ p, x, y }) => (
        <span key={p.id} className="mprev-pin" style={{ left: `${x}%`, top: `${y}%` }}
          dangerouslySetInnerHTML={{ __html: pinHtml(p.tone === "closed" ? "closed" : "normal", "", false) }} />
      ))}
      <span className="mprev-me" style={{ left: `${YOU[0] - 5}%`, top: `${YOU[1] - 2}%` }} aria-hidden="true">
        <svg viewBox="0 0 28 36" width="22" height="29"><path d="M14 2.5C7.6 2.5 2.8 7.3 2.8 13.5c0 8 9.6 18.3 10.5 19.2.4.4 1 .4 1.4 0 .9-.9 10.5-11.2 10.5-19.2C25.2 7.3 20.4 2.5 14 2.5z" fill="none" stroke="#1d4ed8" strokeWidth="3.2" /></svg>
      </span>
      <span className="mprev-you" style={{ left: `${YOU[0]}%`, top: `${YOU[1]}%` }} dangerouslySetInnerHTML={{ __html: mascotHtml() }} />
      <button className="wz-mapbtn" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label="فروشگاه‌ها روی نقشه">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9V3h6M3 3l9 9" /></svg>
        فروشگاه‌ها روی نقشه
      </button>
    </div>
  );
}
