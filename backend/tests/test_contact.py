"""Real text and call to the demo phone (demo «زنده»). Run from backend/:  python -m pytest -q"""
import asyncio

from app import contact, kavenegar, whatsapp

ITEM = {"sid": 1, "name": "موبایل تست پاساژ علاءالدین", "price": 1_000_000}
PRODUCT = {"title": "گوشی موبایل سامسونگ مدل Galaxy A55 ظرفیت ۲۵۶ گیگابایت رم ۸ گیگابایت", "image": None}
PLAN = {"sid": 1, "outcome": "confirmed", "delay_s": 0.01, "confirmed_price": 1_000_000, "in_stock": True,
        "hold_until": None, "text": None}


def reach(monkeypatch, on_text=None, text_note=None, channels=("sms", "call"), wa_note=None, wa_reply=None):
    """Run one «زنده» shop on the demo phone with fake WhatsApp and Kavenegar calls; returns (sent, events)."""
    sent: list[str] = []

    async def fake_wa(phone, text):
        sent.append("whatsapp")
        assert f"{whatsapp.PUBLIC_URL}/r/" in text  # WhatsApp gets the full link
        return wa_note

    async def fake_text(phone, shop, product, code):
        sent.append("sms")
        if on_text:
            on_text(code)
        return text_note

    async def fake_call(phone, text):
        sent.append("call")
        return None

    monkeypatch.setattr(whatsapp, "send", fake_wa)
    monkeypatch.setattr(kavenegar, "send_text", fake_text)
    monkeypatch.setattr(kavenegar, "call", fake_call)
    monkeypatch.setattr(contact, "REAL_TEXT_WAIT_S", 0.05)
    monkeypatch.setattr(contact, "LIVE_WAIT_S", 0.1)
    monkeypatch.setattr(contact, "PHONE_WAIT_S", 0.3)
    monkeypatch.setattr(contact, "INBOX_EVERY_S", 0.02)

    async def fake_inbox(phone, since_ms):
        return [{"text": wa_reply, "ts": since_ms + 1}] if wa_reply and "whatsapp" in sent else []

    monkeypatch.setattr(whatsapp, "inbox", fake_inbox)

    async def run():
        tok = contact._new_page(7, ITEM, PRODUCT)
        q: asyncio.Queue = asyncio.Queue()
        await contact._reach(ITEM, list(channels), dict(PLAN), tok, True, q, "09120000000")
        return [q.get_nowait() for _ in range(q.qsize())]

    return sent, asyncio.run(run())


def test_fit_respects_kavenegar_token_rules():
    out = kavenegar.fit(PRODUCT["title"] + "\n_x", 8)
    assert out.count(" ") <= 8 and len(out) <= 100 and "_" not in out and "\n" not in out
    assert kavenegar.fit("a" * 300, 8) == "a" * 100


def test_normalize_phone():
    for raw in ("۰۹۱۲۰۰۰۰۰۰۰", "+989120000000", "00989120000000", "9120000000", "0912 000 0000"):
        assert kavenegar.normalize_phone(raw) == "09120000000"
    assert kavenegar.normalize_phone("02147009161") is None


def test_reply_codes_are_letters_and_digits():
    tok = contact._new_page(7, ITEM, PRODUCT)
    assert tok.isalnum() and tok.isascii() and len(tok) == 10


def test_untapped_text_is_followed_by_a_real_call(monkeypatch):
    sent, events = reach(monkeypatch)
    assert sent == ["sms", "call"]
    chans = [e for e in events if e["type"] == "channel" and e["state"] != "no_answer"]
    assert [e["channel"] for e in chans] == ["sms", "call"] and all(e["real"] for e in chans)
    assert events[-1]["type"] == "reply" and events[-1]["outcome"] == "no_answer"


def test_a_tap_on_the_texted_page_stops_the_call(monkeypatch):
    sent, events = reach(monkeypatch, on_text=lambda code: contact.submit_reply(code, "out_of_stock", None))
    assert sent == ["sms"]
    assert events[-1]["type"] == "reply" and events[-1]["real"] and events[-1]["outcome"] == "out_of_stock"


def test_a_shop_that_keeps_the_item_gives_the_customer_a_reservation_code(monkeypatch):
    sent, events = reach(monkeypatch, on_text=lambda code: contact.submit_reply(code, "confirmed", None, 2))
    r = events[-1]
    assert r["in_stock"] and r["real"] and len(r["hold_code"]) == 4 and r["hold_code"].isdigit()
    assert r["hold_until_at"] and r["hold_until"] in r["text"]


def test_out_of_stock_never_holds(monkeypatch):
    sent, events = reach(monkeypatch, on_text=lambda code: contact.submit_reply(code, "out_of_stock", None, 2))
    assert events[-1]["hold_code"] is None


def test_a_refused_text_is_shown_and_the_call_still_goes(monkeypatch):
    sent, events = reach(monkeypatch, text_note=kavenegar.ERRORS[424])
    assert sent == ["sms", "call"]
    assert any(e["type"] == "error" and "تأیید نشده" in e["text"] for e in events)
    assert next(e for e in events if e["type"] == "channel")["real"] is False


