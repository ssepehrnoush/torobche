"""Street-following lines on the visit map. Run from backend/:  python -m pytest -q"""
from app import streets


def stop(lat, lon, mode):
    return {"lat": lat, "lon": lon, "leg": {"mode": mode}}


def test_legs_travelled_the_same_way_share_one_line_and_metro_stays_straight(monkeypatch):
    asked = []

    def fake_route(profile, pts):
        asked.append((profile, len(pts)))
        return [list(pts[0]), [9.0, 9.0], list(pts[-1])] if profile == "foot" else None  # the car service is down

    monkeypatch.setattr(streets, "_route", fake_route)
    out = streets.paths((1.0, 1.0), [stop(2, 2, "walk"), stop(3, 3, "walk"), stop(4, 4, "car"), stop(5, 5, "transit")])
    assert asked == [("foot", 3), ("car", 2)]  # one request per run, none for the metro leg
    assert [(p["mode"], p["real"]) for p in out] == [("walk", True), ("car", False), ("transit", False)]
    assert out[1]["points"] == [[3, 3], [4, 4]]  # the failed run falls back to the straight line
