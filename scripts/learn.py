"""
Teacher → student learning for an EGIC model, from what the factory taught it (app/learning/collector.py).

  python -m scripts.learn --task fire           # collect lessons, train a student, examine it, promote if better
  python -m scripts.learn --task fire --seed-golden صور   # one-time: add site frames to the exam (known: no fire)
  python -m scripts.learn --rollback fire       # back to the original weights

Lessons
  • supervisor decisions (platform /api/v1/learning/reviews) on engine alarms — the most trusted labels:
      confirmed  → the alarm's boxes are right             (positive example)
      rejected   → nothing of that class is in this frame   (negative example — the student unlearns the false alarm)
  • unsure frames — labelled by the TEACHER: the current model at a higher resolution with test-time augmentation.
    Only clear answers are used (every box ≥ 0.6, or nothing ≥ 0.15); the rest wait for a person.
Exam
  data/learning/golden/<task>/ — frames whose answer we know. A student is promoted ONLY if it raises no more false
  alarms than the current model and finds at least as many real ones. Every candidate is recorded in active.json.
"""
import argparse
import json
import os
import random
import shutil
import time
from pathlib import Path

import cv2
import httpx
import numpy as np

from app.models.registry import ACTIVE_FILE, active_weights, read_active

ROOT = Path(os.environ.get("EGIC_LEARN_DIR", "data/learning"))
# the Python engine writes its alarm frames under ROOT/events; the platform server (browser live lab) writes its own
# under platform/data/learning/events — read both, or the lab's alarms and the supervisor's reviews of them are never used
PLATFORM_LEARN = Path(os.environ.get("EGIC_PLATFORM_LEARN_DIR", "platform/data/learning"))


def event_metas():
    dirs = [ROOT / "events", PLATFORM_LEARN / "events"]
    return sorted(p for d in dirs if d.exists() for p in d.glob("*.json"))
ORIGINAL = {"fire": "app/weights/fire_smoke_dfire_yolov8n.pt", "smoking": "app/weights/smoking_yolov8_cigarette_vape.pt",
            "ppe": "app/weights/ppe_sh17_yolov8s.pt"}
# which detection classes an alarm type is about, and the confidence the live system uses
ALARM_CLASSES = {"FIRE_DETECTED": ["fire"], "SMOKE_DETECTED": ["smoke"], "SMOKING_DETECTED": ["cigarette", "vape"]}
EXAM_CLASSES = {"fire": ["fire", "smoke"], "smoking": ["cigarette", "vape"], "ppe": ["helmet", "safety-vest", "glasses", "gloves"]}
LIVE_CONF = {"fire": 0.3, "smoking": 0.3, "ppe": 0.35}


def imread(p: Path):
    return cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)


def yolo_line(cls: int, box, w: int, h: int) -> str:
    x1, y1, x2, y2 = box
    return f"{cls} {(x1 + x2) / 2 / w:.6f} {(y1 + y2) / 2 / h:.6f} {(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}"


def fetch_reviews(platform: str, token: str) -> dict:
    try:
        r = httpx.get(platform.rstrip("/") + "/api/v1/learning/reviews", headers={"X-Admin-Token": token} if token else {}, timeout=10)
        return {x["incident"]: x for x in r.json().get("items", [])}
    except Exception as e:
        print("! platform reviews unavailable:", e)
        return {}


def collect_lessons(task: str, names: list, teacher, reviews: dict):
    """→ (lessons: [(img_path, [(cls, box)]), …], waiting_for_a_person: int)"""
    idx = {n: i for i, n in enumerate(names)}
    lessons, waiting = [], 0
    for meta_p in event_metas():
        m = json.loads(meta_p.read_text(encoding="utf-8"))
        if m.get("task") != task:
            continue
        rv = reviews.get(m["id"]) or {}
        # conduct events carry a review; safety alerts (fire / smoke) only a status — "false alarm" is a clear negative,
        # while a closed alert is NOT taken as proof of fire (an operator may close a false alarm too)
        decision = rv.get("review") if rv.get("review") in ("CONFIRMED", "REJECTED") else ("REJECTED" if rv.get("status") == "FALSE_POSITIVE" else None)
        if not decision:
            waiting += 1
            continue
        classes = ALARM_CLASSES.get(m.get("type"), [])
        if decision == "CONFIRMED":
            labels = [(idx[d["label"]], d["box"]) for d in m["dets"] if d["label"] in idx and d.get("score", 0) >= 0.25]
        else:  # rejected: drop every box of the alarmed class, keep the others the model was sure of
            labels = [(idx[d["label"]], d["box"]) for d in m["dets"] if d["label"] in idx and d["label"] not in classes and d.get("score", 0) >= 0.6]
            if task == "ppe":  # "no helmet" rejected = a helmet was there; its box needs a person → wait
                waiting += 1
                continue
        lessons.append((meta_p.with_suffix(".jpg"), labels, "review"))
    for meta_p in sorted((ROOT / "inbox" / task).glob("*.json")):
        img_p = meta_p.with_suffix(".jpg")
        img = imread(img_p)
        if img is None:
            continue
        r = teacher(img, imgsz=1280, augment=True, conf=0.15, verbose=False)[0]
        tdets = [(int(c), b, s) for b, s, c in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist())]
        if not tdets or all(s >= 0.6 for _, _, s in tdets):
            lessons.append((img_p, [(c, b) for c, b, _ in tdets], "teacher"))
        else:
            waiting += 1
    return lessons, waiting


