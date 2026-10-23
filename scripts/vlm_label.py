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
    "protective equipment. Return ONLY a JSON list where each entry is "
    '{"box_2d": [ymin, xmin, ymax, xmax], "label": <one of ' + ", ".join(CLASSES) + ">} "
    "with box_2d normalized to 0-1000.\n"
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
        if isinstance(it.get("box_2d"), list) and len(it["box_2d"]) == 4:   # Gemini native: [ymin, xmin, ymax, xmax] 0..1000
            y1, x1, y2, x2 = [float(v) / 1000.0 for v in it["box_2d"]]
        elif isinstance(it.get("box"), list) and len(it["box"]) == 4:      # other models: [x1, y1, x2, y2] 0..1 (or 0..1000)
            x1, y1, x2, y2 = [float(v) for v in it["box"]]
            if max(x1, y1, x2, y2) > 1.5:
                x1, y1, x2, y2 = x1 / 1000.0, y1 / 1000.0, x2 / 1000.0, y2 / 1000.0
        else:
            continue
        x1, x2 = sorted((max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))))
        y1, y2 = sorted((max(0.0, min(1.0, y1)), max(0.0, min(1.0, y2))))
        cw, ch = x2 - x1, y2 - y1
        if cw < 0.01 or ch < 0.01:
            continue
        lines.append(f"{IDX[lbl]} {(x1+x2)/2:.6f} {(y1+y2)/2:.6f} {cw:.6f} {ch:.6f}")
        boxes.append((lbl, x1 * W, y1 * H, x2 * W, y2 * H))
    return lines, boxes


# labels that can't both be true of the same body part — if the VLM gives both on overlapping boxes it is guessing
CONTRADICT = [({"hard-hat", "welding-shield"}, {"bare-head"}), ({"work-gloves"}, {"bare-hands"}),
              ({"hi-vis-vest"}, {"thermal-apron"})]
MIN_GEAR_H = 0.05  # gear boxes shorter than 5% of the image are far-away guesses (the wide-hall shots)
PART_CLASSES = {"hard-hat", "welding-shield", "work-gloves", "n95-mask", "safety-glasses", "safety-boots", "bare-head", "bare-hands"}


