"""Products: full-text search with location/budget-aware ranking, details, comparison, similar items."""
from __future__ import annotations

import json
import math
from collections import Counter

from . import db
from .models import Ctx
from .shops import all_shops, in_range, siblings
from .travel import quick_minutes
from .timegeo import haversine_km

SEARCH_SQL = """
  SELECT p.pid, p.title, p.title_norm, p.brand, p.category_name, p.image_url, p.n_shops,
         p.n_priced_offers, p.min_price_toman, p.median_price_toman, p.max_price_toman,
         bm25(products_fts, 10.0, 4.0, 2.0, 1.5, 1.0) AS score
  FROM products_fts JOIN products p ON p.pid = products_fts.rowid
  WHERE products_fts MATCH ? AND p.is_redacted = 0 {cat}
  ORDER BY score LIMIT 400"""

SKIP_SPEC_KEYS = {"نام محصول", "شرکت سازنده", "نام انگلیسی", "تاریخ معرفی", "مدل"}


def _fts(query: str, category: str | None = None, ops: tuple[str, ...] = ("AND", "OR")) -> list[dict]:
    units = db.query_units(query)
    if not units:
        return []
    rows: list = []
    sql = SEARCH_SQL.format(cat="AND p.category_name = ?" if category else "")
    for op in ops:
        m = db.build_match(query, op)
        if not m:
            return []
        try:
            rows = db.q(sql, (m, category) if category else (m,))
        except Exception:
            rows = []
        if len(rows) >= 3 or len(units) == 1:
            break
    heads = tuple(units[0])
    out = []
    for r in rows:
        d = dict(r)
        d["head_match"] = bool(d["title_norm"] and d["title_norm"].startswith(heads))
        out.append(d)
    return out


def nearby_offer_stats(pids: list[int], ctx: Ctx) -> dict[int, dict]:
    """Per product: shops in radius, nearest distance, cheapest in-radius price, installment shops."""
    if not pids:
        return {}
    shops = all_shops()
    stats: dict[int, dict] = {p: {"n_nearby": 0, "nearest_km": None, "nearby_min_price": None,
                                  "n_installment": 0} for p in pids}
    owners: dict[int, list[int]] = {}  # offer pid -> requested pids it counts for (duplicate entries pooled)
    for p in pids:
        for member in siblings(p):
            owners.setdefault(member, []).append(p)
    members = list(owners)
    seen = set()
    for chunk in range(0, len(members), 400):
        part = members[chunk:chunk + 400]
        marks = ",".join("?" * len(part))
        for r in db.q(f"SELECT pid, sid, price_toman, price_ok FROM offers WHERE pid IN ({marks})", part):
            s = shops.get(r["sid"])
            if not s:
                continue
            for owner in owners[r["pid"]]:
                if (owner, r["sid"]) in seen:
                    continue
                seen.add((owner, r["sid"]))
                _count(stats[owner], s, r, ctx)
    return stats


def _count(st: dict, s, r, ctx: Ctx) -> None:
    km = haversine_km(ctx.lat, ctx.lon, s.lat, s.lon)
    if st["nearest_km"] is None or km < st["nearest_km"]:
        st["nearest_km"] = round(km, 2)
    if s.installments:
        st["n_installment"] += 1
    if in_range(ctx, km, quick_minutes(km, ctx.travel_mode)):
        st["n_nearby"] += 1
        if r["price_ok"] and (st["nearby_min_price"] is None or r["price_toman"] < st["nearby_min_price"]):
            st["nearby_min_price"] = r["price_toman"]


def key_specs(pids: list[int], per_product: int = 6) -> dict[int, list[dict]]:
    if not pids:
        return {}
    marks = ",".join("?" * len(pids))
    out: dict[int, list[dict]] = {p: [] for p in pids}
    for r in db.q(f"SELECT pid, key, value FROM product_specs WHERE pid IN ({marks}) ORDER BY pid, ord", pids):
        lst = out[r["pid"]]
        if len(lst) >= per_product or not r["value"] or r["key"] in SKIP_SPEC_KEYS:
            continue
        val = str(r["value"]).strip()
        if len(val) > 60:
            val = val[:57] + "…"
        lst.append({"k": r["key"], "v": val})
    return out


