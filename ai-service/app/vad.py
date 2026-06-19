"""Voice Activity Detection — Silero VAD via ONNX backend.

Using onnx=True avoids the TorchScript "expected scalar type Double but found Float"
crash that occurs with the default JIT-compiled model on some PyTorch/Windows setups.
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


def _ensure_loaded():
    global _vad_model, _vad_utils
    if _vad_model is None:
        print("[VAD] Loading Silero VAD (ONNX backend) ...")
        _vad_model, _vad_utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            trust_repo=True,
            onnx=True,
        )
        print("[VAD] Loaded (ONNX) ✓")
    return _vad_model, _vad_utils


def run_vad(pcm_float32: np.ndarray, vad_model=None) -> list:
    """
    Returns list of speech segments as dicts: {"start": sec, "end": sec, "audio": np.ndarray}
    """
    model, utils = _ensure_loaded()
    get_speech_timestamps = utils[0]

    if len(pcm_float32) == 0:
        return []

    audio_tensor = torch.from_numpy(pcm_float32.astype(np.float32))

    try:
        timestamps = get_speech_timestamps(
            audio_tensor,
            model,
            sampling_rate=VAD_SAMPLE_RATE,
            threshold=0.5,
            min_speech_duration_ms=int(MIN_SPEECH_SECS * 1000),
            min_silence_duration_ms=int(SILENCE_THRESHOLD * 1000),
        )
    except Exception as e:
        print(f"[VAD] error: {e} — falling back to treating whole buffer as speech")
        return [{
            "start": 0,
            "end":   len(pcm_float32) / VAD_SAMPLE_RATE,
            "audio": pcm_float32,
        }]

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
    segments = run_vad(pcm_float32, vad_model)
    return len(segments) > 0


def is_recent_silence(pcm_float32: np.ndarray, vad_model=None, tail_sec: float = 1.0) -> bool:
    tail_samples = int(tail_sec * VAD_SAMPLE_RATE)
    tail = pcm_float32[-tail_samples:] if len(pcm_float32) > tail_samples else pcm_float32
    return not has_speech(tail, vad_model)