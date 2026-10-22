"""Voice-over for the demo video, in the voice of the Lemon mirror reel: gpt-audio with the voice marin, through
voice_lock on countv (the OpenAI key lives there), several takes per line with a transcript and pitch gate.

    python -I deploy/video/voice.py send      # narration.json -> lines.json on countv, runs voice_lock in the background
    python -I deploy/video/voice.py review    # every take: what the transcriber heard, pitch, pace (pick by eye)
    python -I deploy/video/voice.py fetch [id=dir:take ...]   # copies the picked clips back as 48 kHz mono WAV + manifest.json

The recorder (record.mjs) holds each scene for as long as its clips, so the video is timed to the voice.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NARRATION = Path(__file__).with_name("narration.json")
OUT = ROOT / "_video" / "voice"
SSH = ["ssh", "-i", str(Path.home() / ".ssh" / "countv"), "-p", "2222", "sadeq@203.17.151.9"]
SCP = ["scp", "-i", str(Path.home() / ".ssh" / "countv"), "-P", "2222"]
REMOTE = "torobche-voice"
VOICE_LOCK = "~/lemon-insta/abadi-react/voice/voice_lock.py"
PY = "~/liara-voice-1022/venv/bin/python"


def lines() -> list[dict]:
    out = []
    for s in json.loads(NARRATION.read_text(encoding="utf-8"))["scenes"]:
        for i, ln in enumerate(s["lines"]):
            item = {"id": f"{s['id']}-{i}", "text": ln["text"], "tts": ln.get("tts", ln["text"]), "takes": ln.get("takes", 3)}
            if ln.get("acting"):
                item["acting"] = ln["acting"]
            out.append(item)
    return out


def send() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    spec = OUT / "lines.json"
    spec.write_text(json.dumps({"lines": lines()}, ensure_ascii=False, indent=1), encoding="utf-8")
    subprocess.run([*SSH, f"mkdir -p ~/{REMOTE}"], check=True)
    subprocess.run([*SCP, str(spec), f"sadeq@203.17.151.9:~/{REMOTE}/lines.json"], check=True)
    subprocess.run([*SSH, f"cd ~/{REMOTE} && nohup {PY} {VOICE_LOCK} lines lines.json out > out.log 2>&1 < /dev/null &"], check=True)
    print(f"voice_lock started on countv: ~/{REMOTE}/out ({len(lines())} lines)")


def review() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    raw = subprocess.run([*SSH, f"cat ~/{REMOTE}/out/takes.json"], capture_output=True, check=True).stdout.decode("utf-8")
    takes = json.loads(raw)
    by_id = {ln["id"]: ln for ln in lines()}
    for lid, ts in takes.items():
        print(f"== {lid}: {by_id[lid]['text']}")
        for t in ts:
            print(f"  t{t['take']} {'OK' if t['ok'] else '--'} s{t['score']} f0 {t['f0']} r{t.get('rate')} {t['dur']}s | {t['heard']}")


def fetch(picks: dict[str, str]) -> None:
    """The picked take of each line as WAV for build.py: picks maps an id to "<out dir>:<take>" (a line redone in
    another run lives in its own out dir); a line without a pick gets voice_lock's best take from out/."""
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for lid, ln in {ln["id"]: ln for ln in lines()}.items():
        d, take = picks.get(lid, "out:").split(":")
        src = f"~/{REMOTE}/{d}/{lid}-take{take}.mp3" if take else f"~/{REMOTE}/{d}/{lid}.mp3"
        mp3 = OUT / f"{lid}.mp3"
        subprocess.run([*SCP, f"sadeq@203.17.151.9:{src}", str(mp3)], check=True, capture_output=True)
        wav = OUT / f"{lid}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3), "-ar", "48000", "-ac", "1", "-sample_fmt", "s16", str(wav)], check=True)
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
                                   capture_output=True, text=True, check=True).stdout.strip())
        manifest[lid] = {"file": wav.name, "dur": round(dur, 3), "text": ln["text"], "take": f"{d}:{take or 'best'}"}
        print(f"{lid}: {d}:{take or 'best'} {dur:.1f}s")
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(manifest)} clips, {sum(v['dur'] for v in manifest.values()):.0f}s of speech -> {OUT}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "send"
    if cmd == "send":
        send()
    elif cmd == "review":
        review()
    elif cmd == "fetch":
        fetch(dict(a.split("=") for a in sys.argv[2:]))
    else:
        sys.exit(__doc__)
