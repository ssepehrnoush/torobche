"""Builds the final demo video from record.mjs + voice.py output.

1920x1080: the recorded phone screen in a phone frame on the left; on the right a Torobche panel with the four
steps of the challenge, the scene title and the line being spoken (panels are HTML rendered by headless Chrome, so
Persian text is shaped exactly like in the app). Voice clips are placed at their cue times. A short intro card and
an outro card with the links bracket the walkthrough.

    python -I deploy/video/build.py          # -> _video/out/torobche-demo.mp4
"""
from __future__ import annotations

import html
import json
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REC = ROOT / "_video" / "rec"
VOICE = ROOT / "_video" / "voice"
WORK = ROOT / "_video" / "work"
OUT = ROOT / "_video" / "out"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
FONT = (ROOT / "frontend" / "public" / "fonts" / "IRANYekanXVF.woff2").as_uri()
NARRATION = json.loads((Path(__file__).with_name("narration.json")).read_text(encoding="utf-8"))["scenes"]
FPS = 30
SR = 48000
# phone screen on the canvas (keeps the 780x1688 recording's aspect ratio)
PH_H = 1000
PH_W = round(PH_H * 780 / 1688)
PH_X, PH_Y = 190, 40
STEPS = ["انتخاب کالا", "فروشگاه‌های نزدیک", "مقایسه و پاساژ", "پرسیدن و مسیر"]
INTRO_S, OUTRO_S = 3.2, 6.0

LOGO = """<svg width="64" height="64" viewBox="0 0 88 88"><path fill="#e91e33" d="M79.245 20.322l-.627.726c-2.474 2.656-5.814 4.2-9.462 4.313-.16.023-.342.023-.502.023-.456 0-.878-.023-1.31-.068 8.595 10.1 9.895 24.968 2.222 36.579-7.638 11.542-21.774 16.252-34.428 12.484h-.08c-5.13-1.34-10.944.68-14.022 5.414 3.192-4.847 2.736-11.055-.798-15.322v-.045c-8.333-10.079-9.473-24.72-1.87-36.16C26.692 15.67 42.766 11.22 56.195 17.031c-.57-1.476-.935-3.065-1.026-4.688-.114-2.95.741-5.788 2.371-8.171-18.012-5.902-38.532.567-49.476 17.137C-5.104 41.171.425 67.842 20.261 80.893c19.882 13.064 46.592 7.502 59.702-12.246 10.032-15.174 9.177-34.331-.707-48.348l-.011.023z"/><path fill="#bf0f22" d="M31.969 10.22c-10.91 1.08-20.463 5.721-24.054 11.191C-5.195 41.216.3 67.853 20.193 80.905l.73-1.112c3.191-4.847 2.735-11.055-.799-15.322v-.045c-8.22-10.079-9.36-24.72-1.835-36.16C26.61 15.67 42.685 11.22 56.114 17.031c0 0-11.4-8.059-24.122-6.81h-.023z"/><path fill="#6fbc23" d="M62.544 22.32s-.342-4.086 1.482-7.037c1.824-2.951 5.7-5.845 10.602-5.539 4.925.307 5.723 1.442 5.723 1.442s.114 3.972-1.254 6.242-4.218 5.606-8.322 6.446c-4.104.829-8.231-1.555-8.231-1.555z"/><path fill="#519a23" d="M61.062 21.173s-.456-3.972 2.28-7.944c2.736-3.973 5.7-4.563 5.7-4.563S68.7 3.218 66.078.608c.228-.057-3.124.08-6.042 3.291-2.577 2.815-4.104 7.264-2.964 11.577 1.14 4.312 3.99 5.697 3.99 5.697z"/></svg>"""

BASE_CSS = f"""@font-face{{font-family:Yekan;src:url('{FONT}') format('woff2');font-weight:100 1000}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:1920px;height:1080px;overflow:hidden}}
body{{font-family:Yekan,Tahoma,sans-serif;background:#F1F5F9;color:#1E293B;direction:rtl;position:relative}}
.glow{{position:absolute;border-radius:50%;filter:blur(90px)}}
"""


