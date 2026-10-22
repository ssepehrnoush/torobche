"""Street-following lines for the visit map, from the public OpenStreetMap routing service (FOSSGIS).

Only the drawn line comes from here: travel times stay our own Tehran-traffic estimates (travel.py),
since this service knows no traffic. Metro legs keep the straight line. When the service is slow or
down, a leg falls back to the dotted straight line the map drew before, so a demo never waits on it.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import httpx

log = logging.getLogger("streets")
URL = "https://routing.openstreetmap.de/routed-{profile}/route/v1/driving/{coords}"
PROFILES = {"walk": "foot", "car": "car"}  # leg mode -> routing profile; transit has none
UA = "torobche-hackathon-demo (github.com/ssepehrnoush)"  # the service's fair-use policy asks for one
TIMEOUT_S = 4.0  # the runs of one plan are asked at the same time, so this bounds the whole plan
_cache: dict[tuple, list[list[float]]] = {}


def _route(profile: str, pts: list[tuple[float, float]]) -> list[list[float]] | None:
    key = (profile, tuple((round(a, 5), round(b, 5)) for a, b in pts))
    if key in _cache:
        return _cache[key]
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in pts)
    try:
        r = httpx.get(URL.format(profile=profile, coords=coords), params={"overview": "full", "geometries": "geojson"},
                      headers={"User-Agent": UA}, timeout=TIMEOUT_S)
        d = r.json()
        if d.get("code") != "Ok":
            log.warning("route %s refused: %s", profile, d.get("code"))
            return None
        line = [[lat, lon] for lon, lat in d["routes"][0]["geometry"]["coordinates"]]
    except Exception as e:
        log.warning("route %s failed: %s", profile, type(e).__name__)
        return None
    line = [list(pts[0]), *line, list(pts[-1])]  # the service snaps to the road; reach the pins themselves
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = line
    return line


def paths(origin: tuple[float, float], stops: list[dict]) -> list[dict]:
    """One line per run of legs travelled the same way, street-following when the service answers:
    [{mode, real, points: [[lat, lon], ...]}]."""
    runs: list[tuple[str, list[tuple[float, float]]]] = []
    prev = origin
    for s in stops:
        mode, pt = s["leg"].get("mode", ""), (s["lat"], s["lon"])
        if runs and runs[-1][0] == mode:
            runs[-1][1].append(pt)
        else:
            runs.append((mode, [prev, pt]))
        prev = pt
    with ThreadPoolExecutor(max_workers=4) as ex:
        lines = list(ex.map(lambda r: _route(PROFILES[r[0]], r[1]) if r[0] in PROFILES else None, runs))
    return [{"mode": mode, "real": line is not None, "points": line or [list(p) for p in pts]}
            for (mode, pts), line in zip(runs, lines)]
