#!/usr/bin/env python3
"""Run the frozen local judge on a free cloud GPU instead of your own machine.

Designed for Google Colab (free T4, 16 GB) or Kaggle (P100/T4, 30 h/week free).
A T4 fits qwen2.5vl:7b entirely in VRAM, so there is no CPU spill and it runs
several times faster than an 8 GB laptop GPU -- with zero load on your machine.

It reproduces src/local-judge.js exactly: same prompt, same response schema, same
verdict validation, same resumable JSONL output. The prompt SHA-256 is asserted
against the frozen value so a drifted prompt fails loudly instead of silently
producing incomparable results.

Nothing but two small JSON manifests needs to be uploaded: with --fetch-missing
the videos are pulled from HuggingFace inside the cloud runtime and checked
against the sha256 already recorded in the index. Results are resumable, so an
interrupted or disconnected session loses nothing.

--- Colab setup (Runtime > Change runtime type > T4 GPU, then one cell) ----
!curl -fsSL https://ollama.com/install.sh | sh
!nohup ollama serve > /tmp/ollama.log 2>&1 &
!sleep 5 && ollama pull qwen2.5vl:7b
!pip -q install imageio-ffmpeg

# Upload the ~200 KB bundle (colab_judge.py, judge-tasks.json, video-index.json,
# and any existing local-judge-results.jsonl to resume from):
from google.colab import files; files.upload()

!mkdir -p /content/pilot && mv judge-tasks.json video-index.json /content/pilot/
!mv local-judge-results.jsonl /content/pilot/ 2>/dev/null || true
!python colab_judge.py --pilot-dir /content/pilot --model qwen2.5vl:7b --fetch-missing

from google.colab import files; files.download('/content/pilot/local-judge-results.jsonl')
---------------------------------------------------------------------------
"""

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

PROMPT_SHA256 = "e91ec6f3cdf677a862bc3b678f39eda5ba00b369e707137a082500a81b184be4"
PROMPT_VERSION = "robot-success-v1"
REASON_CODES = {"COMPLETE", "NO_PROGRESS", "PARTIAL", "WRONG_ACTION", "NOT_VISIBLE", "ABORTED"}

RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "verdict": {"type": "string", "enum": ["SUCCESS", "FAILURE"],
                    "description": "Binary task-completion verdict."},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1,
                       "description": "Confidence in the binary verdict."},
        "partial_success": {"type": "number", "minimum": 0, "maximum": 1,
                            "description": "Visible fraction of the requested task completed."},
        "reason_code": {"type": "string",
                        "enum": ["COMPLETE", "NO_PROGRESS", "PARTIAL", "WRONG_ACTION", "NOT_VISIBLE", "ABORTED"]},
        "evidence": {"type": "string",
                     "description": "A concise visual observation supporting the verdict."},
    },
    "required": ["verdict", "confidence", "partial_success", "reason_code", "evidence"],
}


def judge_prompt(instruction: str) -> str:
    return (
        "You are a blinded evaluator of one real robot-policy rollout.\n\n"
        f"Task instruction: {instruction}\n\n"
        "Watch the entire video and decide whether the robot visibly completed the requested task by the end.\n\n"
        "Use SUCCESS only when the requested end state is visibly achieved. Use FAILURE when the robot only "
        "attempts the task, makes partial progress, performs the wrong action, undoes the result, times out, "
        "or completion is not visible. Do not infer success from motion alone. Judge only this video and "
        "instruction; do not guess the policy identity.\n\n"
        "Return the required JSON fields. confidence is confidence in the binary verdict from 0 to 1. "
        "partial_success is achieved task progress from 0 to 1. evidence must be a concise visual observation "
        "without mentioning any policy name."
    )


def assert_frozen_prompt() -> str:
    digest = hashlib.sha256(judge_prompt("<TASK_INSTRUCTION>").encode("utf8")).hexdigest()
    if digest != PROMPT_SHA256:
        raise SystemExit(
            f"Prompt drift: this file hashes to {digest} but the frozen judge contract is {PROMPT_SHA256}.\n"
            "Results would not be comparable with runs made on the frozen prompt."
        )
    return digest


