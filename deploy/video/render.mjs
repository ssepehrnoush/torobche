// Renders HTML files to 1920x1080 PNGs in one headless Chrome session (starting Chrome once per image
// crashed or hung every few renders on Windows).
//   node deploy/video/render.mjs a.html b.html ...   -> a.png b.png ... next to each html
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9361;
const profile = mkdtempSync(join(tmpdir(), "bzr-"));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url;
for (let i = 0; i < 60 && !url; i++) {
  try { url = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch { /* starting */ }
  if (!url) await sleep(250);
}
if (!url) { proc.kill(); throw new Error("chrome did not start"); }
const ws = new WebSocket(url);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const cdp = (method, params = {}, ms = 20000) => new Promise((res, rej) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method}: no reply`)); }, ms);
  pending.set(id, (m) => { clearTimeout(timer); m.error ? rej(new Error(m.error.message)) : res(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
for (const file of process.argv.slice(2)) {
  await cdp("Page.navigate", { url: pathToFileURL(file).href });
  // wait for the page and its web font before taking the picture
  for (let i = 0; i < 40; i++) {
    const r = await cdp("Runtime.evaluate", { expression: "document.readyState === 'complete' && document.fonts.status === 'loaded'", returnByValue: true });
    if (r.result.value) break;
    await sleep(100);
  }
  await sleep(120);
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(file.replace(/\.html$/, ".png"), Buffer.from(data, "base64"));
}
ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold a file */ }
console.log(`rendered ${process.argv.length - 2} images`);
process.exit(0);
