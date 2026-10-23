export type PinTone = "normal" | "closed" | "pick" | "cheap" | undefined;

const PIN_PATH = "M14 1.5C7.1 1.5 1.8 6.8 1.8 13.5c0 8.6 10.3 19.6 11.2 20.6.5.5 1.5.5 2 0 .9-1 11.2-12 11.2-20.6C26.2 6.8 20.9 1.5 14 1.5z";

/** Torob's own map pin: a blue drop with a white dot and its shadow; a route stop carries its number in the head,
    and with `chip` a shop's price sits above it. Kept apart from MapView so the map preview needs no Leaflet. */
export function pinHtml(tone: PinTone, label: string, chip: boolean): string {
  const num = label.length > 0 && label.length <= 2;
  return `<div class="tpin ${tone ?? "normal"}"><svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">` +
    `<ellipse class="sh" cx="19" cy="33.4" rx="6.5" ry="2.4"/><path class="bd" d="${PIN_PATH}"/>` +
    (num ? "" : `<circle class="dt" cx="14" cy="13.5" r="4.8"/>`) + `</svg>` +
    (num ? `<b class="tpin-n">${label}</b>` : "") + (chip && !num && label ? `<span class="tchip">${label}</span>` : "") + `</div>`;
}
