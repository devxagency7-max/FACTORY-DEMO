"""
Train the "foundry gear" detector — a small model that knows THIS factory's protective kit.

It runs BESIDE the existing PPE model (which still finds person / head / hands): this one says whether that person wears
the foundry's gear (aluminized thermal apron, welding shield, work gloves, N95, boots), so a correctly dressed worker
is no longer flagged. The existing PPE weights are never touched.

  .venv\\Scripts\\python.exe scripts/train_foundry.py                 # dataset from data/learning/foundry → train
  .venv\\Scripts\\python.exe scripts/train_foundry.py --epochs 80 --device 0   # on the GPU (needs CUDA torch)

Output: app/weights/foundry_gear_yolov8n.pt  +  data/learning/foundry_run/ (metrics, val predictions to eyeball).
"""
import argparse
import random
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def group_of(stem: str) -> str:
    """vid_005_vid2_003 → 'vid2' (all frames of one video); a photo is its own group."""
    m = re.search(r"(vid\d+)_\d+$", stem)
    return m.group(1) if m else stem


def build_dataset(src: Path, dst: Path, val_frac: float, seed: int):
    classes = (src / "classes.txt").read_text(encoding="utf-8").split()
    pairs = []
    for img in sorted((src / "images").glob("*.jpg")):
        lab = src / "labels" / (img.stem + ".txt")
        if lab.exists():
            pairs.append((img, lab))
    if len(pairs) < 4:
        raise SystemExit(f"only {len(pairs)} labelled images in {src} — run scripts/vlm_label.py first")
    # split by GROUP, not by image: frames of one video are near-duplicates, so they all go to the same side —
    # otherwise the exam would be on frames the model saw 2 seconds earlier and the score would be inflated
    groups = {}
    for img, lab in pairs:
        groups.setdefault(group_of(img.stem), []).append((img, lab))
    keys = sorted(groups)
    random.Random(seed).shuffle(keys)
    val, train, target = [], [], max(1, int(len(pairs) * val_frac))
    for k in keys:
        (val if len(val) < target else train).extend(groups[k])
    if dst.exists():
        shutil.rmtree(dst)
    n_val = len(val)
    for split, items in (("val", val), ("train", train)):
        (dst / "images" / split).mkdir(parents=True, exist_ok=True)
        (dst / "labels" / split).mkdir(parents=True, exist_ok=True)
        for img, lab in items:
            shutil.copy(img, dst / "images" / split / img.name)
            shutil.copy(lab, dst / "labels" / split / lab.name)  # an empty label file = background (no gear) example
    yaml = dst / "data.yaml"
    yaml.write_text("path: " + str(dst).replace("\\", "/") + "\ntrain: images/train\nval: images/val\nnames:\n"
                    + "".join(f"  {i}: {c}\n" for i, c in enumerate(classes)), encoding="utf-8")
    n_obj = sum(len([l for l in lab.read_text(encoding="utf-8").splitlines() if l.strip()]) for _, lab in pairs)
    print(f"dataset: {len(pairs) - n_val} train / {n_val} val images, {n_obj} boxes, {len(classes)} classes → {yaml}")
    return yaml, classes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/learning/foundry")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--base", default="app/weights/yolov8n_coco.pt", help="start from COCO weights (knows 'person')")
    ap.add_argument("--val-frac", type=float, default=0.2)
    a = ap.parse_args()

    from ultralytics import YOLO

    src = ROOT / a.src
    ds = ROOT / "data" / "learning" / "foundry_ds"
    yaml, classes = build_dataset(src, ds, a.val_frac, seed=7)
    model = YOLO(str(ROOT / a.base))
    run_dir = ROOT / "data" / "learning"
    model.train(data=str(yaml), epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, device=a.device,
                project=str(run_dir), name="foundry_run", exist_ok=True, patience=25, verbose=False,
                # small dataset → strong augmentation, and keep colours (the SILVER apron's look matters)
                hsv_h=0.0, hsv_s=0.3, hsv_v=0.3, fliplr=0.5, mosaic=1.0, scale=0.5, workers=0)
    best = run_dir / "foundry_run" / "weights" / "best.pt"
    out = ROOT / "app" / "weights" / "foundry_gear_yolov8n.pt"
    shutil.copy(best, out)
    m = YOLO(str(out))
    metrics = m.val(data=str(yaml), device=a.device, verbose=False, workers=0)
    print(f"saved {out}")
    print(f"val mAP50={metrics.box.map50:.3f}  mAP50-95={metrics.box.map:.3f}")
    for i, c in enumerate(classes):
        try:
            print(f"  {c:16s} AP50={metrics.box.ap50[list(metrics.box.ap_class_index).index(i)]:.3f}")
        except ValueError:
            pass  # class not present in the val split
    # predictions on the val images, saved to eyeball
    m.predict(source=str(ds / "images" / "val"), save=True, project=str(run_dir), name="foundry_pred",
              exist_ok=True, conf=0.25, device=a.device, verbose=False)
    print(f"val predictions → {run_dir / 'foundry_pred'}")


if __name__ == "__main__":
    main()