def _overlap(a, b):
    ix = max(0.0, min(a[3], b[3]) - max(a[1], b[1])); iy = max(0.0, min(a[4], b[4]) - max(a[2], b[2]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    sa = (a[3] - a[1]) * (a[4] - a[2]); sb = (b[3] - b[1]) * (b[4] - b[2])
    return inter / max(1e-6, min(sa, sb))  # overlap relative to the smaller box


def sanitize(boxes, W, H):
    """Drop what the VLM is unsure of: tiny far-away gear, and contradicting labels on the same spot.
    → (kept boxes, list of reasons dropped). Same rule as the live system: unsure = don't teach it."""
    dropped = []
    keep = []
    for b in boxes:
        if b[0] != "person" and (b[4] - b[2]) / H < MIN_GEAR_H:
            dropped.append(f"tiny {b[0]}")
        else:
            keep.append(b)
    # a body-PART box must be much smaller than the person wearing it — a "boot" box the size of the whole body is wrong
    persons = [b for b in keep if b[0] == "person"]
    sized = []
    for b in keep:
        if b[0] in PART_CLASSES:
            cx, cy = (b[1] + b[3]) / 2, (b[2] + b[4]) / 2
            owner = [p for p in persons if p[1] <= cx <= p[3] and p[2] <= cy <= p[4]]
            if owner and (b[4] - b[2]) > 0.45 * min(p[4] - p[2] for p in owner):
                dropped.append(f"oversized {b[0]}")
                continue
        sized.append(b)
    keep = sized
    bad = set()
    for i, a in enumerate(keep):
        for j, b in enumerate(keep):
            if j <= i:
                continue
            for s1, s2 in CONTRADICT:
                if ((a[0] in s1 and b[0] in s2) or (a[0] in s2 and b[0] in s1)) and _overlap(a, b) > 0.5:
                    bad.update((i, j))
    for i in sorted(bad):
        dropped.append(f"contradiction {keep[i][0]}")
    return [b for i, b in enumerate(keep) if i not in bad], dropped


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


def refilter(out: Path):
    """Re-apply the safety filters to the saved raw VLM answers (out/raw) — no API calls, no cost."""
    nr = out / "needs_review.txt"
    if nr.exists():
        nr.unlink()
    raws = sorted((out / "raw").glob("*.json"))
    tot_keep = tot_drop = 0
    for rp in raws:
        img = out / "images" / (rp.stem + ".jpg")
        if not img.exists():
            continue
        W, H = Image.open(img).size
        _, boxes = to_yolo(json.loads(rp.read_text(encoding="utf-8")), W, H)
        boxes, dropped = sanitize(boxes, W, H)
        lines = [f"{IDX[l]} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} {(x2 - x1) / W:.6f} {(y2 - y1) / H:.6f}" for l, x1, y1, x2, y2 in boxes]
        (out / "labels" / (rp.stem + ".txt")).write_text("\n".join(lines), encoding="utf-8")
        review_image(img, boxes, out / "review" / (rp.stem + ".jpg"))
        if dropped:
            with open(nr, "a", encoding="utf-8") as fh:
                fh.write(f"{rp.stem}: dropped {len(dropped)} — " + ", ".join(dropped) + "\n")
        tot_keep += len(boxes); tot_drop += len(dropped)
    print(f"refiltered {len(raws)} images: kept {tot_keep} boxes, dropped {tot_drop} unsure")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/learning/seed/foundry-ppe")
    ap.add_argument("--out", default="data/learning/foundry")
    ap.add_argument("--model", default="google/gemini-2.5-flash")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--prefix", default="", help="stem prefix, so several source folders can share one dataset")
    ap.add_argument("--refilter", action="store_true", help="re-apply filters to saved raw answers (no API calls)")
    a = ap.parse_args()
    out = (ROOT / a.out) if not os.path.isabs(a.out) else Path(a.out)
    if a.refilter:
        return refilter(out)
    key = load_key()
    src = (ROOT / a.src) if not os.path.isabs(a.src) else Path(a.src)
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
            stem = f"{a.prefix}{i:03d}_{re.sub(r'[^A-Za-z0-9_-]', '_', p.stem)[:40]}"
            items = ask_vlm(key, a.model, p)
            (out / "raw").mkdir(parents=True, exist_ok=True)
            (out / "raw" / (stem + ".json")).write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
            _, boxes = to_yolo(items, W, H)
            boxes, dropped = sanitize(boxes, W, H)
            lines = [f"{IDX[l]} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} {(x2 - x1) / W:.6f} {(y2 - y1) / H:.6f}" for l, x1, y1, x2, y2 in boxes]
            (out / "images" / (stem + ".jpg")).write_bytes(p.read_bytes())
            (out / "labels" / (stem + ".txt")).write_text("\n".join(lines), encoding="utf-8")
            review_image(p, boxes, out / "review" / (stem + ".jpg"))
            if dropped:
                with open(out / "needs_review.txt", "a", encoding="utf-8") as fh:
                    fh.write(f"{stem}: dropped {len(dropped)} — " + ", ".join(dropped) + "\n")
            counts = {}
            for b in boxes:
                counts[b[0]] = counts.get(b[0], 0) + 1
            print(f"  [{i}/{len(imgs)}] {p.name}: " + (", ".join(f"{k}×{v}" for k, v in counts.items()) or "nothing")
                  + (f"  (dropped {len(dropped)} unsure)" if dropped else ""))
            ok += 1
        except Exception as e:
            print(f"  [{i}/{len(imgs)}] {p.name}: ERROR {e}")
    print(f"done — {ok}/{len(imgs)} labelled. Check {out/'review'} and fix boxes before training.")


if __name__ == "__main__":
    main()
