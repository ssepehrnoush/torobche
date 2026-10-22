"""Real text messages and calls to the demo shop's phone, through Kavenegar.

The dataset's shop numbers are fake, so nothing ever goes to a dataset number: only the demo scenario
«زنده» reaches out, and only to the phones in DEMO_SHOP_PHONES. The account is the same one Lemon's own
clinic messages go out on, so a daily cap keeps a stuck loop or a curious visitor from spending it.

The key travels in the URL path (Kavenegar's REST design), so httpx's request log is kept away from it.
"""
from __future__ import annotations

import logging
import os
import re

import httpx

from .timegeo import now_tehran

log = logging.getLogger("kavenegar")
API = "https://api.kavenegar.com/v1"
# Registered in the Kavenegar panel by Daii; the link's fixed part and the brand are in its own text.
TEMPLATE = os.environ.get("KAVENEGAR_TEMPLATE", "torobche-inquiry")
DAILY_CAP = int(os.environ.get("KAVENEGAR_DAILY_CAP", "30"))  # texts and calls together, per Tehran day
ERRORS = {
    424: "الگوی پیامک در کاوه‌نگار هنوز تأیید نشده",
    418: "اعتبار کاوه‌نگار تمام شده",
    420: "کاوه‌نگار لینک داخل پیامک را نمی‌پذیرد",
}


class _HideKey(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "api.kavenegar.com" not in record.getMessage()


logging.getLogger("httpx").addFilter(_HideKey())

_used: dict[str, int] = {}


def _key() -> str:
    return os.environ.get("KAVENEGAR_API_KEY", "").strip()


def normalize_phone(s: str) -> str | None:
    d = s.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    d = re.sub(r"^00", "", re.sub(r"\D", "", d))
    if d.startswith("98"):
        d = "0" + d[2:]
    elif d.startswith("9") and len(d) == 10:
        d = "0" + d
    return d if re.fullmatch(r"09\d{9}", d) else None


def demo_phones() -> list[str]:
    out = [normalize_phone(x) for x in re.split(r"[,،;\n]+", os.environ.get("DEMO_SHOP_PHONES", "")) if x.strip()]
    return [p for p in out if p]


def enabled() -> bool:
    return bool(_key() and demo_phones())


def fit(text: str, spaces: int, limit: int = 100) -> str:
    """A token value Kavenegar takes: one line, at most `spaces` spaces and `limit` characters, no «_»."""
    words = re.sub(r"[\s_]+", " ", text).strip().split(" ")
    return " ".join(words[: spaces + 1])[:limit].strip()


def _spend() -> bool:
    day = now_tehran().strftime("%Y-%m-%d")
    n = _used.get(day, 0)
    if n >= DAILY_CAP:
        return False
    _used.clear()
    _used[day] = n + 1
    return True


async def _get(method: str, params: dict) -> str | None:
    """None when Kavenegar took it, otherwise a short Persian note for the customer's screen."""
    if not _spend():
        return "سقف روزانهٔ پیامک و تماس دمو پر شده"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(f"{API}/{_key()}/{method}.json", params=params)
        status = (r.json().get("return") or {}).get("status", r.status_code)
    except Exception as e:  # the message of some httpx errors carries the URL, so only the type is logged
        log.warning("%s failed: %s", method, type(e).__name__)
        return "ارتباط با کاوه‌نگار برقرار نشد"
    if status == 200:
        return None
    log.warning("%s refused: %s", method, status)
    return ERRORS.get(status, f"کاوه‌نگار نپذیرفت (خطای {status})")


async def send_text(phone: str, shop: str, product: str, code: str) -> str | None:
    return await _get("verify/lookup", {"receptor": phone, "template": TEMPLATE, "token": code,
                                        "token10": fit(shop, 5), "token20": fit(product, 8)})


async def call(phone: str, text: str) -> str | None:
    return await _get("call/maketts", {"receptor": phone, "message": text})