def examine(model, task: str) -> dict:
    """False alarms and finds on the golden frames, per exam class, at the live confidence."""
    out = {"frames": 0, "false_alarms": 0, "found": 0, "missed": 0}
    gdir = ROOT / "golden" / task
    for meta_p in sorted(gdir.glob("*.json")):
        g = json.loads(meta_p.read_text(encoding="utf-8"))
        img = imread(meta_p.with_suffix(".jpg"))
        if img is None:
            continue
        out["frames"] += 1
        known = set(g.get("known", EXAM_CLASSES[task]))
        truth = [(t["label"], t["box"]) for t in g.get("labels", []) if t["label"] in known]
        r = model(img, conf=LIVE_CONF[task], verbose=False)[0]
        pred = [(model.names[int(c)].lower(), b) for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist()) if model.names[int(c)].lower() in known]
        used = set()
        for lbl, b in pred:
            hit = next((i for i, (tl, tb) in enumerate(truth) if tl == lbl and i not in used and _iou(b, tb) > 0.3), None)
            if hit is None:
                out["false_alarms"] += 1
            else:
                used.add(hit)
        out["found"] += len(used)
        out["missed"] += len(truth) - len(used)
    return out


def recheck_mistakes(model, task: str, reviews: dict) -> dict:
    """On the frames a supervisor marked as false alarms: how many still trigger the alarmed class?"""
    out = {"frames": 0, "still_alarming": 0}
    for meta_p in event_metas():
        m = json.loads(meta_p.read_text(encoding="utf-8"))
        rv = reviews.get(m["id"]) or {}
        if m.get("task") != task or not (rv.get("review") == "REJECTED" or rv.get("status") == "FALSE_POSITIVE"):
            continue
        classes = ALARM_CLASSES.get(m.get("type"), [])
        img = imread(meta_p.with_suffix(".jpg"))
        if img is None or not classes:
            continue
        r = model(img, conf=LIVE_CONF[task], verbose=False)[0]
        out["frames"] += 1
        out["still_alarming"] += int(any(model.names[int(c)].lower() in classes for c in r.boxes.cls.tolist()))
    return out


def _iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


def seed_golden(task: str, src: Path, every: float = 2.0):
    """Site footage known to contain no fire / no smoking → exam frames (labels [], known = the alarm classes)."""
    gdir = ROOT / "golden" / task
    gdir.mkdir(parents=True, exist_ok=True)
    known = {"fire": ["fire"], "smoking": ["cigarette", "vape"]}.get(task)
    if not known:
        raise SystemExit("seed-golden only for fire / smoking (PPE exam frames need real labels)")
    n = 0
    for p in sorted(src.iterdir()):
        frames = []
        if p.suffix.lower() in (".jpg", ".jpeg", ".png"):
            frames = [(p.stem, imread(p))]
        elif p.suffix.lower() in (".mp4", ".mov"):
            cap, i = cv2.VideoCapture(str(p)), 0
            fps = cap.get(cv2.CAP_PROP_FPS) or 25
            while True:
                ok, f = cap.read()
                if not ok:
                    break
                if i % int(fps * every) == 0:
                    frames.append((f"{p.stem}_{i}", f))
                i += 1
            cap.release()
        for name, img in frames:
            if img is None:
                continue
            safe = "".join(ch if ch.isalnum() else "_" for ch in name)[:80]
            ok, buf = cv2.imencode(".jpg", img)
            (gdir / f"site_{safe}.jpg").write_bytes(buf.tobytes())
            (gdir / f"site_{safe}.json").write_text(json.dumps({"labels": [], "known": known, "source": str(p.name)}), encoding="utf-8")
            n += 1
    print(f"golden/{task}: +{n} site frames (known: {known})")


