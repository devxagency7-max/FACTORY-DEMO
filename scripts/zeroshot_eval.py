"""
Zero-shot test: can an open-vocabulary detector find the foundry's gear from a TEXT prompt, with no training?

Runs YOLO-World and YOLOE (ultralytics) with prompts like "silver apron" / "welding mask" over the labelled foundry
photos, and scores each against the VLM (Gemini) labels — a loose agreement check (IoU ≥ 0.3), not a true mAP, since the
VLM labels are themselves unverified. Also reports speed.

  .venv-train\\Scripts\\python.exe scripts/zeroshot_eval.py --device 0
"""
import argparse
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# our class → the plain-English prompt these models understand best
PROMPTS = {
    "person": "person",
    "hard-hat": "hard hat",
    "welding-shield": "welding mask",
    "hi-vis-vest": "safety vest",
    "thermal-apron": "silver apron",
    "work-gloves": "work gloves",
    "n95-mask": "face mask",
    "safety-glasses": "safety glasses",
    "safety-boots": "boots",
}


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    return i / max(1e-9, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i)


def load_gt(lab: Path, classes, W, H):
    out = []
    for l in lab.read_text(encoding="utf-8").splitlines():
        if not l.strip():
            continue
        c, cx, cy, w, h = l.split(); c = classes[int(c)]
        cx, cy, w, h = float(cx) * W, float(cy) * H, float(w) * W, float(h) * H
        out.append((c, (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)))
    return out


def run(kind, weights, device, imgs, classes, labels_dir, out_dir, conf):
    from ultralytics import YOLO, YOLOE
    names = list(PROMPTS.values())
    back = {v: k for k, v in PROMPTS.items()}
    if kind == "yoloe":
        m = YOLOE(weights)
        m.set_classes(names, m.get_text_pe(names))
    else:
        m = YOLO(weights)
        m.set_classes(names)
    stats = {c: [0, 0, 0] for c in PROMPTS}  # tp, fp, fn  (vs VLM labels)
    t_inf = 0.0
    for p in imgs:
        t0 = time.time()
        r = m.predict(str(p), conf=conf, device=device, verbose=False, save=True, project=str(out_dir), name=kind, exist_ok=True)[0]
        t_inf += time.time() - t0
        H, W = r.orig_shape
        pred = [(back[r.names[int(c)]], tuple(b)) for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist())]
        gt = load_gt(labels_dir / (p.stem + ".txt"), classes, W, H)
        for c in PROMPTS:
            P = [b for k, b in pred if k == c]; G = [b for k, b in gt if k == c]
            used = set()
            for b in P:
                j = max(range(len(G)), key=lambda j: iou(b, G[j]), default=None)
                if j is not None and j not in used and iou(b, G[j]) >= 0.3:
                    used.add(j); stats[c][0] += 1
                else:
                    stats[c][1] += 1
            stats[c][2] += len(G) - len(used)
    return stats, t_inf / max(1, len(imgs)) * 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/learning/foundry")
    ap.add_argument("--device", default="0")
    ap.add_argument("--conf", type=float, default=0.15)
    a = ap.parse_args()
    src = ROOT / a.src
    classes = (src / "classes.txt").read_text(encoding="utf-8").split()
    imgs = sorted((src / "images").glob("*.jpg"))
    out_dir = ROOT / "data" / "learning" / "zeroshot"
    report = {}
    for kind, w in (("world", "yolov8s-worldv2.pt"), ("yoloe", "yoloe-11s-seg.pt")):
        try:
            stats, ms = run(kind, w, a.device, imgs, classes, src / "labels", out_dir, a.conf)
        except Exception as e:
            print(f"{kind}: FAILED — {e}"); continue
        report[kind] = {"ms_per_img": round(ms, 1), "per_class": stats}
        print(f"\n== {kind} ({w}) · {ms:.0f} ms/img ==   agreement with the VLM labels (IoU≥0.3)")
        for c, (tp, fp, fn) in stats.items():
            if tp + fp + fn == 0:
                continue
            pr = tp / (tp + fp) if tp + fp else 0; rc = tp / (tp + fn) if tp + fn else 0
            print(f"  {c:15s} found {tp:3d} · extra {fp:3d} · missed {fn:3d}   precision {pr:.2f} recall {rc:.2f}")
    (out_dir / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\nannotated predictions → {out_dir}")


if __name__ == "__main__":
    main()
