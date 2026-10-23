import { fa, short } from "../fmt";
import type { MallBuilding as Building } from "../types";
import { MASCOT_RECTS } from "./mascot";

const W = 340; // drawing units; the drawing scales to the sheet's width
const ROW = 38;
const BAR = 16;
const TOP = 26; // room above the top floor for its price tags
const LABEL_X = 336; // floor names, right-aligned here
const SHAFT_X = 292; // the way up (or down) from the entrance
const BAR_R = 282; // bars run from here leftwards
const BAR_L = 10;
const MAX_STEP = 15;

const floorName = (n: number) => (n === 0 ? "همکف" : n < 0 ? `منفی ${fa(-n)}` : `طبقه ${fa(n)}`);

/** The mall as floors stacked like a building, drawn from Torob's own data: each shop of the mall a dot on its floor
    in the order of its unit number (the order is real, the spacing is not), this shop the red pin, the other shops
    with the same product green with their price, and the person the hopping radish at the entrance on the ground
    floor, with the way to the shop dotted. */
export function MallBuilding({ b, onOpenShop }: { b: Building; onOpenShop: (sid: number) => void }) {
  const h = TOP + b.floors.length * ROW;
  const barY = (i: number) => TOP + i * ROW;
  const mid = (i: number) => barY(i) + BAR / 2;
  const ground = b.floors.findIndex((f) => f.num === 0);
  const target = b.floors.findIndex((f) => f.num === b.target_floor);

  const rows = b.floors.map((f) => {
    const n = f.shops.length;
    const step = n > 1 ? Math.min(MAX_STEP, (BAR_R - BAR_L - 24) / (n - 1)) : 0;
    const dots = f.shops.map((s, k) => ({ ...s, x: BAR_R - 14 - k * step }));
    // price tags never sit on one another: the pin's first, then the cheapest offers
    const tags: { x: number; w: number }[] = [];
    const tagged = new Set<number>();
    for (const d of [...dots].sort((a, c) => (a.kind === "target" ? -1 : c.kind === "target" ? 1 : (a.price ?? 9e12) - (c.price ?? 9e12)))) {
      if (d.kind === "other") continue;
      const w = d.kind === "target" ? 58 : (short(d.price) || "؟").length * 4.4 + 10;
      if (tags.some((t) => Math.abs(t.x - d.x) < (t.w + w) / 2 + 2)) continue;
      tags.push({ x: d.x, w });
      tagged.add(d.sid);
    }
    return { f, dots, tagged };
  });
  const pin = target >= 0 ? rows[target].dots.find((d) => d.kind === "target") : undefined;

  return (
    <figure className="mallbld">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={`طبقه‌های ${b.mall_name}، این فروشگاه در ${floorName(b.target_floor)}`}>
        {rows.map(({ f }, i) => (
          <g key={f.num}>
            <rect x={BAR_L} y={barY(i)} width={BAR_R - BAR_L} height={BAR} rx={5}
              className={"mb-bar" + (i === target ? " on" : "")} />
            <text x={LABEL_X} y={mid(i) + 4} textAnchor="end" className={"mb-label" + (i === target ? " on" : "")}>{floorName(f.num)}</text>
          </g>
        ))}

        {/* the way: from the entrance up or down the shaft, then along the floor to the pin */}
        {pin && ground >= 0 && (
          <path className="mb-way" d={`M ${SHAFT_X} ${mid(ground)} V ${mid(target)} H ${pin.x + 7}`} />
        )}

        {rows.map(({ dots, tagged }, i) => dots.map((d) => {
          if (d.kind === "other") return <circle key={d.sid} cx={d.x} cy={mid(i)} r={2.6} className="mb-dot" />;
          const label = d.kind === "target" ? `واحد ${d.unit ?? "؟"}` : short(d.price) || "؟";
          return (
            <g key={d.sid} className={"mb-shop " + d.kind} onClick={() => onOpenShop(d.sid)}>
              <title>{d.name}{d.unit ? `، واحد ${d.unit}` : ""}</title>
              {d.kind === "target"
                ? <><circle cx={d.x} cy={mid(i)} r={7} className="mb-pin" /><circle cx={d.x} cy={mid(i)} r={2.6} fill="#fff" /></>
                : <circle cx={d.x} cy={mid(i)} r={4.4} className="mb-offer" />}
              {tagged.has(d.sid) && (
                <g>
                  <rect x={d.x - (d.kind === "target" ? 29 : (label.length * 4.4 + 10) / 2)} y={barY(i) - 17}
                    width={d.kind === "target" ? 58 : label.length * 4.4 + 10} height={14} rx={7} className="mb-tag" />
                  <text x={d.x} y={barY(i) - 7} textAnchor="middle" className="mb-tagtxt">{label}</text>
                </g>
              )}
            </g>
          );
        }))}

        {/* the person, at the entrance */}
        {ground >= 0 && (
          <g transform={`translate(${SHAFT_X - 8.4} ${barY(ground) - 13})`}>
            <g className="mb-hop" transform="scale(1.2)" dangerouslySetInnerHTML={{ __html: MASCOT_RECTS }} />
          </g>
        )}
      </svg>
      <figcaption className="mb-key">
        <span><i className="k-pin" /> همین فروشگاه</span>
        {b.offers > 0 && <span><i className="k-offer" /> همین کالا در {fa(b.offers)} فروشگاه دیگر این پاساژ</span>}
        <span><i className="k-dot" /> بقیهٔ فروشگاه‌ها</span>
      </figcaption>
      <p className="meta" style={{ margin: 0 }}>نمای ساده از روی دادهٔ ترب: فروشگاه‌ها به ترتیب شمارهٔ واحد، نه جای دقیقشان.</p>
    </figure>
  );
}