def write_active(task: str, entry: dict, promoted: bool):
    a = read_active()
    a.setdefault("history", []).append(dict(entry, task=task, promoted=promoted))
    if promoted:
        a[task] = entry
    ACTIVE_FILE.write_text(json.dumps(a, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=["fire", "smoking", "ppe"])
    ap.add_argument("--platform", default=os.environ.get("EGIC_PLATFORM_URL", "http://127.0.0.1:8080"))
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--min-lessons", type=int, default=40)
    ap.add_argument("--seed-golden")
    ap.add_argument("--rollback")
    a = ap.parse_args()

    if a.rollback:
        act = read_active(); act.pop(a.rollback, None)
        ACTIVE_FILE.write_text(json.dumps(act, ensure_ascii=False, indent=1), encoding="utf-8")
        return print(f"{a.rollback}: back to the original weights")
    if a.seed_golden:
        return seed_golden(a.task, Path(a.seed_golden))

    from ultralytics import YOLO
    task = a.task
    current_path = active_weights(task, ORIGINAL[task])
    current = YOLO(current_path)
    names = [current.names[i].lower() for i in range(len(current.names))]
    lessons, waiting = collect_lessons(task, names, current, fetch_reviews(a.platform, os.environ.get("ADMIN_TOKEN", "")))
    by = {k: sum(1 for x in lessons if x[2] == k) for k in ("review", "teacher")}
    print(f"{task}: {len(lessons)} lessons (supervisor {by['review']} · teacher {by['teacher']}) · {waiting} waiting for a person")
    if len(lessons) < a.min_lessons:
        return print(f"not enough lessons yet (need {a.min_lessons}) — the student keeps collecting")

    stamp = time.strftime("%Y%m%d_%H%M")
    ds = ROOT / "datasets" / f"{task}_{stamp}"
    random.seed(7); random.shuffle(lessons)
    n_val = max(1, len(lessons) // 7)
    for split, part in (("val", lessons[:n_val]), ("train", lessons[n_val:])):
        (ds / "images" / split).mkdir(parents=True, exist_ok=True); (ds / "labels" / split).mkdir(parents=True, exist_ok=True)
        for i, (img_p, labels, _) in enumerate(part):
            img = imread(img_p); h, w = img.shape[:2]
            shutil.copy(img_p, ds / "images" / split / f"{i:06d}.jpg")
            (ds / "labels" / split / f"{i:06d}.txt").write_text("\n".join(yolo_line(c, b, w, h) for c, b in labels), encoding="utf-8")
    (ds / "data.yaml").write_text(json.dumps({"path": str(ds.resolve()), "train": "images/train", "val": "images/val", "names": {i: n for i, n in enumerate(names)}}), encoding="utf-8")

    # the student starts from the current model and learns gently (backbone frozen, small learning rate)
    student = YOLO(current_path)
    student.train(data=str(ds / "data.yaml"), epochs=a.epochs, imgsz=a.imgsz, freeze=10, lr0=0.001, batch=8, patience=5,
                  project=str((ROOT / "runs").resolve()), name=f"{task}_{stamp}", exist_ok=True, plots=False, verbose=False)
    best = ROOT / "runs" / f"{task}_{stamp}" / "weights" / "best.pt"
    cand = YOLO(str(best))

    before, after = examine(current, task), examine(cand, task)
    reviews = fetch_reviews(a.platform, os.environ.get("ADMIN_TOKEN", ""))
    mist_before, mist_after = recheck_mistakes(current, task, reviews), recheck_mistakes(cand, task, reviews)
    print("exam      current:", before, "\n          student:", after)
    print("mistakes  current:", mist_before, "\n          student:", mist_after)
    positives = before["found"] + before["missed"]
    # an exam without real positives can't tell a student that got better from one that forgot how to see fire
    min_pos = 10
    passed = before["frames"] > 0 and positives >= min_pos and after["false_alarms"] <= before["false_alarms"] and after["found"] >= before["found"] \
        and (after["false_alarms"] < before["false_alarms"] or after["found"] > before["found"] or mist_after["still_alarming"] < mist_before["still_alarming"])
    entry = {"path": None, "candidate": str(best), "trained": stamp, "lessons": by, "exam_current": before, "exam_student": after,
             "mistakes_current": mist_before, "mistakes_student": mist_after, "from": current_path}
    if passed:
        dst = Path("app/weights/learned") / f"{task}_{stamp}.pt"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(best, dst)
        entry["path"] = str(dst).replace("\\", "/")
        print(f"✅ promoted → {entry['path']} (the engine picks it up within 30 s)")
    else:
        why = " (no exam frames: run --seed-golden first)" if before["frames"] == 0 else \
            f" (the exam has {positives} real {'/'.join(EXAM_CLASSES[task][:1])} frames, needs {min_pos}: record a controlled drill on site and add it to data/learning/golden/{task})" if positives < min_pos else ""
        print("✋ not promoted — the current model stays" + why)
    write_active(task, entry, passed)


if __name__ == "__main__":
    main()
