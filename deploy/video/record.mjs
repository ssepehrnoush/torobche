// Records the demo from a real run of the app at phone size: drives the page-builder wizard in headless Chrome,
// captures frames, speeds up the waits for the AI, shows a soft dot where each tap lands, and times every scene
// to its voice clips (voice.py). Every screen, request and answer is real; the shop's one-tap answer page is
// opened as a second "phone" and tapped there, like the shopkeeper would.
//   node deploy/video/record.mjs [baseUrl]          (default: the local recording server, torobche-rec)
//   then: python -I deploy/video/build.py
// The browser clock is set to the server's FIXED_NOW (a Saturday morning) so shops are open, as on the server.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith("http")) || "http://127.0.0.1:8095";
const OUT = join(ROOT, "_video", "rec");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9343;
const W = 390, H = 844, DPR = 1.25; // 488x1055 frames
const CLOCK = Date.parse("2026-10-24T07:30:00Z"); // 11:00 in Tehran, the recording server's FIXED_NOW
const NEED = "یه هدفون بی‌سیم خوب می‌خوام، مدلش رو نمی‌دونم. نزدیک میدان ولیعصر، با ماشین";

const narration = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8")).scenes;
const voice = JSON.parse(readFileSync(join(ROOT, "_video", "voice", "manifest.json"), "utf8"));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "frames"), { recursive: true });
const log = (...a) => { const line = [new Date().toISOString().slice(11, 19), ...a].join(" "); console.log(line); appendFileSync(join(OUT, "log.txt"), `${line}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- chrome + cdp
const proc = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "tbv-"))}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--enable-unsafe-swiftshader", // WebGL for the 3D mall `--window-size=${W},${H}`,
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "about:blank",
], { stdio: "ignore" });
const quit = (code, why) => { log(why); proc.kill(); process.exit(code); };

async function pageUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("chrome did not start");
}

/** One page target: its own websocket, cdp() and js(). The main phone and the shopkeeper's phone are two of these. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  // every request has a deadline: one lost reply must not freeze the whole recording
  const cdp = (method, params = {}, ms = 15000) => new Promise((res, rej) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method}: no reply in ${ms} ms`)); }, ms);
    pending.set(id, (m) => { clearTimeout(timer); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async (expr) => {
    try { return (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value; }
    catch (e) { log("js failed:", e.message, expr.slice(0, 60)); return undefined; }
  };
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  // the phone's clock reads Saturday 11:00, moving on in real time, like the recording server
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const off = ${CLOCK} - Date.now(); const D = Date;
    class FakeDate extends D { constructor(...a) { a.length ? super(...a) : super(D.now() + off); } static now() { return D.now() + off; } }
    globalThis.Date = FakeDate; })();` });
  return { ws, cdp, js };
}

const main = await connect(await pageUrl());
let screen = main; // the phone whose frames are recorded right now
const js = (expr) => main.js(expr);

// ---------------------------------------------------------------- virtual clock and frames
// Waits for the AI run at 4x in the final video; everything else is real time.
const rec = { frames: [], cues: [], scenes: [], vt: 0, last: Date.now(), speed: 1, n: 0 };
const tick = () => { const now = Date.now(); rec.vt += (now - rec.last) / rec.speed; rec.last = now; return rec.vt; };
const setSpeed = (s) => { tick(); rec.speed = s; };
let capturing = false;
async function captureLoop() {
  while (capturing) {
    const began = Date.now();
    const t = tick();
    try {
      const { data } = await screen.cdp("Page.captureScreenshot", { format: "jpeg", quality: 84 }, 4000);
      if (!rec.frames.length || t - rec.frames.at(-1).t >= 33) { // at most ~30 fps of final video
        const file = `f${String(++rec.n).padStart(6, "0")}.jpg`;
        writeFileSync(join(OUT, "frames", file), Buffer.from(data, "base64"));
        rec.frames.push({ t: Math.round(t), file });
      }
    } catch { /* page busy navigating: next round */ }
    await sleep(Math.max(0, 66 - (Date.now() - began)));
  }
}
const hold = async (sec) => { setSpeed(1); await sleep(sec * 1000); tick(); };

// ---------------------------------------------------------------- narration timing
let scene = null;
let voiceEnd = 0; // virtual ms when the last clip that was started ends
function beginScene(id) {
  scene = narration.find((s) => s.id === id);
  if (!scene) throw new Error(`no scene ${id}`);
  scene.lineIx = 0;
  rec.scenes.push({ id, title: scene.title, step: scene.step, start: Math.round(tick()) });
  log("SCENE", id);
}
async function say(alt = null) {
  const wait = voiceEnd + 250 - tick(); // the next line starts when the previous clip has finished (plus a breath)
  if (wait > 0) await hold(wait / 1000);
  const lid = alt || `${scene.id}-${scene.lineIx}`; // alt: another wording of this line, for what this take shows
  scene.lineIx++;
  const v = voice[lid];
  if (!v) throw new Error(`no voice clip for ${lid}`);
  const start = tick();
  rec.cues.push({ id: lid, scene: scene.id, start: Math.round(start), dur: v.dur, file: v.file, text: v.text });
  voiceEnd = start + v.dur * 1000;
  log("SAY", lid, v.text.slice(0, 40));
}
/** A recording that is not narration (the call in the demo) placed at this moment; the next line waits for it. */
function clip(id) {
  const v = voice[id];
  if (!v) throw new Error(`no clip ${id}`);
  const start = tick();
  rec.cues.push({ id, scene: scene.id, start: Math.round(start), dur: v.dur, file: v.file, text: v.text });
  voiceEnd = start + v.dur * 1000;
  log("CLIP", id);
}
function sayNow(alt = null) {
  const lid = alt || `${scene.id}-${scene.lineIx}`;
  scene.lineIx++;
  const v = voice[lid];
  if (!v) throw new Error(`no voice clip for ${lid}`);
  rec.cues.push({ id: lid, scene: scene.id, start: Math.round(rec.vt), dur: v.dur, file: v.file, text: v.text });
  voiceEnd = rec.vt + v.dur * 1000;
  log("SAY", lid, v.text.slice(0, 40));
}
/** Film the 3D mall frame by frame: the screenshot loop pauses and the model is stepped exactly 1/30 s per frame,
    so the walk is smooth however slow the software renderer is. `lines` are [second, alt] to say on the way. */
async function film3d(sec, lines = []) {
  capturing = false;
  await capture;
  tick();
  await js("window.__mall3d.manual(true); true");
  const todo = [...lines];
  for (let i = 0; i < Math.round(sec * 30); i++) {
    while (todo.length && i / 30 >= todo[0][0]) sayNow(todo.shift()[1]);
    await js("window.__mall3d.step(1 / 30)");
    const { data } = await screen.cdp("Page.captureScreenshot", { format: "jpeg", quality: 84 }, 15000);
    rec.vt += 1000 / 30;
    const file = `f${String(++rec.n).padStart(6, "0")}.jpg`;
    writeFileSync(join(OUT, "frames", file), Buffer.from(data, "base64"));
    rec.frames.push({ t: Math.round(rec.vt), file });
  }
  await js("window.__mall3d.manual(false); true");
  rec.last = Date.now();
  capturing = true;
  capture = captureLoop();
}
async function untilSpoken(extra = 0) {
  const wait = voiceEnd + extra * 1000 - tick();
  if (wait > 0) await hold(wait / 1000);
}
async function endScene(pad = 0.5) {
  const wait = voiceEnd + pad * 1000 - tick();
  if (wait > 0) await hold(wait / 1000);
  rec.scenes.at(-1).end = Math.round(tick());
}

// ---------------------------------------------------------------- page helpers
async function waitFor(expr, ms = 60000, fast = true, page = main) {
  if (fast) setSpeed(4);
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < ms) {
    if (await page.js(`!!(${expr})`)) { ok = true; break; }
    await sleep(250);
  }
  setSpeed(1);
  if (!ok) log("timeout waiting for", expr);
  // a screen built by the plain rule means the model was not there for this take: record again later
  if (await main.js("[...document.querySelectorAll('.gen-badge')].some((b) => b.textContent.includes('صفحهٔ آماده'))")) {
    quit(3, "FALLBACK: a screen came from the plain rule during this take");
  }
  return ok;
}
const TAP_CSS = `.__tap{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(233,30,51,.28);
  border:2px solid rgba(233,30,51,.55);pointer-events:none;z-index:2147483647;animation:__tap .6s ease-out forwards}
  @keyframes __tap{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.5);opacity:0}}`;
async function tapEl(expr, { scroll = true, page = main } = {}) {
  const ok = await page.js(`(() => { const el = ${expr}; if (!el) return false;
    ${scroll ? "el.scrollIntoView({ block: 'center', behavior: 'smooth' });" : ""} return true })()`);
  if (!ok) { log("missing", expr.slice(0, 90)); return false; }
  if (scroll) await hold(0.45);
  await page.js(`(() => { const el = ${expr}; const r = el.getBoundingClientRect();
    if (!document.getElementById('__tapcss')) { const s = document.createElement('style'); s.id = '__tapcss'; s.textContent = ${JSON.stringify(TAP_CSS)}; document.head.append(s); }
    const d = document.createElement('div'); d.className = '__tap'; d.style.left = (r.left + r.width / 2) + 'px'; d.style.top = (r.top + r.height / 2) + 'px';
    document.body.append(d); setTimeout(() => d.remove(), 700); return true })()`);
  await hold(0.18);
  await page.js(`(() => { (${expr})?.click(); return true })()`);
  await hold(0.3);
  return true;
}
const byText = (text, sel = "button") =>
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}))`;
const NEXT = "document.querySelector('.wz-btns .btn.grow')";
const ready = "!document.querySelector('.wz-wait')";
async function type(sel, text) {
  // type like a person: a few characters at a time into the React-controlled input
  for (let i = 2; i <= text.length + 1; i += 2) {
    await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}.slice(0, ${i}));
      el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`);
    await sleep(45);
  }
  tick();
}
async function slide(end, to, sec = 1.6) {
  // drag one end of the budget slider (0 the floor, 1 the top) from where it rests to `to`, in small steps a hand would make
  const el = `document.querySelectorAll('.gen-budget input[type=range]')[${end}]`;
  const from = await js(`+${el}.value`);
  const steps = Math.round(sec * 20);
  for (let i = 1; i <= steps; i++) {
    const v = Math.round(from + ((to - from) * i) / steps);
    await js(`(() => { const el = ${el};
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${v});
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`);
    await sleep(50);
  }
  tick();
}
async function typeInput(sel, text) {
  // the same, for a one-line input (talking to the map)
  for (let i = 2; i <= text.length + 1; i += 2) {
    await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}.slice(0, ${i}));
      el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`);
    await sleep(45);
  }
  tick();
}
async function smoothScroll(dy, sec = 1.2, sel = null) {
  const steps = Math.max(1, Math.round(sec * 30));
  for (let i = 0; i < steps; i++) {
    await js(`(() => { const el = ${sel ? `document.querySelector(${JSON.stringify(sel)})` : "null"};
      (el || window).scrollBy(0, ${dy / steps}); return true })()`);
    await sleep(1000 / 30);
  }
  tick();
}

