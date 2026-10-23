"""HTTP API (FastAPI) + static front end."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import mimetypes

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent, catalog, config, contact, db, gazetteer, genui, llm, shops, stroll, visit
from . import travel
from .agent import fmt_shops, toman
from .models import Ctx
from .places import PLACES
from .timegeo import VISIT_PRESETS, fa_text, now_tehran

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(shops.all_shops)  # load the shop cache before the first request
    await asyncio.to_thread(shops.sibling_groups)
    yield


app = FastAPI(title="Torobche: Torob in-person shopping agent", docs_url="/api/docs",
              openapi_url="/api/openapi.json", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1200)


@app.middleware("http")
async def timing(request: Request, call_next):
    t0 = time.monotonic()
    resp = await call_next(request)
    if request.url.path.startswith("/api/"):
        log.info("%s %s %d %.0fms", request.method, request.url.path, resp.status_code, (time.monotonic() - t0) * 1000)
    return resp


def sse(gen: AsyncIterator[dict]) -> StreamingResponse:
    async def body():
        try:
            async for ev in gen:
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception:
            log.exception("stream failed")
            yield "data: " + json.dumps({"type": "error", "text": "خطای غیرمنتظره؛ دوباره تلاش کنید."}, ensure_ascii=False) + "\n\n"
            yield 'data: {"type": "done"}\n\n'
    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------------------
# Meta / health
# ---------------------------------------------------------------------------------------
@app.get("/api/health")
def health():
    n = db.q1("SELECT (SELECT COUNT(*) FROM shops) s, (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM offers) o")
    return {"ok": True, "shops": n["s"], "products": n["p"], "offers": n["o"], "llm": llm.describe()}


@app.get("/api/llm/check")
async def llm_check(deep: bool = False):
    """Which AI providers this server can reach right now (BoxAPI first, the OpenAI backup next); deep=1 asks each
    for a five-token reply, because a provider can list its models from a country it refuses to answer."""
    return {"providers": await llm.check_providers(deep)}


@app.get("/api/meta")
def meta():
    m = db.meta()
    return {"places": PLACES, "visit_presets": VISIT_PRESETS, "travel_modes": travel.MODES,
            "range_minutes_presets": [10, 20, 30, 45, 60], "snapshot": m.get("snapshot_max_price_change_utc"),
            "counts": json.loads(m.get("csv_counts", "{}")), "llm": llm.describe(),
            "now": now_tehran().isoformat()}


@app.get("/api/places")
def places(q: str = ""):
    """Free-text start point: preset squares, metro stations, shopping centres and neighbourhoods."""
    return {"items": gazetteer.search(q[:60])}


@app.get("/api/places/areas")
def place_areas():
    """Neighbourhood bubbles for the map: name, position and how many shops."""
    return {"items": gazetteer.areas()}


@app.get("/api/places/at")
def place_at(lat: float, lon: float):
    """A point tapped on the map: the nearest landmark's name and the shops within a short walk."""
    return gazetteer.at(lat, lon)

# ---------------------------------------------------------------------------------------
# Agent chat
# ---------------------------------------------------------------------------------------
class ChatIn(BaseModel):
    session_id: str | None = None
    text: str = Field(min_length=1, max_length=1500)
    ctx: Ctx = Ctx()
    ui: dict = {}


@app.post("/api/chat")
async def chat(body: ChatIn):
    return sse(agent.run_turn(body.session_id, body.text, body.ctx, body.ui))


# ---------------------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------------------
class SearchIn(BaseModel):
    q: str
    ctx: Ctx = Ctx()
    category: str | None = None
    brand: str | None = None
    limit: int = 12


@app.post("/api/search")
async def search(body: SearchIn):
    return await asyncio.to_thread(catalog.search_products, body.q, body.ctx, body.category, body.brand,
                                   None, None, min(body.limit, 30), 4)


class ProductIn(BaseModel):
    pid: int
    ctx: Ctx = Ctx()


@app.post("/api/product")
async def product(body: ProductIn):
    d = await asyncio.to_thread(catalog.product_details, body.pid, 60)
    if not d:
        raise HTTPException(404, "product not found")
    d.update(catalog.nearby_offer_stats([body.pid], body.ctx).get(body.pid, {}))
    return d


