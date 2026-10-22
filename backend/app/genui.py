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

from . import catalog, llm
from .agent import fmt_search, prefetch_query, quick_prefs
from .models import Ctx, range_label

log = logging.getLogger("genui")
BLOCKS = ("choice", "budget", "place", "travel", "products", "compare")
LLM_TIMEOUT_S = 12.0
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
- budget: اسلایدرِ بودجه که بازه‌اش را سیستم از قیمت‌های واقعیِ همین کالا می‌سازد. فقط اگر بودجه نامشخص است و قیمت‌ها پخش‌اند (صدکِ ۹۰ دستِ‌کم سه برابرِ صدکِ ۱۰).
- place: نقشه برای انتخابِ جای خرید. اگر جای خرید هنوز نامشخص است، پیش از products و compare حتماً همین را بساز.
- travel: پیاده یا ماشین یا مترو و چند دقیقه راه. فقط بعد از place و اگر هنوز نامشخص است.
- products: ۲ تا ۴ کالا از نتایجِ جستجو (pids). وقتی نیاز به اندازهٔ کافی روشن است.
- compare: ۲ یا ۳ کالای نزدیک به هم برای مقایسهٔ کوتاه، وقتی کاربر بینِ چند مدلِ شبیه مردد است یا گفته مدل را نمی‌داند و نتایجِ برتر خیلی شبیه‌اند.
پیش از هر چیز نتایجِ جستجو را با نیاز بسنج: اگر کالاها از جنسِ خودِ نیاز نیستند (قطعهٔ یدکی، قاب، گلس یا لوازمِ جانبی به‌جای خودِ دستگاه، یا دستهٔ دیگری)، search را با کلیدواژهٔ ساده‌تر و درست‌تر بده (مثلاً «گوشی سامسونگ» به‌جای «گوشی سامسونگ دوربین»)، گزینه‌ها و pidها را از این نتایجِ نادرست نساز، و block را products بگذار؛ سیستم دوباره جستجو می‌کند و کالاها را خودش می‌گذارد.
قاعده‌ها: هر چیزی که کاربر گفته یا جواب داده را دوباره نپرس. کم‌ترین تعدادِ صفحه را بساز؛ اگر نیاز روشن است مستقیم برو سراغِ products. گزینه‌ها و pidها را فقط از دادهٔ زیر بردار و از خودت نساز. اگر جوابِ کاربر چیزِ دیگری برای جستجو خواست، search (و اگر برند گفت brand) را بده. title و why فارسیِ خودمانی و کوتاه، بدونِ خطِ تیرهٔ بلند و ایموجی."""


def _known(ctx: Ctx, known: dict) -> str:
    budget = "نامشخص"
    if ctx.budget_max:
        budget = f"تا {ctx.budget_max:,} تومان"
    return "\n".join([
        f"- جای خرید: {ctx.place if known.get('place') else 'هنوز نامشخص'}",
        f"- رفت‌وآمد: {range_label(ctx) if known.get('travel') else 'هنوز نامشخص'}",
        f"- بودجه: {budget} | فقط قسطی: {'بله' if ctx.installments_only else 'خیر'} | "
        f"اصالت: {'فقط اورجینال' if ctx.originality == 'original_only' else 'نگفته'}",
    ])


def _search(q: str, ctx: Ctx, brand: str | None) -> dict:
    return catalog.search_products(q, ctx, brand=brand or None, max_price=ctx.budget_max, limit=8)


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
    return [{k: by[p].get(k) for k in ("pid", "title", "brand", "image", "price_min", "nearby_min_price", "n_nearby", "n_shops")}
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
        return {"block": "travel", "title": "چطوری می‌ری؟", "why": "تا فقط مغازه‌هایی رو نشون بدم که زود بهشون می‌رسی."}
    pts = (res.get("facets") or {}).get("price_points") or []
    if not ctx.budget_max and len(pts) == 5 and pts[0] and pts[-1] >= 3 * pts[0] and n < MAX_SCREENS:
        return {"block": "budget", "title": "تا چقدر می‌خوای خرج کنی؟", "why": "قیمت‌های این کالا خیلی پخشه."}
    pids = [it["pid"] for it in res["items"][:4]]
    if pids:
        return {"block": "products", "title": "کدوم رو می‌خوای؟", "why": "این‌ها به نیازت نزدیک‌ترن.", "pids": pids}
    return {"block": "choice", "title": "یه کم دقیق‌تر بگو", "why": "با این توضیح چیزی پیدا نکردم.",
            "options": [c for c, _ in (res.get("facets") or {}).get("categories", [])[:5]] or ["هر چیزی که مشابه باشه"]}


def _valid(s: dict, res: dict, known: dict) -> bool:
    if s.get("block") not in BLOCKS or not s.get("title"):
        return False
    ids = {it["pid"] for it in res["items"]}
    if s["block"] == "choice":
        opts = [o for o in s.get("options") or [] if isinstance(o, str) and o.strip()]
        return 2 <= len(opts) <= 6
    if s["block"] in ("products", "compare"):
        pids = [p for p in s.get("pids") or [] if p in ids]
        lo, hi = (2, 3) if s["block"] == "compare" else (1, 4)
        return known.get("place", False) and lo <= len(pids) <= hi
    if s["block"] == "travel":
        return bool(known.get("place"))
    return True


async def next_screen(need: str, answers: list[dict], ctx: Ctx, known: dict, search: dict | None,
                      budget_key: str | None = None) -> dict:
    """The next screen, with its data filled in. Returns the screen, the context and what is known after
    the person's words, and the search to keep for the next turn."""
    text = " ".join([need] + [str(a.get("a", "")) for a in answers])
    # «کتونی برای پیاده‌روی» is about the shoes, not about walking to the shop
    ctx, changed = quick_prefs(text.replace("پیاده‌روی", " ").replace("پیاده روی", " "), ctx)
    known = {"place": bool(known.get("place") or "lat" in changed or "place" in changed),
             "travel": bool(known.get("travel") or {"travel_mode", "range_minutes"} & changed.keys())}
    for a in answers:  # a budget slider answer carries its number, so it never depends on parsing the text
        if isinstance(a.get("budget"), int) and a["budget"] > 0:
            ctx = ctx.model_copy(update={"budget_max": a["budget"], "budget_min": 0})
    brand = (search or {}).get("brand")
    if (search or {}).get("q"):
        q = search["q"]
        res = await asyncio.to_thread(_search, q, ctx, brand)
    else:
        q, res = await asyncio.to_thread(_first_search, need, ctx)
    screen, source = None, "rule"
    if llm.available() and len(answers) < MAX_SCREENS:
        history = "\n".join(f"- {a.get('q')}: {a.get('a')}" for a in answers) or "- هنوز چیزی نپرسیده‌ای"
        user = (f"نیازِ کاربر: {need}\n\nسؤال‌ها و جواب‌های قبلی:\n{history}\n\nآنچه معلوم است:\n{_known(ctx, known)}\n\n"
                f"نتایجِ جستجو برای «{q}»{' با برندِ ' + brand if brand else ''}:\n{fmt_search(res)}")
        try:
            llm.check_session_budget(budget_key)
            msg = await asyncio.wait_for(llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
                                                  tools=[TOOL], tool_choice={"type": "function", "function": {"name": "render_screen"}},
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
    block = screen["block"]
    out = {"block": block, "title": screen["title"], "why": screen.get("why") or "", "source": source}
    if block == "choice":
        out.update(options=[o.strip() for o in screen.get("options") or [] if isinstance(o, str) and o.strip()][:6],
                   multi=bool(screen.get("multi")))
    elif block == "budget":
        b = _budget_block(res)
        if not b:  # no price spread to build a slider from: show the products instead
            return await _products_instead(res, ctx, q, brand, out, known)
        out["budget"] = b
    elif block == "products":
        out["products"] = _cards(res, [p for p in screen.get("pids") or [] if isinstance(p, int)][:4]) or _cards(res, [i["pid"] for i in res["items"][:4]])
    elif block == "compare":
        out["compare"] = await asyncio.to_thread(_compare, [p for p in screen["pids"] if isinstance(p, int)][:3], ctx, need)
    return {"screen": out, "ctx": ctx.model_dump(), "known": known, "search": {"q": q, "brand": brand}}


async def _products_instead(res: dict, ctx: Ctx, q: str, brand: str | None, out: dict, known: dict) -> dict:
    out.update(block="products", title="کدوم رو می‌خوای؟", why="این‌ها به نیازت نزدیک‌ترن.",
               products=_cards(res, [i["pid"] for i in res["items"][:4]]))
    return {"screen": out, "ctx": ctx.model_dump(), "known": known, "search": {"q": q, "brand": brand}}
