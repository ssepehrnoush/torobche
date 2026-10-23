"""Generative UI: the model builds the next wizard screen itself.

The fixed wizard asks the same questions in the same order. Here every screen after «چی می‌خوای بخری؟» is
chosen by the model from a small, fixed box of blocks, one block per screen, so it can skip what the
person already said and pick the widget that fits (a budget slider made from the item's real prices, a
short comparison when two candidates are close, the map when the place is still unknown). Data in a
block always comes from the catalogue, never from the model: it only names the block and the product ids
it saw in the search results. If the model is slow, unavailable or answers with something invalid, a
plain rule picks the screen instead, so the flow never stalls.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from . import authenticity, catalog, llm, shops
from .agent import fmt_search, prefetch_query, quick_prefs
from .models import Ctx, range_label
from .places import PLACES

log = logging.getLogger("genui")
BLOCKS = ("choice", "budget", "place", "travel", "products", "compare")
TRAVEL_WORDS = re.compile(r"پیاده|مترو|اتوبوس|با ماشین|ماشین دارم|تاکسی|\d+\s*(?:دقیقه|دیقه)|[۰-۹]+\s*(?:دقیقه|دیقه)")
LLM_TIMEOUT_S = 6.0  # past this the plain rule builds the screen, so nobody waits on a busy shared key
MAX_SCREENS = 6  # after this many generated screens the products are shown, whatever the model says

TOOL = {"type": "function", "function": {
    "name": "render_screen",
    "description": "Build the next screen of the shopping wizard: exactly one block.",
    "parameters": {"type": "object", "properties": {
        "block": {"type": "string", "enum": list(BLOCKS)},
        "title": {"type": "string", "description": "The screen's one question, short colloquial Persian (e.g. «کدوم برند؟»)"},
        "why": {"type": "string", "description": "One short Persian line telling the person why this screen comes now"},
        "options": {"type": "array", "items": {"type": "string"}, "description": "choice: 2-6 short options from the real data"},
        "multi": {"type": "boolean", "description": "choice: several options may be picked"},
        "pids": {"type": "array", "items": {"type": "integer"}, "description": "products: 2-4 ids, compare: 2-3 ids, only from the search results"},
        "search": {"type": "string", "description": "optional new search keywords when the answers changed what to look for"},
        "brand": {"type": "string", "description": "optional brand filter for that search, exactly as in the brand facet"},
    }, "required": ["block", "title", "why"]},
}}

SYSTEM = """تو طراحِ صفحه‌های یک دستیارِ خریدِ حضوری روی دادهٔ ترب هستی. هر بار فقط «صفحهٔ بعد» را با ابزارِ render_screen می‌سازی؛ هر صفحه دقیقاً یک بلوک دارد:
- choice: یک سؤالِ کوتاه با ۲ تا ۶ گزینه که از دادهٔ واقعی آمده (برندها، دسته‌ها، نوعِ کاربری). برای فهمیدنِ چیزی که در نیاز مبهم است.
- budget: اسلایدرِ دوسرِ بودجه (از چه قیمتی تا چه قیمتی) که بازه‌اش را سیستم از قیمت‌های واقعیِ همین کالا می‌سازد؛ عنوانش بازه را بپرسد، نه فقط سقف. فقط اگر بودجه نامشخص است و قیمت‌ها پخش‌اند (صدکِ ۹۰ دستِ‌کم سه برابرِ صدکِ ۱۰).
- place: نقشه برای انتخابِ جای خرید. اگر جای خرید هنوز نامشخص است، پیش از products و compare حتماً همین را بساز.
- travel: پیاده یا ماشین یا مترو و چند دقیقه راه. فقط بعد از place و اگر هنوز نامشخص است.
- products: ۲ تا ۴ کالا از نتایجِ جستجو (pids). وقتی نیاز به اندازهٔ کافی روشن است.
- compare: ۲ یا ۳ کالای نزدیک به هم برای مقایسهٔ کوتاه، وقتی کاربر بینِ چند مدلِ شبیه مردد است یا گفته مدل را نمی‌داند و نتایجِ برتر خیلی شبیه‌اند.
پیش از هر چیز نتایجِ جستجو را با نیاز بسنج: اگر کالاها از جنسِ خودِ نیاز نیستند (قطعهٔ یدکی، قاب، گلس یا لوازمِ جانبی به‌جای خودِ دستگاه، یا دستهٔ دیگری)، search را با کلیدواژهٔ ساده‌تر و درست‌تر بده (مثلاً «گوشی سامسونگ» به‌جای «گوشی سامسونگ دوربین»)، گزینه‌ها و pidها را از این نتایجِ نادرست نساز، و block را products بگذار؛ سیستم دوباره جستجو می‌کند و کالاها را خودش می‌گذارد.
قاعده‌ها: هر چیزی که کاربر گفته یا جواب داده را دوباره نپرس. کم‌ترین تعدادِ صفحه را بساز؛ اگر نیاز روشن است مستقیم برو سراغِ products. گزینه‌ها و pidها را فقط از دادهٔ زیر بردار و از خودت نساز. اگر جوابِ کاربر چیزِ دیگری برای جستجو خواست، search (و اگر برند گفت brand) را بده. title و why فارسیِ خودمانی و کوتاه، بدونِ خطِ تیرهٔ بلند و ایموجی."""


def _tool(ctx: Ctx, known: dict) -> dict:
    """This turn's box: a block for something the person already said (place, travel, a budget) is not offered
    at all, so the model cannot pick it and fall back to the plain rule."""
    blocks = [b for b in BLOCKS if not ((b == "place" and known.get("place")) or (b == "travel" and known.get("travel"))
                                        or (b == "budget" and known.get("budget")))]
    tool = json.loads(json.dumps(TOOL))
    tool["function"]["parameters"]["properties"]["block"]["enum"] = blocks
    return tool


def _known(ctx: Ctx, known: dict) -> str:
    budget = "مهم نیست" if known.get("budget") else "نامشخص"
    if ctx.budget_max or ctx.budget_min:
        budget = (f"از {ctx.budget_min:,} " if ctx.budget_min else "") + (f"تا {ctx.budget_max:,}" if ctx.budget_max else "به بالا") + " تومان"
    return "\n".join([
        f"- جای خرید: {ctx.place if known.get('place') else 'هنوز نامشخص'}",
        f"- رفت‌وآمد: {range_label(ctx) if known.get('travel') else 'هنوز نامشخص'}",
        f"- بودجه: {budget} | فقط قسطی: {'بله' if ctx.installments_only else 'خیر'} | "
        f"اصالت: {'فقط اورجینال' if ctx.originality == 'original_only' else 'نگفته'}",
    ])


def _search(q: str, ctx: Ctx, brand: str | None) -> dict:
    res = catalog.search_products(q, ctx, brand=brand or None, max_price=ctx.budget_max, min_price=ctx.budget_min or None, limit=8)
    for it in res["items"]:  # the model reads it too (fmt_search), so it can prefer the originals
        it["copy_hint"] = authenticity.product_hint(it["title"], it["category"], it["brand"], it.get("price_median") or it.get("price_min"))
    return res


def _first_search(need: str, ctx: Ctx) -> tuple[str, dict]:
    """The need's keywords, shortened from the end until the catalogue recognises a product type:
    «گوشی سامسونگ دوربین» finds camera spare parts, «گوشی سامسونگ» finds phones. The dropped words
    (what the person wants from it) stay in the need the model reads."""
    words = (prefetch_query(need) or need).split()
    for n in range(len(words), 0, -1):
        q = " ".join(words[:n])
        res = _search(q, ctx, None)
        if res["facets"].get("intent_category") and res["items"]:
            return q, res
        if n == len(words):
            first = (q, res)
    return first


def _budget_block(res: dict) -> dict | None:
    pts = [p for p in (res.get("facets") or {}).get("price_points") or [] if p and p > 0]
    if len(pts) < 3:
        return None
    lo, hi = pts[0], pts[-1]
    step = max(10_000, int(round((hi - lo) / 20, -4)) or 10_000)
    return {"min": max(step, int(lo // step * step)), "max": int(-(-hi // step) * step), "step": step, "median": pts[len(pts) // 2]}


def _cards(res: dict, pids: list[int]) -> list[dict]:
    by = {it["pid"]: it for it in res["items"]}
    return [{k: by[p].get(k) for k in ("pid", "title", "brand", "image", "price_min", "nearby_min_price", "n_nearby", "n_shops", "copy_hint")}
            for p in pids if p in by]


# what most people weigh first; colour and long descriptions never decide anything
KEY_SPECS = ("دوربین", "حافظه", "رم", "باتری", "نمایشگر", "صفحه", "پردازنده", "شارژ", "وزن", "جنس", "سایز", "گارانتی")
SKIP_ROWS = ("رنگ", "توضیحات", "ابعاد")


def _compare(pids: list[int], ctx: Ctx, need: str = "") -> dict:
    """A short comparison: only the rows that differ, the ones the need mentions first, then the usual
    deciding specs, six at most."""
    res = catalog.compare_products(pids)
    near = catalog.nearby_offer_stats([p["pid"] for p in res["products"]], ctx)
    for p in res["products"]:
        p.update(near.get(p["pid"], {}))
        p["copy_hint"] = authenticity.product_hint(p["title"], p["category"], p["brand"], p.get("price_median") or p.get("price_min"))
    words = [w for w in need.split() if len(w) > 2]

    def rank(r: dict) -> tuple:
        k = r["key"]
        return (not any(w in k for w in words), not any(s in k for s in KEY_SPECS))

    rows = [r for r in res["rows"] if r["differs"] and not any(s in r["key"] for s in SKIP_ROWS)]
    rows.sort(key=rank)
    res["rows"] = [{**r, "values": [v[:60] if v else v for v in r["values"]]} for r in rows[:6]]
    return res


def rule_screen(res: dict, ctx: Ctx, known: dict, n: int) -> dict:
    """The plain fallback: place, then travel, then a budget slider when prices spread, then products."""
    if not known.get("place"):
        return {"block": "place", "title": "کجا می‌خوای خرید کنی؟", "why": "تا مغازه‌های همون دور و بر رو پیدا کنم."}
    if not known.get("travel"):
        return {"block": "travel", "title": "با چی می‌خوای بری؟", "why": "تا فقط مغازه‌هایی رو نشون بدم که زود بهشون می‌رسی."}
    pts = (res.get("facets") or {}).get("price_points") or []
    if not known.get("budget") and len(pts) == 5 and pts[0] and pts[-1] >= 3 * pts[0] and n < MAX_SCREENS:
        return {"block": "budget", "title": "بودجه‌ت حدوداً چقدره؟", "why": "قیمت‌های این کالا خیلی پخشه."}
    pids = [it["pid"] for it in res["items"][:4]]
    if pids:
        return {"block": "products", "title": "کدوم رو می‌خوای؟", "why": "این‌ها به نیازت نزدیک‌ترن.", "pids": pids}
    return {"block": "products", "title": "چیزی پیدا نکردم", "why": "توی کاتالوگ ترب چیزی با این توضیح نبود؛ یه جور دیگه بنویس.",
            "pids": []}


def _valid(s: dict, res: dict, known: dict) -> bool:
    if s.get("block") not in BLOCKS or not s.get("title"):
        return False
    ids = {it["pid"] for it in res["items"]}
    if s["block"] == "choice":
        opts = [o for o in s.get("options") or [] if isinstance(o, str) and o.strip()]
        return 2 <= len(opts) <= 6
    if s["block"] in ("products", "compare"):
        pids = list(dict.fromkeys(p for p in s.get("pids") or [] if p in ids))
        lo, hi = (2, 3) if s["block"] == "compare" else (1, 4)
        s["pids"] = pids[:hi]
        return known.get("place", False) and lo <= len(pids)
    if s["block"] == "budget":
        return not known.get("budget")
    if s["block"] == "place":  # never ask again what the person already said («میدون ولیعصر رو گفتی، ولی...»)
        return not known.get("place")
    if s["block"] == "travel":
        return bool(known.get("place")) and not known.get("travel")
    return True


async def next_screen(need: str, answers: list[dict], ctx: Ctx, known: dict, search: dict | None,
                      budget_key: str | None = None) -> dict:
    """The next screen, with its data filled in. Returns the screen, the context and what is known after
    the person's words, and the search to keep for the next turn."""
    # «کتونی برای پیاده‌روی» is about the shoes, not about walking to the shop
    text = " ".join([need] + [str(a.get("a", "")) for a in answers]).replace("پیاده‌روی", " ").replace("پیاده روی", " ")
    ctx, changed = quick_prefs(text, ctx)
    # said counts as known even when it matches what the context already held (quick_prefs reports changes only)
    known = {"place": bool(known.get("place") or "lat" in changed or "place" in changed),
             "travel": bool(known.get("travel") or {"travel_mode", "range_minutes"} & changed.keys() or TRAVEL_WORDS.search(text))}
    if not known["place"]:  # a named place counts even when it is the app's default (quick_prefs skips those)
        for p in PLACES:
            key = p["label"].replace("میدان ", "").split(" (")[0]
            if len(key) > 2 and key in text:
                ctx = ctx.model_copy(update={"lat": p["lat"], "lon": p["lon"], "place": p["label"]})
                known["place"] = True
                break
    for a in answers:  # a budget slider answer carries its numbers (top, floor; 0 is no limit), never parsed from text
        top = a.get("budget") if isinstance(a.get("budget"), int) and a["budget"] > 0 else 0
        floor = a.get("budget_min") if isinstance(a.get("budget_min"), int) and a["budget_min"] > 0 else 0
        if top or floor:
            ctx = ctx.model_copy(update={"budget_max": top or None, "budget_min": floor})
    known["budget"] = bool(ctx.budget_max or any(isinstance(a.get("budget"), int) for a in answers))
    brand = (search or {}).get("brand")
    if (search or {}).get("q"):
        q = search["q"]
        res = await asyncio.to_thread(_search, q, ctx, brand)
    else:
        q, res = await asyncio.to_thread(_first_search, need, ctx)
    if not res["items"] and answers:  # nothing found: the latest answer may say it better than the need did
        q2, res2 = await asyncio.to_thread(_first_search, str(answers[-1].get("a", "")), ctx)
        if res2["items"]:
            q, brand, res = q2, None, res2
    screen, source = None, "rule"
    if llm.available() and len(answers) < MAX_SCREENS:
        history = "\n".join(f"- {a.get('q')}: {a.get('a')}" for a in answers) or "- هنوز چیزی نپرسیده‌ای"
        user = (f"نیازِ کاربر: {need}\n\nسؤال‌ها و جواب‌های قبلی:\n{history}\n\nآنچه معلوم است:\n{_known(ctx, known)}\n\n"
                f"نتایجِ جستجو برای «{q}»{' با برندِ ' + brand if brand else ''}:\n{fmt_search(res)}")
        try:
            llm.check_session_budget(budget_key)
            msg = await asyncio.wait_for(llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                                                  tools=[_tool(ctx, known)], tool_choice={"type": "function", "function": {"name": "render_screen"}},
                                                  temperature=0.2, max_tokens=500), timeout=LLM_TIMEOUT_S)
            call = (msg.get("tool_calls") or [{}])[0].get("function", {})
            s = json.loads(call.get("arguments") or "{}")
            if s.get("search") or s.get("brand"):  # the answers changed what to look for
                q2, b2 = s.get("search") or q, s.get("brand") or brand
                res2 = await asyncio.to_thread(_search, q2, ctx, b2)
                if res2["items"]:
                    q, brand, res = q2, b2, res2
                    if s.get("block") in ("products", "compare") and not set(s.get("pids") or []) & {i["pid"] for i in res["items"]}:
                        s["pids"] = [i["pid"] for i in res["items"][:3 if s["block"] == "compare" else 4]]
            if _valid(s, res, known):
                screen, source = s, "model"
            else:
                log.info("model screen rejected: %s", s.get("block"))
        except Exception as e:  # slow, unavailable or malformed: the rule decides
            log.warning("model screen failed: %s", type(e).__name__)
    if not screen:
        screen = rule_screen(res, ctx, known, len(answers))
    if screen["block"] == "budget" and not _budget_block(res):  # no price spread to build a slider from
        screen, source = rule_screen(res, ctx, {**known, "budget": True}, len(answers)), "rule"
    block = screen["block"]
    out = {"block": block, "title": screen["title"], "why": screen.get("why") or "", "source": source}
    if block == "choice":
        out.update(options=[o.strip() for o in screen.get("options") or [] if isinstance(o, str) and o.strip()][:6],
                   multi=bool(screen.get("multi")))
    elif block == "budget":
        out["budget"] = _budget_block(res)
    elif block == "products":
        pids = [p for p in screen.get("pids") or [] if isinstance(p, int)][:4]
        out["products"] = _cards(res, pids) if pids or not res["items"] else _cards(res, [i["pid"] for i in res["items"][:4]])
    elif block == "compare":
        out["compare"] = await asyncio.to_thread(_compare, [p for p in screen["pids"] if isinstance(p, int)][:3], ctx, need)
    return {"screen": out, "ctx": ctx.model_dump(), "known": known, "search": {"q": q, "brand": brand}}


