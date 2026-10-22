"""Core behaviour tests. Run from backend/:  python -m pytest -q"""
from datetime import datetime

import pytest

from app import agent, catalog, config, shops
from app.models import Ctx
from app.timegeo import TEHRAN, Shift, fa_text, open_status, travel_estimate

needs_db = pytest.mark.skipif(not config.DB_PATH.is_file(), reason="database not built")

MON = datetime(2026, 10, 19, 12, 0, tzinfo=TEHRAN)  # a Monday


def at(hour: int, minute: int = 0, day: int = 0) -> datetime:
    return MON.replace(day=19 + day, hour=hour, minute=minute)


def test_open_status_inside_and_after_shift():
    shifts = [Shift(0, 600, 1140), Shift(1, 600, 1140)]  # Mon/Tue 10:00-19:00
    assert open_status(shifts, True, at(12))["state"] == "open"
    assert open_status(shifts, True, at(18, 30))["closes_in_min"] == 30
    closed = open_status(shifts, True, at(20))
    assert closed["state"] == "closed" and "فردا" in closed["label"]


def test_open_status_unknown_and_overnight():
    assert open_status(None, False, at(12))["state"] == "unknown"
    night = [Shift(0, 1200, 120)]  # Mon 20:00 -> Tue 02:00
    assert open_status(night, True, at(1, 0, day=1))["state"] == "open"


def test_fa_text_formats_numbers_but_keeps_model_names():
    out = fa_text("قیمت 5190000 تومان — گوشی A55 و 2.5 کیلو")
    assert "۵٫۱۹۰٫۰۰۰" in out and "A55" in out and "۲٫۵" in out and "—" not in out


def test_travel_estimate_walk_vs_car():
    assert travel_estimate(0.5)["mode"] == "walk"
    assert travel_estimate(5)["mode"] == "car"


@needs_db
def test_search_finds_phones_with_category_filter():
    res = catalog.search_products("گوشی سامسونگ", Ctx(), category="گوشی موبایل", limit=5)
    assert res["items"] and all(i["category"] == "گوشی موبایل" for i in res["items"])


@needs_db
def test_duplicate_catalogue_entries_are_pooled():
    pid = catalog.search_products("شارژر اپل ۲۰ وات سه پین", Ctx(), limit=3)["items"][0]["pid"]
    assert len(shops.siblings(pid)) >= 1
    ranked = shops.rank_shops_for_product(pid, Ctx())
    assert ranked["stats"]["total"] >= 1
    for i in ranked["items"]:
        assert i["stock"]["state"] == "unconfirmed"  # registered price is never presented as confirmed
        assert "alt_open" in i and "price_warning" in i


@needs_db
def test_installment_filter_hides_and_counts():
    pid = catalog.search_products("شارژر اپل ۲۰ وات سه پین", Ctx(), limit=1)["items"][0]["pid"]
    allr = shops.rank_shops_for_product(pid, Ctx())
    inst = shops.rank_shops_for_product(pid, Ctx(installments_only=True))
    assert all(i["installments"] for i in inst["items"])
    assert inst["stats"]["hidden"]["installments"] == allr["stats"]["total"] - inst["stats"]["total"]


@needs_db
def test_agent_drops_hallucinated_products():
    _, sess = agent.session(None)
    ev = agent.terminal_event("show_products", {"message": "x", "picks": [{"pid": 999999999, "why": "?"}]}, Ctx(), sess)
    assert ev is None


def test_metro_route_uses_real_lines():
    from app import travel
    r = travel.transit_route(35.8046, 51.4339, 35.6950, 51.4107)  # Tajrish -> Jomhouri
    assert any(l["mode"] == "metro" for l in r["legs"]) and 20 < r["minutes"] < 90


@needs_db
def test_time_range_and_bargain_beyond_it():
    from app import shops as sh
    pid = catalog.search_products("گوشی سامسونگ S25 FE", Ctx(), category="گوشی موبایل", limit=1)["items"][0]["pid"]
    far = Ctx(range_mode="time", range_minutes=15, travel_mode="car", lat=35.8046, lon=51.4339, place="تجریش")
    r = sh.rank_shops_for_product(pid, far)
    assert r["stats"]["in_radius"] == 0 and r["bargain"] and "دورتر" in r["bargain"]["message"]
    walker = sh.rank_shops_for_product(pid, far.model_copy(update={"travel_mode": "walk"}))
    b = walker["bargain"]
    assert b and b["travel_mode"] == "transit" and b["alt_travel"]["mode"] == "walk"  # no 3-hour walks
    near = sh.rank_shops_for_product(pid, Ctx(range_mode="time", range_minutes=20, travel_mode="walk"))
    assert near["stats"]["in_radius"] > 0
    assert all("authenticity" in i for i in near["items"])


