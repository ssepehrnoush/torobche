"""Step 4: contacting shops to confirm price, stock and hours.

The dataset's phone numbers are fake, so the shop side is SIMULATED (clearly labelled in the UI):
each shop's answer is drawn from a seeded scenario whose odds depend on real data (how old the
registered price is, whether the shop is open right now per its declared hours). The agent side is
real: it drafts the message, runs the inquiries in parallel, reads the answers, keeps confirmed
facts separate from registered ones, and immediately proposes alternatives for failed shops.
The one exception is the demo scenario «زنده» once Kavenegar is set up: that shop gets a real text and,
if nobody taps, a real call, on the demo phone (see kavenegar.py).
"""
from __future__ import annotations

import asyncio
import hashlib
import random
import re
import secrets
import string
import time
from datetime import timedelta
from typing import AsyncIterator

from . import catalog, kavenegar, llm, shops, whatsapp
from .models import Ctx
from .timegeo import fa_digits, fa_text, now_tehran

# How a shop is reached: each shop says which channels it wants, in its own order, and the next one is
# tried only when the previous one stays unanswered. The default is a text message whose link opens a
# one-tap answer page (/r/<token>), so the answer comes back structured instead of as free text.
CHANNELS = {"whatsapp": "واتساپ", "sms": "پیامک", "bale": "پیام بله", "call": "تماس خودکار"}
CHANNEL_WAIT_S = 2.6  # simulated: how long one channel is given before the next is tried
LIVE_WAIT_S = 180.0  # demo «زنده»: how long a real tap on the shop's page is awaited, over all channels
PHONE_WAIT_S = 360.0  # a really texted shop (a tester's own phone): after its last way, this long for an answer
INBOX_EVERY_S = 3.0  # how often its WhatsApp replies are looked for
REAL_TEXT_WAIT_S = 20.0  # a real message's turn before the next channel is tried


def real_channels() -> list[str]:
    """The order a real phone is reached in: WhatsApp when the gateway is up, the text, then a call."""
    return (["whatsapp"] if whatsapp.configured() else []) + ["sms", "call"]
REPLY_TTL_S = 6 * 3600
CODE_CHARS = string.ascii_letters + string.digits  # the code rides in a Kavenegar token, which refuses «_»
HOLD_KEYS = ("hold_until", "hold_until_at", "hold_code")
NO_HOLD = dict.fromkeys(HOLD_KEYS)


def hold(hours: int) -> dict:
    """A shop keeps the item for this customer: until when, and a short code to show at the counter, which
    the shop also sees on its answer page."""
    until = now_tehran() + timedelta(hours=hours)
    return {"hold_until": fa_digits(until.strftime("%H:%M")), "hold_until_at": until.isoformat(),
            "hold_code": "".join(secrets.choice(string.digits) for _ in range(4))}

OUTCOMES = ("confirmed", "price_changed", "out_of_stock", "no_answer")
ODDS = {  # by price freshness tier
    "fresh": (0.58, 0.18, 0.10, 0.14),
    "aging": (0.42, 0.30, 0.14, 0.14),
    "stale": (0.25, 0.42, 0.19, 0.14),
    "unknown": (0.30, 0.32, 0.18, 0.20),
}


def toman_fa(v: int) -> str:
    return fa_digits(f"{v:,}").replace(",", "٫")


def contact_auth(item: dict, ctx: Ctx) -> bool:
    return ask_authenticity(item, ctx)


def ask_authenticity(item: dict, ctx: Ctx) -> bool:
    """Ask about originality when the user cares about it or our evidence is suspicious."""
    return ctx.originality == "original_only" or item["authenticity"]["status"] in ("suspicious", "declared_copy")


