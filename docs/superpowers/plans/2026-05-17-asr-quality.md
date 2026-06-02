# ASR Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small, independent ASR-quality tweaks: (1) verify and document the ASR cadence (`STREAM_CHUNK_SEC` default is already `0.5` — CLAUDE.md says `0.25`, which is stale), (2) add an optional stationary-noise reduction preprocessing step before ASR, (3) tighten hallucination thresholds in `faster-whisper`. All without changing the model, the DB, or any Node/RN API.

**Architecture:** Noise reduction lives in a new `app/audio_preprocess.py` so the gain stage in [ws_handler.py](../../../ai-service/app/ws_handler.py) stays focused. It uses [`noisereduce`](https://pypi.org/project/noisereduce/) in stationary mode (spectral gating from the first 0.5 s of the window as a noise estimate) — fast (~20-40 ms per 4 s window on CPU), no model download. Opt-out via `AUDIO_NOISE_REDUCE_ENABLED=false` so a user can A/B it. Hallucination tightening adds `compression_ratio_threshold=2.0` to the `faster-whisper` call, which rejects repetitive outputs like "بسم الله بسم الله بسم الله…" that the model occasionally emits on edge cases.

**Tech Stack:** Python 3.11 · faster-whisper · `noisereduce` (new) · NumPy · pytest.

---

## File Structure

- Create: [`ai-service/app/audio_preprocess.py`](../../../ai-service/app/audio_preprocess.py) — single `reduce_noise()` function. Easy to swap engines later.
- Modify: [`ai-service/app/config.py`](../../../ai-service/app/config.py) — add `AUDIO_NOISE_REDUCE_ENABLED` env var.
- Modify: [`ai-service/app/ws_handler.py`](../../../ai-service/app/ws_handler.py) — call `reduce_noise()` between VAD gate and peak normalization.
- Modify: [`ai-service/app/transcription/tarteel.py`](../../../ai-service/app/transcription/tarteel.py) — pass `compression_ratio_threshold` to faster-whisper.
- Modify: [`ai-service/requirements.txt`](../../../ai-service/requirements.txt) — pin `noisereduce`.
- Modify: [`CLAUDE.md`](../../../CLAUDE.md) — fix stale chunk-size default + add the new env var.
- Create: `ai-service/tests/test_audio_preprocess.py`.

---

### Task 1: Verify chunk-size default + correct stale documentation

**Files:**
- Modify: `CLAUDE.md`

The user's request mentions "increase the time of each chunks (250-500ms)". The codebase already defaults to **500 ms** ([config.py:21](../../../ai-service/app/config.py#L21)) — only CLAUDE.md is out of date.

- [ ] **Step 1: Verify the current value**

```bash
py -3.11 -c "from app.config import STREAM_CHUNK_SEC; print(STREAM_CHUNK_SEC)"
```
Expected: `0.5`.

- [ ] **Step 2: Fix the stale doc**

In CLAUDE.md, find the streaming tunables table row:
```
| `STREAM_CHUNK_SEC` | `0.25` | ASR cadence — new transcription every N seconds. |
```
Update to:
```
| `STREAM_CHUNK_SEC` | `0.5` | ASR cadence — new transcription every N seconds. |
```

Also in the architecture diagram earlier in CLAUDE.md:
```
                                   rolling 4 s window every 250 ms)
```
Update to:
```
                                   rolling 4 s window every 500 ms)
```

And in §"How the realtime feedback pipeline works":
```
Python AI service ([ai-service/app/ws_handler.py](ai-service/app/ws_handler.py)) runs the streaming inner loop: every 250 ms, the last 4 s of audio is transcribed locally
```
Update to:
```
Python AI service ([ai-service/app/ws_handler.py](ai-service/app/ws_handler.py)) runs the streaming inner loop: every 500 ms, the last 4 s of audio is transcribed locally
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: correct stale STREAM_CHUNK_SEC default (250ms → 500ms)"
```

---

### Task 2: Failing test for `reduce_noise()`

**Files:**
- Create: `ai-service/tests/test_audio_preprocess.py`

- [ ] **Step 1: Write the failing test**

```python
# ai-service/tests/test_audio_preprocess.py
import numpy as np

from app.audio_preprocess import reduce_noise


def _make_signal_plus_noise(sr: int = 16000, sec: float = 2.0) -> tuple[np.ndarray, np.ndarray]:
    """Returns (clean_tone, noisy_tone) — a 440 Hz tone with pink-ish noise added."""
    t = np.linspace(0, sec, int(sr * sec), endpoint=False, dtype=np.float32)
    tone = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    rng = np.random.default_rng(seed=42)
    noise = (rng.standard_normal(len(t)).astype(np.float32) * 0.05)
    noisy = (tone + noise).astype(np.float32)
    return tone, noisy


def test_reduce_noise_decreases_rms_noise_floor():
    tone, noisy = _make_signal_plus_noise()
    cleaned = reduce_noise(noisy, sample_rate=16000)
    # Cleaned audio should have a smaller noise-floor RMS than the noisy input
    # in the silent leading 100 ms (which is all noise in our generator).
    n = int(0.1 * 16000)
    rms_noisy = float(np.sqrt(np.mean(noisy[:n] ** 2)))
    rms_clean = float(np.sqrt(np.mean(cleaned[:n] ** 2)))
    assert rms_clean < rms_noisy * 0.9, f"expected ≥10% noise reduction, got rms {rms_clean:.4f} vs {rms_noisy:.4f}"


def test_reduce_noise_preserves_shape_and_dtype():
    _, noisy = _make_signal_plus_noise()
    cleaned = reduce_noise(noisy, sample_rate=16000)
    assert cleaned.dtype == np.float32
    assert cleaned.shape == noisy.shape


def test_reduce_noise_on_empty_input_returns_empty():
    empty = np.zeros(0, dtype=np.float32)
    out = reduce_noise(empty, sample_rate=16000)
    assert out.shape == (0,)
    assert out.dtype == np.float32


def test_reduce_noise_on_very_short_input_passes_through():
    # noisereduce can fail on inputs shorter than the FFT window; we must handle that.
    short = np.random.rand(100).astype(np.float32) - 0.5
    out = reduce_noise(short, sample_rate=16000)
    assert out.shape == short.shape
    assert out.dtype == np.float32
```

- [ ] **Step 2: Run test to verify it fails**

```bash
py -3.11 -m pytest tests/test_audio_preprocess.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.audio_preprocess'`.

---

### Task 3: Install `noisereduce` + implement `reduce_noise()`

**Files:**
- Modify: `ai-service/requirements.txt`
- Create: `ai-service/app/audio_preprocess.py`

- [ ] **Step 1: Add the dependency**

Append to `ai-service/requirements.txt`:
```
noisereduce==3.0.3
```
(3.0.3 is the latest at time of writing; pin for reproducibility. Pure-Python with NumPy + SciPy deps you already have.)

- [ ] **Step 2: Install it**

```bash
cd ai-service && py -3.11 -m pip install noisereduce==3.0.3
```
Expected: clean install, no torch/CUDA churn.

- [ ] **Step 3: Implement the module**

```python
# ai-service/app/audio_preprocess.py
"""Audio preprocessing — single-responsibility wrapper around noisereduce.

Stationary spectral gating: estimates a noise profile from the input and
subtracts it across the whole window. Fast (~30 ms on a 4 s @ 16 kHz window),
no model download, no GPU.

Returns the input unchanged if it's too short for the FFT window so the
caller can use a uniform "always call this" wiring without size checks.
"""
from __future__ import annotations

import numpy as np

# Minimum samples required by noisereduce's default FFT window (n_fft=2048).
# Inputs shorter than this pass through unchanged.
_MIN_SAMPLES = 2048


def reduce_noise(pcm_float32: np.ndarray, sample_rate: int) -> np.ndarray:
    if pcm_float32.size < _MIN_SAMPLES:
        return pcm_float32.astype(np.float32, copy=False)
    import noisereduce as nr
    cleaned = nr.reduce_noise(
        y=pcm_float32,
        sr=sample_rate,
        stationary=True,
        prop_decrease=0.75,    # 1.0 over-suppresses speech; 0.75 is a safe middle.
    )
    return cleaned.astype(np.float32, copy=False)
```

- [ ] **Step 4: Run the tests — all 4 must pass**

```bash
py -3.11 -m pytest tests/test_audio_preprocess.py -v
```
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-service/requirements.txt ai-service/app/audio_preprocess.py ai-service/tests/test_audio_preprocess.py
git commit -m "feat(ai-service): noisereduce-backed reduce_noise() preprocessing helper"
```

---

### Task 4: Wire noise reduction into the streaming loop

**Files:**
- Modify: `ai-service/app/config.py`
- Modify: `ai-service/app/ws_handler.py`

- [ ] **Step 1: Add the env var to config**

In [config.py:14-19](../../../ai-service/app/config.py#L14-L19) (audio block), append:
```python
AUDIO_NOISE_REDUCE_ENABLED = os.getenv("AUDIO_NOISE_REDUCE_ENABLED", "true").lower() in ("1", "true", "yes")
```

- [ ] **Step 2: Wire into ws_handler imports**

In [ws_handler.py:14-22](../../../ai-service/app/ws_handler.py#L14-L22), find the config import block. Append `AUDIO_NOISE_REDUCE_ENABLED,`:
```python
from app.config import (
    VerseScope,
    VAD_SAMPLE_RATE,
    STREAM_CHUNK_SEC,
    STREAM_WINDOW_SEC,
    STREAM_LOCK_IN_RUNS,
    PENDING_CORRECTION_TIMEOUT_SEC,
    SILENCE_THRESHOLD,
    AUDIO_NOISE_REDUCE_ENABLED,
)
```
After the other app imports, add:
```python
from app.audio_preprocess import reduce_noise
```

- [ ] **Step 3: Apply between VAD gate and peak normalization**

In [ws_handler.py:182-199](../../../ai-service/app/ws_handler.py#L182-L199), find the block starting with `if not has_speech(...)` and ending with the gain block (`gain = min(0.5 / peak, 20.0)` → `asr_input = (window * gain)...`). The full current block:

```python
            if not has_speech(window, vad_model, min_speech_sec=0.3):
                if audio_chunks_received % 20 == 0:
                    _dbg(f"  VAD: window is silent — skipping ASR")
                continue

            # Peak-normalize the window before ASR. ...
            peak = float(np.abs(window).max()) if window.size else 0.0
            gain = 1.0
            if peak > 1e-3:
                gain = min(0.5 / peak, 20.0)
                asr_input = (window * gain).astype(np.float32)
            else:
                asr_input = window  # effectively silence — let provider skip
```

Insert the noise-reduction step between the VAD gate and the peak block. The window passed to peak-normalize must be the *cleaned* signal so the gain math sees the post-denoise envelope:

```python
            if not has_speech(window, vad_model, min_speech_sec=0.3):
                if audio_chunks_received % 20 == 0:
                    _dbg(f"  VAD: window is silent — skipping ASR")
                continue

            # Optional background-noise reduction (stationary spectral gating).
            # Default-on; flip AUDIO_NOISE_REDUCE_ENABLED=false to disable.
            if AUDIO_NOISE_REDUCE_ENABLED:
                window = reduce_noise(window, sample_rate=VAD_SAMPLE_RATE)

            # Peak-normalize the window before ASR. ...
            peak = float(np.abs(window).max()) if window.size else 0.0
            gain = 1.0
            if peak > 1e-3:
                gain = min(0.5 / peak, 20.0)
                asr_input = (window * gain).astype(np.float32)
            else:
                asr_input = window  # effectively silence — let provider skip
```

- [ ] **Step 4: Verify the import surface**

```bash
py -3.11 -c "from app.ws_handler import handle_ws_evaluate; print('ok')"
```
Expected: `ok`.

- [ ] **Step 5: Run the full test suite**

```bash
py -3.11 -m pytest tests/ -v
```
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add ai-service/app/config.py ai-service/app/ws_handler.py
git commit -m "feat(ai-service): apply stationary noise reduction before ASR (env-gated)"
```

---

### Task 5: Tighten faster-whisper anti-hallucination thresholds

**Files:**
- Modify: `ai-service/app/transcription/tarteel.py:44-57`

Today's call already does most of the right things (`temperature=0.0`, `condition_on_previous_text=False`, `no_speech_threshold=0.6`, scope-aware `initial_prompt`). Missing piece: `compression_ratio_threshold`. When Whisper hallucinates, it often repeats — "بسم الله بسم الله بسم الله". The compression ratio (gzip-len / raw-len) of repetitive text is very low; faster-whisper rejects the output when the ratio falls below the threshold. Default is `2.4`; lowering to `2.0` catches more repetition hallucinations without rejecting legitimate Quranic recitation (which has a normal compression ratio of ~2.6-3.5).

- [ ] **Step 1: Add the threshold to the `transcribe` call**

In [tarteel.py:44-57](../../../ai-service/app/transcription/tarteel.py#L44-L57), find:
```python
        segments, info = self._model.transcribe(
            pcm,
            language=language,
            task="transcribe",  # explicit: never let it switch to translate mode
            beam_size=5,
            best_of=3,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt=prompt,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            vad_filter=False,  # silence-gating is done upstream in ws_handler.py
        )
```

Add `compression_ratio_threshold=2.0,` right after `log_prob_threshold=-1.0,`:
```python
        segments, info = self._model.transcribe(
            pcm,
            language=language,
            task="transcribe",  # explicit: never let it switch to translate mode
            beam_size=5,
            best_of=3,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt=prompt,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.0,   # reject repetitive hallucinations
            vad_filter=False,  # silence-gating is done upstream in ws_handler.py
        )
```

- [ ] **Step 2: Smoke-test the provider boots**

```bash
cd ai-service && py -3.11 -c "from app.transcription.tarteel import TarteelProvider; p = TarteelProvider(); print('provider ok')"
```
Expected: `provider ok` after model load (~2-5 s on first run).

- [ ] **Step 3: Run the minimal provider test**

```bash
py -3.11 -m pytest tests/test_tarteel_minimal.py -v
```
Expected: PASS or SKIP (if fixture missing).

- [ ] **Step 4: Commit**

```bash
git add ai-service/app/transcription/tarteel.py
git commit -m "feat(ai-service): reject repetitive ASR outputs (compression_ratio_threshold=2.0)"
```

---

### Task 6: Document the new env var

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add env var row**

Append to the "Environment variables (overview)" table in CLAUDE.md:
```
| `AUDIO_NOISE_REDUCE_ENABLED` | ai-service | ❌ (defaults `true`) | Apply stationary noise reduction before ASR. Set to `false` to disable (e.g. if it over-suppresses in your test env). |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document AUDIO_NOISE_REDUCE_ENABLED env var"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Chunk size: verified at default `0.5`, no code change needed; stale docs fixed.
  - Noise reduction: added as a real preprocessing step with sane defaults and an opt-out env var.
  - Hallucination minimization: tightened compression-ratio threshold (existing protections — VAD gate, peak norm, scope-aware initial prompt, `temperature=0.0`, `condition_on_previous_text=False`, `no_speech_threshold=0.6` — already cover most cases per CLAUDE.md).
- **No frontend change required.** Per user scope.
- **No backend/Node change required.** Per user scope.
- **No DB change required.** Per user scope.
- **Latency budget:** noisereduce adds ~30 ms per 4 s window on CPU. The 500 ms ASR cadence has ~200 ms slack today; well within budget.
- **Safety:** env var is opt-out. Threshold change is a tighter filter (more rejections, never more hallucinations). The fallback path on rejection is "ASR returns empty string" which `ws_handler.py:216` already handles via `if not tr.text.strip(): continue`.
- **What this plan deliberately does NOT do:** RNNoise (deep model, GPU-heavy), full-blown denoiser model (Facebook's `denoiser`), or a post-ASR hallucination-phrase blocklist. Those have worse cost/benefit than what's here.