// ---------------------------------------------------------------- start
await main.cdp("Page.navigate", { url: `${BASE}/?demo` });
await sleep(1500);
await js("localStorage.clear(); sessionStorage.clear(); location.reload(); true");
await sleep(3000);
rec.last = Date.now();
capturing = true;
let capture = captureLoop();
await hold(0.4);

// 1) home
beginScene("home");
await say();
await hold(1.2);
await smoothScroll(220, 1.2);
await say();
await hold(1.0);
await smoothScroll(-220, 0.9);
await say();
// Torob's categories under the hero: one opens its leaves from the dataset, with their product counts, in place
await untilSpoken(-1.2);
await tapEl("document.querySelector('.wz-cat')", { scroll: false });
await hold(0.3);
await say();
await hold(1.4);
await untilSpoken(0.2);
await tapEl("document.querySelector('.wz-cat.on')", { scroll: false });
await endScene(0.3);

// 2) the need in one sentence; the model builds the next screen (a budget slider from real prices)
beginScene("need");
await tapEl("document.querySelector('.wz-field textarea')", { scroll: false });
await say();
await type(".wz-field textarea", NEED);
await untilSpoken(0.2);
await tapEl(NEXT, { scroll: false });
await waitFor(`${ready} && document.querySelector('.gen-badge')`);
if (!(await js("!!document.querySelector('.gen-budget')"))) quit(4, "NO-BUDGET: the model built another screen this time; the narration needs the slider");
await hold(0.6);
await say();
await hold(1.2);
await say();
await hold(2.4);
// both ends: the top down to about 5 million, then the floor up a little (the whole range to begin with)
const [bMin, bMax, bStep] = await js("(() => { const i = document.querySelector('.gen-budget input[type=range]'); return [+i.min, +i.max, +i.step]; })()");
await slide(1, Math.min(bMax, Math.max(bMin + 4 * bStep, 5_100_000)));
await hold(0.4);
await slide(0, Math.round((bMin + (Math.min(bMax, 5_100_000) - bMin) * 0.18) / bStep) * bStep, 1.2);
log("budget", bMin, bMax, bStep, await js("document.querySelector('.gen-budget-v')?.innerText"));
await untilSpoken(0.2);
await tapEl(NEXT, { scroll: false });
await endScene(0);