def draft_message(product_title: str, price: int | None, ctx: Ctx, shop_name: str, item: dict | None = None) -> str:
    lines = [f"سلام، وقت بخیر. «{product_title}» را در ترب دیدم"
             + (f" با قیمت {toman_fa(price)} تومان." if price else ".")]
    asks = ["الان موجود است؟", "قیمت امروزش چند است؟", "امروز تا چه ساعتی باز هستید؟"]
    if item and ask_authenticity(item, ctx):
        asks.append("کالا اصل (اورجینال) است یا طرح و کپی؟ گارانتی و فاکتور می‌دهید؟")
    if ctx.installments_only:
        asks.append("امکان خرید قسطی یا اعتباری دارید؟")
    asks.append("اگر موجود است، تا چند ساعت برایم نگه می‌دارید؟")
    lines += [f"{fa_digits(i + 1)}. {a}" for i, a in enumerate(asks)]
    lines.append("ممنون از راهنمایی‌تان.")
    return "\n".join(lines)


def call_script(product_title: str, price: int | None) -> list[str]:
    return [
        "سلام، وقت بخیر. از طریق ترب با فروشگاه شما آشنا شدم.",
        f"«{product_title}» را موجود دارید؟",
        f"قیمت ثبت‌شده {toman_fa(price)} تومان است؛ قیمت امروز چقدر است؟" if price else "قیمت امروزش چقدر است؟",
        "امروز تا چه ساعتی باز هستید و اگر بیایم برایم نگه می‌دارید؟",
    ]


# What shops pick in the seller panel: one, two or all three of WhatsApp, text and automated call, in their order.
PREFS = ((0.25, ["whatsapp", "sms", "call"]), (0.50, ["sms", "call"]), (0.70, ["whatsapp", "sms"]),
         (0.85, ["sms"]), (0.93, ["whatsapp"]), (1.01, ["call", "sms"]))


