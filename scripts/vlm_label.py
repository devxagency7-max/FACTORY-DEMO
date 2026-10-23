"""
VLM auto-labeller — teach the models THIS foundry's protective gear.

The generic PPE model only knows construction gear (hard hat + hi-vis vest), so it mis-flags the foundry's real kit
(aluminized thermal apron, welding face shield, leather work gloves, N95). This script asks a vision LLM on OpenRouter
to find that gear in each photo and writes YOLO-format labels + a review image, so a student can be trained on it.

  python scripts/vlm_label.py                       # label data/learning/seed/foundry-ppe → data/learning/foundry
  python scripts/vlm_label.py --src "صور" --out data/learning/foundry
  python scripts/vlm_label.py --model google/gemini-2.0-flash-001

The VLM boxes are a STARTING point (weak supervision); open the review/ images and fix any that are off before training.
The OpenRouter key is read from .env (OPENROUTER_API_KEY) — never committed.
"""
import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent

# the foundry's compliance vocabulary — POSITIVE gear the model should learn to see, plus the bare-state negatives
CLASSES = [
    "person",            # 0
    "hard-hat",          # 1  head cover (construction)
    "welding-shield",    # 2  head/face cover (foundry) — black flip / green / clear visor
    "hi-vis-vest",       # 3  body cover (construction)
    "thermal-apron",     # 4  body cover (foundry) — silver aluminized apron
    "work-gloves",       # 5  leather/cloth gloves
    "n95-mask",          # 6  dust/respirator mask
    "safety-glasses",    # 7
    "safety-boots",      # 8
    "bare-head",         # 9  head with NO cover (violation)
    "bare-hands",        # 10 hand with NO glove (violation)
]
IDX = {c: i for i, c in enumerate(CLASSES)}

PROMPT = (
    "You are labelling safety-gear in a brass FOUNDRY (not a construction site). Find every person and every piece of "
    "protective equipment, and return ONLY a JSON array. Each item: "
    '{"label": <one of ' + ", ".join(CLASSES) + '>, "box": [x1,y1,x2,y2]} '
    "with box coordinates as fractions of width/height in [0,1] (x1,y1 top-left; x2,y2 bottom-right).\n"
    "Foundry gear guidance:\n"
    "- 'welding-shield': a welding/face mask covering or flipped on the head (black, green-tinted, or clear visor).\n"
    "- 'thermal-apron': a SILVER aluminized/reflective apron over the torso (this foundry's body protection, NOT a vest).\n"
    "- 'work-gloves': leather or thick cloth gloves on the hands.\n"
    "- 'n95-mask': a white dust/respirator mask.\n"
    "- Use 'bare-head' only for a clearly uncovered head, 'bare-hands' only for a clearly ungloved hand.\n"
    "Be precise with boxes. Return [] if nobody is visible. No prose, JSON only."
)


def load_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key.startswith("sk-or-"):
        sys.exit("No OpenRouter key — put OPENROUTER_API_KEY=sk-or-... in .env")
    return key


def data_url(p: Path) -> str:
    b = p.read_bytes()
    ext = "jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else p.suffix.lower().lstrip(".")
    return f"data:image/{ext};base64," + base64.b64encode(b).decode()


def ask_vlm(key: str, model: str, p: Path) -> list:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": data_url(p)}},
        ]}],
        "temperature": 0,
    }
    r = httpx.post("https://openrouter.ai/api/v1/chat/completions",
                   headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                            "HTTP-Referer": "https://egic.local", "X-Title": "EGIC PPE labelling"},
                   json=body, timeout=120)
    r.raise_for_status()
    txt = r.json()["choices"][0]["message"]["content"]
    m = re.search(r"\[.*\]", txt, re.S)
    if not m:
        return []
    try:
        return json.loads(m.group(0))
    except Exception:
        return []


def to_yolo(items, W, H):
    """VLM boxes (0..1, or accidentally 0..1000/pixels) → YOLO lines + clamped pixel boxes for the review image."""
    lines, boxes = [], []
    for it in items:
        lbl = str(it.get("label", "")).strip()
        if lbl not in IDX:
            continue
        b = it.get("box") or []
        if len(b) != 4:
            continue
        x1, y1, x2, y2 = [float(v) for v in b]
        scale = 1.0
        if max(x1, y1, x2, y2) > 1.5:              # model returned 0..1000 or pixels
            scale = 1000.0 if max(x1, y1, x2, y2) <= 1000 else max(W, H)
        x1, y1, x2, y2 = x1 / scale, y1 / scale, x2 / scale, y2 / scale
        x1, x2 = sorted((max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))))
        y1, y2 = sorted((max(0.0, min(1.0, y1)), max(0.0, min(1.0, y2))))
        cw, ch = x2 - x1, y2 - y1
        if cw < 0.01 or ch < 0.01:
            continue
        lines.append(f"{IDX[lbl]} {(x1+x2)/2:.6f} {(y1+y2)/2:.6f} {cw:.6f} {ch:.6f}")
        boxes.append((lbl, x1 * W, y1 * H, x2 * W, y2 * H))
    return lines, boxes


def review_image(src: Path, boxes, dst: Path):
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("arial.ttf", max(14, im.width // 55))
    except Exception:
        font = ImageFont.load_default()
    for lbl, x1, y1, x2, y2 in boxes:
        bad = lbl.startswith("bare")
        col = (230, 40, 40) if bad else (40, 200, 90)
        d.rectangle([x1, y1, x2, y2], outline=col, width=max(2, im.width // 300))
        d.text((x1 + 3, max(0, y1 - (im.width // 45))), lbl, fill=col, font=font)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=85)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/learning/seed/foundry-ppe")
    ap.add_argument("--out", default="data/learning/foundry")
    ap.add_argument("--model", default="google/gemini-2.5-flash")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    key = load_key()
    src = (ROOT / a.src) if not os.path.isabs(a.src) else Path(a.src)
    out = (ROOT / a.out) if not os.path.isabs(a.out) else Path(a.out)
    imgs = sorted([p for p in src.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png")])
    if a.limit:
        imgs = imgs[:a.limit]
    if not imgs:
        sys.exit(f"no images in {src}")
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "labels").mkdir(parents=True, exist_ok=True)
    (out / "review").mkdir(parents=True, exist_ok=True)
    (out / "classes.txt").write_text("\n".join(CLASSES), encoding="utf-8")
    print(f"labelling {len(imgs)} images with {a.model} → {out}")
    ok = 0
    for i, p in enumerate(imgs, 1):
        try:
            W, H = Image.open(p).size
            items = ask_vlm(key, a.model, p)
            lines, boxes = to_yolo(items, W, H)
            stem = f"{i:03d}_{re.sub(r'[^A-Za-z0-9_-]', '_', p.stem)[:40]}"
            (out / "images" / (stem + ".jpg")).write_bytes(p.read_bytes())
            (out / "labels" / (stem + ".txt")).write_text("\n".join(lines), encoding="utf-8")
            review_image(p, boxes, out / "review" / (stem + ".jpg"))
            counts = {}
            for b in boxes:
                counts[b[0]] = counts.get(b[0], 0) + 1
            print(f"  [{i}/{len(imgs)}] {p.name}: " + (", ".join(f"{k}×{v}" for k, v in counts.items()) or "nothing"))
            ok += 1
        except Exception as e:
            print(f"  [{i}/{len(imgs)}] {p.name}: ERROR {e}")
    print(f"done — {ok}/{len(imgs)} labelled. Check {out/'review'} and fix boxes before training.")


if __name__ == "__main__":
    main()