// 3) products
beginScene("products");
for (let i = 0; i < 3; i++) {
  await waitFor(`${ready} && document.querySelector('.gen-badge')`);
  if (await js("document.querySelectorAll('.wz-prod').length >= 2")) break;
  // the model asked one more thing (e.g. which model): leave the pick to the assistant, as a buyer who does not know would
  await hold(1.2);
  await tapEl(byText("فرقی نمی‌کنه", "button"));
}
// the model that shows the floor view best later: the most other shops of one mall nearby with it
setSpeed(8);
const prodIx = await js(`(async () => {
  const ctx = JSON.parse(localStorage.getItem('bazargard.ctx') || '{}');
  const post = async (url, body) => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const pids = [...document.querySelectorAll('.wz-prod')].map((b) => +b.dataset.pid);
  let best = 0, score = -1;
  for (let k = 0; k < pids.length; k++) {
    const r = await post('/api/shops', { pid: pids[k], ctx, sort: 'best', exclude: [] });
    // the map is asked for the three cheapest open shops later, so a model with few shops nearby comes last
    let sc = r.items.filter((i) => i.in_radius && i.open_at_visit?.state !== 'closed').length >= 6 ? 0 : -100000;
    for (const c of r.items.filter((i) => i.in_radius && i.mall_name).slice(0, 6)) {
      const b = (await post('/api/shop', { sid: c.sid, pid: pids[k], ctx })).mall_building;
      if (b) sc = Math.max(sc, (sc < 0 ? -100000 : 0) + (c.mall_name === 'پاساژ علاالدین' ? 1000 : 0) + Math.min(b.offers, 3) * 100 + b.floors.length);
    }
    if (sc > score) { score = sc; best = k; }
  }
  return best })()`);