# ---------------------------------------------------------------------------------------
# The shops screen: the model decides how to show them, the list itself stays the same
# ---------------------------------------------------------------------------------------
SHOP_LAYOUTS = ("best", "list", "map", "bargain", "expand")
SHOP_TOOL = {"type": "function", "function": {
    "name": "render_shops",
    "description": "Decide how the shops screen opens: one layout on top of the usual list.",
    "parameters": {"type": "object", "properties": {
        "layout": {"type": "string", "enum": list(SHOP_LAYOUTS)},
        "title": {"type": "string", "description": "The screen's title, short colloquial Persian"},
        "why": {"type": "string", "description": "One short Persian line: why the screen opens like this"},
        "best_sid": {"type": "integer", "description": "best: the one shop recommended, from the list"},
        "reason": {"type": "string", "description": "best: one short Persian line on why that shop"},
    }, "required": ["layout", "title", "why"]},
}}
SHOP_SYSTEM = """تو صفحهٔ «مغازه‌ها»ی یک دستیارِ خریدِ حضوری را می‌چینی. فهرستِ مغازه‌ها همیشه هست؛ تو فقط تصمیم می‌گیری بالای آن چه بیاید (layout):
- best: فقط وقتی ارزان‌ترین مغازهٔ باز و بی‌هشدار دست‌کم ۵٪ از دومی ارزان‌تر است، یا هم‌قیمت است ولی خیلی نزدیک‌تر. best_sid و reason را بده؛ reason باید عددِ واقعی داشته باشد (مثلاً «۸٪ ارزون‌تر از بعدی و ۶ دقیقه پیاده»)، و اگر مغازه‌های ارزان‌تری هست که موقعِ رسیدن بسته‌اند یا ساعتِ همین مغازه ثبت نشده، همین را صادقانه بگو (مثلاً «ارزون‌ترین مغازه‌ای که موقع رسیدنت بسته نیست؛ ساعتش ثبت نشده، بپرس»).
- map: وقتی دست‌کم سه مغازه اختلافِ قیمت‌شان کمتر از ۱۰٪ است، پس جای مغازه تصمیم را عوض می‌کند؛ نقشه با برچسبِ قیمت نشان داده می‌شود.
- bargain: وقتی «پیشنهادِ دورتر» هست و صرفه‌اش دست‌کم ۵٪ قیمت است.
- expand: فقط وقتی در محدوده هیچ مغازه‌ای نیست.
- list: بقیهٔ حالت‌ها.
title و why فارسیِ خودمانی و کوتاه، بدونِ خطِ تیرهٔ بلند و ایموجی. sid را فقط از فهرستِ زیر بردار."""


