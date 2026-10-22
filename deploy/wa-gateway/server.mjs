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
let status = "STARTING"; // STARTING, SCAN_QR_CODE (waiting to be linked), WORKING, LOGGED_OUT
let me = null;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  sock = makeWASocket({ auth: state, logger: log, browser: Browsers.ubuntu("Chrome"), markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) status = "SCAN_QR_CODE";
    if (connection === "open") {
      status = "WORKING";
      me = sock.user?.id ?? null;
      console.log("whatsapp connected");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log("whatsapp closed", code);
      if (code === DisconnectReason.loggedOut) { // unlinked from the phone: forget it, so a new pairing can start
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        me = null;
      }
      status = code === DisconnectReason.loggedOut ? "LOGGED_OUT" : "STARTING";
      setTimeout(connect, 3000);
    }
  });
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
      if (sock?.authState?.creds?.registered) return send(res, 409, { message: "already linked" });
      return send(res, 201, { code: await sock.requestPairingCode(phone) });
    }
    if (status !== "WORKING") return send(res, 503, { message: `whatsapp ${status}` });
    if (req.method === "GET" && url.pathname === "/api/contacts/check-exists") {
      const phone = String(url.searchParams.get("phone") || "").replace(/\D/g, "");
      const [hit] = phone ? await sock.onWhatsApp(phone) : [];
      return send(res, 200, { numberExists: !!hit?.exists, chatId: hit?.jid ?? null });
    }
    if (req.method === "POST" && url.pathname === "/api/sendText") {
      const { chatId, text } = await body(req);
      if (!chatId || !text) return send(res, 400, { message: "chatId and text needed" });
      const sent = await sock.sendMessage(chatId, { text: String(text).slice(0, 2000) });
      return send(res, 201, { id: sent?.key?.id ?? null });
    }
    return send(res, 404, { message: "Not Found" });
  } catch (e) {
    log.warn({ err: String(e?.message || e) }, "request failed");
    return send(res, 500, { message: "failed" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`wa gateway on 127.0.0.1:${PORT}`));

connect();
