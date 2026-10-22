"""Real WhatsApp messages for the inquiry, through the WAHA gateway (deploy/deploy_waha.py).

WhatsApp's official business API is closed to Iran, so this goes through WAHA, an open-source gateway
that drives an ordinary WhatsApp account linked like WhatsApp Web. Only the same people as the text
message are ever reached: a tester's own number or a demo phone (contact.live_phones), within its caps.
"""
from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("whatsapp")
SESSION = "default"
# where the shop's answer page lives; a WhatsApp message needs the full link, unlike the SMS template
PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://torobche.liara.run").rstrip("/")


def _url() -> str:
    return os.environ.get("WAHA_URL", "").strip().rstrip("/")


def _key() -> str:
    return os.environ.get("WAHA_API_KEY", "").strip()


def configured() -> bool:
    return bool(_url() and _key())


async def send(phone: str, text: str) -> str | None:
    """Send to a 09… number. None when WhatsApp took it, otherwise a short Persian note for the screen."""
    if not configured():
        return "واتساپ وصل نیست"
    intl = "98" + phone[1:]
    try:
        async with httpx.AsyncClient(timeout=15, headers={"X-Api-Key": _key()}) as c:
            r = await c.get(f"{_url()}/api/contacts/check-exists", params={"phone": intl, "session": SESSION})
            if r.status_code != 200:
                log.warning("check-exists: %s", r.status_code)
                return "واتساپ الان در دسترس نیست"
            d = r.json()
            if not d.get("numberExists"):
                return "این شماره واتساپ ندارد"
            r = await c.post(f"{_url()}/api/sendText", json={
                "session": SESSION, "chatId": d.get("chatId") or f"{intl}@c.us", "text": text, "linkPreview": True})
    except Exception as e:
        log.warning("send failed: %s", type(e).__name__)
        return "ارتباط با واتساپ برقرار نشد"
    if r.status_code in (200, 201):
        return None
    log.warning("sendText: %s", r.status_code)
    return "واتساپ پیام را نفرستاد"
