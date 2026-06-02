"""Voice Activity Detection — wraps Silero VAD."""
import os
import subprocess
import tempfile
from typing import Optional

import numpy as np
import torch

from app.config import (
    VAD_SAMPLE_RATE,
    VAD_WINDOW_FRAMES,
    SILENCE_THRESHOLD,
    MIN_SPEECH_SECS,
)


def _to_vad_tensor(pcm_float32: np.ndarray) -> torch.Tensor:
    """Convert numpy float32 array to float64 tensor for Silero VAD."""
    return torch.from_numpy(pcm_float32.astype(np.float64))


def run_vad(pcm_float32: np.ndarray, vad_model) -> list:
    """
    Run Silero VAD on a float32 PCM array at 16kHz.
    Returns list of speech segments:
      [{"start_sec": float, "end_sec": float, "audio": np.ndarray}, ...]
    """
    vad = vad_model
    vad.reset_states()

    frame_size    = VAD_WINDOW_FRAMES   # 512 samples = 32ms at 16kHz
    speech_thresh = 0.5
    pad_samples   = int(0.2 * VAD_SAMPLE_RATE)   # 200ms padding

    # Ensure float32
    pcm_float32 = pcm_float32.astype(np.float32)

    # Pad audio to multiple of frame_size
    remainder = len(pcm_float32) % frame_size
    if remainder:
        pcm_float32 = np.concatenate([pcm_float32, np.zeros(frame_size - remainder, dtype=np.float32)])

    # Get speech probability for each 32ms frame
    # Convert to float64 (Double) to match VAD model's forward_basis_buffer
    probs = []
    audio_tensor = _to_vad_tensor(pcm_float32)
    for i in range(0, len(pcm_float32), frame_size):
        chunk = audio_tensor[i: i + frame_size]
        if len(chunk) < frame_size:
            break
        prob = vad(chunk, VAD_SAMPLE_RATE).item()
        probs.append(prob)

    if not probs:
        return []

    # Convert frame probabilities → binary mask
    is_speech = np.array([p >= speech_thresh for p in probs])

    # Group consecutive speech frames into segments
    segments  = []
    in_speech = False
    seg_start = 0

    for i, speech in enumerate(is_speech):
        sample_pos = i * frame_size

        if speech and not in_speech:
            seg_start = max(0, sample_pos - pad_samples)
            in_speech = True

        elif not speech and in_speech:
            silence_frames = 0
            for j in range(i, min(i + int(SILENCE_THRESHOLD * VAD_SAMPLE_RATE / frame_size) + 1, len(is_speech))):
                if not is_speech[j]:
                    silence_frames += 1
                else:
                    break

            if silence_frames >= int(SILENCE_THRESHOLD * VAD_SAMPLE_RATE / frame_size):
                seg_end   = min(len(pcm_float32), sample_pos + pad_samples)
                seg_audio = pcm_float32[seg_start:seg_end]
                duration  = len(seg_audio) / VAD_SAMPLE_RATE
                if duration >= MIN_SPEECH_SECS:
                    segments.append({
                        "start_sec": seg_start / VAD_SAMPLE_RATE,
                        "end_sec":   seg_end   / VAD_SAMPLE_RATE,
                        "duration":  round(duration, 3),
                        "audio":     seg_audio,
                    })
                in_speech = False

    # Handle audio that ends while still in speech
    if in_speech:
        seg_audio = pcm_float32[seg_start:]
        duration  = len(seg_audio) / VAD_SAMPLE_RATE
        if duration >= MIN_SPEECH_SECS:
            segments.append({
                "start_sec": seg_start / VAD_SAMPLE_RATE,
                "end_sec":   len(pcm_float32) / VAD_SAMPLE_RATE,
                "duration":  round(duration, 3),
                "audio":     seg_audio,
            })

    return segments


def decode_audio(audio_bytes: bytes, fmt: str = "webm") -> Optional[np.ndarray]:
    in_tmp = tempfile.NamedTemporaryFile(suffix=f".{fmt}", delete=False)
    in_tmp.write(audio_bytes)
    in_tmp.close()
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", in_tmp.name,
             "-ar", str(VAD_SAMPLE_RATE), "-ac", "1", "-f", "f32le", "pipe:1"],
            capture_output=True, timeout=60,
        )
        if r.returncode != 0 or len(r.stdout) < 512:
            return None
        return np.frombuffer(r.stdout, dtype=np.float32).copy()
    except Exception:
        return None
    finally:
        try: os.unlink(in_tmp.name)
        except OSError: pass


def get_ext(filename: str) -> str:
    e = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    return e if e in {"webm", "ogg", "mp4", "wav", "m4a", "mp3"} else "webm"


def has_speech(pcm_float32: np.ndarray, vad_model, min_speech_sec: float = 0.3) -> bool:
    """True iff the window contains at least min_speech_sec of speech."""
    sr         = VAD_SAMPLE_RATE
    frame_size = VAD_WINDOW_FRAMES
    if len(pcm_float32) < frame_size:
        return False

    vad_model.reset_states()
    speech_frames   = 0
    required_frames = max(1, int(min_speech_sec * sr / frame_size))

    # Use float64 for VAD model
    pcm_tensor = _to_vad_tensor(pcm_float32)
    for i in range(0, len(pcm_float32) - frame_size + 1, frame_size):
        chunk = pcm_tensor[i:i + frame_size]
        prob  = vad_model(chunk, sr).item()
        if prob >= 0.5:
            speech_frames += 1
            if speech_frames >= required_frames:
                return True
    return False


def is_recent_silence(pcm_float32: np.ndarray, vad_model,
                      last_n_sec: float = 1.0,
                      threshold_sec: float = 0.7) -> bool:
    """True iff the last last_n_sec of audio contains >= threshold_sec of silence."""
    sr   = VAD_SAMPLE_RATE
    n    = int(last_n_sec * sr)
    tail = pcm_float32[-n:] if len(pcm_float32) > n else pcm_float32
    if len(tail) < VAD_WINDOW_FRAMES:
        return False

    vad_model.reset_states()
    frame_size     = VAD_WINDOW_FRAMES
    silence_frames = 0
    total_frames   = 0

    # Use float64 for VAD model
    tail_tensor = _to_vad_tensor(tail)
    for i in range(0, len(tail) - frame_size + 1, frame_size):
        chunk = tail_tensor[i:i + frame_size]
        prob  = vad_model(chunk, sr).item()
        total_frames += 1
        if prob < 0.5:
            silence_frames += 1

    if total_frames == 0:
        return False
    silence_sec = silence_frames * frame_size / sr
    return silence_sec >= threshold_sec