def _shops_brief(res: dict, need: str, ctx: Ctx) -> str:
    near = [i for i in res["items"] if i["in_radius"]]
    lines = [f"نیاز: {need}", f"محدوده: {range_label(ctx)} | مغازه در محدوده: {len(near)} از {res['stats']['total']}"]
    clean = sorted((i for i in near if i["price"] and not i.get("price_warning") and i["open_at_visit"]["state"] != "closed"),
                   key=lambda i: i["price"])
    if len(clean) >= 2:
        gap = round(100 * (clean[1]["price"] - clean[0]["price"]) / clean[1]["price"])
        spread = round(100 * (clean[min(2, len(clean) - 1)]["price"] - clean[0]["price"]) / clean[0]["price"])
        closed = [i for i in near if i["price"] and i["price"] < clean[0]["price"] and i["open_at_visit"]["state"] == "closed"]
        lines.append(f"ارزان‌ترین مغازه‌ای که موقعِ رسیدن بسته نیست و هشدار ندارد: sid={clean[0]['sid']}، "
                     f"{gap}٪ ارزان‌تر از دومین مغازهٔ بسته‌نشده؛ اختلافِ قیمتِ سه مغازهٔ اول: {spread}٪"
                     + (f"؛ {len(closed)} مغازهٔ ارزان‌تر هم هست ولی موقعِ رسیدن بسته‌اند" if closed else "")
                     + ("؛ ساعتِ کاریِ همین مغازه ثبت نشده" if clean[0]["open_at_visit"]["state"] == "unknown" else ""))
    for i in near[:8]:
        warn = []
        if i.get("price_warning"):
            warn.append("قیمت مشکوک")
        if (i.get("authenticity") or {}).get("status") in ("suspicious", "declared_copy"):
            warn.append("اصالت مشکوک")
        lines.append(f"sid={i['sid']} | {i['name']} | {i['price'] or 'بی‌قیمت'} تومان | {i['travel']['label']} | "
                     f"{i['open_at_visit']['label']}" + (f" | هشدار: {'، '.join(warn)}" if warn else ""))
    if res.get("bargain"):
        b = res["bargain"]
        lines.append(f"پیشنهادِ دورتر: {b['name']} | {b['price']} تومان | صرفه {b.get('saving')} تومان | {b.get('travel_label')}")
    return "\n".join(lines)