def fa(n) -> str:
    return str(n).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def panel_html(scene: dict | None, line: str | None) -> str:
    step = scene["step"] if scene else 0
    pills = "".join(
        f'<div class="pill{" on" if step == i + 1 else ""}{" done" if step > i + 1 else ""}"><b>{fa(i + 1)}</b>{html.escape(s)}</div>'
        for i, s in enumerate(STEPS))
    sub = f'<div class="sub">{html.escape(line)}</div>' if line else ""
    return f"""<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>{BASE_CSS}
.phone{{position:absolute;left:{PH_X - 16}px;top:{PH_Y - 16}px;width:{PH_W + 32}px;height:{PH_H + 32}px;border-radius:64px;
  background:#0F172A;box-shadow:0 30px 80px rgba(15,23,42,.28),0 0 0 2px #334155 inset}}
.screen{{position:absolute;left:{PH_X}px;top:{PH_Y}px;width:{PH_W}px;height:{PH_H}px;border-radius:48px;background:#fff}}
.side{{position:absolute;right:110px;top:90px;width:1000px;height:900px}}
.brand{{display:flex;align-items:center;gap:18px}}
.brand .t1{{font-size:44px;font-weight:900;color:#E91E33}}
.brand .t2{{font-size:34px;font-weight:700;color:#1E293B;padding-right:18px;border-right:2px solid #CBD5E1}}
.pills{{display:flex;gap:14px;margin-top:56px;flex-wrap:wrap}}
.pills{{flex-wrap:nowrap;gap:10px}}
.pill{{display:flex;align-items:center;gap:10px;padding:12px 17px;border-radius:999px;background:#fff;font-size:22px;font-weight:600;color:#64748B;box-shadow:0 0 0 1.5px #E2E8F0 inset;white-space:nowrap}}
.pill b{{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#E2E8F0;color:#475569;font-size:18px}}
.pill.on{{background:#E91E33;color:#fff;box-shadow:0 10px 24px rgba(233,30,51,.25)}}
.pill.on b{{background:#fff;color:#E91E33}}
.pill.done{{color:#1E293B}} .pill.done b{{background:#DCFCE7;color:#166534}}
.title{{margin-top:70px;font-size:72px;font-weight:900;line-height:1.35;color:#0F172A}}
.sub{{position:absolute;bottom:0;right:0;width:1000px;padding:30px 38px;border-radius:30px;background:#fff;font-size:38px;font-weight:600;line-height:1.75;color:#1E293B;
  box-shadow:0 14px 40px rgba(15,23,42,.08);border-right:8px solid #E91E33}}
</style><body><div class="glow" style="width:620px;height:620px;right:-180px;top:-220px;background:rgba(233,30,51,.10)"></div>
<div class="glow" style="width:520px;height:520px;left:420px;bottom:-260px;background:rgba(111,188,35,.10)"></div>
<div class="phone"></div><div class="screen"></div>
<div class="side"><div class="brand">{LOGO}<span class="t1">تربچه</span><span class="t2">خرید حضوری روی دادهٔ ترب</span></div>
<div class="pills">{pills}</div><div class="title">{html.escape(scene["title"]) if scene else ""}</div>{sub}</div></body></html>"""