def test_a_tester_plays_the_first_shop_within_the_daily_caps(monkeypatch):
    monkeypatch.setenv("KAVENEGAR_API_KEY", "x")
    monkeypatch.delenv("DEMO_SHOP_PHONES", raising=False)
    monkeypatch.setattr(kavenegar, "_claims", {})
    forced, phones, note = contact.live_phones([7, 8], None, "۰۹۱۲ ۰۰۰ ۰۰۰۰", "browser-a")
    assert note is None and forced == {7: "live"} and phones == {7: "09120000000"}
    contact.live_phones([7], None, "09120000000", "browser-b")
    _, phones, note = contact.live_phones([7], None, "09120000000", "browser-c")  # third time today for this number
    assert phones == {} and "شبیه‌سازی" in note
    contact.live_phones([7], None, "09351110000", "browser-a")
    contact.live_phones([7], None, "09351110001", "browser-a")
    _, phones, note = contact.live_phones([7], None, "09351110002", "browser-a")  # fourth from this browser
    assert phones == {} and note


def test_a_landline_or_no_key_falls_back_to_simulation(monkeypatch):
    monkeypatch.setenv("KAVENEGAR_API_KEY", "x")
    assert contact.live_phones([7], None, "02147009161", None)[1] == {}
    monkeypatch.delenv("KAVENEGAR_API_KEY")
    _, phones, note = contact.live_phones([7], None, "09120000000", None)
    assert phones == {} and "در دسترس نیست" in note


def test_whatsapp_goes_first_and_a_number_without_whatsapp_moves_on(monkeypatch):
    sent, events = reach(monkeypatch, channels=("whatsapp", "sms", "call"), wa_note="این شماره واتساپ ندارد")
    assert sent == ["whatsapp", "sms", "call"]
    assert any(e["type"] == "error" and "واتساپ ندارد" in e["text"] for e in events)


def test_a_channel_that_never_left_does_not_hold_up_the_next(monkeypatch):
    import time
    monkeypatch.setattr(contact, "REAL_TEXT_WAIT_S", 2.0)  # long enough to notice if it were waited
    t = time.monotonic()
    sent, events = reach(monkeypatch, channels=("whatsapp", "sms", "call"), wa_note="واتساپ الان در دسترس نیست",
                         on_text=lambda code: contact.submit_reply(code, "confirmed", None))
    assert sent == ["whatsapp", "sms"] and time.monotonic() - t < 1.5


def test_real_channels_put_whatsapp_first_only_when_the_gateway_is_set(monkeypatch):
    monkeypatch.delenv("WAHA_URL", raising=False)
    assert contact.real_channels() == ["sms", "call"]
    monkeypatch.setenv("WAHA_URL", "https://wa.example")
    monkeypatch.setenv("WAHA_API_KEY", "k")
    assert contact.real_channels() == ["whatsapp", "sms", "call"]


def test_daily_cap_stops_before_any_request(monkeypatch):
    monkeypatch.setattr(kavenegar, "DAILY_CAP", 1)
    monkeypatch.setattr(kavenegar, "_used", {})
    assert kavenegar._spend() and not kavenegar._spend()
    assert "سقف" in asyncio.run(kavenegar._get("verify/lookup", {}))


def test_texts_go_only_to_demo_phones(monkeypatch):
    monkeypatch.setenv("KAVENEGAR_API_KEY", "x")
    monkeypatch.delenv("DEMO_SHOP_PHONES", raising=False)
    assert not kavenegar.enabled()
    monkeypatch.setenv("DEMO_SHOP_PHONES", "09120000000, 0935 111 2222")
    assert kavenegar.enabled() and kavenegar.demo_phones() == ["09120000000", "09351112222"]


def test_shops_pick_one_to_three_of_whatsapp_text_and_call():
    from collections import Counter
    seen = Counter(tuple(contact.contact_prefs(f"shop-{i}")) for i in range(2000))
    assert all(set(p) <= {"whatsapp", "sms", "call"} and 1 <= len(p) <= 3 for p in seen)
    assert {len(p) for p in seen} == {1, 2, 3}
    assert contact.contact_prefs("shop-7") == contact.contact_prefs("shop-7")  # fixed per shop


def test_the_shopkeepers_own_whatsapp_reply_is_the_real_answer(monkeypatch):
    sent, events = reach(monkeypatch, channels=("whatsapp", "sms", "call"), wa_reply="سلام، موجوده. قیمتش ۱٫۲ میلیون شده")
    reply = next(e for e in events if e["type"] == "reply")
    assert reply["real"] and reply["own"] and reply["via"] == "whatsapp"
    assert reply["outcome"] == "price_changed" and reply["confirmed_price"] == 1_200_000 and reply["in_stock"]
    assert "قیمتش ۱٫۲ میلیون شده" in reply["text"]
    assert "call" not in sent  # the answer came before the call was due


def test_reading_a_shopkeepers_words():
    assert contact.read_answer("بله موجوده", 900)["outcome"] == "confirmed"
    assert contact.read_answer("موجود نیست", 900)["outcome"] == "out_of_stock"
    assert contact.read_answer("نداریم", 900)["outcome"] == "out_of_stock"
    assert contact.read_answer("سلام", 900)["outcome"] == "replied"
