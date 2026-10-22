"""Talking with the assistant: Persian speech to text with Gemini, text to Persian speech with gpt-audio.

Both go through the sponsor gateway BoxAPI like every other model call, on the same key and in the same
one-at-a-time queue (`llm.slot`). The browser records 16 kHz mono WAV itself, so every phone sends one format
and nothing depends on the browser's own speech service (Google's, which is not reachable from Iran).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import AsyncIterator

from . import config, llm

log = logging.getLogger("voice")

STT_MODEL = os.environ.get("VOICE_STT_MODEL", "google/gemini-3.8-flash")
TTS_MODEL = os.environ.get("VOICE_TTS_MODEL", "openai/gpt-audio")  # gpt-audio-mini answers the text instead of reading it
TTS_VOICE = os.environ.get("VOICE_TTS_VOICE", "coral")
TTS_RATE = 24000  # pcm16 mono, as gpt-audio streams it
MAX_AUDIO_BYTES = 2_000_000  # about a minute of 16 kHz WAV
MAX_SPEAK_CHARS = 400
SILENT = 400  # pcm16 peak below this is silence (about 1% of full scale)

STT_PROMPT = ("Transcribe this Persian speech exactly as spoken, in Persian script, with Persian digits for numbers. "
              "The speaker is talking to a shopping assistant about products, prices and places in Tehran. "
              "Output only the transcript. If there is no speech, output nothing.")
TTS_PROMPT = ("You are a text-to-speech engine. Read the text inside «» aloud in natural, warm, conversational "
              "Tehrani Persian. Say exactly those words and nothing else: do not answer, greet or add anything.")


def available() -> bool:
    return _endpoint() is not None


def _endpoint() -> config.LLMEndpoint | None:
    return next((e for e in config.llm_endpoints() if e.name == "boxapi"), None)


def _headers(ep: config.LLMEndpoint) -> dict:
    return {"Authorization": f"Bearer {ep.api_key}"}


async def transcribe(wav: bytes) -> str:
    ep = _endpoint()
    if not ep:
        raise llm.LLMUnavailable("voice needs BoxAPI")
    body = {"model": STT_MODEL, "temperature": 0, "max_completion_tokens": 300, "messages": [{"role": "user", "content": [
        {"type": "text", "text": STT_PROMPT},
        {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav).decode(), "format": "wav"}}]}]}
    if STT_MODEL.startswith("google/gemini-3"):
        # Gemini 3 always thinks first; for a transcript that is wasted time (4.1 s -> 3.2 s on a 10 s clip, 10-22)
        body["reasoning"] = {"effort": "minimal"}
    t0 = time.monotonic()
    async with llm.slot():
        r = await llm.client().post(f"{ep.base_url}/chat/completions", json=body, headers=_headers(ep))
    if r.status_code >= 400:
        raise llm.LLMUnavailable(f"stt HTTP {r.status_code}: {r.text[:200]}")
    text = (r.json()["choices"][0]["message"].get("content") or "").strip().strip("«»\"'").strip()
    log.info("stt %s %.1fs %d bytes -> %d chars", STT_MODEL, time.monotonic() - t0, len(wav), len(text))
    return text


_spoken: dict[str, bytes] = {}  # the same sentence (a repeated question) is read once


async def speak(text: str) -> AsyncIterator[bytes]:
    """Stream the sentence as raw pcm16 at TTS_RATE, chunk by chunk as the model produces it."""
    text = " ".join(text.split())[:MAX_SPEAK_CHARS]
    if text in _spoken:
        yield _spoken[text]
        return
    ep = _endpoint()
    if not ep:
        raise llm.LLMUnavailable("voice needs BoxAPI")
    # gpt-audio sometimes reads the sentence and then keeps streaming (once 817 s, about a dollar, 10-22): the
    # length is capped from the text (about 20 audio tokens a second, Persian about 9 characters a second) and
    # reading stops at the first long silence after speech.
    seconds = len(text) / 9 + 4
    body = {"model": TTS_MODEL, "modalities": ["text", "audio"], "audio": {"voice": TTS_VOICE, "format": "pcm16"},
            "stream": True, "temperature": 0, "max_completion_tokens": int(seconds * 22) + 80,
            "messages": [{"role": "system", "content": TTS_PROMPT}, {"role": "user", "content": f"«{text}»"}]}
    pcm = bytearray()
    quiet = 0  # samples of silence since the last sound
    t0 = time.monotonic()
    async with llm.slot():
        async with llm.client().stream("POST", f"{ep.base_url}/chat/completions", json=body, headers=_headers(ep)) as r:
            if r.status_code >= 400:
                log.warning("tts HTTP %s: %s", r.status_code, (await r.aread())[:200])
                return
            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    choices = json.loads(data).get("choices") or []
                except ValueError:
                    continue
                done = False
                for ch in choices:
                    chunk = ((ch.get("delta") or {}).get("audio") or {}).get("data")
                    if chunk:
                        raw = base64.b64decode(chunk)
                        pcm += raw
                        yield raw
                        samples = memoryview(raw[: len(raw) // 2 * 2]).cast("h")
                        quiet = quiet + len(samples) if max(map(abs, samples), default=0) < SILENT else 0
                        done = quiet >= TTS_RATE * 1.2 and len(pcm) > TTS_RATE * 2 * 1.5
                if done:
                    break
    log.info("tts %s %.1fs %.1fs of speech", TTS_MODEL, time.monotonic() - t0, len(pcm) / (2 * TTS_RATE))
    if pcm:
        if len(_spoken) > 60:
            _spoken.clear()
        _spoken[text] = bytes(pcm)