class CompareIn(BaseModel):
    pids: list[int]
    ctx: Ctx = Ctx()
    need: str | None = None


@app.post("/api/compare")
async def compare(body: CompareIn):
    res = await asyncio.to_thread(catalog.compare_products, body.pids)
    near = catalog.nearby_offer_stats([p["pid"] for p in res["products"]], body.ctx)
    for p in res["products"]:
        p.update(near.get(p["pid"], {}))
    return res


def client_key(request: Request) -> str:
    return "ip:" + (request.client.host if request.client else "?")


@app.post("/api/compare/verdict")
async def compare_verdict(body: CompareIn, request: Request):
    res = await asyncio.to_thread(catalog.compare_products, body.pids)
    near = catalog.nearby_offer_stats([p["pid"] for p in res["products"]], body.ctx)
    lines = []
    for p in res["products"]:
        n = near.get(p["pid"], {})
        lines.append(f"pid={p['pid']} | {p['title']} | قیمت {toman(p['price_min'])} تا {toman(p['price_max'])} | "
                     f"فروشگاه در شعاع: {n.get('n_nearby', 0)}")
    for r in res["rows"][:22]:
        lines.append(f"{r['key']}: " + " | ".join(v or "-" for v in r["values"]))
    try:
        llm.check_session_budget(client_key(request))
        data = await asyncio.wait_for(llm.complete_json(
            "تو دستیار خرید هستی. با توجه به جدول مقایسه و نیاز کاربر، در حداکثر دو جملهٔ کوتاه فارسی بگو کدام کالا برای "
            "چه کسی بهتر است و تفاوت کلیدی چیست. فقط از داده‌های داده‌شده استفاده کن. خط تیره بلند و ایموجی نگذار. "
            "خروجی JSON: {\"verdict\": \"...\", \"best_pid\": عدد, \"labels\": {\"pid\": \"برچسب ۲-۳ کلمه‌ای\"}}",
            f"نیاز کاربر: {body.need or 'نامشخص'}\n" + "\n".join(lines), max_tokens=400), timeout=12)
        labels = {str(k): fa_text(str(v)) for k, v in (data.get("labels") or {}).items()}
        return {"verdict": fa_text(data.get("verdict")) or None, "best_pid": data.get("best_pid"), "labels": labels}
    except Exception as e:
        log.warning("verdict failed: %s", e)
        return rule_verdict(res["products"], near)


def rule_verdict(products: list[dict], near: dict) -> dict:
    """Data-only comparison summary used when no language model is available."""
    priced = [p for p in products if p["price_min"]]
    if len(priced) < 2:
        return {"verdict": None, "best_pid": None, "labels": {}}
    cheap = min(priced, key=lambda p: p["price_min"])
    most = max(products, key=lambda p: near.get(p["pid"], {}).get("n_nearby", 0))
    labels = {str(cheap["pid"]): "ارزان‌تر"}
    text = f"{cheap['title'][:40]} ارزان‌تر است"
    if most["pid"] != cheap["pid"] and near.get(most["pid"], {}).get("n_nearby"):
        labels[str(most["pid"])] = "فروشگاه نزدیک بیشتر"
        text += f" و {most['title'][:40]} در فروشگاه‌های نزدیک بیشتری پیدا می‌شود"
    return {"verdict": fa_text(text + ". تفاوت مشخصات را در جدول ببینید."), "best_pid": cheap["pid"], "labels": labels}


# ---------------------------------------------------------------------------------------
# Shops
# ---------------------------------------------------------------------------------------
class ShopsIn(BaseModel):
    pid: int
    ctx: Ctx = Ctx()
    sort: str = "best"
    exclude: list[int] = []


@app.post("/api/shops")
async def shops_for_product(body: ShopsIn):
    sort = body.sort if body.sort in shops.SORTS else "best"
    res = await asyncio.to_thread(shops.rank_shops_for_product, body.pid, body.ctx, sort, set(body.exclude))
    product = await asyncio.to_thread(catalog.product_details, body.pid, 0)
    if not product:
        raise HTTPException(404, "product not found")
    res["product"] = {k: product[k] for k in ("pid", "title", "brand", "image", "category", "price_min", "price_max", "n_shops")}
    res["similar"], res["leads"] = [], []
    if res["stats"]["in_radius"] < 3:
        res["similar"] = await asyncio.to_thread(catalog.similar_products, body.pid, body.ctx, 4)
        res["leads"] = await asyncio.to_thread(shops.category_only_shops, product["category"], body.ctx,
                                               {i["sid"] for i in res["items"]}, 4)
    return res