def card_html(kind: str) -> str:
    if kind == "intro":
        inner = f"""<div class="mark">{LOGO.replace('width="64" height="64"', 'width="150" height="150"')}</div>
<h1>تربچه</h1><p>دستیار خرید حضوری روی دادهٔ ترب، با صفحه‌هایی که هوش مصنوعی می‌سازد</p>
<div class="row"><span>انتخاب کالا</span><span>فروشگاه‌های نزدیک</span><span>مقایسه</span><span>پرسیدن و مسیر</span></div>"""
    else:
        inner = f"""<div class="mark">{LOGO.replace('width="64" height="64"', 'width="120" height="120"')}</div>
<h1>تربچه</h1><div class="links"><div><small>اپ زنده روی لیارا</small><b dir="ltr">torobche.liara.run</b></div>
<div><small>کد کامل</small><b dir="ltr">github.com/ssepehrnoush/torobche</b></div></div>
<p>هوش مصنوعی از BoxAPI (پشتیبان: OpenAI). داده: دیتاست ترب.</p>
<p class="note">ضبط‌شده روی همین کد، با ساعتِ ثابتِ شنبه ۱۱ صبح تا مغازه‌ها باز باشند.</p>"""
    return f"""<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>{BASE_CSS}
.wrap{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}}
h1{{font-size:96px;font-weight:900;color:#0F172A;margin-top:26px}}
p{{font-size:40px;color:#475569;margin-top:18px;font-weight:600}}
.row{{display:flex;gap:18px;margin-top:56px}}
.row span{{padding:14px 28px;border-radius:999px;background:#fff;font-size:28px;font-weight:700;color:#E91E33;box-shadow:0 0 0 2px #FECDD3 inset}}
.links{{display:flex;flex-direction:column;gap:22px;margin-top:46px}}
.links div{{background:#fff;border-radius:26px;padding:22px 46px;box-shadow:0 12px 34px rgba(15,23,42,.08)}}
.links small{{display:block;font-size:26px;color:#64748B;font-weight:600}}
.links b{{display:block;font-size:46px;color:#E91E33;font-weight:800;font-family:Yekan,Segoe UI,sans-serif}}
p.note{{font-size:26px;color:#94A3B8;margin-top:10px;font-weight:500}}
</style><body><div class="glow" style="width:760px;height:760px;right:-200px;top:-260px;background:rgba(233,30,51,.12)"></div>
<div class="glow" style="width:640px;height:640px;left:-180px;bottom:-280px;background:rgba(111,188,35,.12)"></div>
<div class="wrap">{inner}</div></body></html>"""


_pending: list[Path] = []


def render(html_text: str, png: Path) -> None:
    """Queue an HTML page; render_all() turns every queued page into a PNG in one Chrome session
    (starting Chrome once per image crashed or hung every few renders on Windows)."""
    src = png.with_suffix(".html")
    src.write_text(html_text, encoding="utf-8")
    _pending.append(src)


def render_all() -> None:
    if _pending:
        subprocess.run(["node", str(Path(__file__).with_name("render.mjs")), *map(str, _pending)], check=True, timeout=900)
        _pending.clear()


