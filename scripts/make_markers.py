"""
Printable ID codes (ArUco 4x4) for workers — read by the cameras from a distance, even from behind, where a face can't be.

The code number IS the employee number (EMP-0001 → code 1), dictionary DICT_4X4_50 (big cells = read from farthest).
Output: real-size A3/A4 PDFs — print at "Actual size / 100%" (never "fit to page"); a 10 cm ruler on each page checks it.

  .venv-train\\Scripts\\python.exe scripts/make_markers.py EMP-0001="محمد محمود" EMP-0002="عمر عباس" EMP-0007="هشام أبو الهنا"
  .venv-train\\Scripts\\python.exe scripts/make_markers.py --test        # distance-test sheet (code 0 at 12 / 15 / 20 cm)
"""
import argparse
import re
from pathlib import Path

import arabic_reshaper
import cv2
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DPI = 300
A4, A3 = (210, 297), (297, 420)          # mm
DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
FONT = "C:/Windows/Fonts/arialbd.ttf"


def mm(v):
    return int(round(v / 25.4 * DPI))


def ar(t):
    return get_display(arabic_reshaper.reshape(t))  # shape + right-to-left, or PIL draws disconnected letters


def font(size_mm):
    return ImageFont.truetype(FONT, mm(size_mm))


def marker(code, side_mm):
    """the marker at an exact physical size: 6 cells (4 data + black border), each cell a whole number of pixels"""
    cell = max(1, round(mm(side_mm) / 6))
    img = cv2.aruco.generateImageMarker(DICT, code, cell * 6)
    return Image.fromarray(img).convert("RGB")


def ruler(d, x, y):
    d.rectangle([x, y, x + mm(100), y + mm(3)], fill="black")
    d.text((x, y + mm(4)), "10 cm — " + ar("لو المسطرة دي مش 10 سم بالظبط، الطباعة غلط"), fill="black", font=font(4))


def page(size, title, lines, code, side_mm, copies=1):
    W, H = mm(size[0]), mm(size[1])
    im = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(im)
    y = mm(12)
    d.text((W - mm(12), y), ar(title), fill="black", font=font(9), anchor="ra"); y += mm(13)
    for ln in lines:
        d.text((W - mm(12), y), ar(ln), fill="black", font=font(5), anchor="ra"); y += mm(7)
    m = marker(code, side_mm); quiet = mm(max(12, side_mm / 6))  # white margin ≥ one cell around the code
    y += mm(4)
    per_row = max(1, min(copies, (W - mm(20)) // (m.width + 2 * quiet)))
    x0 = (W - per_row * (m.width + 2 * quiet)) // 2
    for i in range(copies):
        cx = x0 + (i % per_row) * (m.width + 2 * quiet) + quiet
        cy = y + (i // per_row) * (m.height + 2 * quiet + mm(10)) + quiet
        im.paste(m, (cx, cy))
        d.text((cx + m.width // 2, cy + m.height + mm(3)), f"#{code} · {side_mm / 10:g} cm", fill="black", font=font(4), anchor="ma")
    ruler(d, mm(12), H - mm(20))
    return im


def save(pages, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(out, save_all=True, append_images=pages[1:], resolution=DPI)
    print("saved", out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workers", nargs="*", help='EMP-0001="name"')
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--out", default="data/markers")
    a = ap.parse_args()
    out = ROOT / a.out
    if a.test:
        common = ["ورقة اختبار المسافة — الكود رقم 0 (مش لأي عامل)", "اطبعها «بالمقاس الفعلي 100%»، وحد يمسكها مواجهة للكاميرا ويبعد خطوة خطوة",
                  "المنصة هتكتب آخر مسافة قرت الكود منها"]
        save([page(A4, "اختبار 12 سم", common, 0, 120), page(A3, "اختبار 15 سم", common, 0, 150), page(A3, "اختبار 20 سم", common, 0, 200)],
             out / "test-sheet_codes-12-15-20cm.pdf")
    for w in a.workers:
        emp, name = w.split("=", 1)
        code = int(re.sub(r"\D", "", emp))
        if not 1 <= code <= 49:
            raise SystemExit(f"{emp}: code must be 1..49 for DICT_4X4_50")
        info = [f"{name} · {emp} · الكود رقم {code}", "اطبع «بالمقاس الفعلي 100%» — ممنوع «Fit to page»",
                "أسود مطفي على أبيض، وسيب الحواف البيضا زي ما هي"]
        save([page(A3, "ضهر المريلة — 20 سم", info, code, 200),
              page(A4, "الخوذة / الدرع — 12 سم (اطبعها مرتين: خوذة + درع)", info, code, 120)],
             out / f"{emp}_{name.replace(' ', '_')}.pdf")


if __name__ == "__main__":
    main()
