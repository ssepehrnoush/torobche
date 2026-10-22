"""Minimal OpenAI-compatible chat client with provider fallback (OpenAI <-> BoxAPI)."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections import deque

import httpx

from . import config

log = logging.getLogger("llm")


class LLMUnavailable(RuntimeError):
    pass


_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(config.LLM_TIMEOUT_S, connect=8.0))
    return _client


def available() -> bool:
    return bool(config.llm_endpoints())


def describe() -> dict:
    eps = config.llm_endpoints()
    return {"providers": [{"name": e.name, "model": e.model} for e in eps], "available": bool(eps)}


_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL_S = 900


def _cache_key(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


async def chat(messages: list[dict], tools: list[dict] | None = None, tool_choice: str | dict | None = None,
               temperature: float | None = None, max_tokens: int | None = None,
               json_mode: bool = False) -> dict:
    """Return the assistant message dict. Tries each configured provider in order.
    Identical requests within 15 minutes are answered from memory (saves the shared API budget)."""
    key = _cache_key(messages, [t["function"]["name"] for t in tools or []], tool_choice, max_tokens, json_mode)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_S:
        return dict(hit[1])
    msg = await _chat(messages, tools, tool_choice, temperature, max_tokens, json_mode)
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.monotonic(), dict(msg))
    return msg


class BudgetExceeded(LLMUnavailable):
    pass


_check: dict[bool, tuple[float, list]] = {}


async def check_providers(deep: bool = False) -> list[dict]:
    """Can this server reach each provider? Lists the models (free) or, with deep, asks for a five-token reply, with
    every configured key; cached for five minutes. Shows only status codes, never keys."""
    hit = _check.get(deep)
    if hit and time.monotonic() - hit[0] < 300:
        return hit[1]
    out = []
    for ep in config.llm_endpoints():
        t0 = time.monotonic()
        try:
            if deep:
                r = await client().post(f"{ep.base_url}/chat/completions", headers={"Authorization": f"Bearer {ep.api_key}"},
                                        json={"model": ep.model, "messages": [{"role": "user", "content": "Reply with: ok"}],
                                              "max_completion_tokens": 5, **ep.extra}, timeout=30)
            else:
                r = await client().get(f"{ep.base_url}/models", headers={"Authorization": f"Bearer {ep.api_key}"}, timeout=15)
            body = r.text[:400].lower()
            note = ("blocked for this country" if "unsupported_country" in body
                    else "out of credit" if r.status_code == 402 or "budget" in body else None)
            out.append({"provider": ep.name, "model": ep.model, "status": r.status_code, "ok": r.status_code == 200,
                        "note": note, "ms": round((time.monotonic() - t0) * 1000)})
        except httpx.HTTPError as e:
            out.append({"provider": ep.name, "model": ep.model, "status": None, "ok": False, "note": type(e).__name__,
                        "ms": round((time.monotonic() - t0) * 1000)})
    _check[deep] = (time.monotonic(), out)
    return out


# The BoxAPI key allows one request at a time and ~20 per minute, shared with another app, so calls are
# serialised, spaced, and capped per session; identical requests are served from the cache above.
_gate = asyncio.Semaphore(config.LLM_CONCURRENCY)
_recent: deque[float] = deque()
_per_session: dict[str, deque[float]] = {}


def check_session_budget(session_id: str | None) -> None:
    if not session_id:
        return
    now = time.monotonic()
    q = _per_session.setdefault(session_id, deque())
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= config.LLM_SESSION_CALLS_PER_HOUR:
        raise BudgetExceeded("session LLM budget used up")
    q.append(now)


async def _rate_wait() -> None:
    while True:
        now = time.monotonic()
        while _recent and now - _recent[0] > 60:
            _recent.popleft()
        if len(_recent) < config.LLM_CALLS_PER_MINUTE:
            _recent.append(now)
            return
        await asyncio.sleep(60 - (now - _recent[0]) + 0.05)


async def _chat(messages, tools, tool_choice, temperature, max_tokens, json_mode) -> dict:
    async with _gate:
        await _rate_wait()
        return await _chat_unlocked(messages, tools, tool_choice, temperature, max_tokens, json_mode)


async def _chat_unlocked(messages, tools, tool_choice, temperature, max_tokens, json_mode) -> dict:
    errors = []
    for ep in config.llm_endpoints():
        body: dict = {"model": ep.model, "messages": messages, **ep.extra}
        if tools:
            body["tools"] = tools
            if tool_choice:
                body["tool_choice"] = tool_choice
        if temperature is not None and not ep.extra.get("reasoning_effort"):
            body["temperature"] = temperature
        if max_tokens:
            body["max_completion_tokens"] = max_tokens
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        t0 = time.monotonic()
        try:
            for attempt in range(3):
                r = await client().post(f"{ep.base_url}/chat/completions", json=body,
                                        headers={"Authorization": f"Bearer {ep.api_key}"})
                if r.status_code != 429:  # the shared key is busy: back off briefly and retry
                    break
                await asyncio.sleep(1.5 * (attempt + 1))
            if r.status_code >= 400:
                raise LLMUnavailable(f"{ep.name} HTTP {r.status_code}: {r.text[:300]}")
            data = r.json()
            msg = data["choices"][0]["message"]
            log.info("llm %s/%s %.1fs tools=%s", ep.name, ep.model, time.monotonic() - t0,
                     [c["function"]["name"] for c in msg.get("tool_calls") or []])
            msg["_provider"] = ep.name
            return msg
        except (httpx.HTTPError, LLMUnavailable, KeyError, ValueError) as e:
            log.warning("llm provider %s failed: %s", ep.name, str(e)[:300])
            errors.append(f"{ep.name}: {type(e).__name__}")
    raise LLMUnavailable("; ".join(errors) or "no LLM provider configured")


async def complete_json(system: str, user: str, max_tokens: int = 800) -> dict:
    msg = await chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                     json_mode=True, max_tokens=max_tokens)
    try:
        return json.loads(msg.get("content") or "{}")
    except ValueError as e:
        raise LLMUnavailable(f"bad json: {e}") from e
