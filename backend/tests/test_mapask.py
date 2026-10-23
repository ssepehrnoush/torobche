"""Talking to the shops map: the rules alone, and a model reading kept only where the request backs it."""
import asyncio

from app import llm, mapask

SHOPS = [
    {"sid": 1, "name": "الف", "price": 4_100_000, "minutes": 9, "open": "open", "installment": True},
    {"sid": 2, "name": "ب", "price": 3_900_000, "minutes": 14, "open": "closed", "installment": True},
    {"sid": 3, "name": "ج", "price": 3_500_000, "minutes": 5, "open": "open", "installment": False, "mall": "پاساژ"},
]


def ask(text):
    return asyncio.run(mapask.ask(text, SHOPS))


def test_rules(monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: False)
    assert ask("فقط بازها")["sids"] == [1, 3]
    assert ask("ارزون‌ترین دو تا که قسطی باشه")["sids"] == [2, 1]
    assert ask("زیر ۴ میلیون")["sids"] == [2, 3]
    assert ask("نزدیک‌ترین")["sids"][0] == 3
    r = ask("داخل پاساژ")
    assert r["sids"] == [3] and "۱ مغازه" in r["say"]


def test_model_needs_the_words(monkeypatch):
    async def fake(system, user, max_tokens=0):  # fills keys nobody asked for, and backs only one of them
        return {"filter": {"open": True, "authentic": True, "in_mall": True, "installment": True},
                "why": {"open": "باز", "installment": "قسطی"}}
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake)
    r = ask("ارزون‌ترین دو تا که قسطی باشه")
    assert r["filter"] == {"installment": True, "sort": "price", "limit": 2}
    assert r["sids"] == [2, 1]
