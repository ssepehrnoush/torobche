"""Shops: in-memory cache, opening status, ranking of offers for a product, mall guidance."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache

from . import db
from . import authenticity, travel
from .models import Ctx, range_label
from .timegeo import (Shift, fa_digits, fmt_km, haversine_km, now_tehran, open_status, resolve_visit_time,
                      week_table)

INSTALLMENT_PROVIDERS = {"ترب‌پی", "اسنپ‌پی", "دیجی پی", "تارا", "ازکی‌وام"}


@dataclass
class Shop:
    sid: int
    shop_id: str
    name: str
    address: str | None
    area: str | None
    lat: float
    lon: float
    mall_kind: str | None
    mall_name: str | None
    floor_raw: str | None
    floor_num: int | None
    unit: str | None
    phone: str | None
    instagram_url: str | None
    website_url: str | None
    is_real_name: bool
    fast_delivery: bool | None
    has_hours: bool
    torob_pay: bool
    torob_pay_in_person: bool
    providers: list[str]
    n_products: int
    shifts: list[Shift] = field(default_factory=list)
    day_status: dict[int, str] = field(default_factory=dict)

    @property
    def installments(self) -> list[str]:
        return [p for p in self.providers if p in INSTALLMENT_PROVIDERS]


@lru_cache(maxsize=1)
def all_shops() -> dict[int, Shop]:
    shops: dict[int, Shop] = {}
    for r in db.q("SELECT * FROM shops"):
        shops[r["sid"]] = Shop(
            sid=r["sid"], shop_id=r["shop_id"], name=r["name"], address=r["address"], area=r["area"],
            lat=r["lat"], lon=r["lon"], mall_kind=r["mall_kind"], mall_name=r["mall_name"],
            floor_raw=r["floor_raw"], floor_num=r["floor_num"], unit=r["unit"], phone=r["phone"],
            instagram_url=r["instagram_url"], website_url=r["website_url"], is_real_name=bool(r["is_real_name"]),
            fast_delivery=None if r["supports_fast_delivery"] is None else bool(r["supports_fast_delivery"]),
            has_hours=bool(r["has_hours"]), torob_pay=bool(r["accepts_torob_pay"]),
            torob_pay_in_person=bool(r["torob_pay_in_person"]),
            providers=[p.strip() for p in (r["payment_providers"] or "").split(",") if p.strip()],
            n_products=r["n_products"],
        )
    for r in db.q("SELECT sid, dow, status, open_min, close_min FROM shop_hours"):
        s = shops.get(r["sid"])
        if not s:
            continue
        s.day_status[r["dow"]] = r["status"]
        if r["open_min"] is not None and r["close_min"] is not None:
            s.shifts.append(Shift(r["dow"], r["open_min"], r["close_min"]))
    return shops


def shop(sid: int) -> Shop | None:
    return all_shops().get(sid)


# ---------------------------------------------------------------------------------------
# Price freshness
# ---------------------------------------------------------------------------------------
def freshness(ts: int | None, now: datetime | None = None) -> dict:
    """Age of the registered price. Registered price is never presented as confirmed."""
    if not ts:
        return {"tier": "unknown", "days": None, "label": "زمان ثبت قیمت نامشخص"}
    now = now or now_tehran()
    days = max(0, int((now.timestamp() - ts) // 86400))
    if days <= 14:
        tier, word = "fresh", "اخیر"
    elif days <= 45:
        tier, word = "aging", "ممکن است تغییر کرده باشد"
    else:
        tier, word = "stale", "قدیمی؛ حتماً استعلام بگیرید"
    when = "امروز" if days == 0 else f"{fa_digits(days)} روز پیش"
    return {"tier": tier, "days": days, "ts": ts, "label": f"قیمت ثبت‌شده {when}، {word}"}


# ---------------------------------------------------------------------------------------
# Offers of one product, evaluated against the user's context
# ---------------------------------------------------------------------------------------
def _shop_badges(s: Shop) -> list[dict]:
    b = []
    if s.installments:
        b.append({"kind": "installment", "label": "قسطی: " + "، ".join(s.installments)})
    if s.torob_pay_in_person:
        b.append({"kind": "torobpay", "label": "ترب‌پی حضوری"})
    elif s.torob_pay:
        b.append({"kind": "torobpay", "label": "ترب‌پی"})
    if s.fast_delivery:
        b.append({"kind": "delivery", "label": "ارسال فوری"})
    if s.is_real_name:
        b.append({"kind": "verified", "label": "نام واقعی فروشگاه"})
    return b


def mall_line(s: Shop) -> str | None:
    parts = []
    if s.mall_name:
        parts.append(s.mall_name)
    if s.floor_raw:
        parts.append("طبقه " + fa_digits(s.floor_raw))
    if s.unit:
        parts.append(("واحد " if s.mall_name else "پلاک ") + fa_digits(s.unit))
    return "، ".join(parts) or None


def in_range(ctx: Ctx, km: float, minutes: float) -> bool:
    return minutes <= ctx.range_minutes if ctx.range_mode == "time" else km <= ctx.radius_km


def shop_brief(s: Shop, ctx: Ctx, visit_at: datetime | None = None) -> dict:
    """Location / time facts about one shop relative to the user."""
    km = haversine_km(ctx.lat, ctx.lon, s.lat, s.lon)
    visit_at = visit_at or resolve_visit_time(ctx.visit)
    trip = travel.estimate(km, ctx.travel_mode, visit_at, (ctx.lat, ctx.lon), (s.lat, s.lon))
    arrive = visit_at
    if ctx.visit == "now":
        arrive = visit_at + timedelta(minutes=trip["minutes"])
    st_now = open_status(s.shifts, s.has_hours, now_tehran())
    st_arrive = open_status(s.shifts, s.has_hours, arrive)
    warning = None
    if st_arrive["state"] == "closed" and st_now["state"] == "open" and ctx.visit == "now":
        warning = f"الان باز است ولی تا برسید ({trip['label']}) احتمالاً بسته می‌شود"
    elif st_arrive["state"] == "open" and (st_arrive.get("closes_in_min") or 999) < 45:
        warning = f"زمان رسیدن شما فقط {fa_digits(st_arrive['closes_in_min'])} دقیقه تا بسته شدن مانده"
    return {
        "sid": s.sid, "shop_id": s.shop_id, "name": s.name, "area": s.area, "address": s.address,
        "lat": s.lat, "lon": s.lon, "mall": mall_line(s), "mall_name": s.mall_name,
        "km": round(km, 2), "distance_label": fmt_km(km), "travel": trip,
        "in_radius": in_range(ctx, km, trip["minutes"]),
        "open_now": st_now, "open_at_visit": st_arrive, "visit_warning": warning,
        "badges": _shop_badges(s), "installments": s.installments,
        "torob_pay": s.torob_pay, "phone": s.phone, "is_real_name": s.is_real_name,
        "instagram_url": s.instagram_url, "website_url": s.website_url,
    }


@lru_cache(maxsize=1)
def sibling_groups() -> dict[int, tuple[int, ...]]:
    """The catalogue sometimes lists one product twice under an identical title in the same category
    (e.g. two entries for the Apple 20 W charger, with 29 and 59 shops). Their offers are pooled."""
    out: dict[int, tuple[int, ...]] = {}
    for r in db.q("SELECT group_concat(pid) AS pids FROM products WHERE is_redacted = 0 AND title_norm != ''"
                  " GROUP BY title_norm, category_name HAVING COUNT(*) BETWEEN 2 AND 6"):
        pids = tuple(int(x) for x in r["pids"].split(","))
        for p in pids:
            out[p] = pids
    return out


def siblings(pid: int) -> tuple[int, ...]:
    return sibling_groups().get(pid, (pid,))


def offers_for_product(pid: int) -> list[dict]:
    """Cheapest sane listing per shop (plus unpriced ones, flagged), pooled over duplicate entries."""
    group = siblings(pid)
    marks = ",".join("?" * len(group))
    rows = db.q(
        f"""SELECT o.sid, o.oid, o.pid, o.price_toman, o.price_ok, o.price_flag, o.last_price_changed_ts,
                  o.seller_title, o.warranty_provider, o.warranty_months, o.warranty_desc, o.description
           FROM offers o WHERE o.pid IN ({marks})""", group)
    best: dict[int, dict] = {}
    for r in rows:
        d = dict(r)
        cur = best.get(d["sid"])
        if cur is None:
            d["n_listings"] = 1
            best[d["sid"]] = d
            continue
        cur["n_listings"] += 1
        better = (d["price_ok"], -(d["price_toman"] or 0)) > (cur["price_ok"], -(cur["price_toman"] or 0))
        if better:
            d["n_listings"] = cur["n_listings"]
            best[d["sid"]] = d
    return list(best.values())


def _warranty(o: dict) -> str | None:
    if o.get("warranty_desc"):
        return fa_digits(o["warranty_desc"])
    if o.get("warranty_months"):
        txt = f"{fa_digits(o['warranty_months'])} ماه"
        return f"گارانتی {txt}" + (f" {o['warranty_provider']}" if o.get("warranty_provider") else "")
    if o.get("warranty_provider"):
        return f"گارانتی {o['warranty_provider']}"
    return None


SORTS = ("best", "cheapest", "nearest")


VALUE_OF_MINUTE = 8_000  # toman a shopper gives up per extra minute of travel (both ways are counted)


def _cost(i: dict) -> float | None:
    """Price plus what the trip costs in time, plus small premiums for uncertainty. Lower is better."""
    if not i["price"] or i["price_warning"]:
        return None
    c = i["price"] + 2 * i["travel"]["minutes"] * VALUE_OF_MINUTE
    c += i["price"] * {"fresh": 0, "aging": 0.015, "stale": 0.03, "unknown": 0.03}[i["freshness"]["tier"]]
    st = i["open_at_visit"]["state"]
    c += i["price"] * (0.15 if st == "closed" else 0.02 if st == "unknown" else 0)
    if i["authenticity"]["status"] in ("suspicious", "declared_copy"):
        c += i["price"] * 0.10
    return c


def _toman(v: int) -> str:
    return fa_digits(f"{int(round(v, -3)):,}").replace(",", "٫")


def rank_shops_for_product(pid: int, ctx: Ctx, sort: str = "best", exclude: set[int] | None = None) -> dict:
    """All shops listing the product, with filters applied, ranked by price + travel time, with reasons."""
    shops = all_shops()
    visit_at = resolve_visit_time(ctx.visit)
    offers = offers_for_product(pid)
    priced_all = sorted(o["price_toman"] for o in offers if o["price_ok"] and o["price_toman"])
    median_all = priced_all[len(priced_all) // 2] if priced_all else None
    items, hidden = [], {"installments": 0, "torob_pay": 0, "open": 0, "original": 0, "radius": 0, "excluded": 0}
    for o in offers:
        s = shops.get(o["sid"])
        if not s:
            continue
        if exclude and s.sid in exclude:
            hidden["excluded"] += 1
            continue
        brief = shop_brief(s, ctx, visit_at)
        price = o["price_toman"] if o["price_ok"] else None
        item = {
            **brief,
            "offer_id": o["oid"], "price": price,
            "price_note": None if price else "قیمت معتبری ثبت نشده",
            "freshness": freshness(o["last_price_changed_ts"]),
            "seller_title": o["seller_title"], "warranty": _warranty(o), "n_listings": o["n_listings"],
            "stock": {"state": "unconfirmed", "label": "موجودی تأیید نشده"},
            "authenticity": authenticity.assess(o, median_all, len(priced_all)),
        }
        if ctx.installments_only and not s.installments:
            hidden["installments"] += 1
            continue
        if ctx.torob_pay_only and not s.torob_pay:
            hidden["torob_pay"] += 1
            continue
        if ctx.open_only and brief["open_at_visit"]["state"] == "closed":
            hidden["open"] += 1
            continue
        if ctx.originality == "original_only" and item["authenticity"]["status"] == "declared_copy":
            hidden["original"] += 1
            continue
        items.append(item)

    priced = sorted(i["price"] for i in items if i["price"])
    median = priced[len(priced) // 2] if priced else None
    for i in items:  # a price far below the others is more often a different item than a bargain
        i["price_warning"] = None
        if i["price"] and len(priced) >= 4 and i["price"] < 0.55 * median:
            i["price_warning"] = "خیلی ارزان‌تر از بقیه؛ ممکن است کالای متفاوت، غیراصل یا قیمت اشتباه باشد"
        i["cost"] = _cost(i)
    sane = [i["price"] for i in items if i["price"] and not i["price_warning"]]
    pmin = min(sane) if sane else None
    pmax = max(priced) if priced else None
    in_r = [i for i in items if i["in_radius"]]
    tmin = min((i["travel"]["minutes"] for i in items), default=None)
    costed_in = [i for i in in_r if i["cost"] is not None]
    best_in = min(costed_in, key=lambda i: i["cost"]) if costed_in else None
    nearest_in = min(costed_in, key=lambda i: i["travel"]["minutes"]) if costed_in else None
    worst_cost = max((i["cost"] for i in items if i["cost"] is not None), default=1)
    best_cost = min((i["cost"] for i in items if i["cost"] is not None), default=0)

    for i in items:
        i["score"] = round(1 - (i["cost"] - best_cost) / max(worst_cost - best_cost, 1), 4) if i["cost"] is not None else 0
        reasons = []
        if i["price"] and i["price"] == pmin and len(priced) > 1:
            reasons.append("ارزان‌ترین قیمت ثبت‌شده")
        if i["price_warning"]:
            reasons.append("قیمت مشکوک به اشتباه")
        if i["travel"]["minutes"] == tmin and len(items) > 1:
            reasons.append("نزدیک‌ترین به شما")
        if nearest_in and i is not nearest_in and i["cost"] is not None and i["price"] and nearest_in["price"] \
                and i["price"] < nearest_in["price"] and i["cost"] < nearest_in["cost"]:
            extra = i["travel"]["minutes"] - nearest_in["travel"]["minutes"]
            if extra > 3:
                reasons.append(f"{_toman(nearest_in['price'] - i['price'])} تومان ارزان‌تر از نزدیک‌ترین، با {fa_digits(extra)} دقیقه راه بیشتر؛ می‌ارزد")
        st = i["open_at_visit"]["state"]
        if st == "open":
            reasons.append("در زمان رسیدن باز است")
        elif st == "closed":
            reasons.append("در زمان مراجعه بسته است")
        if i["freshness"]["tier"] == "fresh":
            reasons.append("قیمت اخیراً به‌روز شده")
        if i["installments"]:
            reasons.append("امکان خرید قسطی")
        if i["authenticity"]["status"] in ("suspicious", "declared_copy"):
            reasons.append(i["authenticity"]["label"])
        if not i["in_radius"]:
            reasons.append("خارج از محدودهٔ انتخابی شما")
        i["reasons"] = reasons

    if sort == "cheapest":
        items.sort(key=lambda i: (i["price"] is None, i["price"] or 0, i["km"]))
    elif sort == "nearest":
        items.sort(key=lambda i: i["travel"]["minutes"])
    else:
        items.sort(key=lambda i: (not i["in_radius"], i["cost"] is None, i["cost"] or 0))

    # several shops with this product in the same mall: one trip, several options
    mall_count: dict[str, int] = {}
    for i in items:
        if i["mall_name"]:
            mall_count[i["mall_name"]] = mall_count.get(i["mall_name"], 0) + 1
    for i in items:
        n = mall_count.get(i["mall_name"] or "", 0)
        i["same_mall_count"] = n - 1 if n > 1 else 0
        if n > 1:
            i["reasons"].append(f"{fa_digits(n - 1)} فروشگاه دیگر با همین کالا در همین پاساژ")

    # instant alternative for every shop that is closed (or unknown) when the user gets there:
    # the closest shop to IT that is open at that time and lists the same product
    open_items = [i for i in items if i["open_at_visit"]["state"] == "open"]
    for i in items:
        i["alt_open"] = None
        if i["open_at_visit"]["state"] == "open" or not open_items:
            continue
        best = min(open_items, key=lambda o: haversine_km(i["lat"], i["lon"], o["lat"], o["lon"]))
        d = haversine_km(i["lat"], i["lon"], best["lat"], best["lon"])
        if d <= max(2.0, ctx.radius_km):
            i["alt_open"] = {"sid": best["sid"], "name": best["name"], "price": best["price"],
                             "distance_label": fmt_km(d), "same_mall": bool(i["mall_name"] and i["mall_name"] == best["mall_name"]),
                             "open_label": best["open_at_visit"]["label"]}

    return {
        "items": items,
        "stats": {"total": len(items), "in_radius": len(in_r), "price_min": pmin, "price_max": pmax, "price_median": median,
                  "open_at_visit": sum(1 for i in items if i["open_at_visit"]["state"] == "open"),
                  "hidden": hidden},
        "bargain": _bargain(items, best_in, ctx, visit_at),
        "expand": _expand(items, ctx),
        "range": {"mode": ctx.range_mode, "minutes": ctx.range_minutes, "km": ctx.radius_km,
                  "travel_mode": ctx.travel_mode, "label": range_label(ctx)},
        "visit_at": visit_at.isoformat(),
    }


def _bargain(items: list[dict], best_in: dict | None, ctx: Ctx, visit_at) -> dict | None:
    """A shop outside the chosen range that is worth the longer trip (or the only good option)."""
    out = [i for i in items if not i["in_radius"] and i["cost"] is not None and i["open_at_visit"]["state"] != "closed"]
    if not out:
        return None
    cand = min(out, key=lambda i: i["cost"])
    base = {"sid": cand["sid"], "name": cand["name"], "price": cand["price"], "minutes": cand["travel"]["minutes"],
            "travel_label": cand["travel"]["label"], "mall": cand["mall"] or cand["area"], "travel_mode": cand["travel"]["mode"], "alt_travel": None}
    if ctx.travel_mode == "walk" and cand["travel"]["minutes"] > 40:
        # nobody walks two hours for a bargain: say how long it is by metro instead
        alt = travel.estimate(cand["km"], "transit", visit_at, (ctx.lat, ctx.lon), (cand["lat"], cand["lon"]))
        base["alt_travel"] = {"mode": "walk", "minutes": base["minutes"], "label": base["travel_label"]}
        base.update(minutes=alt["minutes"], travel_label=alt["label"], travel_mode=alt["mode"])
    if best_in is None:
        return {**base, "saving": None, "extra_minutes": None,
                "message": "توی محدودهٔ انتخابی شما مورد مناسبی پیدا نکردم، اما یه پیشنهاد خیلی خوب در فاصلهٔ دورتری دارم. مایلید بررسیش کنیم؟"}
    if cand["cost"] < best_in["cost"] * 0.98 and cand["price"] < best_in["price"]:
        saving = best_in["price"] - cand["price"]
        extra = cand["travel"]["minutes"] - best_in["travel"]["minutes"]
        return {**base, "saving": saving, "extra_minutes": extra,
                "message": f"یه پیشنهاد خیلی خوب کمی دورتر دارم: {_toman(saving)} تومان ارزان‌تر، با {fa_digits(max(extra, 1))} دقیقه راه بیشتر. مایلید بررسیش کنیم؟"}
    return None


def _expand(items: list[dict], ctx: Ctx) -> list[dict]:
    """How many shops a wider range would add (offered when the current range is thin)."""
    if ctx.range_mode == "time":
        steps = sorted({m for m in (-(-ctx.range_minutes * 3 // 10) * 5, ctx.range_minutes * 2, 60) if m > ctx.range_minutes})
        return [{"minutes": m, "count": sum(1 for i in items if i["travel"]["minutes"] <= m),
                 "label": f"تا {fa_digits(m)} دقیقه"} for m in steps[:3]]
    steps = [ctx.radius_km * 2, ctx.radius_km * 4]
    return [{"km": k, "count": sum(1 for i in items if i["km"] <= k), "label": f"تا {fa_digits(round(k))} کیلومتر"} for k in steps]


# ---------------------------------------------------------------------------------------
# Shop detail and in-mall guidance
# ---------------------------------------------------------------------------------------
_UNIT_NUM = re.compile(r"\d+")


def _unit_int(u: str | None) -> int | None:
    if not u:
        return None
    m = _UNIT_NUM.search(db.normalize_fa(u, split_alnum=False))
    return int(m.group()) if m else None


def same_mall_shops(s: Shop, max_m: float = 250) -> list[Shop]:
    if not s.mall_name:
        return []
    return [o for o in all_shops().values()
            if o.mall_name == s.mall_name and haversine_km(s.lat, s.lon, o.lat, o.lon) * 1000 <= max_m]


def mall_guide(s: Shop) -> dict | None:
    """Turn the free-text address into step-by-step directions inside the passage/mall,
    using other shops of the dataset on the same floor as landmarks."""
    if not (s.mall_name or s.floor_raw or s.unit):
        return None
    steps = []
    street = None
    if s.address and s.mall_name:
        norm_addr = db.normalize_fa(s.address, split_alnum=False)
        idx = norm_addr.find(s.mall_name.split()[0])
        street = norm_addr[:idx].strip(" ,") if idx > 0 else None
    if s.mall_name:
        steps.append({"icon": "building", "text": f"به {s.mall_name} بروید" + (f" ({street})" if street else "")})
    floor_txt = None
    if s.floor_raw:
        fn = s.floor_num
        if fn is not None and fn < 0:
            floor_txt = f"طبقهٔ {fa_digits(s.floor_raw)} (زیر همکف)"
        elif fn == 0:
            floor_txt = "طبقهٔ همکف"
        else:
            floor_txt = f"طبقهٔ {fa_digits(s.floor_raw)}"
        how = " با آسانسور یا پله برقی" if fn is not None and (fn >= 3 or fn <= -2) else ""
        steps.append({"icon": "floor", "text": f"به {floor_txt} بروید{how}"})
    unit_i = _unit_int(s.unit)
    if s.unit:
        hint = ""
        if unit_i and s.floor_num and s.floor_num > 0 and str(unit_i).startswith(str(s.floor_num)) and unit_i >= 100:
            hint = f" (در بیشتر پاساژها شمارهٔ واحد با شمارهٔ طبقه شروع می‌شود: {fa_digits(unit_i)} یعنی طبقهٔ {fa_digits(s.floor_num)})"
        steps.append({"icon": "door", "text": f"دنبال واحد {fa_digits(s.unit)} بگردید{hint}"})

    neighbours = []
    floors: dict[int | None, int] = {}
    mates = same_mall_shops(s)
    for o in mates:
        floors[o.floor_num] = floors.get(o.floor_num, 0) + 1
        if o.sid == s.sid or o.floor_num != s.floor_num:
            continue
        ou = _unit_int(o.unit)
        if unit_i is not None and ou is not None:
            neighbours.append((abs(ou - unit_i), o))
    neighbours.sort(key=lambda x: x[0])
    landmarks = [{"name": o.name, "unit": fa_digits(o.unit), "sid": o.sid} for _, o in neighbours[:3]]
    if landmarks:
        txt = "، ".join(f"واحد {l['unit']} ({l['name']})" for l in landmarks)
        steps.append({"icon": "pin", "text": f"واحدهای نزدیک برای پیدا کردن راحت‌تر: {txt}"})
    steps.append({"icon": "help", "text": "اگر پیدا نکردید، از نگهبانی یا اطلاعات پاساژ شمارهٔ واحد را بپرسید یا از همین‌جا با فروشگاه تماس بگیرید"})
    floor_list = sorted((f for f in floors if f is not None), reverse=True)
    return {
        "mall_name": s.mall_name, "floor": s.floor_raw and fa_digits(s.floor_raw), "floor_num": s.floor_num,
        "unit": s.unit and fa_digits(s.unit), "street": street, "steps": steps, "landmarks": landmarks,
        "floors": [{"num": f, "shops": floors[f], "target": f == s.floor_num} for f in floor_list],
        "mall_shop_count": len(mates),
        "source": "برگرفته از متن نشانی فروشگاه و فروشگاه‌های هم‌پاساژ در داده ترب",
    }


def shop_detail(sid: int, ctx: Ctx, pid: int | None = None) -> dict | None:
    s = shop(sid)
    if not s:
        return None
    brief = shop_brief(s, ctx)
    cats = [r["category_name"] for r in db.q(
        "SELECT category_name FROM shop_categories WHERE sid = ? LIMIT 12", (sid,))]
    offer = None
    if pid:
        for o in offers_for_product(pid):
            if o["sid"] == sid:
                offer = {"price": o["price_toman"] if o["price_ok"] else None,
                         "freshness": freshness(o["last_price_changed_ts"]), "seller_title": o["seller_title"],
                         "warranty": _warranty(o), "description": o["description"]}
    mall_alts = []
    if pid and s.mall_name:
        mates = {m.sid for m in same_mall_shops(s)}
        for o in offers_for_product(pid):
            if o["sid"] in mates and o["sid"] != sid:
                m = all_shops()[o["sid"]]
                mall_alts.append({"sid": m.sid, "name": m.name, "mall": mall_line(m),
                                  "price": o["price_toman"] if o["price_ok"] else None})
    return {
        **brief,
        "week": week_table(s.shifts, s.has_hours, s.day_status),
        "categories": cats, "n_products": s.n_products, "providers": s.providers,
        "mall_guide": mall_guide(s), "offer": offer, "same_mall_offers": mall_alts,
        "phone_note": "شماره‌های تلفن در داده هکاتون ساختگی هستند",
        "nav": nav_links(s.lat, s.lon, s.name, (ctx.lat, ctx.lon), ctx.travel_mode),
    }


_NESHAN_MODE = {"walk": "pedestrian", "car": "car", "transit": "public_transportation"}
_GOOGLE_MODE = {"walk": "walking", "car": "driving", "transit": "transit"}


def nav_links(lat: float, lon: float, name: str, origin: tuple[float, float] | None = None, mode: str = "car") -> dict:
    """Links that open the route from the user's point (or the previous stop) straight away, so nobody has
    to tap «directions» again in the map app. Without an origin they just show the place. `dest` lets the
    phone offer its own «open with» list of map apps (a geo: link)."""
    dest = {"lat": round(lat, 6), "lon": round(lon, 6), "name": name}
    if origin is None:
        return {
            "neshan": f"https://neshan.org/maps/@{lat},{lon},17z,0p",
            "balad": f"https://balad.ir/location?latitude={lat}&longitude={lon}&zoom=17",
            "google": f"https://www.google.com/maps/search/?api=1&query={lat},{lon}",
            "dest": dest,
        }
    o_lat, o_lon = round(origin[0], 6), round(origin[1], 6)
    lat, lon = round(lat, 6), round(lon, 6)
    return {
        "dest": dest,
        "neshan": f"https://neshan.org/maps/routing/{_NESHAN_MODE.get(mode, 'car')}"
                  f"/origin/{o_lat},{o_lon}/destination/{lat},{lon}",
        # Balad keeps no travel mode in the link; it opens on driving with the other modes one tap away
        "balad": f"https://balad.ir/directions/driving?origin={o_lon},{o_lat}&destination={lon},{lat}",
        "google": f"https://www.google.com/maps/dir/?api=1&origin={o_lat},{o_lon}&destination={lat},{lon}"
                  f"&travelmode={_GOOGLE_MODE.get(mode, 'driving')}",
    }


# ---------------------------------------------------------------------------------------
# Shops that only DECLARE the category (no listing of this product): unverified leads
# ---------------------------------------------------------------------------------------
def category_only_shops(category: str, ctx: Ctx, exclude: set[int], limit: int = 5) -> list[dict]:
    rows = db.q("SELECT sid FROM shop_categories WHERE category_name = ?", (category,))
    out = []
    shops = all_shops()
    for r in rows:
        s = shops.get(r["sid"])
        if not s or s.sid in exclude:
            continue
        b = shop_brief(s, ctx)
        if ctx.installments_only and not s.installments:
            continue
        if b["open_at_visit"]["state"] == "closed":
            continue
        out.append(b)
    out.sort(key=lambda b: b["km"])
    for b in out[:limit]:
        b["reasons"] = [f"در دستهٔ «{category}» فعال است ولی این کالا را ثبت نکرده؛ موجودی کاملاً نامعلوم"]
    return out[:limit]