def _card(d: dict, near: dict | None, specs: list[dict] | None) -> dict:
    return {
        "pid": d["pid"], "title": d["title"], "brand": d["brand"], "category": d["category_name"],
        "image": d["image_url"], "n_shops": d["n_shops"],
        "price_min": d["min_price_toman"], "price_median": d["median_price_toman"], "price_max": d["max_price_toman"],
        **(near or {}), "specs": specs or [],
    }


def search_products(query: str, ctx: Ctx, category: str | None = None, brand: str | None = None,
                    min_price: int | None = None, max_price: int | None = None, limit: int = 10,
                    with_specs: int = 4) -> dict:
    rows = _fts(query, category) if category else []
    if not rows:
        rows = _fts(query)
    total_matches = len(rows)
    facets_rows = rows[:]

    # Intent category: Persian titles lead with the product type, so the category most titles that
    # start with the query's head words belong to is what the user means ("گوشی سامسونگ" -> phones,
    # not the many cases whose titles merely mention the phone). It is decided before the brand and
    # budget filters: deciding it after them let a budget below every phone turn «گوشی موبایل» into
    # batteries and cases.
    intent = category
    heads = Counter(r["category_name"] for r in rows if r["head_match"])
    if heads and not category:
        top_cat, n_top = heads.most_common(1)[0]
        if n_top >= 2 and n_top >= 0.4 * sum(heads.values()):
            intent = top_cat
    if intent:
        # re-query inside that category: the global top 400 is crowded out by accessories. A query that is
        # just the category's own words («گوشی موبایل», «لپ تاپ») means any of them, and most phone titles
        # say «گوشی سامسونگ» rather than «گوشی موبایل سامسونگ», so it is matched loosely (OR); a query with a
        # brand or model («گوشی اپل») stays strict, or a budget below every iPhone would bring up Nokias.
        # A brand is searched on its own so its models are in the pool before the brand filter.
        generic = set(db.normalize_fa(query).split()) <= set(db.normalize_fa(intent).split())
        have = {x["pid"] for x in rows}
        loose = _fts(query, intent, ("OR",)) if generic else []
        for r in _fts(query, intent) + loose + (_fts(brand, intent) if brand else []):
            if r["pid"] not in have:
                have.add(r["pid"])
                rows.append(r)
        in_cat = [r for r in rows if r["category_name"] == intent]
        if len(in_cat) >= 3 or (category and in_cat):
            rows = in_cat
    brand_rows = rows[:]
    if brand:
        bn = db.normalize_fa(brand)
        b_rows = [r for r in rows if r["brand"] and (bn in db.normalize_fa(r["brand"]) or bn in (r["title_norm"] or ""))]
        rows = b_rows or rows
    lo = min_price if min_price is not None else ctx.budget_min
    hi = max_price if max_price is not None else ctx.budget_max

    def in_budget(rs: list[dict]) -> list[dict]:
        if hi:
            rs = [r for r in rs if r["min_price_toman"] and r["min_price_toman"] <= hi * 1.03]
        if lo:
            rs = [r for r in rs if r["max_price_toman"] and r["max_price_toman"] >= lo]
        return rs

    price_rows = rows[:]
    rows = in_budget(rows)
    # nothing of the wanted kind in the budget: say so instead of showing whatever else fits it
    budget_miss = None
    if price_rows and not rows and (lo or hi):
        lows = [r["min_price_toman"] for r in price_rows if r["min_price_toman"]]
        budget_miss = {"category": intent, "n": len(price_rows), "cheapest": min(lows) if lows else None}

    def text_rank(r):
        boost = 1 + 0.15 * math.log1p(r["n_shops"] or 0)
        if r["head_match"]:
            boost *= 1.6
        if intent and r["category_name"] == intent:
            boost *= 1.8
        if not r["n_priced_offers"]:
            boost *= 0.5
        return r["score"] * boost  # bm25 is negative: bigger boost ranks higher

    cand = sorted(rows, key=text_rank)[:150]
    near = nearby_offer_stats([r["pid"] for r in cand], ctx)

    def rank(r):
        n = near.get(r["pid"], {})
        boost = 1.0
        if n.get("n_nearby"):
            boost *= 1.25 + 0.05 * min(n["n_nearby"], 6)
        if ctx.installments_only:
            boost *= 1.3 if n.get("n_installment") else 0.75
        return text_rank(r) * boost

    cand.sort(key=rank)
    inst_only = False
    if ctx.installments_only:  # show only items some installment shop lists, when there are enough
        with_inst = [r for r in cand if near.get(r["pid"], {}).get("n_installment")]
        if len(with_inst) >= 3:
            cand, inst_only = with_inst, True
    # avoid a wall of near-identical variants: at most 2 items with the same first 5 title words
    picked, seen, groups = [], Counter(), set()
    for r in cand:
        sig = " ".join((r["title_norm"] or "").split()[:5])
        group = siblings(r["pid"])
        if seen[sig] >= 2 or group in groups:  # duplicate catalogue entries are shown once
            continue
        groups.add(group)
        seen[sig] += 1
        picked.append(r)
        if len(picked) >= limit:
            break
    specs = key_specs([r["pid"] for r in picked], with_specs) if with_specs else {}
    items = [_card(r, near.get(r["pid"]), specs.get(r["pid"])) for r in picked]

    # brands and price points come from the wanted kind of product, so the budget chips built from them
    # fit phones when phones are asked for (they used to come from the cases that crowd the top results)
    cats = Counter(r["category_name"] for r in facets_rows[:200])
    brands = Counter(r["brand"] for r in brand_rows[:300] if r["brand"])
    prices = sorted(r["median_price_toman"] for r in price_rows[:300] if r["median_price_toman"])
    quart = [prices[int(len(prices) * q)] for q in (0.1, 0.25, 0.5, 0.75, 0.9)] if len(prices) >= 5 else prices
    return {
        "query": query, "total_matches": total_matches, "after_filters": len(rows), "items": items,
        "facets": {"categories": cats.most_common(6), "brands": brands.most_common(10), "price_points": quart,
                   "intent_category": intent, "installment_only_items": inst_only, "budget_miss": budget_miss},
    }


