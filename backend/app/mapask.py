"""Talking to the shops map: one sentence about which shops to show («فقط بازها»، «قسطی‌ها»، «ارزون‌ترین سه تا») becomes a
filter over the shops already on the map. The model only reads the request; which shops match, and the sentence that
says so, come from the shops' own facts, so a count or a price is never made up. Without the model, plain rules."""
from __future__ import annotations

import asyncio
import re

from . import llm
from .timegeo import fa_digits

SYSTEM = (
    "You turn a Persian request about which shops to show on a map into a JSON filter. Keys, each null when not asked: "
    "open (true: only shops open when the person gets there), installment (true: only shops that sell in instalments), "
    "authentic (true: only originals, no copies), in_mall (true: only shops inside a mall or passage), "
    "max_price and min_price (toman, integers; «۴ میلیون» is 4000000, «۹۰۰ تومن» in a phone context means 900000), "
    "max_minutes (integer: how far, in minutes of travel), sort (\"price\" for cheapest first, \"minutes\" for nearest first, "
    "\"fresh\" for the most recently updated price), limit (integer: how many). Answer with JSON only."
)
_FA = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٫٬", "01234567890123456789.,")
_WORD_N = {"یک": 1, "یه": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "هفت": 7, "هشت": 8, "ده": 10}


def _rules(text: str) -> dict:
    t = text.translate(_FA)
    f: dict = {}
    if re.search(r"باز", t):
        f["open"] = True
    if re.search(r"قسط|اقساط|اعتبار", t):
        f["installment"] = True
    if re.search(r"اصل|اورجینال|غیر\s*کپی|اوریجینال", t):
        f["authentic"] = True
    if re.search(r"پاساژ|مجتمع|مال\b|مرکز خرید", t):
        f["in_mall"] = True
    m = re.search(r"(?:زیر|کمتر از|تا|حداکثر)\s*(\d+(?:\.\d+)?)\s*(میلیون|ملیون|هزار)?", t)
    if m and (m.group(2) or float(m.group(1)) > 1000) and "دقیقه" not in t[m.end():m.end() + 8]:
        v = float(m.group(1))
        f["max_price"] = int(v * 1_000_000 if m.group(2) in ("میلیون", "ملیون") or v < 1000 else v * 1000 if m.group(2) == "هزار" else v)
    m = re.search(r"(\d+)\s*دقیقه", t)
    if m:
        f["max_minutes"] = int(m.group(1))
    if re.search(r"ارزون|ارزان|کم\s*قیمت|ارزونتر", t):
        f["sort"] = "price"
    elif re.search(r"نزدیک", t):
        f["sort"] = "minutes"
    elif re.search(r"تازه|به\s*روز|آپدیت", t):
        f["sort"] = "fresh"
    m = re.search(r"(\d+)\s*تا", t)
    if m:
        f["limit"] = int(m.group(1))
    else:
        for w, n in _WORD_N.items():
            if re.search(rf"(?:^|\s){w}\s*(?:تا|تای|مغازه)", t):
                f["limit"] = n
    return f


async def read(text: str) -> dict:
    """The filter a sentence asks for: the model's reading when it answers in time, the rules otherwise."""
    rules = _rules(text)
    if not llm.available():
        return rules
    try:
        got = await asyncio.wait_for(llm.complete_json(SYSTEM, text, max_tokens=200), timeout=6)
    except Exception:
        return rules
    keys = ("open", "installment", "authentic", "in_mall", "max_price", "min_price", "max_minutes", "sort", "limit")
    f = {k: got.get(k) for k in keys if got.get(k) not in (None, False, "", 0)}
    return f or rules


def apply(f: dict, shops: list[dict]) -> list[dict]:
    out = []
    for s in shops:
        if f.get("open") and s.get("open") != "open":
            continue
        if f.get("installment") and not s.get("installment"):
            continue
        if f.get("authentic") and s.get("copy"):
            continue
        if f.get("in_mall") and not s.get("mall"):
            continue
        p = s.get("price")
        if f.get("max_price") and (not p or p > f["max_price"]):
            continue
        if f.get("min_price") and (not p or p < f["min_price"]):
            continue
        if f.get("max_minutes") and (s.get("minutes") or 999) > f["max_minutes"]:
            continue
        out.append(s)
    key = {"price": lambda s: s.get("price") or 9e12, "minutes": lambda s: s.get("minutes") or 999,
           "fresh": lambda s: s.get("days") if s.get("days") is not None else 999}.get(f.get("sort") or "")
    if key:
        out.sort(key=key)
    if f.get("limit"):
        out = out[: max(1, int(f["limit"]))]
    return out


def _short(p: int | None) -> str:
    if not p:
        return "بی‌قیمت"
    return fa_digits(f"{p / 1_000_000:.1f}".rstrip("0").rstrip(".").replace(".", "٫")) + " میلیون" if p >= 1_000_000 else fa_digits(f"{p:,}".replace(",", "٬")) + " تومان"


def say(f: dict, hits: list[dict], total: int) -> str:
    """The one sentence of the reply, from the filter and the shops that matched (never from the model)."""
    if not hits:
        return "با این شرط مغازه‌ای روی نقشه نیست؛ یه شرط رو بردار یا محدوده رو بزرگ‌تر کن."
    words = []
    if f.get("open"):
        words.append("باز")
    if f.get("installment"):
        words.append("قسطی")
    if f.get("authentic"):
        words.append("اصل")
    if f.get("in_mall"):
        words.append("داخل پاساژ")
    if f.get("max_price"):
        words.append(f"زیر {_short(f['max_price'])}")
    if f.get("max_minutes"):
        words.append(f"تا {fa_digits(f['max_minutes'])} دقیقه")
    what = "، ".join(words)
    n = fa_digits(len(hits))
    head = f"{n} مغازه{'ٔ ' + what if what else ''} از {fa_digits(total)} تا رو پین کردم" if what or len(hits) < total else f"همهٔ {n} مغازه رو پین کردم"
    first = hits[0]
    tail = {"price": f"ارزون‌ترین: «{first['name']}» با {_short(first.get('price'))}",
            "minutes": f"نزدیک‌ترین: «{first['name']}»، {fa_digits(first.get('minutes') or 0)} دقیقه",
            "fresh": f"تازه‌ترین قیمت: «{first['name']}»"}.get(f.get("sort") or "")
    return f"{head}؛ {tail}." if tail else f"{head}."


async def ask(text: str, shops: list[dict]) -> dict:
    f = await read(text)
    hits = apply(f, shops)
    return {"filter": f, "sids": [s["sid"] for s in hits], "say": say(f, hits, len(shops))}