def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe_duration(ffmpeg: str, path: str) -> float:
    out = subprocess.run([ffmpeg, "-i", path], capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "Duration:" in line:
            stamp = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = stamp.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return 0.0


def extract_frames(ffmpeg: str, path: str, frame_count: int, width: int = 448):
    duration = probe_duration(ffmpeg, path)
    stamps = [0.0] if duration <= 0 else [duration * (i + 0.5) / frame_count for i in range(frame_count)]
    frames = []
    for stamp in stamps:
        proc = subprocess.run(
            [ffmpeg, "-ss", f"{stamp:.3f}", "-i", path, "-frames:v", "1",
             "-vf", f"scale={width}:-2", "-f", "image2", "-c:v", "mjpeg", "-"],
            capture_output=True,
        )
        if proc.stdout:
            frames.append(base64.b64encode(proc.stdout).decode("ascii"))
    if not frames:
        raise RuntimeError(f"ffmpeg produced no frames for {path}")
    return frames


def context_window_for(frame_count: int) -> int:
    need = frame_count * 600 + 1024
    size = 8192
    while size < need:
        size *= 2
    return size


def parse_verdict(text: str) -> dict:
    """Same contract as parseLocalVerdict in src/local-judge.js."""
    value = None
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try:
            value = json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            value = None
    if not isinstance(value, dict):
        raise ValueError(f"no parseable JSON verdict: {text[:200]}")
    if value.get("verdict") not in ("SUCCESS", "FAILURE"):
        raise ValueError(f"invalid verdict: {value.get('verdict')!r}")
    for field in ("confidence", "partial_success"):
        number = value.get(field)
        if not isinstance(number, (int, float)) or not (0 <= number <= 1):
            raise ValueError(f"invalid {field}: {number!r}")
    if value.get("reason_code") not in REASON_CODES:
        raise ValueError(f"invalid reason_code: {value.get('reason_code')!r}")
    evidence = value.get("evidence")
    if not isinstance(evidence, str) or not evidence.strip() or len(evidence) > 600:
        raise ValueError("missing or overlong evidence")
    # A verdict scored as P(success) must not land on the far side of its own label.
    if value["confidence"] < 0.5:
        raise ValueError(
            f"verdict contradicts its own confidence: {value['verdict']} at {value['confidence']}"
        )
    return value


REPOSITORY_ID = "RoboArena/DataDump_07-17-2026"


def fetch_video(video: dict, root: str, attempts: int = 5) -> str:
    """Pull one wrist video straight from HuggingFace so nothing has to be uploaded.

    Only the two small JSON manifests need to travel; the media is fetched in the
    cloud runtime and verified against the sha256 already recorded in the index.
    """
    destination = os.path.join(root, *video["local_path"].split("/"))
    if os.path.exists(destination):
        return destination
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    encoded = "/".join(urllib.parse.quote(part) for part in video["source_path"].split("/"))
    url = f"https://huggingface.co/datasets/{REPOSITORY_ID}/resolve/main/{encoded}"
    last = None
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"user-agent": "roboeval/0.2"})
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = response.read()
            digest = hashlib.sha256(payload).hexdigest()
            if digest != video["sha256"]:
                raise RuntimeError(f"sha256 mismatch for {video['item_id']}")
            with open(destination, "wb") as handle:
                handle.write(payload)
            return destination
        except Exception as error:  # noqa: BLE001
            last = error
            if attempt < attempts:
                time.sleep(min(20, 2 ** attempt))
    raise RuntimeError(f"could not fetch {video['item_id']}: {last}")


def call_model(endpoint: str, model: str, prompt: str, images, timeout: int = 300) -> dict:
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "images": images,
        "stream": False,
        "format": RESPONSE_SCHEMA,
        "options": {"temperature": 0, "num_predict": 300, "num_ctx": context_window_for(len(images))},
    }).encode("utf8")
    request = urllib.request.Request(
        f"{endpoint.rstrip('/')}/api/generate", data=body,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pilot-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--endpoint", default="http://127.0.0.1:11434")
    parser.add_argument("--frames", type=int, default=8)
    parser.add_argument("--max-new", type=int, default=0, help="0 means no limit")
    parser.add_argument("--results-file", default="local-judge-results.jsonl")
    parser.add_argument("--fetch-missing", action="store_true",
                        help="Download absent videos from HuggingFace instead of requiring an upload")
    args = parser.parse_args()

    digest = assert_frozen_prompt()
    ffmpeg = ffmpeg_exe()
    root = args.pilot_dir
    tasks = {i["item_id"]: i["instruction"]
             for i in json.load(open(os.path.join(root, "judge-tasks.json")))["items"]}
    index = json.load(open(os.path.join(root, "video-index.json")))
    results_path = os.path.join(root, args.results_file)

    completed = set()
    if os.path.exists(results_path):
        with open(results_path, encoding="utf8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("model") != args.model or row.get("prompt_sha256") != digest:
                    raise SystemExit(f"Existing result {row.get('item_id')} uses a different judge contract")
                completed.add(row["item_id"])
    print(f"resuming: {len(completed)} already judged of {index['total_videos']}", flush=True)

    pending = [v for v in index["videos"] if v["item_id"] not in completed]
    if args.max_new > 0:
        pending = pending[:args.max_new]

    started = time.time()
    failures = 0
    for position, video in enumerate(pending, start=1):
        item_started = time.time()
        try:
            path = (fetch_video(video, root) if args.fetch_missing
                    else os.path.join(root, *video["local_path"].split("/")))
            images = extract_frames(ffmpeg, path, args.frames)
            response = call_model(args.endpoint, args.model, judge_prompt(tasks[video["item_id"]]), images)
            parsed = parse_verdict(response.get("response", ""))
        except Exception as error:  # noqa: BLE001 - one bad video must not end the run
            failures += 1
            print(f"  SKIP {video['item_id']}: {error}", flush=True)
            continue

        success = parsed["verdict"] == "SUCCESS"
        row = {
            "result_version": 1,
            "item_id": video["item_id"],
            "model": args.model,
            "model_version": response.get("model", args.model),
            "runtime": "local",
            "prompt_version": PROMPT_VERSION,
            "prompt_sha256": digest,
            "frame_count": len(images),
            "verdict": parsed["verdict"],
            "success": success,
            "confidence": parsed["confidence"],
            "automatic_score": parsed["confidence"] if success else 1 - parsed["confidence"],
            "partial_success": parsed["partial_success"],
            "reason_code": parsed["reason_code"],
            "evidence": parsed["evidence"].strip(),
            "elapsed_ms": int((time.time() - item_started) * 1000),
            "judged_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        with open(results_path, "a", encoding="utf8") as handle:
            handle.write(json.dumps(row) + "\n")

        elapsed = time.time() - started
        rate = elapsed / position
        left = (len(pending) - position) * rate
        print(f"  {position}/{len(pending)}  {row['verdict']:<8} "
              f"{row['elapsed_ms'] / 1000:5.1f}s  |  {rate:.1f}s/video, ~{left / 60:.0f} min left",
              flush=True)

    print(f"\ndone: {len(completed) + len(pending) - failures} judged, {failures} skipped")
    print(f"results: {results_path}")


if __name__ == "__main__":
    sys.exit(main())