def _cheaper_by(res: dict, sid: int | None) -> float:
    """How many percent this shop is cheaper than the next open, unwarned shop near by (0 when it is not): a
    «پیشنهاد من» that says «ارزون‌تر» needs a real gap, never «۰٪ ارزون‌تر»."""
    clean = [i for i in res["items"] if i["in_radius"] and i["price"] and not i.get("price_warning")
             and i["open_at_visit"]["state"] != "closed"]
    me = next((i for i in clean if i["sid"] == sid), None)
    others = [i["price"] for i in clean if i["sid"] != sid]
    if not me or not others:
        return 0.0
    return max(0.0, 100 * (min(others) - me["price"]) / min(others))


def shops_rule(res: dict) -> dict:
    near = [i for i in res["items"] if i["in_radius"]]
    if not near:
        return {"layout": "expand", "title": "این دور و بر نیست", "why": "توی محدوده‌ات مغازه‌ای این کالا رو نداره."}
    b = res.get("bargain")
    if b and (b.get("saving") or 0) > 0:
        return {"layout": "bargain", "title": "از کدوم فروشگاه‌ها بپرسیم؟", "why": "یه جای کمی دورتر خیلی ارزون‌تره."}
    clean = [i for i in near if i["price"] and not i.get("price_warning") and i["open_at_visit"]["state"] != "closed"]
    if len(clean) >= 2:
        first, second = sorted(clean, key=lambda i: i["price"])[:2]
        if first["price"] <= 0.95 * second["price"]:
            hours = "موقع رسیدنت بازه" if first["open_at_visit"]["state"] == "open" else "ساعت کاریش ثبت نشده، بپرس"
            return {"layout": "best", "title": "این یکی از همه بهتره", "why": f"از بقیه آشکارا ارزون‌تره؛ {hours}.",
                    "best_sid": first["sid"], "reason": f"دست‌کم ۵٪ ارزون‌تر از بقیه، {first['travel']['label']}"}
    if len(near) >= 3:
        return {"layout": "map", "title": "از کدوم فروشگاه‌ها بپرسیم؟", "why": "قیمت‌ها نزدیک همن؛ جاشون تعیین می‌کنه."}
    return {"layout": "list", "title": "از کدوم فروشگاه‌ها بپرسیم؟", "why": ""}