@app.post("/api/shops/insight")
async def shops_insight(body: ShopsIn, request: Request):
    res = await asyncio.to_thread(shops.rank_shops_for_product, body.pid, body.ctx, "best", set(body.exclude))
    items = res["items"]
    if not items:
        return {"headline": "با فیلترهای فعلی فروشگاهی پیدا نشد", "body": "شعاع را بزرگ‌تر کنید یا فیلتر قسطی/باز بودن را بردارید.", "pick_sid": None}
    top = items[0]
    fallback = {"headline": f"پیشنهاد من: {top['name']}",
                "body": "، ".join(top["reasons"][:3]) + ". قیمت و موجودی را قبل از رفتن استعلام بگیرید.",
                "pick_sid": top["sid"]}
    if not llm.available():
        return fallback
    product = catalog.product_details(body.pid, 0) or {}
    try:
        llm.check_session_budget(client_key(request))
        data = await asyncio.wait_for(llm.complete_json(
            "تو دستیار خرید حضوری هستی. از بین فروشگاه‌ها یکی را پیشنهاد کن و در یک تیتر کوتاه (حداکثر ۸ کلمه) و یک جملهٔ "
            "توضیح بگو چرا (قیمت، فاصله، باز بودن در زمان رسیدن، تازگی قیمت، قسطی) و اگر نکتهٔ مهمی هست (قیمت قدیمی، "
            "بسته شدن نزدیک) گوشزد کن. قیمت ثبت‌شده را قیمت قطعی ننام. اگر ساعت کاری ثبت نشده، نگو باز است. فقط از sid های داده‌شده. خط تیره بلند و ایموجی نگذار. "
            "خروجی JSON: {\"headline\": \"...\", \"body\": \"...\", \"pick_sid\": عدد}",
            f"کالا: {product.get('title')}\nکاربر در {body.ctx.place}، زمان مراجعه: {VISIT_PRESETS.get(body.ctx.visit, body.ctx.visit)}\n"
            + fmt_shops(body.pid, res, []), max_tokens=300), timeout=10)
        sid = data.get("pick_sid")
        if not any(i["sid"] == sid for i in items):
            sid = top["sid"]
        return {"headline": fa_text(data.get("headline")) or fallback["headline"],
                "body": fa_text(data.get("body")) or fallback["body"], "pick_sid": sid}
    except Exception as e:
        log.warning("insight failed: %s", e)
        return fallback


class ShopIn(BaseModel):
    sid: int
    pid: int | None = None
    ctx: Ctx = Ctx()


@app.post("/api/mall3d")
async def mall3d(body: ShopIn):
    d = await asyncio.to_thread(shops.mall3d, body.sid, body.ctx, body.pid)
    if not d:
        raise HTTPException(404, "این پاساژ مدل سه‌بعدی ندارد")
    return d


@app.post("/api/shop")
async def shop_detail(body: ShopIn):
    d = await asyncio.to_thread(shops.shop_detail, body.sid, body.ctx, body.pid)
    if not d:
        raise HTTPException(404, "shop not found")
    return d


# ---------------------------------------------------------------------------------------
# Contact + visit
# ---------------------------------------------------------------------------------------
class InquiryIn(BaseModel):
    pid: int
    sids: list[int] = Field(min_length=1, max_length=5)
    ctx: Ctx = Ctx()
    forced: dict[int, str] | None = None  # demo control: sid -> outcome
    tester_phone: str | None = Field(None, max_length=20)  # the tester plays the first shop on their own phone


@app.post("/api/inquiry")
async def inquiry(body: InquiryIn, request: Request):
    # the tester's number is never logged
    log.info("inquiry pid=%s sids=%s tester=%s (simulated except a «زنده» or tester shop, really texted)",
             body.pid, body.sids, bool(body.tester_phone))
    return sse(contact.run_inquiry(body.pid, body.sids, body.ctx, body.forced, client_key(request), body.tester_phone))


