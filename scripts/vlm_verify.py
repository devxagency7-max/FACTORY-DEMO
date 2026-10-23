"""
VLM "referee" — a second opinion on a PPE alarm BEFORE it is recorded against a worker.

The fast on-camera model raises the alarm; this asks a vision LLM (OpenRouter) whether the flagged item is really
missing, judged by THIS foundry's gear rules (welding shield = head cover, thermal apron = body cover, …).
Experiment mode: run it over the saved raw frames of past live alarms and report how many it would keep / reject.

  python scripts/vlm_verify.py                                   # platform/data/learning/events → report
  python scripts/vlm_verify.py --model google/gemini-2.5-flash --limit 10

Unclear = keep for a human (never auto-reject what the model can't see). The key is read from .env.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vlm_label import ROOT, data_url, load_key  # noqa: E402

WHAT = {
    "NO_HELMET": "the worker has NO head protection",
    "NO_VEST": "the worker has NO body protection (no vest / apron)",
    "NO_GLOVES": "the worker has NO gloves",
    "NO_GLASSES": "the worker has NO safety glasses",
    "NO_EARMUFFS": "the worker has NO ear protection",
}
POLICY = (
    "Compliant protective gear in THIS brass foundry:\n"
    "- head: a hard hat OR a welding / face shield of any kind worn on the head (black, green-tinted or clear; "
    "flipped up still counts)\n"
    "- body: a hi-vis vest OR an aluminized silver thermal apron OR a heavy leather/cloth work apron OR a coverall\n"
    "- hands: any work gloves (leather, cloth, striped)\n"
    "- eyes: safety glasses OR a face shield covering the eyes\n"
    "- ears: ear muffs or ear plugs\n"
)


def verify(key, model, img: Path, alarm: str):
    prompt = (
        f"An automated camera system in a brass FOUNDRY raised this alarm on the photo: \"{WHAT.get(alarm, alarm)}\".\n"
        + POLICY +
        "Look at the worker(s) in the photo. Is the alarm TRUE for at least one clearly visible worker, judged by the "
        "foundry rules above? If the relevant body part is not clearly visible, answer unclear — never guess.\n"
        'Answer ONLY JSON: {"verdict": "real" | "false_alarm" | "unclear", "wears": ["..."], "reason": "short"}'
    )
    body = {"model": model, "temperature": 0, "messages": [{"role": "user", "content": [
        {"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": data_url(img)}}]}]}
    for attempt in range(3):
        try:
            r = httpx.post("https://openrouter.ai/api/v1/chat/completions",
                           headers={"Authorization": "Bearer " + key, "X-Title": "EGIC PPE referee"}, json=body, timeout=120)
            r.raise_for_status()
            txt = r.json()["choices"][0]["message"]["content"]
            m = re.search(r"\{.*\}", txt, re.S)
            return json.loads(m.group(0)) if m else {"verdict": "unclear", "reason": "no json"}
        except Exception as e:
            if attempt == 2:
                return {"verdict": "error", "reason": str(e)[:120]}
            time.sleep(3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="platform/data/learning/events")
    ap.add_argument("--model", default="google/gemini-2.5-flash")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default="data/learning/verify_report.json")
    a = ap.parse_args()
    key = load_key()
    src = ROOT / a.src
    metas = sorted(src.glob("*.json"))
    if a.limit:
        metas = metas[:a.limit]
    results, tally = [], {}
    t0 = time.time()
    for i, mp in enumerate(metas, 1):
        meta = json.loads(mp.read_text(encoding="utf-8"))
        img = mp.with_suffix(".jpg")
        if meta.get("task") != "ppe" or not img.exists():
            continue
        v = verify(key, a.model, img, meta.get("type"))
        tally[v.get("verdict")] = tally.get(v.get("verdict"), 0) + 1
        results.append({"id": meta["id"], "alarm": meta.get("type"), **v})
        print(f"  [{i}/{len(metas)}] {meta['id']} {meta.get('type'):12s} → {v.get('verdict'):11s} {v.get('reason', '')[:90]}")
    out = ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    n = len(results)
    print(f"\n{n} alarms in {time.time() - t0:.0f}s · " + " · ".join(f"{k}: {v}" for k, v in sorted(tally.items())))
    print(f"report → {out}")


if __name__ == "__main__":
    main()
