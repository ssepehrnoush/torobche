import { ART, COLOURS, pixelSvg } from "./mascot";

/* The small pixel pictures of how a shop hears about a question, in the style of Torob's pixel radish: the
   radish with a headset (Torob's assistant), the shop, and what travels between them. */

const RADISH_AI = ART.map((row, y) => {
  const r = [...row];
  if (y === 3) { r[1] = "K"; r[12] = "K"; }
  if (y >= 4 && y <= 7) { r[0] = "K"; r[13] = "K"; }
  if (y === 2) { r[2] = "K"; r[11] = "K"; }
  if (y === 8) { r[0] = "K"; r[1] = "K"; }
  if (y === 9) { r[1] = "k"; r[2] = "k"; }
  return r.join("");
});

const SHOP = [
  "..RRRRRRRRRR..",
  ".RRWWRRWWRRWW.",
  "RRWWRRWWRRWWRR",
  "OOOOOOOOOOOOOO",
  ".GTTTTTTTTTTG.",
  ".GTBBBTTDDDTG.",
  ".GTBBBTTDDDTG.",
  ".GTBBBTTDDDTG.",
  ".GTTTTTTDDYTG.",
  ".GTTTTTTDDDTG.",
  "GGGGGGGGGGGGGG",
];

const WHATSAPP = [
  "...GGGGG...",
  ".GGGGGGGGG.",
  ".GGWWGGGGG.",
  "GGGWWGGGGGG",
  "GGGWWWGGGGG",
  "GGGGWWWGWGG",
  "GGGGGWWWWGG",
  ".GGGGGGWWG.",
  ".GGGGGGGGG.",
  "GGGGGGGGG..",
  "GG.........",
];

const SMS = [
  "BBBBBBBBBBBB",
  "BWBBBBBBBBWB",
  "BBWBBBBBBWBB",
  "BBBWBBBBWBBB",
  "BBBBWWWWBBBB",
  "BBBBBBBBBBBB",
  "BBBBBBBBBBBB",
  "BBBBBBBBBBBB",
];

const CALL = [
  "PPPPPPPPPPP",
  "PWWWPPPPPPP",
  "PWWWWPPPPPP",
  "PPWWWPPPPPP",
  "PPPWWPPPPPP",
  "PPPWWWPPPPP",
  "PPPPWWWPWWP",
  "PPPPPWWWWWP",
  "PPPPPPWWWWP",
  "PPPPPPPPPPP",
];

const REPLY = [
  "..YYYYYYY..",
  ".YYYYYYYYY.",
  "YYKYYKYYKYY",
  "YYYYYYYYYYY",
  ".YYYYYYYYY.",
  "..YYYYYYY..",
  "....YY.....",
  "...Y.......",
];

export const PX = {
  radishAi: (w = 30) => pixelSvg(RADISH_AI, { ...COLOURS, K: "#1f2937", k: "#475569" }, w),
  shop: (w = 30) => pixelSvg(SHOP, { R: "#e91e33", W: "#ffffff", O: "#b3132b", G: "#94a3b8", T: "#e2e8f0", B: "#93c5fd", D: "#64748b", Y: "#fbbf24" }, w),
  whatsapp: (w = 20) => pixelSvg(WHATSAPP, { G: "#25d366", W: "#ffffff" }, w),
  sms: (w = 20) => pixelSvg(SMS, { B: "#2f7df6", W: "#ffffff" }, w),
  call: (w = 20) => pixelSvg(CALL, { P: "#7c3aed", W: "#ffffff" }, w),
  reply: (w = 20) => pixelSvg(REPLY, { Y: "#22c55e", K: "#ffffff" }, w),
};
