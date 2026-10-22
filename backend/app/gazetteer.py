"""Free-text start points for «از کجا راه می‌افتی؟», without a geocoding service.

Every name the app can put on the map by itself: the preset squares, Tehran metro stations, and the
shopping centres and neighbourhoods of the dataset (placed at the median position of their shops).
That is about 940 points, all inside the area the shops cover. Anything else is honestly not found.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from functools import lru_cache
from statistics import median

from . import db, travel
from .places import PLACES
from .timegeo import fa_digits, haversine_km

# Words people put in front of a name («مترو طالقانی», «پاساژ علاءالدین»); matching ignores them.
_GENERIC = re.compile(r"^(?:ایستگاه|مترو|میدان|میدون|خیابان|خیابون|پاساژ|مجتمع|ساختمان|محله|محل|نزدیک|از|سمت)\s+")
_FOLD = str.maketrans({"ء": "", "ٔ": "", "أ": "ا", "إ": "ا", "آ": "ا"})
_PUNCT = re.compile(r"[^\w]")
KIND_ORDER = {"place": 0, "metro": 1, "mall": 2, "area": 3}
SAME_BUILDING_KM = 0.4
NEAR_KM = 1.0  # a tapped point is named after a known place this close
WALK_KM = 1.5  # «shops within a short walk» of a tapped point
# «مترو امام» means a station even though «میدان امام خمینی» is a preset; the first word says which kind comes first.
_HINT = {"مترو": "metro", "ایستگاه": "metro", "پاساژ": "mall", "مجتمع": "mall", "ساختمان": "mall", "محله": "area"}


def _norm(text: str) -> str:
    return db.normalize_fa(text, split_alnum=False).translate(_FOLD)


def _core(text: str) -> str:
    """The distinctive part of a name, spaces removed: «پاساژ علاءالدین» -> «علاالدین»."""
    s = _norm(text)
    while True:
        t = _GENERIC.sub("", s)
        if t == s:
            break
        s = t
    return _PUNCT.sub("", s)


def _label(name: str) -> str:
    """Dataset names sometimes carry a stray bracket («پاساژ چارسو)»): drop unbalanced ones."""
    s = name.strip()
    if s.count("(") != s.count(")"):
        s = s.replace("(", " ").replace(")", " ")
    return " ".join(s.split())


def _entry(kind: str, label: str, lat: float, lon: float, sub: str, weight: int = 0) -> dict:
    return {"id": f"{kind}:{label}", "kind": kind, "label": label, "lat": round(lat, 6), "lon": round(lon, 6),
            "sub": sub, "_core": _core(label), "_full": _PUNCT.sub("", _norm(label)), "_w": weight}


@lru_cache(maxsize=1)
def entries() -> list[dict]:
    out = [_entry("place", p["label"], p["lat"], p["lon"], "میدان و خیابان اصلی", 10**6) for p in PLACES]

    lines: dict[str, set[str]] = defaultdict(set)
    pos: dict[str, tuple[float, float]] = {}
    for ref, _i, s in travel.network()["stations"]:
        lines[s["name"]].add(travel.line_label(ref))
        pos.setdefault(s["name"], (s["lat"], s["lon"]))
    for name, ls in lines.items():
        out.append(_entry("metro", f"مترو {name}", *pos[name], "ایستگاه مترو، " + " و ".join(sorted(ls))))

    # One centre under several spellings («پاساژ علاالدین», «پاساژ علا الدین», «مجتمع علاالدین») is one entry,
    # named by its most common spelling. The same name more than a few hundred metres away is another building.
    named: dict[str, list] = defaultdict(list)
    areas: dict[str, list] = defaultdict(list)
    for r in db.q("SELECT mall_name, area, lat, lon FROM shops WHERE lat IS NOT NULL AND lon IS NOT NULL"):
        if r["mall_name"] and _core(r["mall_name"]):
            named[_core(r["mall_name"])].append(r)
        if r["area"]:
            areas[r["area"].strip()].append(r)
    malls: list[list] = []
    for rows in named.values():
        groups: list[list] = []
        for r in rows:
            g = next((g for g in groups if haversine_km(g[0]["lat"], g[0]["lon"], r["lat"], r["lon"]) < SAME_BUILDING_KM), None)
            g.append(r) if g else groups.append([r])
        malls += groups
    for rows in malls:
        name = _label(Counter(r["mall_name"] for r in rows).most_common(1)[0][0])
        where = Counter(r["area"] for r in rows if r["area"]).most_common(1)
        sub = f"{fa_digits(len(rows))} فروشگاه" + (f"، {where[0][0]}" if where else "")
        out.append(_entry("mall", name, median(r["lat"] for r in rows), median(r["lon"] for r in rows), sub, len(rows)))
    for name, rows in areas.items():
        out.append(_entry("area", name, median(r["lat"] for r in rows), median(r["lon"] for r in rows),
                          f"محله، {fa_digits(len(rows))} فروشگاه", len(rows)))
    return out


def search(text: str, limit: int = 8) -> list[dict]:
    """Best matches first: exact name, then names that start with it, then names that contain it."""
    q_core, q_full = _core(text), _PUNCT.sub("", _norm(text))
    if len(q_core) < 2:
        return []
    hint = _HINT.get(_norm(text).split(" ")[0])
    scored = []
    for e in entries():
        if e["_core"] == q_core:
            rank = 0
        elif e["_core"].startswith(q_core):
            rank = 1
        elif q_core in e["_core"] or q_full in e["_full"]:
            rank = 2
        else:
            continue
        kind = -1 if e["kind"] == hint else KIND_ORDER[e["kind"]]
        scored.append((rank, kind, -e["_w"], len(e["label"]), e))
    scored.sort(key=lambda t: t[:4])
    # Shop positions are noisy, so one building can split into a big cluster and a few strays: a name is
    # listed once, at its biggest cluster.
    out, seen = [], set()
    for *_, e in scored:
        if e["label"] in seen:
            continue
        seen.add(e["label"])
        out.append(_public(e))
        if len(out) == limit:
            break
    return out


def _public(e: dict) -> dict:
    return {k: v for k, v in e.items() if not k.startswith("_")}


def areas(min_shops: int = 10) -> list[dict]:
    """Neighbourhoods with enough shops to be worth a trip: the map's tappable bubbles."""
    return [_public(e) | {"shops": e["_w"]} for e in entries() if e["kind"] == "area" and e["_w"] >= min_shops]


@lru_cache(maxsize=1)
def _shop_points() -> list[tuple[float, float]]:
    return [(r["lat"], r["lon"]) for r in db.q("SELECT lat, lon FROM shops WHERE lat IS NOT NULL AND lon IS NOT NULL")]


def at(lat: float, lon: float) -> dict:
    """Name a point tapped on the map after the closest landmark, and count the shops within a short walk,
    so a tap where no shop is listed can say so instead of showing an empty list later."""
    landmarks = [e for e in entries() if e["kind"] != "mall" or e["_w"] >= 10]  # tiny centres make odd names
    best = min(landmarks, key=lambda e: haversine_km(lat, lon, e["lat"], e["lon"]))
    near = _public(best) if haversine_km(lat, lon, best["lat"], best["lon"]) <= NEAR_KM else None
    shops = sum(1 for a, b in _shop_points() if haversine_km(lat, lon, a, b) <= WALK_KM)
    return {"label": f"نزدیک {best['label']}" if near else "نقطهٔ روی نقشه", "near": near, "shops_nearby": shops}