def contact_prefs(shop_id: str) -> list[str]:
    """The channels a shop wants to be asked on, in its order. In the real product the shop picks them in
    its Torob seller panel; the dataset has none, so they are simulated (fixed per shop, labelled in the UI)."""
    r = int(hashlib.sha256(f"prefs|{shop_id}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return next(list(p) for cut, p in PREFS if r < cut)


def sms_text(shop_name: str, product_title: str, link: str) -> str:
    """The short text a shop gets (by text message, WhatsApp or Bale), worded as the Kavenegar template
    TEMPLATE so the screen shows what the phone receives. Signed with the account's own brand: Kavenegar
    turned down «هوش مصنوعی ترب» because a template's brand must match the account's domain (lemonai.ir)."""
    return (f"فروشگاه {kavenegar.fit(shop_name, 5)}\nیک مشتری نزدیک شما این کالا را می‌خواهد: "
            f"{kavenegar.fit(product_title, 8)}\nموجود دارید؟ جواب با یک لمس:\n{link}\nهوش مصنوعی لمون")


def call_text(shop_name: str, product_title: str) -> str:
    """What the automated call reads out: it only points to the text, since a call cannot take the answer.
    It names the project (Daii's choice); only the SMS template must carry the account's own brand."""
    return (f"سلام، وقت بخیر. از هوش مصنوعی تربچه تماس می‌گیریم. یک مشتری نزدیک فروشگاه {kavenegar.fit(shop_name, 5)}، "
            f"{kavenegar.fit(product_title, 5)} را می‌خواهد. لینک جواب برایتان پیامک شد؛ "
            "با یک لمس روی آن بگویید موجود دارید یا نه. ممنون.")


# Answer pages: token -> what the shop's page shows and what the shop answered. One server process
# keeps them in memory, which is enough for an inquiry that lasts minutes.
_pages: dict[str, dict] = {}


def _new_page(pid: int, item: dict, product: dict) -> str:
    now = time.monotonic()
    for k in [k for k, v in _pages.items() if now - v["created"] > REPLY_TTL_S]:
        del _pages[k]
    tok = "".join(secrets.choice(CODE_CHARS) for _ in range(10))
    _pages[tok] = {"created": now, "pid": pid, "sid": item["sid"], "shop": item["name"], "price": item.get("price"),
                   "product": product["title"], "image": product.get("image"), "answer": None, "event": asyncio.Event()}
    return tok


def reply_page(tok: str) -> dict | None:
    p = _pages.get(tok)
    if not p:
        return None
    return {k: p[k] for k in ("shop", "price", "product", "image", "answer")}


def submit_reply(tok: str, outcome: str, price: int | None, hold_h: int | None = None) -> dict | None:
    """A tap on the shop's answer page. The first answer wins (a simulated one counts). With `hold_h` the
    shop also keeps the item that many hours, and the customer gets a reservation code."""
    p = _pages.get(tok)
    if not p:
        return None
    if p["answer"]:
        return {"ok": False, "answer": p["answer"]}
    if outcome not in ("confirmed", "price_changed", "out_of_stock") or (outcome == "price_changed" and not price):
        return {"ok": False, "error": "جواب نامعتبر"}
    p["answer"] = {"outcome": outcome, "price": price if outcome == "price_changed" else p["price"], "real": True,
                   "at": fa_digits(now_tehran().strftime("%H:%M")),
                   **(hold(hold_h) if hold_h and outcome != "out_of_stock" else NO_HOLD)}
    p["event"].set()
    return {"ok": True, "answer": p["answer"]}


_FA = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩٫٬", "01234567890123456789.,")  # and the Persian decimal and thousands marks
_NO = re.compile(r"ندار|نمی\s*دار|نیست|تموم|تمام شد|ناموجود|^\s*نه\b|نخیر")
_YES = re.compile(r"موجود|داریم|هست|بله|آره|اره|بلی|حتما|اوکی|\bok\b|\byes\b", re.I)
_PRICE = re.compile(r"(\d[\d,٬.]*)\s*(میلیون|ملیون|م\b|هزار|تومن|تومان)?")


def read_answer(text: str, price: int | None) -> dict:
    """A shopkeeper's own words (a WhatsApp reply) as an answer: in stock or not, and a price if one is written."""
    t = text.translate(_FA)
    new = None
    for num, unit in _PRICE.findall(t):
        try:
            v = float(num.replace(",", "").replace("٬", ""))
        except ValueError:
            continue
        v = v * 1_000_000 if unit in ("میلیون", "ملیون", "م") or (not unit and v < 1000) else v * 1000 if unit == "هزار" else v
        if v >= 10_000:
            new = int(v) if new is None else max(new, int(v))
    if _NO.search(t) and not re.search(r"موجوده(?!\s*نیست)", t):
        outcome = "out_of_stock"
    elif _YES.search(t) or new:
        outcome = "price_changed" if new and price and abs(new - price) > price * 0.01 else "confirmed"
    else:
        outcome = "replied"
    return {"outcome": outcome, "price": new if outcome == "price_changed" else price}


async def _watch_whatsapp(page: dict, phone: str, since_ms: int, price: int | None) -> None:
    """Until the shop answers: its WhatsApp replies become its real answer, like a tap on its page."""
    while not page["event"].is_set():
        for m in await whatsapp.inbox(phone, since_ms):
            text = (m.get("text") or "").strip()
            if text:
                page["answer"] = {**read_answer(text, price), "real": True, "via": "whatsapp", "said": text[:300],
                                  "at": fa_digits(now_tehran().strftime("%H:%M")), **NO_HOLD}
                page["event"].set()
                return
        await asyncio.sleep(INBOX_EVERY_S)


def _real_reply(item: dict, ans: dict, via: str) -> dict:
    """The customer-side reply built from a real answer: a tap on the shop's page, or its own WhatsApp words."""
    price = item.get("price")
    res = {"sid": item["sid"], "outcome": ans["outcome"], "delay_s": 0, "confirmed_price": None, "in_stock": None,
           "hours_today": None, "installments": None, "authenticity_check": None,
           "via": ans.get("via") or via, "real": True, **{k: ans.get(k) for k in HOLD_KEYS}}
    if ans.get("said"):  # the shopkeeper's own words, shown as written
        res["text"] = f"مغازه‌دار در واتساپ نوشت: «{ans['said']}»"
        res["own"] = True  # its own words, not a tap
        if ans["outcome"] == "out_of_stock":
            res["in_stock"] = False
        elif ans["outcome"] in ("confirmed", "price_changed"):
            new = ans.get("price") or price
            res.update(in_stock=True, confirmed_price=new, price_delta=(new - price) if new and price else 0)
        return res
    if ans["outcome"] == "out_of_stock":
        res["in_stock"] = False
        res["text"] = "مغازه‌دار از صفحهٔ جواب زد: «نداریم»."
    else:
        new = ans.get("price") or price
        res["in_stock"] = True
        res["confirmed_price"] = new
        res["price_delta"] = (new - price) if new and price else 0
        res["text"] = ("مغازه‌دار از صفحهٔ جواب زد: «موجوده، با همین قیمت»." if ans["outcome"] == "confirmed" else
                       f"مغازه‌دار از صفحهٔ جواب زد: «موجوده، قیمت امروز {toman_fa(new)} تومان».")
        if res["hold_until"]:
            res["text"] += f" تا ساعت {res['hold_until']} برایتان نگه می‌دارد."
    return res


def _rng(shop_id: str, pid: int) -> random.Random:
    day = now_tehran().strftime("%Y-%m-%d")
    seed = hashlib.sha256(f"{shop_id}|{pid}|{day}".encode()).hexdigest()[:12]
    return random.Random(int(seed, 16))


def simulate_reply(item: dict, s: shops.Shop, pid: int, forced: str | None = None, ask_auth: bool = False) -> dict:
    """Decide what the (simulated) shop answers. Facts come from the scenario, not from an LLM."""
    rng = _rng(s.shop_id, pid)
    now_state = item["open_now"]["state"]
    tier = item["freshness"]["tier"]
    outcome = forced if forced in OUTCOMES + ("closed",) else None
    if outcome is None:
        if now_state == "closed":
            outcome = "closed"
        else:
            r, acc = rng.random(), 0.0
            for name, p in zip(OUTCOMES, ODDS[tier]):
                acc += p
                if r <= acc:
                    outcome = name
                    break
            outcome = outcome or "confirmed"
    price = item.get("price")
    res = {"sid": s.sid, "outcome": outcome, "delay_s": round(1.2 + rng.random() * 3.2, 1),
           "confirmed_price": None, "in_stock": None, "hours_today": None, "text": None,
           "installments": None, "authenticity_check": None, **NO_HOLD}
    close = item["open_now"].get("closes_at")
    if outcome == "closed":
        res["delay_s"] = 2.0
        res["text"] = None
        res["note"] = f"تماس بی‌پاسخ ماند؛ طبق ساعت ثبت‌شده فروشگاه الان بسته است ({item['open_now']['label']})."
        return res
    if outcome == "no_answer":
        res["delay_s"] = 6.0
        res["note"] = "پیام خوانده نشد و تلفن هم جواب نداد."
        if ask_auth:
            res["authenticity_check"] = _unanswered_auth(item)
        return res
    hours_txt = f"تا ساعت {close} باز هستیم" if close else "امروز تا ۹ شب هستیم"
    res["hours_today"] = close or "۲۱:۰۰ (طبق گفتهٔ فروشنده)"
    if outcome == "out_of_stock":
        res["in_stock"] = False
        restock = rng.random() < 0.5
        res["text"] = "سلام، وقتتون بخیر. متأسفانه فعلاً تموم کردیم." + (
            " اگه بخواید تا فردا ظهر براتون جور می‌کنیم." if restock else " فعلاً هم معلوم نیست کی بیاد.")
        res["restock"] = "تا فردا ظهر" if restock else None
        return res
    res["in_stock"] = True
    if outcome == "price_changed" and price:
        pct = rng.choice([0.03, 0.05, 0.07, 0.09, 0.12, -0.04])
        new = int(round(price * (1 + pct), -4)) or price
        res["confirmed_price"] = new
        res["price_delta"] = new - price
        verb = "بالا رفته" if new > price else "یه کم پایین اومده"
        res["text"] = f"سلام، بله موجوده. ولی قیمتش {verb}، امروز {toman_fa(new)} تومنه. {hours_txt}."
    else:
        res["outcome"] = "confirmed"
        res["confirmed_price"] = price
        res["price_delta"] = 0
        res["text"] = (f"سلام، بله موجوده و قیمت همونه، {toman_fa(price)} تومن." if price
                       else "سلام، بله موجوده. قیمت رو حضوری می‌گیم.") + f" {hours_txt}."
    hold_h = rng.choice([2, 3, 4])
    res.update(hold(hold_h))
    res["text"] += f" اگه تا {fa_digits(hold_h)} ساعت دیگه بیاید براتون نگه می‌داریم."
    if s.installments:
        res["installments"] = "، ".join(s.installments)
        res["text"] += f" قسطی هم با {s.installments[0]} داریم."
    if ask_auth:
        check, sentence = _auth_answer(item, rng)
        res["authenticity_check"] = check
        res["text"] += " " + sentence
    return res


def _auth_answer(item: dict, rng: random.Random) -> tuple[dict, str]:
    """The (simulated) shop's answer about originality. Only an admission confirms a copy; a claim of
    originality is reported as the seller's claim, next to our own estimate."""
    a = item["authenticity"]
    if a["status"] == "declared_copy":
        roll = 0.0
    elif a["status"] == "suspicious":
        roll = rng.random()
    else:
        roll = 0.9
    if roll < 0.45:
        return ({"status": "confirmed_copy", "label": "غیراصل (به گفتهٔ خود فروشنده)", "confidence": 95},
                "راستش این یکی طرح اصلیه (های‌کپی)، اصلش رو الان نداریم.")
    if roll < 0.75:
        return ({"status": "unclear", "label": f"فروشنده جواب روشنی نداد؛ برآورد ما: {a['label']}",
                 "confidence": a["confidence"], "reasons": a["reasons"]},
                "کیفیتش خیلی خوبه، حضوری ببینید خودتون متوجه می‌شید.")
    sentence = "اصله و گارانتی شرکتی داره، فاکتور هم می‌دیم."
    if a["status"] == "suspicious":
        return ({"status": "claimed_original", "confidence": a["confidence"], "reasons": a["reasons"],
                 "label": f"فروشنده می‌گوید اصل است، ولی برآورد ما هنوز «{a['label']}» است"}, sentence)
    return ({"status": "claimed_original", "label": "فروشنده می‌گوید اصل است و گارانتی می‌دهد", "confidence": 75}, sentence)


def _unanswered_auth(item: dict) -> dict:
    a = item["authenticity"]
    return {"status": "unclear", "label": f"نتوانستیم از فروشنده بپرسیم؛ برآورد ما: {a['label']}",
            "confidence": a["confidence"], "reasons": a["reasons"]}


def _rank_confirmed(replies: list[dict], items: dict[int, dict]) -> list[dict]:
    ok = [r for r in replies if r["in_stock"]]
    ok.sort(key=lambda r: (r["confirmed_price"] is None, r["confirmed_price"] or 0, items[r["sid"]]["km"]))
    return ok


async def _summary_text(product: dict, replies: list[dict], items: dict[int, dict], best: dict | None,
                        n_alt: int, budget_key: str | None = None) -> str:
    facts = []
    for r in replies:
        i = items[r["sid"]]
        facts.append(f"{i['name']}: {r['outcome']}, قیمت ثبت‌شده {i.get('price')}, قیمت تأییدشده {r['confirmed_price']}, "
                     f"فاصله {i['distance_label']}, {i['open_now']['label']}")
    fallback = _template_summary(replies, items, best, n_alt)
    if not llm.available():
        return fallback
    try:
        llm.check_session_budget(budget_key)
        data = await asyncio.wait_for(llm.complete_json(
            "تو دستیار خرید حضوری هستی. نتیجهٔ استعلام (شبیه‌سازی‌شده) از فروشگاه‌ها را در حداکثر دو جملهٔ کوتاه فارسی "
            "جمع‌بندی کن: بهترین انتخاب تأییدشده و دلیلش؛ فقط اگر «تعداد جایگزین آماده» بیشتر از صفر است، بگو جایگزین آماده است. "
            "عدد قیمت را با «تومان» بنویس. خط تیره بلند و ایموجی نگذار. خروجی JSON: {\"text\": \"...\"}",
            f"کالا: {product.get('title')}\nبهترین: {items[best['sid']]['name'] if best else 'هیچ'}\n"
            f"تعداد جایگزین آماده: {n_alt}\n" + "\n".join(facts), max_tokens=300), timeout=8)
        text = fa_text((data.get("text") or "").strip())
        return text or fallback
    except Exception:
        return fallback


def _template_summary(replies, items, best, n_alt) -> str:
    ok = sum(1 for r in replies if r["in_stock"])
    failed = len(replies) - ok
    if best:
        i = items[best["sid"]]
        price = f" با قیمت تأییدشدهٔ {toman_fa(best['confirmed_price'])} تومان" if best["confirmed_price"] else ""
        txt = f"{fa_digits(ok)} فروشگاه موجودی را تأیید کردند و بهترین گزینه {i['name']}{price} در {i['distance_label']} است."
    else:
        txt = "هیچ‌کدام از فروشگاه‌ها موجودی را تأیید نکردند."
    if failed and n_alt:
        txt += f" برای {fa_digits(failed)} فروشگاه ناموفق، {fa_digits(n_alt)} جایگزین آماده کردم."
    return txt


def prepare(pid: int, sids: list[int], ctx: Ctx) -> tuple[dict | None, dict, list[dict], dict]:
    """Drafts for each shop (shown to the user before anything is sent)."""
    product = catalog.product_details(pid, 0)
    if not product:
        return None, {}, [], {"type": "error", "text": "کالا پیدا نشد"}
    loose = Ctx(**{**ctx.model_dump(), "installments_only": False, "torob_pay_only": False, "open_only": False})
    ranked = shops.rank_shops_for_product(pid, loose)
    by_sid = {i["sid"]: i for i in ranked["items"]}
    targets = [by_sid[s] for s in sids if s in by_sid][:5]
    if not targets:
        return None, {}, [], {"type": "error", "text": "این فروشگاه‌ها این کالا را ثبت نکرده‌اند"}
    start = {"type": "inquiry_start", "product": {k: product[k] for k in ("pid", "title", "image", "price_min")},
             "shops": [{"sid": t["sid"], "name": t["name"], "price": t["price"], "phone": t["phone"],
                        "freshness": t["freshness"], "open_now": t["open_now"], "distance_label": t["distance_label"],
                        "authenticity": t["authenticity"],
                        "channels": [{"k": c, "label": CHANNELS[c]} for c in contact_prefs(shops.shop(t["sid"]).shop_id)],
                        "draft": draft_message(product["title"], t["price"], ctx, t["name"], t)} for t in targets],
             "call_script": call_script(product["title"], targets[0]["price"]),
             "simulated": True,
             "notice": "شماره‌های دادهٔ هکاتون ساختگی‌اند؛ پاسخ فروشگاه‌ها شبیه‌سازی می‌شود. در نسخهٔ واقعی هر فروشگاه در پنل فروشندهٔ ترب "
                       "گفته با کدام راه‌ها (یکی، دو تا یا هر سه از واتساپ، پیامک و تماس خودکار) و به چه ترتیبی از او بپرسند."}
    return product, by_sid, targets, start


async def _reach(item: dict, channels: list[str], plan: dict, tok: str, live: bool, queue: asyncio.Queue,
                 phone: str | None = None) -> None:
    """Ask one shop on its channels in its own order. A real tap on its answer page wins at any moment;
    otherwise the simulated answer arrives on one of the channels (usually the first), or none answers.
    With `phone` (a tester or a demo phone) WhatsApp, the text and the call really go to that phone."""
    page = _pages[tok]
    watch = None
    if live and phone:  # a real phone: its WhatsApp reply counts as an answer too
        watch = asyncio.create_task(_watch_whatsapp(page, phone, int(time.time() * 1000) - 5000, item.get("price")))
    try:
        await _reach_ways(item, channels, plan, tok, live, queue, phone, page)
    finally:
        if watch:
            watch.cancel()


async def _reach_ways(item: dict, channels: list[str], plan: dict, tok: str, live: bool, queue: asyncio.Queue,
                      phone: str | None, page: dict) -> None:
    answered = plan["outcome"] not in ("no_answer", "closed")
    answer_on = 0
    if plan.get("answer_last"):
        # demo «با تماس»: the messages go unread and the automated call gets the answer
        answer_on = channels.index("call") if "call" in channels else len(channels) - 1
    elif answered and len(channels) > 1 and random.Random(tok).random() < 0.35:
        answer_on = 1  # the first channel goes unread, the next one gets the answer
    for i, ch in enumerate(channels):
        ev = {"type": "channel", "sid": item["sid"], "channel": ch, "label": CHANNELS[ch],
              "state": "calling" if ch == "call" else "sent"}
        note = None
        if phone and ch in ("whatsapp", "sms", "call"):
            if ch == "whatsapp":
                note = await whatsapp.send(phone, sms_text(item["name"], page["product"], f"{whatsapp.PUBLIC_URL}/r/{tok}"))
            elif ch == "sms":
                note = await kavenegar.send_text(phone, item["name"], page["product"], tok)
            else:
                note = await kavenegar.call(phone, call_text(item["name"], page["product"]))
            ev["real"] = note is None
            if note:
                await queue.put({"type": "error", "text": f"{CHANNELS[ch]} واقعی نرفت: {note}"})
        await queue.put(ev)
        if live and phone and note and i < len(channels) - 1:
            wait = 0.05  # this channel never left; the next one goes at once
        elif live:
            wait = (REAL_TEXT_WAIT_S if i < len(channels) - 1 else PHONE_WAIT_S) if phone else LIVE_WAIT_S / len(channels)
        elif plan["outcome"] == "closed":
            wait = 1.0
        else:
            wait = plan["delay_s"] if answered and i == answer_on else CHANNEL_WAIT_S
        try:
            await asyncio.wait_for(page["event"].wait(), timeout=wait)
            await queue.put({"type": "reply", **_real_reply(item, page["answer"], ch)})
            return
        except asyncio.TimeoutError:
            pass
        if not live and answered and i == answer_on:
            page["answer"] = {"outcome": plan["outcome"], "price": plan["confirmed_price"], "real": False,
                              "at": fa_digits(now_tehran().strftime("%H:%M")), **{k: plan.get(k) for k in HOLD_KEYS}}
            await queue.put({"type": "reply", **plan, "via": ch})
            return
        await queue.put({"type": "channel", "sid": item["sid"], "channel": ch, "label": CHANNELS[ch], "state": "no_answer"})
    if live:  # nobody tapped in time
        plan = {**plan, "outcome": "no_answer", "in_stock": None, "confirmed_price": None, **NO_HOLD,
                "text": None, "note": "در مهلتِ دمو کسی از صفحهٔ جواب پاسخ نداد."}
    if plan["outcome"] == "no_answer" and "call" not in channels and not live:
        plan = {**plan, "note": "پیام‌ها خوانده نشد."}  # this shop takes no calls, so no phone went unanswered
    page["answer"] = page["answer"] or {"outcome": "no_answer", "price": None, "real": False, "expired": True}
    await queue.put({"type": "reply", **plan})


def live_phones(sids: list[int], forced: dict[int, str] | None, tester: str | None,
                client: str | None) -> tuple[dict[int, str], dict[int, str], str | None]:
    """Which shops are really texted and called, on which phone: a tester's own number plays the first shop
    (within the per-number and per-browser caps), and «زنده» demo shops go to DEMO_SHOP_PHONES.
    Returns (forced with those shops set to «زنده», sid -> phone, a note for the screen)."""
    forced, phones, note = dict(forced or {}), {}, None
    if tester and sids:
        phone = kavenegar.normalize_phone(tester)
        if not phone:
            note = "این شماره موبایل ایران نیست؛ این بار مغازه‌ها شبیه‌سازی می‌شن"
        elif not kavenegar.configured():
            note = "پیامک و تماس واقعی الان در دسترس نیست؛ این بار مغازه‌ها شبیه‌سازی می‌شن"
        else:
            note = kavenegar.claim(phone, client)
            if not note:
                forced[sids[0]] = "live"
                phones[sids[0]] = phone
    demo = kavenegar.demo_phones() if kavenegar.enabled() else []
    live = [sid for sid in sids if forced.get(sid) == "live" and sid not in phones]
    if demo:
        phones.update({sid: demo[i % len(demo)] for i, sid in enumerate(live)})
    return forced, phones, note


async def run_inquiry(pid: int, sids: list[int], ctx: Ctx, forced: dict[int, str] | None = None,
                      budget_key: str | None = None, tester_phone: str | None = None) -> AsyncIterator[dict]:
    product, by_sid, targets, start = await asyncio.to_thread(prepare, pid, sids, ctx)
    phones: dict[int, str] = {}  # sid -> the phone that really gets this shop's text and call
    note = None
    if product:
        forced, phones, note = live_phones([t["sid"] for t in targets], forced, tester_phone, budget_key)
        for sh, t in zip(start["shops"], targets):
            sh["reply_token"] = tok = _new_page(pid, t, product)
            sh["sms"] = sms_text(t["name"], product["title"], f"/r/{tok}")  # the page prefixes its own origin
            if t["sid"] in phones:
                sh["channels"] = [{"k": c, "label": CHANNELS[c]} for c in real_channels()]
                sh["real"] = True
    yield start
    if not product:
        return
    if note:
        yield {"type": "error", "text": note}
    replies: list[dict] = []
    queue: asyncio.Queue = asyncio.Queue()
    tasks = []
    for sh, t in zip(start["shops"], targets):
        s = shops.shop(t["sid"])
        f = (forced or {}).get(t["sid"])
        plan = simulate_reply(t, s, pid, None if f == "live" else "confirmed" if f == "on_call" else f, contact_auth(t, ctx))
        if f == "on_call":
            plan = {**plan, "answer_last": True, "delay_s": 6.5}  # long enough to see the call
        tasks.append(asyncio.create_task(
            _reach(t, [c["k"] for c in sh["channels"]], plan, sh["reply_token"], f == "live", queue, phones.get(t["sid"]))))
    try:
        while len(replies) < len(tasks):
            ev = await queue.get()
            if ev["type"] == "reply":
                replies.append({k: v for k, v in ev.items() if k != "type"})
            yield ev
    finally:  # the customer left mid-inquiry: stop waiting on the shops
        for task in tasks:
            task.cancel()

    confirmed = _rank_confirmed(replies, by_sid)
    best = confirmed[0] if confirmed else None
    failed = [r["sid"] for r in replies if not r["in_stock"]]
    alternatives, similar, leads = [], [], []
    if failed or not best:
        alt = await asyncio.to_thread(shops.rank_shops_for_product, pid, ctx, "best", set(sids))
        alternatives = [i for i in alt["items"] if i["open_at_visit"]["state"] != "closed"][:3]
        if len(alternatives) < 2:
            similar = await asyncio.to_thread(catalog.similar_products, pid, ctx, 3)
            leads = await asyncio.to_thread(shops.category_only_shops, product["category"], ctx,
                                            set(sids) | {a["sid"] for a in alternatives}, 3)
    yield {"type": "status", "text": "در حال جمع‌بندی پاسخ‌ها…"}
    text = await _summary_text(product, replies, by_sid, best, len(alternatives) + len(similar), budget_key)
    yield {"type": "summary", "text": text, "best_sid": best["sid"] if best else None,
           "confirmed_sids": [r["sid"] for r in confirmed], "failed_sids": failed,
           "alternatives": alternatives, "similar": similar, "leads": leads}
    yield {"type": "done"}