def ffmpeg(*args: str) -> None:
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], cwd=WORK)
    if r.returncode:
        sys.exit(f"ffmpeg failed: {' '.join(args)[:200]}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    tl = json.loads((REC / "timeline.json").read_text(encoding="utf-8"))
    frames, cues, scenes, end = tl["frames"], tl["cues"], tl["scenes"], tl["end"]
    t0 = frames[0]["t"]
    total = (end - t0) / 1000
    by_id = {s["id"]: s for s in NARRATION}

    # 1) background panels: one segment per stretch of time with the same scene and spoken line
    marks = []  # (time ms, scene id, line text or None)
    for i, sc in enumerate(scenes):
        marks.append((sc["start"], sc["id"], None))
        for c in [c for c in cues if c["scene"] == sc["id"]]:
            marks.append((c["start"], sc["id"], c["text"]))
            nxt = [d["start"] for d in cues if d["start"] > c["start"]]
            off = c["start"] + c["dur"] * 1000 + 1200
            # the subtitle clears before the next line, and never after its own scene has ended
            if (not nxt or off < nxt[0]) and off < sc.get("end", end):
                marks.append((off, sc["id"], None))
    marks = sorted(marks, key=lambda m: (m[0], m[2] is not None))
    marks = [(max(t0, m[0]), m[1], m[2]) for m in marks]
    if marks[0][0] > t0:
        marks.insert(0, (t0, scenes[0]["id"], None))
    segs = []
    for i, (t, sid, line) in enumerate(marks):
        t_end = marks[i + 1][0] if i + 1 < len(marks) else end
        if t_end - t > 1:
            segs.append((t, t_end, sid, line))
    cache: dict[tuple, str] = {}
    lines = [f"ffconcat version 1.0"]
    for t, t_end, sid, line in segs:
        k = (sid, line)
        if k not in cache:
            png = WORK / f"panel_{len(cache):03d}.png"
            render(panel_html(by_id[sid], line), png)
            cache[k] = png.name
        lines += [f"file '{cache[k]}'", f"duration {(t_end - t) / 1000:.3f}"]
    lines.append(f"file '{cache[(segs[-1][2], segs[-1][3])]}'")
    (WORK / "panels.txt").write_text("\n".join(lines), encoding="utf-8")
    render(card_html("intro"), WORK / "intro.png")
    render(card_html("outro"), WORK / "outro.png")
    render_all()
    print(f"panels: {len(cache)} images, {len(segs)} segments")

    # 2) phone screen video from the screencast frames
    flist = ["ffconcat version 1.0"]
    for i, f in enumerate(frames):
        nxt = frames[i + 1]["t"] if i + 1 < len(frames) else end
        flist += [f"file '{(REC / 'frames' / f['file']).as_posix()}'", f"duration {max(0.001, (nxt - f['t']) / 1000):.3f}"]
    flist.append(f"file '{(REC / 'frames' / frames[-1]['file']).as_posix()}'")
    (WORK / "frames.txt").write_text("\n".join(flist), encoding="utf-8")

    # rounded screen corners: a still overlay paints the bezel colour into the four corners (a looped alpha mask
    # made ffmpeg buffer frames until it ran out of memory)
    from PIL import Image, ImageDraw
    caps = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(caps)
    d.rectangle((PH_X, PH_Y, PH_X + PH_W - 1, PH_Y + PH_H - 1), fill=(15, 23, 42, 255))
    d.rounded_rectangle((PH_X, PH_Y, PH_X + PH_W - 1, PH_Y + PH_H - 1), radius=48, fill=(0, 0, 0, 0))
    caps.save(WORK / "caps.png")

    enc = ["-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"]
    # three plain steps (one big graph ran out of memory): background, phone screen, then the overlay. The
    # corner image is a single frame that overlay repeats, not a looped input.
    fast = ["-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p"]
    ffmpeg("-f", "concat", "-safe", "0", "-i", "panels.txt", "-vf", f"fps={FPS},format=yuv420p", "-t", f"{total:.3f}", *fast, "bg.mp4")
    ffmpeg("-f", "concat", "-safe", "0", "-i", "frames.txt", "-vf", f"fps={FPS},scale={PH_W}:{PH_H}:flags=lanczos,format=yuv420p",
           "-t", f"{total:.3f}", *fast, "phone.mp4")
    ffmpeg("-i", "bg.mp4", "-i", "phone.mp4", "-i", "caps.png", "-filter_complex",
           f"[0:v][1:v]overlay={PH_X}:{PH_Y}[v1];[v1][2:v]overlay=0:0,format=yuv420p[v]",
           "-map", "[v]", "-t", f"{total:.3f}", *enc, "main.mp4")
    print("main video done")

    # 3) voice track: every clip at its cue time
    n_total = int((total + 0.5) * SR)
    buf = bytearray(n_total * 2)
    for c in cues:
        with wave.open(str(VOICE / c["file"]), "rb") as w:
            assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2
            data = w.readframes(w.getnframes())
        off = int((c["start"] - t0) / 1000 * SR) * 2
        buf[off:off + len(data)] = data[: max(0, len(buf) - off)]
    with wave.open(str(WORK / "voice.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(buf))

    # 4) intro and outro cards (rendered with the panels), then everything joined with soft fades
    ffmpeg("-loop", "1", "-t", f"{INTRO_S}", "-i", "intro.png", "-vf",
           f"fps={FPS},format=yuv420p,fade=in:st=0:d=0.5,fade=out:st={INTRO_S - 0.4}:d=0.4", *enc, "intro.mp4")
    ffmpeg("-loop", "1", "-t", f"{OUTRO_S}", "-i", "outro.png", "-vf",
           f"fps={FPS},format=yuv420p,fade=in:st=0:d=0.5,fade=out:st={OUTRO_S - 0.8}:d=0.8", *enc, "outro.mp4")
    out = OUT / "torobche-demo.mp4"
    ffmpeg("-i", "intro.mp4", "-i", "main.mp4", "-i", "outro.mp4", "-i", "voice.wav", "-filter_complex",
           f"[1:v]fade=in:st=0:d=0.4[m];[0:v][m][2:v]concat=n=3:v=1:a=0[v];"
           f"[3:a]adelay={int(INTRO_S * 1000)}|{int(INTRO_S * 1000)},apad,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
           "-map", "[v]", "-map", "[a]", "-t", f"{INTRO_S + total + OUTRO_S:.3f}", *enc,
           "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", str(out))
    size = out.stat().st_size / 1e6
    print(f"done: {out} ({INTRO_S + total + OUTRO_S:.0f} s, {size:.1f} MB)")


if __name__ == "__main__":
    main()
