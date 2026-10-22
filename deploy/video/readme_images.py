"""Images for the README, made from the recorded demo (record.mjs), so every screen in them is a real one:

    assets/screens.jpg   six phone screens of one purchase, with a caption under each
    assets/poster.jpg    the video's opening frame with a play button, linking to the video

    python -I deploy/video/readme_images.py   (after record.mjs and build.py)
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
REC = ROOT / "_video" / "rec"
WORK = ROOT / "_video" / "work"
ASSETS = ROOT / "assets"
FONT = (ROOT / "frontend" / "public" / "fonts" / "IRANYekanXVF.woff2").as_uri()

# (scene, line in it or None for the scene's end, seconds after that point, caption)
SHOTS = [
    ("need", 2, 2.2, "صفحه‌ای که هوش مصنوعی ساخت: بودجه از قیمت‌های واقعی"),
    ("products", 1, 1.0, "چند مدل، با تعداد مغازهٔ نزدیک"),
    ("shops", 0, 1.6, "«پیشنهاد من» با دلیلش، و شرط‌ها همان‌جا"),
    ("inquiry", 1, 1.0, "هر مغازه فقط از راه‌هایی که خودش خواسته"),
    ("shopkeeper", None, -0.8, "مغازه‌دار با یک لمس جواب می‌دهد"),
    ("visit", 0, 2.4, "مسیر روی خیابان‌های واقعی و کد رزرو"),
]


def frame_at(tl: dict, scene: str, line: int | None, after: float) -> Path:
    sc = next(s for s in tl["scenes"] if s["id"] == scene)
    t = sc["end"] if line is None else next(c for c in tl["cues"] if c["id"] == f"{scene}-{line}")["start"]
    t += after * 1000
    f = min(tl["frames"], key=lambda fr: abs(fr["t"] - t))
    return REC / "frames" / f["file"]


def data_uri(p: Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(p.read_bytes()).decode()


def screens_html(shots: list[tuple[Path, str]]) -> str:
    phones = "".join(f'<figure><div class="ph"><img src="{data_uri(p)}"></div><figcaption>{cap}</figcaption></figure>'
                     for p, cap in shots)
    return f"""<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>
@font-face{{font-family:Yekan;src:url('{FONT}') format('woff2');font-weight:100 1000}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:1920px;height:1080px;overflow:hidden}}
body{{font-family:Yekan,Tahoma,sans-serif;background:linear-gradient(160deg,#FFF5F6 0%,#F1F5F9 55%,#F2FBEA 100%);color:#0F172A;direction:rtl}}
header{{text-align:center;padding-top:56px}}
h1{{font-size:84px;font-weight:900;color:#E91E33;line-height:1.1}}
header p{{font-size:34px;font-weight:600;color:#334155;margin-top:14px}}
.row{{display:flex;justify-content:center;gap:26px;margin-top:52px;padding:0 40px}}
figure{{width:272px;display:flex;flex-direction:column;align-items:center}}
.ph{{width:272px;height:588px;border-radius:40px;background:#0F172A;padding:9px;box-shadow:0 24px 50px rgba(15,23,42,.22)}}
.ph img{{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:32px;display:block}}
figcaption{{margin-top:22px;font-size:23px;font-weight:700;line-height:1.55;text-align:center;color:#1E293B}}
</style><body><header><h1>تربچه</h1><p>دستیار خرید حضوری روی دادهٔ ترب، با صفحه‌هایی که هوش مصنوعی می‌سازد</p></header>
<div class="row">{phones}</div></body></html>"""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ASSETS.mkdir(exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    tl = json.loads((REC / "timeline.json").read_text(encoding="utf-8"))
    shots = [(frame_at(tl, s, ln, after), cap) for s, ln, after, cap in SHOTS]
    page = WORK / "readme_screens.html"
    page.write_text(screens_html(shots), encoding="utf-8")
    subprocess.run(["node", str(Path(__file__).with_name("render.mjs")), str(page)], check=True, timeout=300)
    Image.open(page.with_suffix(".png")).convert("RGB").save(ASSETS / "screens.jpg", quality=88, optimize=True, progressive=True)

    # poster: the video's first frame after the intro card, with a round play button in the middle
    video = ROOT / "_video" / "out" / "torobche-demo.mp4"
    still = WORK / "poster_src.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "9", "-i", str(video), "-frames:v", "1", str(still)], check=True)
    im = Image.open(still).convert("RGB").resize((1280, 720), Image.LANCZOS)
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy, r = 640, 360, 74
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(233, 30, 51, 235))
    d.polygon([(cx - 22, cy - 36), (cx - 22, cy + 36), (cx + 40, cy)], fill=(255, 255, 255, 255))
    Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB").save(ASSETS / "poster.jpg", quality=88, optimize=True)
    for p in ("screens.jpg", "poster.jpg"):
        print(p, f"{(ASSETS / p).stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
