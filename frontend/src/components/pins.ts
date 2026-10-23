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

const LOGO_RED = "M79.245 20.322l-.627.726c-2.474 2.656-5.814 4.2-9.462 4.313-.16.023-.342.023-.502.023-.456 0-.878-.023-1.31-.068 8.595 10.1 9.895 24.968 2.222 36.579-7.638 11.542-21.774 16.252-34.428 12.484h-.08c-5.13-1.34-10.944.68-14.022 5.414 3.192-4.847 2.736-11.055-.798-15.322v-.045c-8.333-10.079-9.473-24.72-1.87-36.16C26.692 15.67 42.766 11.22 56.195 17.031c-.57-1.476-.935-3.065-1.026-4.688-.114-2.95.741-5.788 2.371-8.171-18.012-5.902-38.532.567-49.476 17.137C-5.104 41.171.425 67.842 20.261 80.893c19.882 13.064 46.592 7.502 59.702-12.246 10.032-15.174 9.177-34.331-.707-48.348l-.011.023z";
const LOGO_DARK = "M31.969 10.22c-10.91 1.08-20.463 5.721-24.054 11.191C-5.195 41.216.3 67.853 20.193 80.905l.73-1.112c3.191-4.847 2.735-11.055-.799-15.322v-.045c-8.22-10.079-9.36-24.72-1.835-36.16C26.61 15.67 42.685 11.22 56.114 17.031c0 0-11.4-8.059-24.122-6.81h-.023z";
const LEAF_A = "M62.544 22.32s-.342-4.086 1.482-7.037c1.824-2.951 5.7-5.845 10.602-5.539 4.925.307 5.723 1.442 5.723 1.442s.114 3.972-1.254 6.242-4.218 5.606-8.322 6.446c-4.104.829-8.231-1.555-8.231-1.555z";
const LEAF_B = "M61.062 21.173s-.456-3.972 2.28-7.944c2.736-3.973 5.7-4.563 5.7-4.563S68.7 3.218 66.078.608c.228-.057-3.124.08-6.042 3.291-2.577 2.815-4.104 7.264-2.964 11.577 1.14 4.312 3.99 5.697 3.99 5.697z";

/** A shop on the map as Torob's logo standing on its sharp tip (turned 33°: tip down, leaves up), a white heart
    that shows a tick when the shop is ticked; with `chip` its price sits above it as a small tag. */
export function logoPinHtml(tone: PinTone, label: string, chip: boolean, more = 0): string {
  const heart = tone === "pick" ? `<path d="M34 45l7 7 13-14" fill="none" stroke="#e91e33" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    : tone === "cheap" ? `<circle cx="44" cy="44" r="8" fill="#16a34a"/>` : `<circle cx="44" cy="44" r="7" fill="#e91e33" opacity=".85"/>`;
  return `<div class="lpin ${tone ?? "normal"}"><svg viewBox="0 0 88 92" width="34" height="36" aria-hidden="true">` +
    `<ellipse cx="44" cy="89" rx="13" ry="3.4" fill="rgba(15,23,42,.24)"/>` +
    `<g transform="rotate(-33 44 44)"><path fill="#e91e33" d="${LOGO_RED}"/><path fill="#bf0f22" d="${LOGO_DARK}"/>` +
    `<path fill="#6fbc23" d="${LEAF_A}"/><path fill="#519a23" d="${LEAF_B}"/></g>` +
    `<circle cx="44" cy="44" r="21" fill="#fff"/>${heart}</svg>` +
    (chip && label ? `<span class="lpin-tag">${label}</span>` : "") +
    (more > 0 ? `<b class="lpin-more">+${String(more).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d])}</b>` : "") + `</div>`;
}