setSpeed(1);
log("product", prodIx);
await hold(0.5);
await say();
await hold(1.4);
await tapEl(`document.querySelectorAll('.wz-prod')[${prodIx || 0}]`);
await say();
await untilSpoken(0.2);
await tapEl(NEXT, { scroll: false });
await endScene(0);

// 4) shops: the model's pick with its reason, open-at-arrival, price age, conditions changed in place
beginScene("shops");
await waitFor("document.querySelectorAll('.wz-shop').length >= 1 && document.querySelector('.gen-best, .gen-badge')", 20000);
await hold(0.8);
await say();
await untilSpoken(-1.0);
await smoothScroll(490, 1.8); // past the map strip to the cards
await say();
await hold(2.5);
await js("window.scrollTo({ top: 0, behavior: 'smooth' }); true");
await hold(0.6);
await say();
await hold(1.2);
await tapEl("[...document.querySelectorAll('.wz-cond button')].find((b) => b.textContent.includes('دقیقه'))", { scroll: false });
await hold(0.8);
await tapEl(byText("تا ۳۰ دقیقه", ".wz-cond-pop button"), { scroll: false });
await waitFor("document.querySelectorAll('.wz-shop').length >= 1 && document.querySelector('.gen-best, .gen-badge')", 20000);
// the map strip opens full size: each shop a Torob-logo pin with its price; then the map is told what to show
await untilSpoken(-0.6);
await tapEl(byText("فروشگاه‌ها روی نقشه", ".wz-mapbtn"), { scroll: false });
await hold(0.5);
await js("document.querySelector('.wz-shopmap')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); true");
await say();
await untilSpoken(-1.5);
await tapEl("document.querySelector('.mapask-box input')", { scroll: false });
await typeInput(".mapask-box input", "ارزون‌ترین سه تا که الان بازن");
await hold(0.3);
await tapEl("document.querySelector('.mapask-box .sendbtn')", { scroll: false });
await waitFor("document.querySelector('.mapask-say')", 20000);
const asked = await js("document.querySelector('.mapask-say')?.innerText");
log("map ask:", asked);
if (!/^۳ مغازه/.test(asked || "")) quit(6, "MAP-ASK: the map did not pin three shops this time");
await js("document.querySelector('.wz-shopmap')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); true");
await hold(1.6);
await say();
await hold(3.2);
await tapEl(byText("همینا رو انتخاب کن", ".mapask-say button"), { scroll: false });
await untilSpoken(0.4);
await tapEl(byText("کوچیک کن", ".wz-mapbtn"), { scroll: false });
await endScene(0.3);

