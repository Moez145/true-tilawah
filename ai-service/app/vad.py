"""Voice Activity Detection — Silero VAD via ONNX backend.

Using onnx=True avoids the TorchScript "expected scalar type Double but found Float"
crash that occurs with the default JIT-compiled model on some PyTorch/Windows setups.

The model is loaded lazily on first use and cached as a module-level singleton.
If loading ever fails (e.g. missing onnxruntime, no network on cold start), the
failure itself is cached too — so we don't waste time retrying on every audio
chunk for the rest of the process lifetime. Callers should catch exceptions
from these functions and fall back to a simpler silence gate (e.g. RMS energy).
"""
import numpy as np
import torch

from app.config import (
    VAD_SAMPLE_RATE,
    VAD_WINDOW_FRAMES,
    SILENCE_THRESHOLD,
    MIN_SPEECH_SECS,
)

_vad_model = None
_vad_utils = None
_vad_failed = False
_vad_fail_reason = None


def _ensure_loaded():
    """Load the ONNX-backed Silero VAD model once, caching success AND failure."""
    global _vad_model, _vad_utils, _vad_failed, _vad_fail_reason

    if _vad_failed:
        raise RuntimeError(f"VAD previously failed to load — not retrying ({_vad_fail_reason})")

    if _vad_model is None:
        try:
            print("[VAD] Loading Silero VAD (ONNX backend) ...")
            _vad_model, _vad_utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                trust_repo=True,
                onnx=True,
            )
            print("[VAD] Loaded (ONNX) ✓")
        except Exception as e:
            _vad_failed = True
            _vad_fail_reason = str(e)
            print(f"[VAD] Load failed permanently: {e}")
            raise

    return _vad_model, _vad_utils


def run_vad(pcm_float32: np.ndarray, vad_model=None) -> list:
    """
    Run VAD on a float32 PCM buffer at VAD_SAMPLE_RATE.
    Returns a list of speech segments: [{"start": sec, "end": sec, "audio": np.ndarray}, ...]
    Raises if the model isn't loadable — callers should catch and fall back.
    """
    model, utils = _ensure_loaded()
    get_speech_timestamps = utils[0]

    if len(pcm_float32) == 0:
        return []

    audio_tensor = torch.from_numpy(pcm_float32.astype(np.float32))

    timestamps = get_speech_timestamps(
        audio_tensor,
        model,
        sampling_rate=VAD_SAMPLE_RATE,
        threshold=0.5,
        min_speech_duration_ms=int(MIN_SPEECH_SECS * 1000),
        min_silence_duration_ms=int(SILENCE_THRESHOLD * 1000),
    )

    segments = []
    for ts in timestamps:
        start_idx = ts["start"]
        end_idx   = ts["end"]
        segments.append({
            "start": start_idx / VAD_SAMPLE_RATE,
            "end":   end_idx / VAD_SAMPLE_RATE,
            "audio": pcm_float32[start_idx:end_idx],
        })
    return segments


def has_speech(pcm_float32: np.ndarray, vad_model=None) -> bool:
    """
    Cheap yes/no check — does this buffer contain any detected speech?
    Does NOT trim or modify the audio. Raises if VAD isn't available —
    callers (e.g. ws_handler.py) should catch and fall back to has_audio_energy().
    """
    segments = run_vad(pcm_float32, vad_model)
    return len(segments) > 0


def is_recent_silence(pcm_float32: np.ndarray, vad_model=None, tail_sec: float = 1.0) -> bool:
    """True if the last `tail_sec` seconds of the buffer contain no detected speech."""
    tail_samples = int(tail_sec * VAD_SAMPLE_RATE)
    tail = pcm_float32[-tail_samples:] if len(pcm_float32) > tail_samples else pcm_float32
    return not has_speech(tail, vad_model)
