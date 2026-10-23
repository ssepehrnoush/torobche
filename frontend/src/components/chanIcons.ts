/* Smooth vector pictures of how a shop is asked: the shop, and what travels to it (a WhatsApp bubble, a text's
   envelope, a call) and back (the answer). Drawn as plain SVG strings so they animate with CSS alone. */

const svg = (w: number, body: string, box = "0 0 24 24") => `<svg viewBox="${box}" width="${w}" height="${w}" aria-hidden="true">${body}</svg>`;

export const CHAN = {
  shop: (w = 30) => svg(w, `<rect x="2" y="2" width="28" height="28" rx="9" fill="#eef2f7"/>` +
    `<path d="M8 13v10h16V13" fill="#fff" stroke="#64748b" stroke-width="1.8" stroke-linejoin="round"/>` +
    `<path d="M7 13l1.8-5h14.4L25 13c0 1.6-1.3 2.6-2.9 2.6S19.4 14.6 19.2 13c-.2 1.6-1.4 2.6-3.2 2.6S13 14.6 12.8 13c-.2 1.6-1.3 2.6-2.9 2.6S7 14.6 7 13z" fill="#e91e33" stroke="#e91e33" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<rect x="14" y="17.5" width="4" height="5.5" rx="1" fill="#94a3b8"/>`, "0 0 32 32"),
  whatsapp: (w = 22) => svg(w, `<circle cx="12" cy="12" r="11" fill="#25d366"/>` +
    `<path d="M6.3 17.7l1-3a6 6 0 1 1 2.2 2.1z" fill="#fff"/><path d="M10 9.6c.2-.4.5-.4.7-.4h.4c.2 0 .4.1.5.4l.5 1.2c.1.2 0 .4-.1.5l-.4.5c.4.8 1 1.4 1.8 1.8l.5-.4c.2-.1.4-.2.6-.1l1.2.5c.2.1.3.3.3.5v.4c0 .3-.2.6-.5.7-.6.3-1.6.3-3-.6-1.1-.7-2-1.7-2.5-2.8-.4-1-.4-1.7 0-2.2z" fill="#25d366"/>`),
  sms: (w = 22) => svg(w, `<rect x="1" y="4" width="22" height="16" rx="4" fill="#2f7df6"/><path d="M4 8l8 5.5L20 8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  call: (w = 22) => svg(w, `<circle cx="12" cy="12" r="11" fill="#7c3aed"/>` +
    `<path d="M8.6 6.5c.4-.2.9 0 1.1.4l1 2.1c.2.4.1.8-.2 1.1l-.8.7c.6 1.3 1.6 2.3 2.9 2.9l.7-.8c.3-.3.7-.4 1.1-.2l2.1 1c.4.2.6.7.4 1.1l-.4 1c-.3.7-1 1.1-1.7 1-4.4-.5-7.9-4-8.4-8.4-.1-.7.3-1.4 1-1.7z" fill="#fff"/>`),
  reply: (w = 22) => svg(w, `<circle cx="12" cy="12" r="11" fill="#16a34a"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`),
};