// 5) finding the shop inside the passage: a near shop that sits in a mall
beginScene("mall");
const mallName = await js(`(async () => { const s = JSON.parse(sessionStorage.getItem('torobche.gen') || '{}');
  const ctx = JSON.parse(localStorage.getItem('bazargard.ctx') || '{}');
  const r = await (await fetch('/api/shops', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid: s.pid, ctx, sort: 'best', exclude: [] }) })).json();
  const rows = [...document.querySelectorAll('.wz-shop')].map((x) => x.textContent);
  const cands = r.items.filter((i) => i.in_radius && i.mall_name && rows.some((t) => t.includes(i.name)));
  // the one whose floor view has the most to show: other shops of the mall with the same product, then floors
  let best = null, score = -1;
  for (const c of cands.slice(0, 6)) {
    const d = await (await fetch('/api/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: c.sid, pid: s.pid, ctx }) })).json();
    const b = d.mall_building;
    const sc = b ? (c.mall_name === 'پاساژ علاالدین' ? 1000 : 0) + Math.min(b.offers, 3) * 100 + b.floors.length : -1;
    if (sc > score) { score = sc; best = c; }
  }
  return best ? best.name : null })()`);
log("mall shop:", mallName);
await tapEl(mallName
  ? `[...document.querySelectorAll('.wz-shop')].find((x) => x.textContent.includes(${JSON.stringify(mallName || "")}))?.querySelector('.wz-info')`
  : "document.querySelector('.wz-shop .wz-info')");
