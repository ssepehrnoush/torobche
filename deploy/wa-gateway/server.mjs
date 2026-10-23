// WhatsApp gateway for Torobche's inquiry, on countv (Australia): WhatsApp is filtered inside Iranian data
// centres, so the WAHA app on Liara could never connect. Built on Baileys (open source, WhatsApp Web's
// multi-device protocol) and linked to one ordinary WhatsApp account with a pairing code.
//
// It answers the few WAHA endpoints the app uses, with the same shapes, so backend/app/whatsapp.py does not
// care which gateway sits behind WAHA_URL. Listens on 127.0.0.1 only; nginx (wa.lemonai.ir) adds TLS, and
// every request must carry X-Api-Key.
import fs from "node:fs";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";

const PORT = Number(process.env.WA_PORT || 3010);
const KEY = Buffer.from(process.env.WA_API_KEY || "");
const AUTH_DIR = new URL("./auth/", import.meta.url).pathname;
const log = pino({ level: "warn" });

let sock = null;
let status = "IDLE"; // IDLE (not linked, waiting for a pairing request), STARTING, SCAN_QR_CODE, WORKING, LOGGED_OUT
let me = null;
let gen = 0; // each connection's number: events of a retired socket are ignored
let qrReady = null; // settles once the current socket can take a pairing request
// the shop's own answers: the last texts people sent this account, for the app to show as a real reply.
// Only the sender's number, the text and the time are kept, in memory, and never more than 200.
const inbox = [];
const jidOf = new Map(); // phone -> the chat id WhatsApp gave for it (may be a privacy id, not the number)
const digits = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
const textOf = (m) => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption ||
  m?.buttonsResponseMessage?.selectedDisplayText || m?.ephemeralMessage?.message?.conversation ||
  m?.ephemeralMessage?.message?.extendedTextMessage?.text || "";

const linked = () => fs.existsSync(new URL("./auth/creds.json", import.meta.url)) &&
  JSON.parse(fs.readFileSync(new URL("./auth/creds.json", import.meta.url), "utf8")).registered === true;

async function connect() {
  const my = ++gen;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const s = makeWASocket({ auth: state, logger: log, browser: Browsers.ubuntu("Chrome"), markOnlineOnConnect: false, syncFullHistory: false });
  sock = s;
  status = "STARTING";
  let ready;
  qrReady = new Promise((r) => (ready = r));
  s.ev.on("creds.update", saveCreds);
  s.ev.on("messages.upsert", ({ messages }) => {
    if (my !== gen) return;
    for (const msg of messages || []) {
      if (msg.key?.fromMe) continue;
      const text = textOf(msg.message);
      if (!text) continue;
      const k = msg.key || {};
      const pn = [k.remoteJid, k.remoteJidAlt, k.senderPn, k.participantPn].find((j) => String(j || "").endsWith("@s.whatsapp.net"));
      inbox.push({ jid: k.remoteJid || "", from: digits(pn), text: String(text).slice(0, 600), ts: Number(msg.messageTimestamp) * 1000 || Date.now() });
      if (inbox.length > 200) inbox.shift();
    }
  });
  s.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (my !== gen) return;
    if (qr) {
      status = "SCAN_QR_CODE";
      ready();
    }
    if (connection === "open") {
      status = "WORKING";
      me = s.user?.id ?? null;
      console.log("whatsapp connected");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("whatsapp closed", code);
      if (code === DisconnectReason.loggedOut) { // unlinked from the phone: forget it, so a new pairing can start
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        me = null;
        status = "LOGGED_OUT";
        return;
      }
      if (!s.authState.creds.registered) { // nobody linked in time: wait for the next pairing request instead of
        status = "IDLE"; //                     churning connections, which would void a code already handed out
        return;
      }
      setTimeout(() => my === gen && connect(), 3000); // linked: a dropped line or WhatsApp's restart after linking
    }
  });
}

/** A fresh connection for each pairing request, so the code stays good for that connection's whole life. */
async function pair(phone) {
  gen++; // retire the old socket before it closes
  try {
    sock?.end?.(undefined);
  } catch {
    /* already closed */
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  await connect();
  await Promise.race([qrReady, new Promise((_, no) => setTimeout(() => no(new Error("whatsapp did not answer")), 20_000))]);
  return sock.requestPairingCode(phone);
}

const allowed = (req) => {
  const got = Buffer.from(String(req.headers["x-api-key"] || ""));
  return KEY.length > 0 && got.length === KEY.length && timingSafeEqual(got, KEY);
};

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 16_384) reject(new Error("too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (!allowed(req)) return send(res, 401, { message: "Unauthorized", statusCode: 401 });
  try {
    if (req.method === "GET" && url.pathname === "/api/sessions/default") {
      return send(res, 200, { name: "default", status, me: me ? { id: me } : null });
    }
    if (req.method === "POST" && url.pathname === "/api/default/auth/request-code") {
      const phone = String((await body(req)).phoneNumber || "").replace(/\D/g, "");
      if (!phone) return send(res, 400, { message: "phoneNumber missing" });
      if (status === "WORKING") return send(res, 409, { message: "already linked" });
      return send(res, 201, { code: await pair(phone) });
    }
    if (status !== "WORKING") return send(res, 503, { message: `whatsapp ${status}` });
    if (req.method === "GET" && url.pathname === "/api/contacts/check-exists") {
      const phone = String(url.searchParams.get("phone") || "").replace(/\D/g, "");
      const [hit] = phone ? await sock.onWhatsApp(phone) : [];
      if (hit?.jid) jidOf.set(phone, hit.jid);
      return send(res, 200, { numberExists: !!hit?.exists, chatId: hit?.jid ?? null });
    }
    if (req.method === "POST" && url.pathname === "/api/sendText") {
      const { chatId, text } = await body(req);
      if (!chatId || !text) return send(res, 400, { message: "chatId and text needed" });
      const sent = await sock.sendMessage(chatId, { text: String(text).slice(0, 2000) });
      return send(res, 201, { id: sent?.key?.id ?? null });
    }
    if (req.method === "GET" && url.pathname === "/api/inbox") {
      // what one number wrote since a moment (ms): matched by its number, or by the chat id WhatsApp gave for it
      const phone = String(url.searchParams.get("phone") || "").replace(/\D/g, "");
      const since = Number(url.searchParams.get("since") || 0);
      if (!phone) return send(res, 400, { message: "phone needed" });
      const jid = jidOf.get(phone);
      const got = inbox.filter((m) => m.ts >= since && (m.from === phone || (jid && m.jid === jid)));
      return send(res, 200, { messages: got.map(({ text, ts }) => ({ text, ts })) });
    }
    return send(res, 404, { message: "Not Found" });
  } catch (e) {
    log.warn({ err: String(e?.message || e) }, "request failed");
    return send(res, 500, { message: "failed" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`wa gateway on 127.0.0.1:${PORT}`));

if (linked()) connect(); // not linked yet: stay idle until a pairing code is asked for