def product_details(pid: int, max_specs: int = 40) -> dict | None:
    r = db.q1("SELECT * FROM products WHERE pid = ?", (pid,))
    if not r:
        return None
    specs = [dict(x) for x in db.q("SELECT section, key, value FROM product_specs WHERE pid = ? ORDER BY ord LIMIT ?",
                                   (pid, max_specs))]
    imgs = json.loads(r["image_urls_json"]) if r["image_urls_json"] else []
    return {
        "pid": pid, "title": r["title"], "brand": r["brand"], "model": r["model"], "category": r["category_name"],
        "images": imgs[:6], "image": r["image_url"], "n_shops": r["n_shops"],
        "price_min": r["min_price_toman"], "price_median": r["median_price_toman"], "price_max": r["max_price_toman"],
        "specs": specs,
    }


def compare_products(pids: list[int]) -> dict:
    prods = [p for p in (product_details(pid, 80) for pid in pids[:4]) if p]
    keys: list[str] = []
    values: dict[str, dict[int, str]] = {}
    for p in prods:
        for s in p["specs"]:
            k = s["key"]
            if not k or k in SKIP_SPEC_KEYS or s["value"] in (None, ""):
                continue
            if k not in values:
                keys.append(k)
                values[k] = {}
            values[k].setdefault(p["pid"], str(s["value"])[:80])
    rows = []
    for k in keys:
        vals = [values[k].get(p["pid"]) for p in prods]
        present = sum(v is not None for v in vals)
        if present < 2 and len(prods) > 1:
            continue
        differs = len({v for v in vals if v is not None}) > 1 or present < len(prods)
        rows.append({"key": k, "values": vals, "differs": differs})
    rows.sort(key=lambda r: not r["differs"])
    return {"products": [{k: p[k] for k in ("pid", "title", "brand", "image", "price_min", "price_median",
                                             "price_max", "n_shops", "category")} for p in prods],
            "rows": rows[:30]}


def similar_products(pid: int, ctx: Ctx, limit: int = 4) -> list[dict]:
    """Same-category items with similar titles that are available nearby (used when the chosen
    product has few or no reachable shops)."""
    base = db.q1("SELECT title_norm, category_name, brand, median_price_toman FROM products WHERE pid = ?", (pid,))
    if not base or not base["title_norm"]:
        return []
    words = [w for w in base["title_norm"].split() if len(w) > 1][:6]
    res = search_products(" ".join(words), ctx, category=base["category_name"], limit=limit + 6, with_specs=3)
    out = []
    ref = base["median_price_toman"]
    for it in res["items"]:
        if it["pid"] == pid or it["category"] != base["category_name"] or not it.get("n_nearby"):
            continue
        if ref and it["price_median"] and not (ref * 0.5 <= it["price_median"] <= ref * 1.6):
            continue
        out.append(it)
        if len(out) >= limit:
            break
    return out