@app.post("/api/inquiry/draft")
async def inquiry_draft(body: InquiryIn):
    product, _, _, start = await asyncio.to_thread(contact.prepare, body.pid, body.sids, body.ctx)
    if not product:
        raise HTTPException(404, start.get("text", "not found"))
    return start


class ShopReplyIn(BaseModel):
    outcome: str
    price: int | None = Field(None, ge=0, le=100_000_000_000)
    hold_h: int | None = Field(None, ge=0, le=12)  # hours the shop keeps the item for this customer


@app.get("/api/reply/{token}")
async def shop_reply_page(token: str):
    """What the shop sees when it opens the link in the inquiry text message."""
    page = contact.reply_page(token)
    if not page:
        raise HTTPException(404, "این لینک منقضی شده است")
    return page


@app.post("/api/reply/{token}")
async def shop_reply(token: str, body: ShopReplyIn):
    # async on purpose: it wakes the waiting inquiry stream, which lives on the event loop
    res = contact.submit_reply(token, body.outcome, body.price, body.hold_h)
    if res is None:
        raise HTTPException(404, "این لینک منقضی شده است")
    log.info("shop reply via answer page: %s %s", body.outcome, res.get("ok"))
    return res


class VisitIn(BaseModel):
    pid: int | None = None
    sids: list[int] = Field(min_length=1, max_length=8)
    ctx: Ctx = Ctx()
    confirmed: dict[int, dict] | None = None


class GenIn(BaseModel):
    need: str = Field(min_length=1, max_length=300)
    answers: list[dict] = Field(default_factory=list, max_length=12)  # [{q, a}] of the screens answered so far
    ctx: Ctx = Ctx()
    known: dict = Field(default_factory=dict)  # {place: bool, travel: bool}
    search: dict | None = None  # {q, brand} the previous screen searched with


class GenShopsIn(BaseModel):
    pid: int
    ctx: Ctx = Ctx()
    need: str = Field("", max_length=300)


@app.post("/api/gen/shops")
async def gen_shops(body: GenShopsIn, request: Request):
    """Generative UI: how the shops screen opens (best pick, price map, cheaper further away, or the list)."""
    return await genui.shops_layout(body.pid, body.ctx, body.need, client_key(request))


@app.post("/api/gen/next")
async def gen_next(body: GenIn, request: Request):
    """Generative UI: the next wizard screen, built by the model from a fixed box of blocks."""
    if not body.need.strip():
        raise HTTPException(422, "need is empty")
    return await genui.next_screen(body.need, body.answers, body.ctx, body.known, body.search, client_key(request))


class StrollIn(BaseModel):
    pid: int
    sid: int
    ctx: Ctx = Ctx()


@app.post("/api/stroll")
async def stroll_route(body: StrollIn):
    """«مسیر گردش و خرید» around a shop the user is going to anyway."""
    return await asyncio.to_thread(stroll.stroll, body.pid, body.sid, body.ctx)


@app.post("/api/visit")
async def visit_plan(body: VisitIn):
    return await asyncio.to_thread(visit.plan_visit, body.pid, body.sids, body.ctx, body.confirmed)


# ---------------------------------------------------------------------------------------
# Static front end (built by Vite into frontend/dist)
# ---------------------------------------------------------------------------------------
mimetypes.add_type("image/webp", ".webp")  # the container's own table lacks it; the demo's mascots are WebP

if config.STATIC_DIR.is_dir():
    assets = config.STATIC_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/r/{token}", include_in_schema=False)
    def reply_link(token: str):
        if config.REPLY_FALLBACK_URL and token.isascii() and token.isalnum() and contact.reply_page(token) is None:
            return RedirectResponse(f"{config.REPLY_FALLBACK_URL}/r/{token}", status_code=302)
        return FileResponse(config.STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (config.STATIC_DIR / path).resolve()
        if path and f.is_file() and config.STATIC_DIR.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(config.STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})
else:
    @app.get("/", include_in_schema=False)
    def root():
        return JSONResponse({"ok": True, "note": "front end not built; see README"})
