#!/usr/bin/env python3
"""Resident Kokoro-ONNX speech engine for PHOENIX (Windows, per-user).

Stdout is reserved for NDJSON protocol frames. Model files live in
%LOCALAPPDATA%/Phoenix/voice/kokoro, outside the source worktree.
"""

from __future__ import annotations

import contextlib
import json
import os
import queue
import sys
import tempfile
import threading
import wave
from pathlib import Path
from typing import Any

BASE = Path(__file__).resolve().parent
MODEL = BASE / "kokoro-v1.0.onnx"
VOICES = BASE / "voices-v1.0.bin"
SPANS = {
    "es": ("ef_dora", "em_alex", "es"),
    "en": ("af_heart", "am_michael", "en-us"),
    "pt": ("pf_dora", "pm_alex", "pt-br"),
    "it": ("if_sara", "im_nicola", "it"),
    "ja": ("jf_alpha", "jm_kumo", "ja"),
    "hi": ("hf_alpha", "hm_omega", "hi"),
    "zh": ("zf_xiaobei", "zm_yunxi", "cmn"),
    "fr": ("ff_siwis", None, "fr-fr"),
}
ESPEAK_LANGUAGES = {"es", "pt", "it", "fr"}
write_lock = threading.Lock()
cancel_lock = threading.Lock()
cancelled: set[str] = set()
closed = threading.Event()
jobs: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=8)


def voice_for(language: str, gender: str) -> tuple[str, str, str]:
    primary = language.strip().lower().replace("_", "-").split("-")[0]
    primary = primary if primary in SPANS else "en"
    female, male, code = SPANS[primary]
    voice = male if gender == "masculine" else female
    if not voice:
        raise ValueError(f"Kokoro has no {gender} voice for {primary}")
    return voice, code, primary


def emit(frame: dict[str, Any]) -> None:
    with write_lock:
        sys.stdout.write(json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def load_model():
    with contextlib.redirect_stdout(sys.stderr):
        from kokoro_onnx import Kokoro
        return Kokoro(str(MODEL), str(VOICES))


model = None
phonemizers: dict[str, Any] = {}


def generate(text: str, language: str, gender: str, pace: str):
    voice, code, primary = voice_for(language, gender)
    speed = 0.94 if pace == "calm" else 1.06 if pace == "brisk" else 1.0
    with contextlib.redirect_stdout(sys.stderr):
        if primary in ESPEAK_LANGUAGES:
            if primary not in phonemizers:
                import espeakng_loader
                from phonemizer.backend.espeak.wrapper import EspeakWrapper
                from misaki.espeak import EspeakG2P
                EspeakWrapper.set_library(espeakng_loader.get_library_path())
                EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
                phonemizers[primary] = EspeakG2P(language=code)
            phonemes, _ = phonemizers[primary](text)
            if not phonemes.strip():
                raise ValueError("Kokoro phonemizer returned no speech")
            return model.create(phonemes, voice=voice, speed=speed, is_phonemes=True)
        return model.create(text, voice=voice, speed=speed, lang=code)


def play_audio(samples, sample_rate: int, request_id: str) -> None:
    import numpy as np

    if not samples.size or is_cancelled(request_id):
        return
    audio = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
    fd, filename = tempfile.mkstemp(prefix="phoenix-voice-", suffix=".wav")
    try:
        with os.fdopen(fd, "wb") as stream:
            with wave.open(stream, "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(int(sample_rate))
                output.writeframes(audio)
        if is_cancelled(request_id):
            return
        if sys.platform == "win32":
            import winsound
            winsound.PlaySound(filename, winsound.SND_FILENAME)
        else:
            import subprocess
            player = ["afplay", filename] if sys.platform == "darwin" else ["aplay", "-q", filename]
            subprocess.run(player, check=True, timeout=120)
    finally:
        Path(filename).unlink(missing_ok=True)


def is_cancelled(request_id: str) -> bool:
    with cancel_lock:
        return closed.is_set() or request_id in cancelled


def worker() -> None:
    while not closed.is_set():
        task = jobs.get()
        if task is None:
            jobs.task_done()
            return
        request_id = task["id"]
        try:
            language = str(task.get("language") or "es-DO")
            gender = str(task.get("gender") or "feminine")
            style = task.get("style") or {}
            pace = str(style.get("pace") or "conversational") if isinstance(style, dict) else "conversational"
            for chunk in task.get("chunks", []):
                if is_cancelled(request_id):
                    break
                samples, rate = generate(chunk, language, gender, pace)
                play_audio(samples, rate, request_id)
            emit({"type": "done", "id": request_id})
        except Exception as exc:
            emit({"type": "error", "id": request_id, "message": str(exc)[:320]})
        finally:
            with cancel_lock:
                cancelled.discard(request_id)
            jobs.task_done()


def main() -> int:
    global model
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        assert voice_for("es-DO", "feminine")[0] == "ef_dora"
        assert voice_for("es-DO", "masculine")[0] == "em_alex"
        assert voice_for("en-US", "feminine")[0] == "af_heart"
        assert voice_for("en-US", "masculine")[0] == "am_michael"
        return 0
    try:
        model = load_model()
        if len(sys.argv) == 2 and sys.argv[1] == "--check":
            # Validate both Spanish presentations and the phonemizer, not just imports.
            generate("Hola.", "es-DO", "feminine", "conversational")
            generate("Hola.", "es-DO", "masculine", "conversational")
            return 0
    except Exception as exc:
        print(f"Kokoro initialization failed: {exc}", file=sys.stderr)
        return 1
    thread = threading.Thread(target=worker, name="phoenix-kokoro", daemon=True)
    thread.start()
    emit({"type": "ready", "engine": "kokoro-onnx"})
    try:
        for raw in sys.stdin:
            try:
                frame = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(frame, dict):
                continue
            kind = frame.get("type")
            if kind == "shutdown":
                break
            if kind == "cancel":
                request_id = frame.get("id")
                if isinstance(request_id, str):
                    with cancel_lock:
                        cancelled.add(request_id)
                continue
            if kind != "speak":
                continue
            request_id = frame.get("id")
            chunks = frame.get("chunks")
            if not isinstance(request_id, str) or not request_id or not isinstance(chunks, list) or not all(isinstance(chunk, str) for chunk in chunks):
                emit({"type": "error", "id": request_id, "message": "invalid speech request"})
                continue
            if frame.get("gender") not in ("masculine", "feminine", "neutral", None):
                emit({"type": "error", "id": request_id, "message": "invalid voice gender"})
                continue
            try:
                jobs.put_nowait(frame)
            except queue.Full:
                emit({"type": "error", "id": request_id, "message": "Kokoro queue is full"})
    finally:
        closed.set()
        try:
            jobs.put_nowait(None)
        except queue.Full:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