async def shops_layout(pid: int, ctx: Ctx, need: str, budget_key: str | None = None) -> dict:
    """How the shops screen opens, decided by the model (a plain rule when it is slow or invalid)."""
    res = await asyncio.to_thread(shops.rank_shops_for_product, pid, ctx, "best", set())
    near = {i["sid"] for i in res["items"] if i["in_radius"]}
    # a shop closed when the person gets there is never «پیشنهاد من» while an open one is near
    open_near = {i["sid"] for i in res["items"] if i["in_radius"] and i["open_at_visit"]["state"] != "closed"
                 and not i.get("price_warning") and (i.get("authenticity") or {}).get("status") != "declared_copy"}
    out, source = None, "rule"
    if llm.available() and res["items"]:
        try:
            llm.check_session_budget(budget_key)
            msg = await asyncio.wait_for(llm.chat(
                [{"role": "system", "content": SHOP_SYSTEM}, {"role": "user", "content": _shops_brief(res, need, ctx)}],
                tools=[SHOP_TOOL], tool_choice={"type": "function", "function": {"name": "render_shops"}},
                temperature=0.2, max_tokens=300), timeout=LLM_TIMEOUT_S)
            s = json.loads(((msg.get("tool_calls") or [{}])[0].get("function") or {}).get("arguments") or "{}")
            ok = s.get("layout") in SHOP_LAYOUTS and s.get("title")
            ok = ok and (s["layout"] != "best" or s.get("best_sid") in (open_near or near))
            ok = ok and (s["layout"] != "best" or "ارزون" not in (s.get("reason") or "") or _cheaper_by(res, s.get("best_sid")) >= 2)
            ok = ok and (s["layout"] != "bargain" or bool(res.get("bargain")))
            ok = ok and (s["layout"] != "expand" or not near)
            ok = ok and (s["layout"] != "map" or len(near) >= 3)
            if ok:
                out, source = s, "model"
        except Exception as e:
            log.warning("model shops layout failed: %s", type(e).__name__)
    out = out or shops_rule(res)
    return {"layout": out["layout"], "title": out["title"], "why": out.get("why") or "", "source": source,
            "best_sid": out.get("best_sid") if out["layout"] == "best" else None, "reason": out.get("reason") or ""}
