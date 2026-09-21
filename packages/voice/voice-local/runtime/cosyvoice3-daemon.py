#!/usr/bin/env python3
"""PHOENIX Natural Voice daemon for a local CosyVoice 3 installation.

Protocol: newline-delimited JSON on stdin/stdout.
Stdout is reserved for protocol frames. Model diagnostics are redirected to stderr.

Required environment:
  PHOENIX_COSYVOICE_HOME       path to a CosyVoice checkout
  PHOENIX_COSYVOICE_MODEL_DIR  local Fun-CosyVoice3-0.5B model directory
  PHOENIX_VOICE_REFERENCE      authorized clean reference WAV

Optional:
  PHOENIX_VOICE_REFERENCE_TEXT transcript of the reference WAV
  PHOENIX_VOICE_DEVICE         sounddevice output device id/name
"""

from __future__ import annotations

import contextlib
import json
import os
import queue
import sys
import threading
from pathlib import Path
from typing import Any, Iterable


def emit(frame: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def require_path(name: str) -> Path:
    raw = os.environ.get(name, "").strip()
    if not raw:
        raise RuntimeError(f"{name} is required")
    path = Path(raw).expanduser().resolve()
    if not path.exists():
        raise RuntimeError(f"{name} does not exist: {path}")
    return path


COSY_HOME = require_path("PHOENIX_COSYVOICE_HOME")
MODEL_DIR = require_path("PHOENIX_COSYVOICE_MODEL_DIR")
REFERENCE_WAV = require_path("PHOENIX_VOICE_REFERENCE")
REFERENCE_TEXT = os.environ.get("PHOENIX_VOICE_REFERENCE_TEXT", "").strip()

sys.path.insert(0, str(COSY_HOME))
matcha = COSY_HOME / "third_party" / "Matcha-TTS"
if matcha.exists():
    sys.path.insert(0, str(matcha))

try:
    import sounddevice as sd
except ImportError as exc:
    raise RuntimeError(
        "sounddevice is required by PHOENIX Natural Voice; install it in the CosyVoice environment"
    ) from exc

with contextlib.redirect_stdout(sys.stderr):
    from cosyvoice.cli.cosyvoice import AutoModel
    model = AutoModel(model_dir=str(MODEL_DIR))

sample_rate = int(getattr(model, "sample_rate", 24000))
device: int | str | None = os.environ.get("PHOENIX_VOICE_DEVICE") or None
stream = sd.OutputStream(
    samplerate=sample_rate,
    channels=1,
    dtype="float32",
    latency="low",
    device=device,
    blocksize=0,
)
stream.start()

jobs: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=8)
cancelled: set[str] = set()
cancel_lock = threading.Lock()
closed = threading.Event()


def is_cancelled(request_id: str) -> bool:
    with cancel_lock:
        return request_id in cancelled


def clear_cancel(request_id: str) -> None:
    with cancel_lock:
        cancelled.discard(request_id)


def instruction(style: dict[str, Any]) -> str:
    pace = str(style.get("pace", "conversational"))
    energy = float(style.get("energy", 0.5))
    warmth = float(style.get("warmth", 0.75))
    question = bool(style.get("interrogative", False))
    pieces = [
        "Speak naturally and conversationally with human-like timing and subtle pauses.",
        "Keep a warm, close, non-announcer delivery." if warmth >= 0.7
        else "Keep a clear, neutral delivery.",
    ]
    if pace == "calm":
        pieces.append("Use a calm measured pace without dragging words.")
    elif pace == "brisk":
        pieces.append("Use a slightly brisk pace while staying intelligible.")
    else:
        pieces.append("Use a normal conversational pace.")
    if energy >= 0.62:
        pieces.append("Use moderately higher energy, never shout.")
    if question:
        pieces.append("Use natural interrogative intonation.")
    return " ".join(pieces)


def text_generator(text: str) -> Iterable[str]:
    # CosyVoice supports iterable text input; each semantic PHOENIX chunk is
    # already bounded, so a single yield avoids a second arbitrary splitter.
    yield text


def synthesize(text: str, style: dict[str, Any]):
    prompt = instruction(style)
    with contextlib.redirect_stdout(sys.stderr):
        if hasattr(model, "inference_instruct2"):
            return model.inference_instruct2(
                text_generator(text),
                prompt,
                str(REFERENCE_WAV),
                stream=True,
            )
        if REFERENCE_TEXT:
            return model.inference_zero_shot(
                text_generator(text),
                REFERENCE_TEXT,
                str(REFERENCE_WAV),
                stream=True,
            )
        return model.inference_cross_lingual(
            text_generator(text),
            str(REFERENCE_WAV),
            stream=True,
        )


def play_piece(piece: dict[str, Any], request_id: str) -> bool:
    if is_cancelled(request_id):
        return False
    speech = piece.get("tts_speech")
    if speech is None:
        return True
    array = speech.detach().float().cpu().numpy()
    if array.ndim == 2:
        array = array[0]
    if array.size == 0:
        return True
    stream.write(array.reshape(-1, 1))
    return not is_cancelled(request_id)


def worker() -> None:
    while not closed.is_set():
        job = jobs.get()
        if job is None:
            return
        request_id = str(job["id"])
        chunks = job.get("chunks", [])
        style = job.get("style", {})
        try:
            for chunk in chunks:
                if is_cancelled(request_id):
                    break
                with contextlib.redirect_stdout(sys.stderr):
                    generated = synthesize(str(chunk), style if isinstance(style, dict) else {})
                    for piece in generated:
                        if not play_piece(piece, request_id):
                            break
                if is_cancelled(request_id):
                    break
            emit({"type": "done", "id": request_id})
        except Exception as exc:  # daemon boundary must convert all model failures
            emit({"type": "error", "id": request_id, "message": str(exc)})
        finally:
            clear_cancel(request_id)
            jobs.task_done()


thread = threading.Thread(target=worker, name="phoenix-natural-voice", daemon=True)
thread.start()
emit({"type": "ready", "sampleRate": sample_rate, "engine": "cosyvoice3"})

try:
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            emit({"type": "error", "message": "invalid JSON frame"})
            continue
        kind = frame.get("type")
        if kind == "shutdown":
            break
        if kind == "cancel":
            request_id = str(frame.get("id", ""))
            if request_id:
                with cancel_lock:
                    cancelled.add(request_id)
            continue
        if kind != "speak":
            emit({"type": "error", "id": frame.get("id"), "message": "unsupported frame type"})
            continue
        request_id = str(frame.get("id", ""))
        chunks = frame.get("chunks")
        if not request_id or not isinstance(chunks, list) or not all(isinstance(item, str) for item in chunks):
            emit({"type": "error", "id": request_id, "message": "invalid speak frame"})
            continue
        try:
            jobs.put_nowait(frame)
        except queue.Full:
            emit({"type": "error", "id": request_id, "message": "natural voice queue is full"})
finally:
    closed.set()
    try:
        jobs.put_nowait(None)
    except queue.Full:
        pass
    stream.abort()
    stream.close()