await waitFor("document.querySelector('.sheet')", 15000, false);
await hold(0.6);
await say();
await hold(0.8);
// the way in as a short story: the mall's door, the lift counting to the shop's floor, the shop's unit plate
await js("document.querySelector('.sheet .mstory-open')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
await untilSpoken(0.2);
await tapEl("document.querySelector('.sheet .mstory-open')", { scroll: false });
await waitFor("document.querySelector('.mstory')", 8000, false);
await hold(0.4);
await say();
await waitFor("document.querySelector('.mstory')?.dataset.card === '2'", 15000, false);
await hold(3.4);
await untilSpoken(0.2);
await tapEl("document.querySelector('.mstory-x')", { scroll: false });
await hold(0.4);
await endScene();
await tapEl("document.querySelector('.backdrop')", { scroll: false });
await hold(0.4);

// 6) the inquiry: three shops at once, each on the channels it picked
beginScene("inquiry");
await js("window.scrollTo({ top: 0, behavior: 'smooth' }); true");
for (let i = 0; i < 6; i++) {
  if ((await js("document.querySelectorAll('.wz-shop .selbox.on').length")) >= 3) break;
  await tapEl("[...document.querySelectorAll('.wz-shop .selbox')].find((b) => !b.classList.contains('on'))?.closest('button')");
}
await tapEl(NEXT, { scroll: false });
await waitFor("document.querySelectorAll('.scenario').length >= 3 && document.querySelector('.bubble-out')", 20000, false);
await hold(0.6);
await say();
const ways = JSON.parse(await js("JSON.stringify([...document.querySelectorAll('.wz-iq')].map((q) => (q.querySelector('.wz-iq-ch')?.dataset.ways || '').split(',').filter(Boolean)))"));
const callIx = [1, 2].filter((i) => ways[i]?.at(-1) === "call").sort((a, b) => ways[b].length - ways[a].length)[0]
  ?? [1, 2].find((i) => ways[i]?.includes("call"));
log("ways", JSON.stringify(ways), "call shop", callIx);
const plan = callIx ? [[0, "زنده"], [callIx, "با تماس"], [3 - callIx, "تغییر قیمت"]] : [[0, "زنده"], [1, "تغییر قیمت"], [2, "بی‌پاسخ"]];
for (const [ix, label] of plan) {
  await tapEl(`(() => { const row = document.querySelectorAll('.scenario')[${ix}]; return row && [...row.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(label)}) })()`);
}
await js("document.querySelector('.wz-iq-ch')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
await say();
await hold(2.0);
await smoothScroll(200, 1.4);
await untilSpoken(0.2);
// the call can be tried for real: with «خودت جای مغازه‌دار جواب بده» and one's own number, Kavenegar really rings
await js("document.querySelector('.wz-tester')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
await hold(0.6);
await say();
await untilSpoken(0.3);
await tapEl(NEXT, { scroll: false });
// each shop hears about it on its own ways, drawn in pixels in its card; the AI's call plays its own recording
await waitFor("document.querySelector('.sheet')", 8000, false);
await hold(0.8);
await tapEl(`document.querySelector('.sheet .iconbtn[aria-label="بستن"]') || document.querySelector('.backdrop')`, { scroll: false });
await hold(0.3);
await js("window.scrollTo({ top: 0, behavior: 'smooth' }); true");
await say();
if (callIx) {
  const card = `document.querySelectorAll('.wz-iq')[${callIx}]`;
  await waitFor(`${card}?.querySelector('.chan[data-call="talk"]')`, 25000, false);
  await js(`${card}?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true`);
  clip("call-ai");
  await waitFor(`${card}?.querySelector('.chan[data-call="seller"]')`, 25000, false);
  clip("call-seller");
  await waitFor(`${card}?.querySelector('.chan.done')`, 15000, false);
  await hold(1.4);
}
await untilSpoken(0.3);
await endScene(0);

// 7) the shopkeeper's phone: the one-tap answer page of the first shop, tapped like the shopkeeper would
beginScene("shopkeeper");
await waitFor("document.querySelector('.wz-tally')", 20000, false);
await hold(0.8);
await say();
// in the «زنده» demo scenario the app opens the text the shop got (QR for a second phone); its signature is read now
if (!(await js("!!document.querySelector('.sheet')"))) await tapEl("document.querySelector('.wz-shoplink')");
await waitFor("document.querySelector('.sheet')", 10000, false);
await say();
await untilSpoken(-2.0);
const token = await js("(() => { const s = JSON.parse(sessionStorage.getItem('torobche.gen') || '{}'); return s.inq?.shops?.[0]?.reply_token || null })()");
if (!token) quit(5, "NO-TOKEN: the first shop has no answer page");
const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${BASE}/r/${token}`, { method: "PUT" })).json();
const shop = await connect(created.webSocketDebuggerUrl);
await shop.cdp("Page.navigate", { url: `${BASE}/r/${token}` });
await waitFor("document.querySelector('.sr-yes')", 15000, false, shop);
screen = shop;
await untilSpoken(0.2);
await hold(0.6);
await tapEl(byText("۲ ساعت", ".sr-keep button"), { scroll: false, page: shop });
await say();
await hold(1.6);
await tapEl("document.querySelector('.sr-yes')", { page: shop });
await waitFor("document.querySelector('.sr-code')", 10000, false, shop);
await untilSpoken(0.6);
await endScene(0);

// 8) back on the customer's phone: the answer and its reservation code have arrived; the rest come in
beginScene("replies");
screen = main;
// the shopkeeper's phone is done: close it, two live pages make every screenshot of the first one slow
shop.ws.close();
await fetch(`http://127.0.0.1:${PORT}/json/close/${created.id}`).catch(() => {});
if (await js("!!document.querySelector('.sheet')")) await tapEl("document.querySelector('.sheet .iconbtn[aria-label=\"بستن\"]') || document.querySelector('.backdrop')", { scroll: false });
await waitFor("document.querySelector('.wz-hold')", 15000, false);
await js("document.querySelector('.wz-hold')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
await hold(0.6);
await say();
await waitFor("document.querySelectorAll('.wz-in').length >= 3", 90000);
await hold(0.4);
await smoothScroll(260, 1.4);
await say(callIx ? null : "replies-1-plain"); // with no shop that takes calls, the older wording
await waitFor("document.querySelector('.ainote')", 40000);
await js("document.querySelector('.ainote')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
await endScene(0.8);

// 9) the visit plan: route on real streets, the confirmed price, the reservation countdown
beginScene("visit");
await tapEl(NEXT, { scroll: false });
await waitFor("document.querySelector('.leaflet-container')", 20000, false);
await hold(1.2);
await say();
await hold(2.0);
await js("document.querySelector('.wz-hold')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); true");
await hold(0.8);
await say();
await hold(2.4);
await js("document.querySelector('.wz-btns .btn.grow')?.scrollIntoView({ block: 'end', behavior: 'smooth' }); window.scrollBy(0, 200); true");
await endScene();

// 10) transparency
beginScene("outro");
await tapEl(`document.querySelector('[aria-label="دربارهٔ داده و روش کار"]')`, { scroll: false });
await waitFor("document.querySelector('.sheet')", 10000, false);
await say();
await hold(1.5);
await smoothScroll(420, 2.2, ".sheet .sheetbody");
scene.lineIx++; // outro-1 (the voice conversation that was tried) is no longer said, to keep the video near five minutes
await untilSpoken(0.6);
await smoothScroll(300, 1.6, ".sheet .sheetbody");
await say();
await endScene(1.0);

capturing = false;
await capture;
const end = Math.round(tick());
writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ frames: rec.frames, cues: rec.cues, scenes: rec.scenes, end }, null, 1));
log(`recorded ${rec.frames.length} frames, ${(end / 1000).toFixed(1)} s, ${rec.cues.length} voice cues -> ${OUT}`);
main.ws.close();
proc.kill();
process.exit(0);