def test_authenticity_reads_seller_text():
    from app import authenticity
    copy = authenticity.assess({"seller_title": "ایرپاد پرو مستر کپی", "price_toman": 900000, "price_ok": 1}, 9_000_000, 5)
    assert copy["status"] == "declared_copy"
    cheap = authenticity.assess({"seller_title": "ایرپاد پرو", "price_toman": 3_000_000, "price_ok": 1}, 9_000_000, 5)
    assert cheap["status"] == "suspicious" and cheap["confidence"] > 0


@needs_db
def test_stroll_finds_nearby_deals():
    from app import shops as sh, stroll
    pid = catalog.search_products("گوشی سامسونگ S25 FE", Ctx(), category="گوشی موبایل", limit=1)["items"][0]["pid"]
    anchor = sh.rank_shops_for_product(pid, Ctx())["items"][0]["sid"]
    r = stroll.stroll(pid, anchor, Ctx())
    assert r["stops"] and all(s["item"]["below_pct"] >= 12 for s in r["stops"])


def test_nav_links_open_the_route_from_the_user():
    from app.shops import nav_links
    links = nav_links(35.8046, 51.4339, "x", (35.6998, 51.4197), "transit")
    assert links["neshan"] == "https://neshan.org/maps/routing/public_transportation/origin/35.6998,51.4197/destination/35.8046,51.4339"
    assert "origin=51.4197,35.6998&destination=51.4339,35.8046" in links["balad"]  # Balad wants lon,lat
    assert "maps/dir/?api=1&origin=35.6998,51.4197" in links["google"] and links["google"].endswith("travelmode=transit")
    assert "search" in nav_links(35.8, 51.4, "x")["google"]  # no origin: just the place


@needs_db
def test_free_text_places_find_malls_metro_and_areas():
    from app import gazetteer
    assert gazetteer.search("علاءالدین")[0]["label"].startswith("پاساژ علا")  # dataset spells it without ء
    hit = gazetteer.search("مترو طالقانی")[0]
    assert hit["kind"] == "metro" and "طالقانی" in hit["label"]  # «مترو آیت‌الله طالقانی»
    assert any(h["kind"] == "area" for h in gazetteer.search("شیخ هادی"))
    assert gazetteer.search("فردوسی")[0]["kind"] == "place"
    assert gazetteer.search("x") == [] and gazetteer.search("نیویورک") == []


@needs_db
def test_map_areas_and_tapped_points():
    from app import gazetteer
    names = {a["label"]: a for a in gazetteer.areas()}
    assert "تجریش" in names and names["فردوسی"]["shops"] > 1000
    tajrish = gazetteer.at(35.8046, 51.4339)
    assert "تجریش" in tajrish["label"] and tajrish["shops_nearby"] > 0
    desert = gazetteer.at(35.55, 51.90)  # far east of the city: nothing near, nothing listed
    assert desert["near"] is None and desert["shops_nearby"] == 0



def test_gen_never_reasks_a_known_place_or_travel():
    from app.genui import _valid
    res = {"items": []}
    assert not _valid({"block": "place", "title": "کجا؟"}, res, {"place": True, "travel": False})
    assert _valid({"block": "place", "title": "کجا؟"}, res, {"place": False, "travel": False})
    assert not _valid({"block": "travel", "title": "چطوری؟"}, res, {"place": True, "travel": True})
    assert _valid({"block": "travel", "title": "چطوری؟"}, res, {"place": True, "travel": False})


def test_copy_hint_from_the_title_and_model_code():
    from app.authenticity import _model_key, product_hint
    assert product_hint("گوشی طرح سامسونگ S24 Ultra | حافظه 128 رم 4 گیگابایت", "گوشی موبایل", "سامسونگ", 18_900_000)
    assert product_hint("تیشرت طرح دار نخی", "تیشرت", None, 300_000) is None  # «طرح» alone is just a pattern
    assert _model_key("گوشی سامسونگ (ویتنام) S25 Ultra 5G | حافظه 256 رم 12 گیگابایت") == ("s 25", frozenset({"ultra"}))
    assert _model_key("لپ تاپ ایسوس i7 نسل 12") is None  # the processor is not the model
    assert _model_key("تلویزیون ال جی QLED Ultra HD 4K") is None
