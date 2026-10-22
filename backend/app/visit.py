"""Visit plan: order the chosen shops into one trip and check each is open when the user arrives."""
from __future__ import annotations

from datetime import timedelta

from . import shops, streets
from .models import Ctx
from . import travel
from .timegeo import fa_digits, haversine_km, now_tehran, open_status, resolve_visit_time

STOP_MINUTES = 15  # time spent in each shop


def plan_visit(pid: int | None, sids: list[int], ctx: Ctx, confirmed: dict[int, dict] | None = None) -> dict:
    remaining = [shops.shop(s) for s in dict.fromkeys(sids) if shops.shop(s)]
    if not remaining:
        return {"stops": [], "warnings": ["فروشگاهی برای برنامه‌ریزی انتخاب نشده"]}
    start = resolve_visit_time(ctx.visit)
    t = start
    lat, lon = ctx.lat, ctx.lon
    stops, warnings = [], []
    offers = {o["sid"]: o for o in shops.offers_for_product(pid)} if pid else {}
    total_km = 0.0
    while remaining:
        # nearest-neighbour ordering, but a shop that would be closed on arrival goes last
        def cost(s):
            km = haversine_km(lat, lon, s.lat, s.lon)
            arr = t + timedelta(minutes=travel.quick_minutes(km, ctx.travel_mode, t))
            closed = open_status(s.shifts, s.has_hours, arr)["state"] == "closed"
            return (closed, km)
        nxt = min(remaining, key=cost)
        remaining.remove(nxt)
        km = haversine_km(lat, lon, nxt.lat, nxt.lon)
        tr = travel.estimate(km, ctx.travel_mode, t, (lat, lon), (nxt.lat, nxt.lon))
        same_mall = bool(stops) and stops[-1]["mall_name"] and stops[-1]["mall_name"] == nxt.mall_name
        if same_mall:
            tr = {"mode": "walk", "minutes": 3, "label": "در همین پاساژ"}
        t = t + timedelta(minutes=tr["minutes"])
        st = open_status(nxt.shifts, nxt.has_hours, t)
        if st["state"] == "closed":
            warnings.append(f"{nxt.name} در زمان رسیدن ({fa_digits(t.strftime('%H:%M'))}) بسته است")
        elif st["state"] == "unknown":
            warnings.append(f"ساعت کاری {nxt.name} ثبت نشده؛ قبل از رفتن استعلام بگیرید")
        elif (st.get("closes_in_min") or 999) < STOP_MINUTES + 10:
            warnings.append(f"{nxt.name} کمی بعد از رسیدن شما بسته می‌شود")
        o = offers.get(nxt.sid) or {}
        conf = (confirmed or {}).get(nxt.sid) or {}
        guide = shops.mall_guide(nxt)
        stops.append({
            "sid": nxt.sid, "name": nxt.name, "lat": nxt.lat, "lon": nxt.lon, "mall_name": nxt.mall_name,
            "mall": shops.mall_line(nxt), "address": nxt.address,
            "leg": {"km": round(km, 2), **tr}, "arrive": t.isoformat(), "arrive_label": fa_digits(t.strftime("%H:%M")),
            "open": st, "price": o.get("price_toman") if o.get("price_ok") else None,
            "confirmed_price": conf.get("confirmed_price"), "hold_until": conf.get("hold_until"),
            "guide": guide["steps"][:3] if guide else [], "nav": shops.nav_links(nxt.lat, nxt.lon, nxt.name, (lat, lon), tr["mode"]),
            "installments": nxt.installments,
        })
        total_km += km
        t = t + timedelta(minutes=STOP_MINUTES)
        lat, lon = nxt.lat, nxt.lon
    checklist = ["قیمت تأییدشده و زمان نگه‌داشتن کالا را هنگام خرید یادآوری کنید",
                 "برچسب اصالت، گارانتی و فاکتور را قبل از پرداخت چک کنید"]
    if ctx.installments_only or any(s["installments"] for s in stops):
        checklist.append("برای خرید قسطی، اپ سرویس اعتباری (مثل اسنپ‌پی یا دیجی‌پی) را از قبل فعال و اعتبارتان را چک کنید")
    if now_tehran().weekday() == 3:
        checklist.append("پنجشنبه‌ها خیلی از پاساژها زودتر می‌بندند")
    return {"start": start.isoformat(), "start_label": fa_digits(start.strftime("%H:%M")),
            "end_label": fa_digits(t.strftime("%H:%M")), "total_minutes": int((t - start).total_seconds() // 60),
            "total_km": round(total_km, 1), "stops": stops, "warnings": warnings, "checklist": checklist,
            "origin": {"lat": ctx.lat, "lon": ctx.lon, "label": ctx.place},
            "paths": streets.paths((ctx.lat, ctx.lon), stops)}
