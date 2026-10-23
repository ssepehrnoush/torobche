/* The person on the map: a small pixel radish that hops in place (CSS: .mascot), in Torob's playful spirit.
   Drawn here, one letter per pixel, so it stays crisp at any size and needs no image file. */
const ART = [
  "........LL.L..",
  ".......lLLLLl.",
  "........lLl...",
  "....OOOOlOO...",
  "...ORRRRRRRO..",
  "..ORHHRRRRRRO.",
  "..ORHRRRRRRRO.",
  "..ORRERRRERRO.",
  "..ORRERRRERRO.",
  "..ORCRRRRRCRO.",
  "...ORRRSSRRO..",
  "....ORRRRRO...",
  ".....OOOOO....",
];
const COLOURS: Record<string, string> = {
  O: "#b3132b", R: "#f2475d", H: "#ff9aa8", E: "#3a1820", C: "#ff8094", S: "#8f1023", L: "#6fbc23", l: "#4f9418",
};

function pixels(): string {
  const out: string[] = [];
  ART.forEach((row, y) => {
    let x = 0;
    while (x < row.length) { // one rect per run of the same colour
      const c = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      if (COLOURS[c]) out.push(`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${COLOURS[c]}"/>`);
      x += w;
    }
  });
  return out.join("");
}

export const MASCOT_SVG = `<svg viewBox="0 0 14 13" width="34" height="32" shape-rendering="crispEdges" aria-hidden="true">${pixels()}</svg>`;

/** The marker's HTML: the hopping radish over its own shadow, with an optional label above its head. */
export const mascotHtml = (label?: string) =>
  `<div class="mascot">${label ? `<span class="youlabel">${label}</span>` : ""}${MASCOT_SVG}<i></i></div>`;
