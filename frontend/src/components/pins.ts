export type PinTone = "normal" | "closed" | "pick" | "cheap" | undefined;

const PIN_PATH = "M14 1.5C7.1 1.5 1.8 6.8 1.8 13.5c0 8.6 10.3 19.6 11.2 20.6.5.5 1.5.5 2 0 .9-1 11.2-12 11.2-20.6C26.2 6.8 20.9 1.5 14 1.5z";

/** Torob's own map pin: a blue drop with a white dot and its shadow; a route stop carries its number in the head,
    and with `chip` a shop's price sits above it. Kept apart from MapView so the map preview needs no Leaflet. */
const STORE = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5V13.5h11V6.5"/><path d="M1.5 6.5l1.4-4h10.2l1.4 4c0 1.2-1 2-2.2 2s-2-.8-2.2-2c-.1 1.2-1 2-2.1 2s-2-.8-2.1-2c-.2 1.2-1 2-2.2 2s-2.2-.8-2.2-2z"/><path d="M6.5 13.5v-3h3v3"/></svg>`;

/** A shop with its price on the map, as one tag: a small shop sign and the price in a clear, larger type, with a tail
    pointing at the shop. Ticked shops are red, the cheapest has a green edge, the closed ones are faded. */
export function tagHtml(tone: PinTone, label: string): string {
  return `<div class="ptag ${tone ?? "normal"}"><span class="ptag-in"><i class="ptag-ico">${STORE}</i><b>${label}</b></span><i class="ptag-tail"></i></div>`;
}

export function pinHtml(tone: PinTone, label: string, chip: boolean): string {
  const num = label.length > 0 && label.length <= 2;
  return `<div class="tpin ${tone ?? "normal"}"><svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">` +
    `<ellipse class="sh" cx="19" cy="33.4" rx="6.5" ry="2.4"/><path class="bd" d="${PIN_PATH}"/>` +
    (num ? "" : `<circle class="dt" cx="14" cy="13.5" r="4.8"/>`) + `</svg>` +
    (num ? `<b class="tpin-n">${label}</b>` : "") + (chip && !num && label ? `<span class="tchip">${label}</span>` : "") + `</div>`;
}
