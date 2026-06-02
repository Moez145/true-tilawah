# Streaming Tarteel Recitation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Groq-per-utterance recitation pipeline with a local streaming pipeline using `tarteel-ai/whisper-base-ar-quran` via `faster-whisper`, emit per-word `partial_mistake` / `word_corrected` / `mistake_acknowledged` events mid-recitation, render words individually on the frontend, play TTS corrections from EveryAyah CDN, and deploy the AI service to a free Hugging Face Space.

**Architecture:** Python streaming inner loop transcribes a rolling 4 s window every 250 ms, locks in words across ≥2 stable ASR runs, runs per-word diff + tajweed, and drives a small per-mistake state machine that handles "user re-reads / user moves on / user is silent." Node relays events; only `ayah_finalized` writes `Feedback` rows. Frontend renders ayahs word-by-word and queues short TTS clips fetched directly from EveryAyah.

**Tech Stack:** Python 3.11 + FastAPI + faster-whisper (CTranslate2 int8) + Silero VAD + pyarabic + RapidFuzz + regex (PyPI); Node.js + Express + ws + Prisma/MySQL (existing, minimal change); React Native + Expo + expo-av + Zustand (new dep) + expo-file-system; pytest, Hugging Face Spaces (Docker SDK, CPU Basic), Cloudflare Tunnel.

**Spec reference:** [`docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md`](../specs/2026-05-12-streaming-tarteel-design.md)

---

## Parallelization map

Four tracks. Track A's first three phases (P1–P3) must complete before P5–P6. Tracks B, C, D can each start once Track A reaches P6.

```
Track A (Python):    P1 → P2 → P3 → P4 → P5 → P6 ────────┐
                                                          │
Track B (Node):      ─────────────────────────────────── P7
Track C (Frontend):  ─────────────────────────────────── P8 → P9
Track D (Deploy):    ─────────────────────────────────────────── P10
```

Total: 28 tasks across 10 phases.

---

## Prerequisites (humans only — do once)

- [ ] Confirm Python 3.11 is on PATH (`py -3.11 --version` on Windows, `python3.11 --version` on macOS/Linux).
- [ ] Confirm `ffmpeg` is on PATH (existing requirement).
- [ ] Sign up at [huggingface.co](https://huggingface.co); generate a User Access Token with `read` scope (for model download during `convert_tarteel_model.py`).
- [ ] In `ai-service/.env`, add `HF_TOKEN=<your token>` (used only by the conversion script).
- [ ] Generate a 32-byte random hex token: `python -c "import secrets; print(secrets.token_hex(32))"`. Save as `AI_SERVICE_AUTH_TOKEN` for §P10.

---

## File structure

### New files (Python)
```
ai-service/
├── app/
│   ├── arabic_norm.py
│   ├── streaming_buffer.py
│   ├── tts_resolver.py
│   ├── auth.py
│   └── transcription/
│       └── tarteel.py
├── scripts/
│   ├── convert_tarteel_model.py
│   └── build_word_timing_index.py
├── data/
│   └── word_timings.json        (generated; gitignored)
├── models/
│   └── tarteel-ct2/             (generated; gitignored)
├── tests/
│   ├── fixtures/
│   │   └── al-baqarah-23.wav    (manually placed; 16 kHz mono)
│   ├── test_arabic_norm.py
│   ├── test_streaming_buffer.py
│   ├── test_stable_tracker.py
│   ├── test_align_partial.py
│   ├── test_mistake_state_machine.py
│   ├── test_tts_resolver.py
│   ├── test_auth.py
│   └── test_ws_handler_streaming.py
```

### Modified files (Python)
```
ai-service/
├── app/
│   ├── config.py
│   ├── lifespan.py
│   ├── vad.py
│   ├── ayah_aligner.py
│   ├── word_diff.py
│   ├── pipeline.py
│   ├── ws_handler.py
│   └── transcription/__init__.py
├── requirements-local-whisper.txt
├── Dockerfile
└── .env.example
```

### Modified files (Node)
```
backend/
├── src/
│   ├── routes/audio.ws.js
│   └── services/ai.service.js
└── .env.example
```

### New files (Frontend)
```
frontend/
└── src/
    └── services/
        ├── wordStateStore.js
        ├── ttsQueueService.js
        └── wordAudioPrefetch.js
```

### Modified files (Frontend)
```
frontend/
└── src/
    ├── screens/ReciteScreen.js
    ├── services/audioStreamService.js
    └── constants/colors.js
```

### Untouched (do not modify)
- All other backend REST routes, services, prisma schema, middleware
- All other frontend screens, navigation, contexts, components
- `ai-service/app/transcription/groq.py` (kept as dead fallback code)
- `ai-service/app/transcription/local_whisper.py` (kept; deprecated)

---

# Phase P1 — Tarteel Provider (Track A)

**Outcome:** `tests/test_tarteel_minimal.py` transcribes a fixture WAV and returns a non-empty Arabic string.

### Task 1: Model conversion script

**Files:**
- Create: `ai-service/scripts/__init__.py` (empty)
- Create: `ai-service/scripts/convert_tarteel_model.py`
- Modify: `ai-service/requirements-local-whisper.txt`
- Modify: `ai-service/.gitignore` (or create if missing) — add `models/` and `data/`

- [ ] **Step 1: Update requirements**

Replace contents of `ai-service/requirements-local-whisper.txt`:

```
# Required when TRANSCRIPTION_PROVIDER=tarteel or local_whisper
# Install on top of requirements.txt:
#   pip install -r requirements.txt -r requirements-local-whisper.txt
faster-whisper==1.0.3
ctranslate2>=4.4.0,<5
transformers>=4.39.0,<5
huggingface-hub>=0.23.0
pyarabic==0.6.15
regex==2024.5.15
gTTS==2.5.1
```

- [ ] **Step 2: Install deps**

Run: `cd ai-service && py -3.11 -m pip install -r requirements.txt -r requirements-local-whisper.txt`
Expected: all installs succeed.

- [ ] **Step 3: Write conversion script**

Create `ai-service/scripts/convert_tarteel_model.py`:

```python
"""One-time conversion of tarteel-ai/whisper-base-ar-quran HF model → CTranslate2 int8.

Run: py -3.11 -m scripts.convert_tarteel_model
Idempotent: skips if ./models/tarteel-ct2/model.bin already exists.
"""
import os
import sys
from pathlib import Path

MODEL_ID = "tarteel-ai/whisper-base-ar-quran"
OUT_DIR = Path(__file__).resolve().parent.parent / "models" / "tarteel-ct2"


def main() -> int:
    if (OUT_DIR / "model.bin").exists():
        print(f"[skip] {OUT_DIR} already exists")
        return 0

    try:
        from ctranslate2.converters.transformers import TransformersConverter
    except ImportError:
        print("ctranslate2 not installed; run pip install -r requirements-local-whisper.txt", file=sys.stderr)
        return 1

    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    print(f"[convert] {MODEL_ID} → {OUT_DIR} (int8)")
    converter = TransformersConverter(MODEL_ID)
    converter.convert(str(OUT_DIR), quantization="int8", force=False)
    print("[done]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Create gitignore additions**

Append to `ai-service/.gitignore` (create if missing):

```
models/
data/
*.wav
!tests/fixtures/*.wav
```

- [ ] **Step 5: Run the converter**

Run: `cd ai-service && py -3.11 -m scripts.convert_tarteel_model`
Expected: prints `[convert] ...` then `[done]`; `ai-service/models/tarteel-ct2/model.bin` exists (~80 MB).

- [ ] **Step 6: Commit**

```bash
git add ai-service/scripts/convert_tarteel_model.py ai-service/scripts/__init__.py ai-service/requirements-local-whisper.txt ai-service/.gitignore
git commit -m "feat(ai-service): add Tarteel HF→CT2 model conversion script"
```

---

### Task 2: TarteelProvider (faster-whisper)

**Files:**
- Create: `ai-service/app/transcription/tarteel.py`
- Modify: `ai-service/app/transcription/__init__.py`
- Modify: `ai-service/app/config.py`
- Create: `ai-service/tests/test_tarteel_minimal.py`

- [ ] **Step 1: Add new config keys**

Replace `ai-service/app/config.py` body (preserve existing imports/dotenv block at top, append new constants):

```python
"""Centralised env + constants — every other module imports from here."""
import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
    _ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    if _ENV_PATH.exists():
        load_dotenv(_ENV_PATH, override=True)
except ImportError:
    pass

# ── Audio / VAD ────────────────────────────────────────────────
VAD_SAMPLE_RATE   = 16000
VAD_WINDOW_FRAMES = 512
SILENCE_THRESHOLD = float(os.getenv("VAD_SILENCE_THRESHOLD_SEC", "0.7"))
MIN_SPEECH_SECS   = float(os.getenv("VAD_MIN_SPEECH_SEC", "0.5"))

# ── Streaming ──────────────────────────────────────────────────
STREAM_CHUNK_SEC               = float(os.getenv("STREAM_CHUNK_SEC", "0.25"))
STREAM_WINDOW_SEC              = float(os.getenv("STREAM_WINDOW_SEC", "4.0"))
STREAM_LOCK_IN_RUNS            = int(os.getenv("STREAM_LOCK_IN_RUNS", "2"))
PENDING_CORRECTION_TIMEOUT_SEC = float(os.getenv("PENDING_CORRECTION_TIMEOUT_SEC", "2.0"))

# ── Transcription ──────────────────────────────────────────────
TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "tarteel")
GROQ_API_KEY           = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL             = os.getenv("GROQ_MODEL", "whisper-large-v3")
WHISPER_MODEL          = os.getenv("WHISPER_MODEL", "medium")
WHISPER_MODEL_PATH     = os.getenv("WHISPER_MODEL_PATH", str(Path(__file__).resolve().parent.parent / "models" / "tarteel-ct2"))

# ── TTS ─────────────────────────────────────────────────────────
TTS_AUDIO_BASE_URL          = os.getenv("TTS_AUDIO_BASE_URL", "https://everyayah.com/data/Husary_64kbps")
TTS_WORD_TIMING_INDEX_PATH  = os.getenv("TTS_WORD_TIMING_INDEX_PATH", str(Path(__file__).resolve().parent.parent / "data" / "word_timings.json"))

# ── Auth ────────────────────────────────────────────────────────
AI_SERVICE_AUTH_TOKEN = os.getenv("AI_SERVICE_AUTH_TOKEN", "")


@dataclass(frozen=True)
class VerseScope:
    surah_id: int
    ayah_start: int
    ayah_end: int
```

- [ ] **Step 2: Place fixture WAV**

Manually copy a known-good 16 kHz mono WAV recitation of Al-Baqarah ayah 23 to `ai-service/tests/fixtures/al-baqarah-23.wav`. (You can record yourself reading the ayah, or extract one from an existing dataset. The test only requires non-empty Arabic output, so any clean recitation of any ayah works to bootstrap.)

If no fixture is available, create one with `ffmpeg`:
```
ffmpeg -f lavfi -i "sine=frequency=200:duration=3" -ar 16000 -ac 1 tests/fixtures/al-baqarah-23.wav
```
(this will produce empty transcript and the test will skip — that's acceptable for now; replace later).

- [ ] **Step 3: Write failing test**

Create `ai-service/tests/test_tarteel_minimal.py`:

```python
import wave
from pathlib import Path

import numpy as np
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "al-baqarah-23.wav"


def _load_wav_float32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getframerate() == 16000
        frames = w.readframes(w.getnframes())
    pcm_int16 = np.frombuffer(frames, dtype=np.int16)
    return (pcm_int16.astype(np.float32) / 32768.0).copy()


@pytest.mark.asyncio
async def test_tarteel_transcribes_arabic():
    if not FIXTURE.exists():
        pytest.skip("fixture WAV not present")
    from app.transcription.tarteel import TarteelProvider
    provider = TarteelProvider()
    pcm = _load_wav_float32(FIXTURE)
    result = await provider.transcribe(pcm)
    # Tarteel may return empty for a silence-only fixture — we only assert it
    # returns a string (not None) and (when there's speech) contains Arabic.
    assert isinstance(result.text, str)
    if len(pcm) / 16000 >= 1.0 and pcm.std() > 0.01:
        # Real recitation → expect Arabic letters
        has_arabic = any("؀" <= ch <= "ۿ" for ch in result.text)
        assert has_arabic, f"no Arabic in output: {result.text!r}"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ai-service && py -3.11 -m pytest tests/test_tarteel_minimal.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.transcription.tarteel'`.

- [ ] **Step 5: Implement TarteelProvider**

Create `ai-service/app/transcription/tarteel.py`:

```python
"""Tarteel provider — faster-whisper with the Quranic fine-tune."""
import asyncio
from typing import Optional

import numpy as np

from .base import TranscriptionProvider, TranscriptionResult
from app.config import WHISPER_MODEL_PATH


class TarteelProvider(TranscriptionProvider):
    def __init__(self, model_path: str = WHISPER_MODEL_PATH):
        from faster_whisper import WhisperModel
        # int8 on CPU is the free-tier sweet spot; auto-promotes to float16 on GPU.
        try:
            import torch
            use_gpu = torch.cuda.is_available()
        except ImportError:
            use_gpu = False
        device = "cuda" if use_gpu else "cpu"
        compute_type = "float16" if use_gpu else "int8"
        self._model = WhisperModel(model_path, device=device, compute_type=compute_type)
        self._initial_prompt = "بسم الله الرحمن الرحيم"

    async def transcribe(self, pcm_float32: np.ndarray, language: str = "ar") -> TranscriptionResult:
        # faster-whisper is synchronous; run in default executor to avoid blocking
        # the asyncio event loop. Tarteel-base on a 4 s window finishes in ~200-400 ms.
        return await asyncio.get_event_loop().run_in_executor(
            None, self._sync_transcribe, pcm_float32, language
        )

    def _sync_transcribe(self, pcm: np.ndarray, language: str) -> TranscriptionResult:
        segments, info = self._model.transcribe(
            pcm,
            language=language,
            beam_size=5,
            best_of=3,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt=self._initial_prompt,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            vad_filter=False,  # we run VAD upstream
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return TranscriptionResult(text=text, confidence=None, raw={"language": info.language})
```

- [ ] **Step 6: Update transcription provider factory**

Read current `ai-service/app/transcription/__init__.py` first. Add `tarteel` branch.

If the file has a `get_provider()` function that switches on `TRANSCRIPTION_PROVIDER`, add an `elif name == "tarteel": from .tarteel import TarteelProvider; return TarteelProvider()` branch. If unsure of current shape, replace the file with:

```python
from app.config import TRANSCRIPTION_PROVIDER, GROQ_API_KEY


def get_provider():
    name = (TRANSCRIPTION_PROVIDER or "tarteel").lower()
    if name == "groq":
        from .groq import GroqProvider
        return GroqProvider(api_key=GROQ_API_KEY)
    if name == "tarteel":
        from .tarteel import TarteelProvider
        return TarteelProvider()
    if name == "local_whisper":
        from .local_whisper import LocalWhisperProvider
        return LocalWhisperProvider()
    raise ValueError(f"Unknown TRANSCRIPTION_PROVIDER={name!r}")
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd ai-service && py -3.11 -m pytest tests/test_tarteel_minimal.py -v`
Expected: PASS (or SKIPPED if you used the synthetic sine fixture — replace the fixture with a real recitation when available; the test asserts the *shape*, not the content, when the audio is silent).

- [ ] **Step 8: Commit**

```bash
git add ai-service/app/transcription/tarteel.py ai-service/app/transcription/__init__.py ai-service/app/config.py ai-service/tests/test_tarteel_minimal.py ai-service/tests/fixtures/al-baqarah-23.wav
git commit -m "feat(ai-service): add TarteelProvider via faster-whisper"
```

---

### Task 3: Wire TarteelProvider into lifespan

**Files:**
- Modify: `ai-service/app/lifespan.py`

- [ ] **Step 1: Replace lifespan provider load**

Replace the body of the `lifespan` function in `ai-service/app/lifespan.py`. Current load comment `print("[Startup] Initialising transcription provider ...")` stays; the call beneath is now provider-agnostic via the factory and already handles `tarteel`. No code change is needed if `get_provider()` was extended in Task 2 Step 6. Verify by running:

Run: `cd ai-service && py -3.11 -c "from app.lifespan import STATE; from app.transcription import get_provider; p = get_provider(); print(type(p).__name__)"`
Expected: prints `TarteelProvider`.

- [ ] **Step 2: Commit (if any change was needed)**

```bash
git add ai-service/app/lifespan.py
git commit -m "feat(ai-service): default lifespan provider to Tarteel" || echo "nothing to commit"
```

---

# Phase P2 — Streaming buffer + Stable tracker (Track A)

### Task 4: RollingBuffer

**Files:**
- Create: `ai-service/app/streaming_buffer.py`
- Create: `ai-service/tests/test_streaming_buffer.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_streaming_buffer.py`:

```python
import numpy as np

from app.streaming_buffer import RollingBuffer


def test_append_and_window():
    rb = RollingBuffer(sample_rate=16000, window_sec=2.0)
    rb.append(np.ones(16000, dtype=np.float32))   # 1 s
    rb.append(np.ones(16000, dtype=np.float32))   # 1 s total = 2 s
    window = rb.window()
    assert window.shape == (32000,)
    assert window.dtype == np.float32


def test_window_caps_to_window_sec_plus_tail():
    rb = RollingBuffer(sample_rate=16000, window_sec=2.0, max_extra_sec=1.0)
    rb.append(np.ones(16000 * 5, dtype=np.float32))   # 5 s
    window = rb.window()
    # max retained = (2 + 1) s = 48000 samples
    assert len(window) == 48000
    # window() must return the most recent 2 s slice
    assert len(rb.recent(2.0)) == 32000


def test_recent_short_buffer_returns_all():
    rb = RollingBuffer(sample_rate=16000, window_sec=2.0)
    rb.append(np.ones(8000, dtype=np.float32))   # 0.5 s
    assert len(rb.recent(2.0)) == 8000
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_streaming_buffer.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement RollingBuffer**

Create `ai-service/app/streaming_buffer.py`:

```python
"""Rolling audio buffer + word-level stability tracker for streaming ASR."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from app.arabic_norm import canonical  # noqa: F401  imported lazily by callers; see Task 7


class RollingBuffer:
    """Append-only float32 PCM buffer with a windowed read view.

    Memory is capped to `window_sec + max_extra_sec` to bound RAM.
    """

    def __init__(self, sample_rate: int, window_sec: float, max_extra_sec: float = 1.0):
        self.sr = sample_rate
        self.window_sec = window_sec
        self.max_samples = int((window_sec + max_extra_sec) * sample_rate)
        self._buf = np.zeros(0, dtype=np.float32)

    def append(self, chunk: np.ndarray) -> None:
        if chunk.dtype != np.float32:
            chunk = chunk.astype(np.float32)
        self._buf = np.concatenate([self._buf, chunk])
        if len(self._buf) > self.max_samples:
            self._buf = self._buf[-self.max_samples:]

    def window(self) -> np.ndarray:
        return self.recent(self.window_sec)

    def recent(self, sec: float) -> np.ndarray:
        n = int(sec * self.sr)
        if len(self._buf) <= n:
            return self._buf.copy()
        return self._buf[-n:].copy()

    def __len__(self) -> int:
        return len(self._buf)
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_streaming_buffer.py -v`
Expected: PASS (3 tests).

Note: the `from app.arabic_norm import canonical` import will fail because arabic_norm doesn't exist yet. Either (a) remove that import line for now and add it back after Task 7, or (b) create a stub `arabic_norm.py` immediately:

```python
# Stub — replaced in Task 7
def canonical(s: str) -> str: return s
```

Choose (b) so this test can pass in isolation.

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/streaming_buffer.py ai-service/app/arabic_norm.py ai-service/tests/test_streaming_buffer.py
git commit -m "feat(ai-service): add RollingBuffer for streaming ASR"
```

---

### Task 5: StableTracker

**Files:**
- Modify: `ai-service/app/streaming_buffer.py`
- Create: `ai-service/tests/test_stable_tracker.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_stable_tracker.py`:

```python
from app.streaming_buffer import StableTracker


def test_first_transcript_locks_nothing():
    t = StableTracker(lock_in_runs=2)
    locked = t.feed("بسم الله")
    assert locked == []


def test_two_consecutive_same_locks_all_but_tail():
    t = StableTracker(lock_in_runs=2)
    t.feed("بسم الله")
    locked = t.feed("بسم الله الرحمن")
    # "بسم" is locked (same at pos 0 in both, not the tail of run 2)
    # "الله" is locked (same at pos 1 in both, not the tail of run 2)
    # "الرحمن" is the trailing tentative word → NOT locked yet
    assert [w.text for w in locked] == ["بسم", "الله"]
    assert [w.position for w in locked] == [0, 1]


def test_word_locks_only_once():
    t = StableTracker(lock_in_runs=2)
    t.feed("بسم الله")
    t.feed("بسم الله الرحمن")
    locked = t.feed("بسم الله الرحمن الرحيم")
    # Now "الرحمن" locks (was tail before, now at pos 2 in both run 2 and run 3)
    # "بسم" / "الله" already emitted → must NOT re-emit
    assert [w.text for w in locked] == ["الرحمن"]


def test_change_in_locked_position_does_not_unlock():
    """If a future transcript edits an already-locked word, ignore it."""
    t = StableTracker(lock_in_runs=2)
    t.feed("بسم الله")
    t.feed("بسم الله الرحمن")
    locked = t.feed("بسم اللهم الرحمن الرحيم")  # whisper revised pos 1 — ignore
    # Already-locked positions are immutable; only NEW locks emitted.
    # "الرحمن" locks now (pos 2 stable across run 2 and run 3).
    assert [w.position for w in locked] == [2]


def test_reset():
    t = StableTracker(lock_in_runs=2)
    t.feed("بسم الله")
    t.feed("بسم الله الرحمن")
    t.reset()
    locked = t.feed("سورة")
    assert locked == []
    assert t.current_locked() == []
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_stable_tracker.py -v`
Expected: FAIL with `ImportError: cannot import name 'StableTracker'`.

- [ ] **Step 3: Append StableTracker to streaming_buffer.py**

Append to `ai-service/app/streaming_buffer.py`:

```python
@dataclass(frozen=True)
class LockedWord:
    position: int     # 0-based index in the transcript
    text: str         # normalised form (canonical())


class StableTracker:
    """Locks words that appear at the same position across N consecutive runs."""

    def __init__(self, lock_in_runs: int = 2):
        assert lock_in_runs >= 2, "lock_in_runs must be >= 2"
        self.lock_in_runs = lock_in_runs
        self._prev_runs: list[list[str]] = []
        self._locked: dict[int, str] = {}  # position -> normalised word

    def feed(self, transcript: str) -> list[LockedWord]:
        words = [canonical(w) for w in transcript.split() if w.strip()]
        self._prev_runs.append(words)
        if len(self._prev_runs) > self.lock_in_runs:
            self._prev_runs.pop(0)
        if len(self._prev_runs) < self.lock_in_runs:
            return []

        newly: list[LockedWord] = []
        # Consider all positions EXCEPT the tail of the most recent transcript
        # (the tail is tentative — give it one more run to confirm).
        latest = self._prev_runs[-1]
        candidate_positions = range(len(latest) - 1)
        for pos in candidate_positions:
            if pos in self._locked:
                continue
            # All runs must agree at this position
            if all(pos < len(run) and run[pos] == latest[pos] for run in self._prev_runs):
                self._locked[pos] = latest[pos]
                newly.append(LockedWord(position=pos, text=latest[pos]))
        return newly

    def current_locked(self) -> list[str]:
        return [self._locked[p] for p in sorted(self._locked)]

    def reset(self) -> None:
        self._prev_runs.clear()
        self._locked.clear()
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_stable_tracker.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/streaming_buffer.py ai-service/tests/test_stable_tracker.py
git commit -m "feat(ai-service): add StableTracker for word lock-in"
```

---

### Task 6: VAD recent-silence helper

**Files:**
- Modify: `ai-service/app/vad.py`
- Modify: `ai-service/tests/` (extend an existing test or add new)

- [ ] **Step 1: Write failing test**

Append to a new `ai-service/tests/test_vad_silence.py`:

```python
import numpy as np

from app.vad import is_recent_silence


class _FakeVad:
    """Probabilistic VAD stand-in: returns p=1.0 for non-zero frames, p=0.0 for zero frames."""

    def reset_states(self): pass

    def __call__(self, chunk_tensor, sr):
        import torch
        chunk = chunk_tensor.numpy()
        p = 1.0 if np.abs(chunk).mean() > 1e-6 else 0.0
        class _R:
            def item(self_): return p
        return _R()


def test_returns_true_when_recent_tail_is_silent():
    sr = 16000
    speech = np.ones(sr * 2, dtype=np.float32)
    silence = np.zeros(int(sr * 0.8), dtype=np.float32)
    buf = np.concatenate([speech, silence])
    assert is_recent_silence(buf, _FakeVad(), last_n_sec=1.0, threshold_sec=0.7) is True


def test_returns_false_when_recent_tail_has_speech():
    sr = 16000
    speech = np.ones(sr * 2, dtype=np.float32)
    buf = speech
    assert is_recent_silence(buf, _FakeVad(), last_n_sec=1.0, threshold_sec=0.7) is False
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_vad_silence.py -v`
Expected: FAIL with `ImportError: cannot import name 'is_recent_silence'`.

- [ ] **Step 3: Append helper to vad.py**

Append to `ai-service/app/vad.py`:

```python
def is_recent_silence(pcm_float32: np.ndarray, vad_model, last_n_sec: float = 1.0,
                     threshold_sec: float = 0.7) -> bool:
    """True iff the last `last_n_sec` of audio contains ≥ `threshold_sec` of silence.

    Cheap check used to detect ayah-end pauses. Operates on the recent tail only
    so it's bounded regardless of total recording length.
    """
    sr = VAD_SAMPLE_RATE
    n = int(last_n_sec * sr)
    tail = pcm_float32[-n:] if len(pcm_float32) > n else pcm_float32
    if len(tail) < VAD_WINDOW_FRAMES:
        return False

    vad_model.reset_states()
    frame_size = VAD_WINDOW_FRAMES
    silence_frames = 0
    total_frames = 0
    tail_tensor = torch.from_numpy(tail)
    for i in range(0, len(tail) - frame_size + 1, frame_size):
        chunk = tail_tensor[i:i + frame_size]
        prob = vad_model(chunk, sr).item()
        total_frames += 1
        if prob < 0.5:
            silence_frames += 1
    if total_frames == 0:
        return False
    silence_sec = silence_frames * frame_size / sr
    return silence_sec >= threshold_sec
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_vad_silence.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/vad.py ai-service/tests/test_vad_silence.py
git commit -m "feat(ai-service): add is_recent_silence VAD helper for ayah-end detection"
```

---

# Phase P3 — Arabic normalisation, partial aligner, per-word diff (Track A)

### Task 7: Arabic normaliser (pyarabic)

**Files:**
- Modify: `ai-service/app/arabic_norm.py` (replace stub from Task 4)
- Create: `ai-service/tests/test_arabic_norm.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_arabic_norm.py`:

```python
from app.arabic_norm import canonical, strip_diacritics


def test_strip_tashkeel():
    assert strip_diacritics("الرَّحْمَٰنِ") == "الرحمن"


def test_canonical_strips_tashkeel_and_normalises_alef():
    assert canonical("أَلْحَمْدُ") == canonical("الحمد") == "الحمد"


def test_canonical_normalises_ya_variants():
    assert canonical("على") == canonical("علي")


def test_canonical_handles_hamza_wasl():
    # ٱ (U+0671) ↔ ا (U+0627)
    assert canonical("ٱلحمد") == canonical("الحمد")


def test_canonical_strips_tatweel():
    assert canonical("ابــــا") == canonical("ابا")


def test_canonical_lowercases_latin_safely():
    # mixed input shouldn't crash
    assert isinstance(canonical("hello"), str)
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_arabic_norm.py -v`
Expected: FAIL — current `arabic_norm.py` is the stub.

- [ ] **Step 3: Replace stub with real implementation**

Replace `ai-service/app/arabic_norm.py`:

```python
"""Arabic text normalisation for matching ASR output against canonical Quranic text."""
import re

import pyarabic.araby as araby

# Characters mapped to a canonical form (or removed)
_TATWEEL = "ـ"
_HAMZA_WASL = "ٱ"
_ALEF_VARIANTS = "أإآٱ"   # أ إ آ ٱ → ا
_YA_VARIANTS = "ى"                       # ى → ي
_TA_MARBUTA = "ة"                        # ة → ه

_RE_NON_ARABIC = re.compile(r"[^؀-ۿ\s]+")


def strip_diacritics(text: str) -> str:
    """Remove all tashkeel/diacritics; keep base letters."""
    return araby.strip_tashkeel(text)


def canonical(text: str) -> str:
    """Normalise for matching: strip tashkeel, unify Alef/Ya, drop tatweel, lower-case Latin."""
    if not text:
        return ""
    s = strip_diacritics(text)
    s = s.replace(_TATWEEL, "")
    # Normalise Alef / Hamza-Wasl variants
    for ch in _ALEF_VARIANTS:
        s = s.replace(ch, "ا")
    # Normalise Alef Maksura → Ya
    s = s.replace(_YA_VARIANTS, "ي")
    # Normalise Ta Marbuta → Ha (a common ASR ambiguity)
    s = s.replace(_TA_MARBUTA, "ه")
    s = s.lower().strip()
    return s
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_arabic_norm.py tests/test_streaming_buffer.py tests/test_stable_tracker.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/arabic_norm.py ai-service/tests/test_arabic_norm.py
git commit -m "feat(ai-service): replace arabic_norm stub with pyarabic-backed canonical()"
```

---

### Task 8: align_partial on ScopedAligner

**Files:**
- Modify: `ai-service/app/ayah_aligner.py`
- Create: `ai-service/tests/test_align_partial.py`

- [ ] **Step 1: Inspect current ayah_aligner.py**

Run: `cd ai-service && py -3.11 -c "from app.ayah_aligner import ScopedAligner; help(ScopedAligner)"`
Expected: prints class signature. Note the constructor params.

- [ ] **Step 2: Write failing test**

Create `ai-service/tests/test_align_partial.py`:

```python
import pytest

from app.config import VerseScope


@pytest.fixture
def fake_quran():
    # Minimal Quran-like dict: {surah_id: {ayah_num: "text"}}
    return {
        2: {
            23: "وإن كنتم في ريب مما نزلنا على عبدنا فأتوا بسورة من مثله",
            24: "فإن لم تفعلوا ولن تفعلوا فاتقوا النار التي وقودها الناس والحجارة",
            25: "وبشر الذين آمنوا وعملوا الصالحات أن لهم جنات",
        }
    }


def test_align_partial_requires_three_matching_words(fake_quran):
    from app.ayah_aligner import ScopedAligner
    scope = VerseScope(surah_id=2, ayah_start=23, ayah_end=25)
    a = ScopedAligner(scope, fake_quran)
    # Only 2 words → no anchor yet
    anchor = a.align_partial(["وإن", "كنتم"], last_anchor=None)
    assert anchor is None


def test_align_partial_anchors_after_three_words(fake_quran):
    from app.ayah_aligner import ScopedAligner
    scope = VerseScope(surah_id=2, ayah_start=23, ayah_end=25)
    a = ScopedAligner(scope, fake_quran)
    anchor = a.align_partial(["وإن", "كنتم", "في"], last_anchor=None)
    assert anchor is not None
    assert anchor.ayah == 23
    assert anchor.position == 3   # next expected position


def test_align_partial_advances_position_with_anchor(fake_quran):
    from app.ayah_aligner import ScopedAligner, AyahAnchor
    scope = VerseScope(surah_id=2, ayah_start=23, ayah_end=25)
    a = ScopedAligner(scope, fake_quran)
    last = AyahAnchor(ayah=23, position=3, score=95.0)
    anchor = a.align_partial(["وإن", "كنتم", "في", "ريب"], last_anchor=last)
    assert anchor is not None
    assert anchor.ayah == 23
    assert anchor.position == 4


def test_align_partial_invalidates_on_large_score_drop(fake_quran):
    from app.ayah_aligner import ScopedAligner, AyahAnchor
    scope = VerseScope(surah_id=2, ayah_start=23, ayah_end=25)
    a = ScopedAligner(scope, fake_quran)
    last = AyahAnchor(ayah=23, position=3, score=95.0)
    # Garbage words → score drops sharply → re-anchor (probably to None or a different ayah)
    anchor = a.align_partial(["xyz", "abc", "qqq"], last_anchor=last)
    assert anchor is None or anchor.ayah != 23 or anchor.position == 0
```

- [ ] **Step 3: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_align_partial.py -v`
Expected: FAIL with `ImportError: cannot import name 'align_partial'` or `AyahAnchor`.

- [ ] **Step 4: Add align_partial + AyahAnchor**

Append to `ai-service/app/ayah_aligner.py` (do not modify existing `align` method):

```python
from dataclasses import dataclass
from typing import Optional

from rapidfuzz import fuzz

from app.arabic_norm import canonical


@dataclass(frozen=True)
class AyahAnchor:
    ayah: int
    position: int   # 0-based next-expected-position in the ayah
    score: float    # RapidFuzz partial_ratio at time of anchor


# Append as a top-level method on ScopedAligner.
# IMPORTANT: keep the existing align() method intact.
def _add_align_partial_method():
    from app.ayah_aligner import ScopedAligner as _SA

    def align_partial(self, words_so_far: list[str],
                      last_anchor: Optional[AyahAnchor] = None) -> Optional[AyahAnchor]:
        if len(words_so_far) < 3 and last_anchor is None:
            return None

        normed = [canonical(w) for w in words_so_far]
        partial_text = " ".join(normed)

        # Score against every ayah in the scope
        best_ayah: Optional[int] = None
        best_score: float = 0.0
        for ayah_num in range(self.scope.ayah_start, self.scope.ayah_end + 1):
            ref = self.quran.get(self.scope.surah_id, {}).get(ayah_num, "")
            if not ref:
                continue
            ref_norm = " ".join(canonical(w) for w in ref.split())
            score = fuzz.partial_ratio(partial_text, ref_norm)
            if score > best_score:
                best_score = score
                best_ayah = ayah_num

        if best_ayah is None:
            return None

        # If we had an anchor and the new best is the same ayah, allow the score
        # to drop a bit (Whisper edits) before invalidating.
        if last_anchor is not None and best_ayah == last_anchor.ayah:
            if best_score < (last_anchor.score - 25):
                return None  # anchor invalidated; caller resets state
            ref = self.quran[self.scope.surah_id][best_ayah]
            return AyahAnchor(ayah=best_ayah, position=len(normed), score=best_score)

        # New anchor candidate — require min score
        if best_score < 60.0:
            return None
        return AyahAnchor(ayah=best_ayah, position=len(normed), score=best_score)

    _SA.align_partial = align_partial


_add_align_partial_method()
```

- [ ] **Step 5: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_align_partial.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add ai-service/app/ayah_aligner.py ai-service/tests/test_align_partial.py
git commit -m "feat(ai-service): add ScopedAligner.align_partial + AyahAnchor"
```

---

### Task 9: Per-word diff helper

**Files:**
- Modify: `ai-service/app/word_diff.py`
- Create: `ai-service/tests/test_diff_locked_word.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_diff_locked_word.py`:

```python
from app.word_diff import diff_locked_word, LockedWordDiff


def test_match():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    out = diff_locked_word("ريب", expected_words=expected, position=3)
    assert out.kind == "MATCH"


def test_mispronunciation():
    expected = ["وإن", "كنتم", "في", "ريب"]
    out = diff_locked_word("ربا", expected_words=expected, position=3)
    assert out.kind == "MISPRONUNCIATION"
    assert out.incorrect == "ربا"
    assert out.correct == "ريب"


def test_omitted_word_user_jumped_ahead():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    # user already said pos 0,1,2; their next locked word is "مما" → they skipped "ريب"
    out = diff_locked_word("مما", expected_words=expected, position=3)
    assert out.kind == "OMITTED_WORD"
    assert out.correct == "ريب"
    assert out.advance == 2   # skip past "ريب" then consume "مما"


def test_added_word_when_no_nearby_expected_match():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    out = diff_locked_word("xyz", expected_words=expected, position=3)
    assert out.kind == "ADDED_WORD"
    assert out.advance == 0   # don't advance anchor — anchor stays put
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_diff_locked_word.py -v`
Expected: FAIL with `ImportError`.

- [ ] **Step 3: Append helper to word_diff.py**

Append to `ai-service/app/word_diff.py`:

```python
from dataclasses import dataclass
from typing import Optional

from app.arabic_norm import canonical


@dataclass(frozen=True)
class LockedWordDiff:
    kind: str            # "MATCH" | "MISPRONUNCIATION" | "OMITTED_WORD" | "ADDED_WORD"
    incorrect: str
    correct: str
    advance: int         # how many positions to advance the anchor


def diff_locked_word(locked_word: str, expected_words: list[str],
                     position: int, lookahead: int = 2) -> LockedWordDiff:
    """Decide what a single newly-locked word means at the current anchor position."""
    norm_locked = canonical(locked_word)

    if position >= len(expected_words):
        # Anchor ran off the end of the ayah — treat as added
        return LockedWordDiff(kind="ADDED_WORD", incorrect=locked_word, correct="", advance=0)

    expected = canonical(expected_words[position])

    if norm_locked == expected:
        return LockedWordDiff(kind="MATCH", incorrect=locked_word,
                              correct=expected_words[position], advance=1)

    # Did the user skip 1 or 2 expected words and land on a later one?
    for skip in range(1, lookahead + 1):
        peek_pos = position + skip
        if peek_pos < len(expected_words) and canonical(expected_words[peek_pos]) == norm_locked:
            return LockedWordDiff(kind="OMITTED_WORD",
                                  incorrect="", correct=expected_words[position],
                                  advance=skip + 1)

    # Doesn't match expected and isn't a skip-ahead → ADDED if Levenshtein distance
    # to expected is huge, else MISPRONUNCIATION.
    from rapidfuzz.distance import Levenshtein
    dist = Levenshtein.distance(norm_locked, expected)
    if dist > max(3, len(expected) // 2):
        return LockedWordDiff(kind="ADDED_WORD", incorrect=locked_word, correct="", advance=0)
    return LockedWordDiff(kind="MISPRONUNCIATION",
                          incorrect=locked_word, correct=expected_words[position], advance=1)
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_diff_locked_word.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/word_diff.py ai-service/tests/test_diff_locked_word.py
git commit -m "feat(ai-service): add per-word diff helper for streaming pipeline"
```

---

### Task 10: build_partial_mistake in pipeline.py

**Files:**
- Modify: `ai-service/app/pipeline.py`
- Create: `ai-service/tests/test_build_partial_mistake.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_build_partial_mistake.py`:

```python
from app.pipeline import build_partial_mistake
from app.word_diff import LockedWordDiff


def test_match_returns_none():
    d = LockedWordDiff(kind="MATCH", incorrect="بسم", correct="بسم", advance=1)
    assert build_partial_mistake(d, tajweed_violation=None) is None


def test_mispronunciation_returns_mistake():
    d = LockedWordDiff(kind="MISPRONUNCIATION", incorrect="ربا", correct="ريب", advance=1)
    m = build_partial_mistake(d, tajweed_violation=None)
    assert m["type"] == "MISPRONUNCIATION"
    assert m["incorrect"] == "ربا"
    assert m["correct"] == "ريب"
    assert m["tajweedRule"] is None


def test_omitted_word():
    d = LockedWordDiff(kind="OMITTED_WORD", incorrect="", correct="ريب", advance=2)
    m = build_partial_mistake(d, tajweed_violation=None)
    assert m["type"] == "OMITTED_WORD"
    assert m["correct"] == "ريب"


def test_added_word_has_empty_correct():
    d = LockedWordDiff(kind="ADDED_WORD", incorrect="xyz", correct="", advance=0)
    m = build_partial_mistake(d, tajweed_violation=None)
    assert m["type"] == "ADDED_WORD"
    assert m["correct"] == ""


def test_match_plus_high_tajweed_returns_tajweed_violation():
    d = LockedWordDiff(kind="MATCH", incorrect="عبدنا", correct="عَبْدِنَا", advance=1)
    violation = {"rule": "Madd", "severity": "high", "tip": "Elongate."}
    m = build_partial_mistake(d, tajweed_violation=violation)
    assert m["type"] == "TAJWEED_VIOLATION"
    assert m["tajweedRule"] == "Madd"
    assert m["severity"] == "high"
    assert m["correct"] == "عَبْدِنَا"


def test_match_plus_low_tajweed_returns_none():
    d = LockedWordDiff(kind="MATCH", incorrect="عبدنا", correct="عبدنا", advance=1)
    violation = {"rule": "Qalqala", "severity": "low", "tip": "Bounce."}
    m = build_partial_mistake(d, tajweed_violation=violation)
    assert m is None
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_build_partial_mistake.py -v`
Expected: FAIL.

- [ ] **Step 3: Append to pipeline.py**

Append to `ai-service/app/pipeline.py`:

```python
from typing import Optional

from app.word_diff import LockedWordDiff


def build_partial_mistake(
    diff: LockedWordDiff,
    tajweed_violation: Optional[dict] = None,
) -> Optional[dict]:
    """Build a single mistake payload for a locked word, or None if no issue."""
    if diff.kind == "MATCH":
        if tajweed_violation and tajweed_violation.get("severity") == "high":
            return {
                "type": "TAJWEED_VIOLATION",
                "incorrect": diff.incorrect,
                "correct": diff.correct,
                "tajweedRule": tajweed_violation["rule"],
                "severity": "high",
                "tip": tajweed_violation.get("tip"),
            }
        return None

    return {
        "type": diff.kind,
        "incorrect": diff.incorrect,
        "correct": diff.correct,
        "tajweedRule": None,
        "severity": None,
        "tip": None,
    }
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_build_partial_mistake.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/pipeline.py ai-service/tests/test_build_partial_mistake.py
git commit -m "feat(ai-service): add build_partial_mistake() for per-word events"
```

---

# Phase P4 — MistakeStateMachine (Track A)

### Task 11: MistakeStateMachine

**Files:**
- Modify: `ai-service/app/pipeline.py`
- Create: `ai-service/tests/test_mistake_state_machine.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_mistake_state_machine.py`:

```python
import time

import pytest

from app.pipeline import MistakeStateMachine


@pytest.fixture
def sm():
    return MistakeStateMachine(timeout_sec=2.0)


def _payload(correct: str) -> dict:
    return {"type": "MISPRONUNCIATION", "incorrect": "x", "correct": correct,
            "tajweedRule": None, "severity": None, "tip": None}


def test_register_first_mistake_emits(sm):
    events = sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    assert [e["type"] for e in events] == ["partial_mistake"]
    assert events[0]["ayah"] == 23
    assert events[0]["word_index"] == 3


def test_same_position_suppresses_re_emission(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    events = sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.5)
    assert events == []


def test_repeated_correctly_emits_word_corrected(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    events = sm.on_locked_word(ayah=23, position=3, locked_normalised="ريب", now=0.5)
    assert [e["type"] for e in events] == ["word_corrected"]
    assert events[0]["word_index"] == 3


def test_moved_on_emits_acknowledged(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    # user said the NEXT expected word at position 4 → ack the pending at 3
    events = sm.on_locked_word(ayah=23, position=4, locked_normalised="مما", now=0.4)
    assert any(e["type"] == "mistake_acknowledged" and e["word_index"] == 3 for e in events)


def test_timeout_emits_acknowledged(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    events = sm.sweep(now=2.5)   # > timeout
    assert [e["type"] for e in events] == ["mistake_acknowledged"]


def test_reset_ayah_clears_pending(sm):
    sm.register_mistake(ayah=23, position=3, payload=_payload("ريب"), now=0.0)
    sm.reset_ayah(23)
    events = sm.sweep(now=10.0)
    assert events == []
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_mistake_state_machine.py -v`
Expected: FAIL.

- [ ] **Step 3: Append MistakeStateMachine to pipeline.py**

Append to `ai-service/app/pipeline.py`:

```python
from dataclasses import dataclass, field
from typing import Literal


_State = Literal["PENDING", "CORRECTED", "ACKNOWLEDGED"]


@dataclass
class _PendingMistake:
    state: _State
    emitted_at: float
    expected_correct_norm: str
    position: int
    payload: dict


class MistakeStateMachine:
    """Per-WS-connection state for emitted partial_mistake events.

    Handles: (a) suppressing re-emission for same (ayah, position),
             (b) turning a pending mistake green when user re-reads it correctly,
             (c) acknowledging a pending mistake when user moves past it,
             (d) timing out pending mistakes after `timeout_sec`.
    """

    def __init__(self, timeout_sec: float):
        self.timeout_sec = timeout_sec
        self._pending: dict[tuple[int, int], _PendingMistake] = {}

    def register_mistake(self, ayah: int, position: int, payload: dict, now: float) -> list[dict]:
        key = (ayah, position)
        if key in self._pending:
            return []   # suppress
        from app.arabic_norm import canonical
        self._pending[key] = _PendingMistake(
            state="PENDING",
            emitted_at=now,
            expected_correct_norm=canonical(payload.get("correct", "")),
            position=position,
            payload=payload,
        )
        return [{"type": "partial_mistake", "ayah": ayah, "word_index": position,
                 "mistake": payload, "state": "pending"}]

    def on_locked_word(self, ayah: int, position: int, locked_normalised: str, now: float) -> list[dict]:
        events: list[dict] = []
        # First check: did the user just re-read a pending mistake correctly?
        for (a, p), pm in list(self._pending.items()):
            if a != ayah or pm.state != "PENDING":
                continue
            if locked_normalised == pm.expected_correct_norm:
                pm.state = "CORRECTED"
                events.append({"type": "word_corrected", "ayah": a, "word_index": p})
                continue   # don't also ack
            # User said the next expected position → ack the pending one
            if position == p + 1:
                pm.state = "ACKNOWLEDGED"
                events.append({"type": "mistake_acknowledged", "ayah": a, "word_index": p})
        return events

    def sweep(self, now: float) -> list[dict]:
        events: list[dict] = []
        for (a, p), pm in list(self._pending.items()):
            if pm.state != "PENDING":
                continue
            if now - pm.emitted_at >= self.timeout_sec:
                pm.state = "ACKNOWLEDGED"
                events.append({"type": "mistake_acknowledged", "ayah": a, "word_index": p})
        return events

    def reset_ayah(self, ayah: int) -> None:
        self._pending = {k: v for k, v in self._pending.items() if k[0] != ayah}

    def pending_payloads_for_ayah(self, ayah: int) -> list[dict]:
        return [pm.payload for (a, _), pm in sorted(self._pending.items())
                if a == ayah]
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_mistake_state_machine.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/pipeline.py ai-service/tests/test_mistake_state_machine.py
git commit -m "feat(ai-service): add MistakeStateMachine for repeat/skip handling"
```

---

# Phase P5 — TTS resolver + auth (Track A)

### Task 12: Word-timing index builder

**Files:**
- Create: `ai-service/scripts/build_word_timing_index.py`

- [ ] **Step 1: Write the script**

Create `ai-service/scripts/build_word_timing_index.py`:

```python
"""Builds a local index of (surah, ayah) → ayah-level mp3 URL on EveryAyah.

Word-level timing (start_ms/end_ms per word in the ayah mp3) is NOT publicly
available from EveryAyah, so we leave the per-word timing slots empty and let
the frontend play the whole ayah clip from the start. The Quran.com API does
provide word timings; that's a future enhancement.

Run: py -3.11 -m scripts.build_word_timing_index
"""
import json
from pathlib import Path

from app.config import TTS_AUDIO_BASE_URL

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "word_timings.json"


def main() -> int:
    index: dict = {}
    # Surah ayah counts (114 surahs, source: known fixed numbers)
    SURAH_AYAH_COUNTS = [
        7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,
        112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,
        59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,
        52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,
        21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6
    ]
    for surah_id, count in enumerate(SURAH_AYAH_COUNTS, start=1):
        for ayah_num in range(1, count + 1):
            key = f"{surah_id:03d}{ayah_num:03d}"
            index[key] = {
                "audio_url": f"{TTS_AUDIO_BASE_URL}/{key}.mp3",
                "words": []   # empty until Quran.com word timings are integrated
            }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(f"[done] wrote {len(index)} entries → {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the builder**

Run: `cd ai-service && py -3.11 -m scripts.build_word_timing_index`
Expected: prints `[done] wrote 6236 entries → .../data/word_timings.json`.

- [ ] **Step 3: Commit**

```bash
git add ai-service/scripts/build_word_timing_index.py
git commit -m "feat(ai-service): add word-timing index builder for TTS lookup"
```

---

### Task 13: TTS resolver

**Files:**
- Create: `ai-service/app/tts_resolver.py`
- Create: `ai-service/tests/test_tts_resolver.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_tts_resolver.py`:

```python
import json
from pathlib import Path

import pytest

from app.tts_resolver import TTSResolver


@pytest.fixture
def tmp_index(tmp_path):
    p = tmp_path / "wt.json"
    p.write_text(json.dumps({
        "002023": {"audio_url": "https://example.com/002023.mp3", "words": []},
    }, ensure_ascii=False), encoding="utf-8")
    return p


def test_resolve_known_ayah(tmp_index):
    r = TTSResolver(index_path=tmp_index)
    out = r.resolve(surah=2, ayah=23, word_index=4)
    assert out["audio_url"] == "https://example.com/002023.mp3"
    assert out["audio_word_timing"] is None
    assert out["audio_fallback_url"] is None


def test_resolve_unknown_ayah_returns_fallback(tmp_index):
    r = TTSResolver(index_path=tmp_index)
    out = r.resolve(surah=99, ayah=1, word_index=0, fallback_word="ريب")
    assert out["audio_url"] is None
    assert out["audio_fallback_url"] is not None
    assert "ريب" in out["audio_fallback_url"]
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_tts_resolver.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement TTSResolver**

Create `ai-service/app/tts_resolver.py`:

```python
"""Resolve a (surah, ayah, word_index) into TTS audio URLs."""
import json
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from app.config import TTS_WORD_TIMING_INDEX_PATH


class TTSResolver:
    def __init__(self, index_path: Path | str = TTS_WORD_TIMING_INDEX_PATH):
        path = Path(index_path)
        if path.exists():
            self._index = json.loads(path.read_text(encoding="utf-8"))
        else:
            self._index = {}

    def resolve(self, surah: int, ayah: int, word_index: int,
                fallback_word: Optional[str] = None) -> dict:
        key = f"{surah:03d}{ayah:03d}"
        entry = self._index.get(key)
        if entry:
            words = entry.get("words") or []
            timing = words[word_index] if 0 <= word_index < len(words) else None
            return {
                "audio_url": entry.get("audio_url"),
                "audio_word_timing": timing,
                "audio_fallback_url": None,
            }
        # Unknown ayah → gTTS fallback URL the client can fetch
        fb = None
        if fallback_word:
            fb = f"/api/tts/gtts?text={quote(fallback_word)}"
        return {"audio_url": None, "audio_word_timing": None, "audio_fallback_url": fb}
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_tts_resolver.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/tts_resolver.py ai-service/tests/test_tts_resolver.py
git commit -m "feat(ai-service): add TTSResolver for EveryAyah URL lookup"
```

---

### Task 14: Bearer-token auth helper

**Files:**
- Create: `ai-service/app/auth.py`
- Create: `ai-service/tests/test_auth.py`

- [ ] **Step 1: Write failing test**

Create `ai-service/tests/test_auth.py`:

```python
from app.auth import check_bearer_token


def test_correct_token_passes(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "secret123")
    assert check_bearer_token("Bearer secret123") is True


def test_wrong_token_fails(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "secret123")
    assert check_bearer_token("Bearer nope") is False


def test_missing_prefix_fails(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "secret123")
    assert check_bearer_token("secret123") is False


def test_no_configured_token_allows_all(monkeypatch):
    monkeypatch.setattr("app.auth.AI_SERVICE_AUTH_TOKEN", "")
    assert check_bearer_token(None) is True
    assert check_bearer_token("anything") is True
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd ai-service && py -3.11 -m pytest tests/test_auth.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement auth**

Create `ai-service/app/auth.py`:

```python
"""Bearer-token gate for the HF Space public URL."""
import hmac
from typing import Optional

from app.config import AI_SERVICE_AUTH_TOKEN


def check_bearer_token(header_value: Optional[str]) -> bool:
    """Constant-time compare of an Authorization header against the configured token.

    If no token is configured, all requests pass (local dev mode).
    """
    if not AI_SERVICE_AUTH_TOKEN:
        return True
    if not header_value or not header_value.startswith("Bearer "):
        return False
    presented = header_value[len("Bearer "):]
    return hmac.compare_digest(presented.encode(), AI_SERVICE_AUTH_TOKEN.encode())
```

- [ ] **Step 4: Run to verify PASS**

Run: `cd ai-service && py -3.11 -m pytest tests/test_auth.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/auth.py ai-service/tests/test_auth.py
git commit -m "feat(ai-service): add bearer-token gate for public Space URL"
```

---

# Phase P6 — WS handler rewrite (Track A — depends on P1-P5)

### Task 15: Rewrite the streaming inner loop

**Files:**
- Modify: `ai-service/app/ws_handler.py`
- Modify: `ai-service/app/lifespan.py` (load TTSResolver into STATE)

- [ ] **Step 1: Add TTSResolver to lifespan**

Modify `ai-service/app/lifespan.py` — add TTSResolver loading inside the `lifespan` async generator, after the provider init:

```python
# Append to the existing lifespan body, right after STATE["provider"] = get_provider()
print("[Startup] Loading TTS resolver ...")
from app.tts_resolver import TTSResolver
STATE["tts"] = TTSResolver()
```

Also add `"tts": None` to the `STATE` dict at the top of the file.

- [ ] **Step 2: Rewrite ws_handler.py**

Replace `ai-service/app/ws_handler.py` entirely:

```python
import asyncio
import json
import time

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from app.config import (
    VerseScope,
    VAD_SAMPLE_RATE,
    STREAM_CHUNK_SEC,
    STREAM_WINDOW_SEC,
    STREAM_LOCK_IN_RUNS,
    PENDING_CORRECTION_TIMEOUT_SEC,
    SILENCE_THRESHOLD,
)
from app.lifespan import STATE
from app.vad import is_recent_silence
from app.ayah_aligner import ScopedAligner
from app.word_diff import diff_locked_word
from app.pipeline import build_partial_mistake, MistakeStateMachine, SummaryAccumulator
from app.streaming_buffer import RollingBuffer, StableTracker
from app.arabic_norm import canonical
from app.tajweed import check_tajweed_violations  # existing function — keep name in mind
from app.auth import check_bearer_token


async def handle_ws_evaluate(ws: WebSocket):
    # Auth (HF Space deployment)
    auth = ws.headers.get("authorization") or ws.headers.get("Authorization")
    if not check_bearer_token(auth):
        await ws.close(code=4401)
        return

    await ws.accept()
    if not STATE["ready"]:
        await ws.send_json({"type": "error", "code": "not_ready"})
        await ws.close()
        return

    # 1. Receive config frame
    try:
        first = await ws.receive()
        if "text" not in first:
            await ws.send_json({"type": "error", "code": "config_required"})
            await ws.close()
            return
        cfg = json.loads(first["text"])
        scope = VerseScope(
            surah_id=int(cfg["surahId"]),
            ayah_start=int(cfg["ayahStart"]),
            ayah_end=int(cfg["ayahEnd"]),
        )
    except (KeyError, ValueError, json.JSONDecodeError):
        await ws.send_json({"type": "error", "code": "invalid_config"})
        await ws.close()
        return

    aligner = ScopedAligner(scope, STATE["quran"])
    summary = SummaryAccumulator()
    provider = STATE["provider"]
    vad_model = STATE["vad"]
    tts = STATE["tts"]

    buf = RollingBuffer(sample_rate=VAD_SAMPLE_RATE, window_sec=STREAM_WINDOW_SEC)
    tracker = StableTracker(lock_in_runs=STREAM_LOCK_IN_RUNS)
    state_machine = MistakeStateMachine(timeout_sec=PENDING_CORRECTION_TIMEOUT_SEC)
    last_anchor = None
    samples_since_last_asr = 0
    chunk_samples = int(STREAM_CHUNK_SEC * VAD_SAMPLE_RATE)
    ayah_finalized_for: set[int] = set()

    await ws.send_json({"type": "ready", "effective_chunk_sec": STREAM_CHUNK_SEC})

    # Background sweep task for state machine timeouts
    stop_sweep = asyncio.Event()

    async def sweep_loop():
        while not stop_sweep.is_set():
            await asyncio.sleep(0.25)
            for ev in state_machine.sweep(now=time.monotonic()):
                try:
                    await ws.send_json(ev)
                except Exception:
                    return

    sweep_task = asyncio.create_task(sweep_loop())

    try:
        while True:
            msg = await ws.receive()

            if "text" in msg and msg["text"].strip().upper() == "STOP":
                break

            if "bytes" not in msg:
                continue

            chunk = np.frombuffer(msg["bytes"], dtype=np.float32)
            buf.append(chunk)
            samples_since_last_asr += len(chunk)

            if samples_since_last_asr < chunk_samples:
                continue
            samples_since_last_asr = 0

            window = buf.window()
            if len(window) < int(0.5 * VAD_SAMPLE_RATE):
                continue

            # Transcribe
            try:
                tr = await provider.transcribe(window)
            except Exception as e:
                await ws.send_json({"type": "error", "code": "asr_failed", "message": str(e)})
                continue

            if not tr.text.strip():
                continue

            # Feed StableTracker
            newly_locked = tracker.feed(tr.text)
            if not newly_locked:
                # Still check for ayah-end silence even if no lock-ins this cycle
                pass
            else:
                # Build a partial-text list from the full locked words for alignment
                all_locked = tracker.current_locked()
                for w in newly_locked:
                    # Recompute anchor with the prefix up to and including this word
                    prefix = all_locked[: w.position + 1]
                    new_anchor = aligner.align_partial(prefix, last_anchor=last_anchor)
                    if new_anchor is None:
                        if last_anchor is not None:
                            state_machine.reset_ayah(last_anchor.ayah)
                            last_anchor = None
                        continue
                    last_anchor = new_anchor

                    expected = STATE["quran"][scope.surah_id][last_anchor.ayah].split()
                    # Position to compare against in the ayah is the position the
                    # anchor was at BEFORE this word. align_partial sets `position`
                    # to the NEXT-expected position after consuming this word, so
                    # the slot we just consumed is position - 1.
                    word_idx = max(0, last_anchor.position - 1)
                    diff = diff_locked_word(
                        locked_word=w.text,
                        expected_words=expected,
                        position=word_idx,
                    )

                    # Tajweed check (HIGH-severity only is surfaced inside build_partial_mistake)
                    tj_violations = check_tajweed_violations(w.text, expected, word_idx)
                    high = next((v for v in tj_violations if v.get("severity") == "high"), None)

                    payload = build_partial_mistake(diff, tajweed_violation=high)
                    # Notify state machine — both on lock-in (for ack/correct path) AND on mistake
                    ack_events = state_machine.on_locked_word(
                        ayah=last_anchor.ayah, position=word_idx,
                        locked_normalised=w.text, now=time.monotonic(),
                    )
                    for ev in ack_events:
                        await ws.send_json(ev)

                    if payload is not None:
                        for ev in state_machine.register_mistake(
                            ayah=last_anchor.ayah, position=word_idx,
                            payload=payload, now=time.monotonic(),
                        ):
                            tts_info = tts.resolve(
                                surah=scope.surah_id, ayah=last_anchor.ayah,
                                word_index=word_idx, fallback_word=payload.get("correct"),
                            )
                            ev.update({
                                "audio_url": tts_info["audio_url"],
                                "audio_word_timing": tts_info["audio_word_timing"],
                                "audio_fallback_url": tts_info["audio_fallback_url"],
                            })
                            await ws.send_json(ev)

            # Ayah-end detection
            if last_anchor is not None and last_anchor.ayah not in ayah_finalized_for:
                if is_recent_silence(buf.window(), vad_model,
                                     last_n_sec=1.0, threshold_sec=SILENCE_THRESHOLD):
                    final_mistakes = state_machine.pending_payloads_for_ayah(last_anchor.ayah)
                    await ws.send_json({
                        "type": "ayah_finalized",
                        "ayah": last_anchor.ayah,
                        "mistakes": final_mistakes,
                    })
                    summary.record(last_anchor.ayah, last_anchor.score, final_mistakes)
                    ayah_finalized_for.add(last_anchor.ayah)
                    state_machine.reset_ayah(last_anchor.ayah)
                    tracker.reset()
                    last_anchor = None

    except WebSocketDisconnect:
        pass
    finally:
        stop_sweep.set()
        sweep_task.cancel()

    await ws.send_json({"type": "final_report", **summary.finalize()})
    await ws.close()
```

- [ ] **Step 3: Ensure tajweed function name matches**

Verify `app.tajweed` exports `check_tajweed_violations` (returns a list of `{"rule", "severity", "tip"}` dicts). If the current exported name differs:

Run: `cd ai-service && py -3.11 -c "from app import tajweed; print([n for n in dir(tajweed) if not n.startswith('_')])"`

If a different name exists (e.g., `check_madd`, `analyze_tajweed`), add a shim function at the bottom of `ai-service/app/tajweed.py`:

```python
def check_tajweed_violations(word: str, expected_words: list[str], position: int) -> list[dict]:
    """Run all detectors on a single word in its ayah context. Returns list of
    {"rule": str, "severity": "low"|"medium"|"high", "tip": str}."""
    violations = []
    # Wire each existing detector here. Example pattern:
    # m = check_madd(word, expected_words[position])
    # if m: violations.append({"rule": "Madd", "severity": "high", "tip": "Elongate..."})
    return violations
```

The minimal correct implementation calls each existing detector and packages results. Adjust to the actual existing API.

- [ ] **Step 4: Smoke-import**

Run: `cd ai-service && py -3.11 -c "from app.ws_handler import handle_ws_evaluate; print('ok')"`
Expected: `ok` (no import errors).

- [ ] **Step 5: Commit**

```bash
git add ai-service/app/ws_handler.py ai-service/app/lifespan.py ai-service/app/tajweed.py
git commit -m "feat(ai-service): rewrite ws_handler for streaming pipeline"
```

---

### Task 16: WS handler integration test

**Files:**
- Create: `ai-service/tests/test_ws_handler_streaming.py`

- [ ] **Step 1: Write integration test**

Create `ai-service/tests/test_ws_handler_streaming.py`:

```python
"""End-to-end replay of a fixture WAV through the streaming pipeline.

Asserts that the event order is:
  ready → 0+ partial_mistake → 0+ word_corrected/mistake_acknowledged → ayah_finalized → final_report
"""
import asyncio
import json
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.lifespan import lifespan, STATE
from app.ws_handler import handle_ws_evaluate

FIXTURE = Path(__file__).parent / "fixtures" / "al-baqarah-23.wav"


def _build_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.websocket("/ws/evaluate")(handle_ws_evaluate)
    return app


def _load_wav_float32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        frames = w.readframes(w.getnframes())
    return (np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0).copy()


def test_ws_event_ordering():
    if not FIXTURE.exists():
        pytest.skip("fixture WAV not present")
    app = _build_app()
    with TestClient(app) as client:
        # Lifespan loads STATE; check provider is Tarteel
        assert STATE["ready"]
        with client.websocket_connect("/ws/evaluate") as ws:
            # Config
            ws.send_text(json.dumps({"surahId": 2, "ayahStart": 23, "ayahEnd": 23}))
            ready = json.loads(ws.receive_text())
            assert ready["type"] == "ready"

            # Stream the WAV in 0.25s chunks
            pcm = _load_wav_float32(FIXTURE)
            chunk = int(0.25 * 16000)
            for i in range(0, len(pcm), chunk):
                ws.send_bytes(pcm[i:i + chunk].tobytes())

            ws.send_text("STOP")

            seen_types = []
            while True:
                try:
                    msg = ws.receive_text(timeout=10)
                except Exception:
                    break
                ev = json.loads(msg)
                seen_types.append(ev["type"])
                if ev["type"] == "final_report":
                    break

            assert "final_report" in seen_types
            # ready is the first event; final_report is the last
            assert seen_types[0] == "ready"
            assert seen_types[-1] == "final_report"
```

- [ ] **Step 2: Run the test**

Run: `cd ai-service && py -3.11 -m pytest tests/test_ws_handler_streaming.py -v`
Expected: PASS (or SKIP if fixture missing). If FAIL, debug the inner loop using the printed event list.

- [ ] **Step 3: Run the full Python test suite**

Run: `cd ai-service && py -3.11 -m pytest -v`
Expected: all tests pass (any SKIP is acceptable).

- [ ] **Step 4: Commit**

```bash
git add ai-service/tests/test_ws_handler_streaming.py
git commit -m "test(ai-service): add end-to-end streaming WS handler test"
```

---

### Task 17: Update Dockerfile and .env.example

**Files:**
- Modify: `ai-service/Dockerfile`
- Modify: `ai-service/.env.example`

- [ ] **Step 1: Replace Dockerfile**

Replace `ai-service/Dockerfile`:

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-local-whisper.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-local-whisper.txt

COPY . .

RUN python -m scripts.convert_tarteel_model
RUN python -m scripts.build_word_timing_index

ENV STREAM_CHUNK_SEC=0.25 \
    STREAM_WINDOW_SEC=4.0 \
    STREAM_LOCK_IN_RUNS=2 \
    VAD_SILENCE_THRESHOLD_SEC=0.7 \
    PENDING_CORRECTION_TIMEOUT_SEC=2.0 \
    TRANSCRIPTION_PROVIDER=tarteel

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
```

- [ ] **Step 2: Update .env.example**

Replace `ai-service/.env.example`:

```ini
TRANSCRIPTION_PROVIDER=tarteel
WHISPER_MODEL_PATH=./models/tarteel-ct2/

STREAM_CHUNK_SEC=0.25
STREAM_WINDOW_SEC=4.0
STREAM_LOCK_IN_RUNS=2
VAD_SILENCE_THRESHOLD_SEC=0.7
PENDING_CORRECTION_TIMEOUT_SEC=2.0

TTS_AUDIO_BASE_URL=https://everyayah.com/data/Husary_64kbps
TTS_WORD_TIMING_INDEX_PATH=./data/word_timings.json

# Set when deploying to a public HF Space. Leave blank for local dev (auth bypassed).
AI_SERVICE_AUTH_TOKEN=

# Legacy / fallback providers
GROQ_API_KEY=
GROQ_MODEL=whisper-large-v3

# Only used by convert_tarteel_model.py for the initial HF download
HF_TOKEN=
```

- [ ] **Step 3: Commit**

```bash
git add ai-service/Dockerfile ai-service/.env.example
git commit -m "feat(ai-service): Dockerfile + .env.example for Tarteel streaming"
```

---

# Phase P7 — Node backend dispatcher (Track B — independent until merge)

### Task 18: Backend WS dispatcher for new events

**Files:**
- Modify: `backend/src/routes/audio.ws.js`
- Modify: `backend/src/services/ai.service.js`
- Modify: `backend/.env.example`

- [ ] **Step 1: Read current audio.ws.js**

Run: `cd backend && type src\routes\audio.ws.js` (Windows) or `cat src/routes/audio.ws.js` (Unix).
Note the existing event dispatcher (likely a `switch (msg.type)` or `if (msg.type === 'mistake')`).

- [ ] **Step 2: Add new event cases**

Modify `backend/src/routes/audio.ws.js`. Locate the dispatcher block. Add cases (relay verbatim, except `ayah_finalized` writes Feedback + relays as legacy `mistake`):

```javascript
// Inside the existing onEvent / message handler from ai.service.js:
switch (msg.type) {
  // ... existing cases ...

  case 'partial_mistake':
  case 'word_corrected':
  case 'mistake_acknowledged':
    // Relay verbatim to RN; do NOT persist
    rnSocket.send(JSON.stringify(msg));
    break;

  case 'ayah_finalized': {
    // Persist via existing service
    await createFeedbackBatch({
      sessionId,
      ayah: msg.ayah,
      mistakes: msg.mistakes,
    });
    // Relay to RN under the LEGACY name so existing RN handlers keep working
    rnSocket.send(JSON.stringify({ ...msg, type: 'mistake' }));
    break;
  }

  // ... existing cases (final_report, error, ok, unclear, out_of_scope) ...
}
```

If the current handler uses a different code style, match it. The behaviour above is the contract.

- [ ] **Step 3: Update ai.service.js for WSS URL + auth**

Modify `backend/src/services/ai.service.js`. Change the connection URL logic:

```javascript
const WS_URL = process.env.AI_SERVICE_WSS_URL
  || `ws://${process.env.AI_SERVICE_HOST || 'localhost'}:${process.env.AI_SERVICE_PORT || '8000'}/ws/evaluate`;

const headers = process.env.AI_SERVICE_AUTH_TOKEN
  ? { Authorization: `Bearer ${process.env.AI_SERVICE_AUTH_TOKEN}` }
  : {};

const child = new WebSocket(WS_URL, { headers });
```

Make sure the dispatcher recognises the new event types (forwards them through `onEvent`).

- [ ] **Step 4: Update backend/.env.example**

Append to `backend/.env.example`:

```ini
# AI service — either WSS_URL (for HF Space) or HOST/PORT (legacy local)
AI_SERVICE_WSS_URL=
AI_SERVICE_AUTH_TOKEN=
AI_SERVICE_HOST=localhost
AI_SERVICE_PORT=8000
```

- [ ] **Step 5: Smoke test with replay script**

Run (with ai-service running locally): `cd backend && node scripts/test_audio_ws.js`
Expected: receives `partial_mistake` events (if the fixture WAV has mispronunciations) followed by a final `mistake` (mapped from `ayah_finalized`), then `final_report`. Database has `Feedback` rows matching the final mistake list.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/audio.ws.js backend/src/services/ai.service.js backend/.env.example
git commit -m "feat(backend): dispatch streaming events, support HF Space WSS URL"
```

---

### Task 19: Optional gTTS fallback proxy route

**Files:**
- Create: `backend/src/routes/tts.js`
- Modify: `backend/src/app.js` (register the route)

- [ ] **Step 1: Decide if needed**

Skip this task entirely if EveryAyah coverage is sufficient — `tts_resolver.py` returns the EveryAyah URL directly. The `audio_fallback_url` field is only populated when EveryAyah lacks coverage (extremely rare). If you choose to skip, document by adding a comment in `tts_resolver.py` that the fallback is unused.

If implementing:

- [ ] **Step 2: Create the route**

Create `backend/src/routes/tts.js`:

```javascript
const express = require('express');
const router = express.Router();
const { gTTS } = require('gtts');  // npm install gtts

router.get('/gtts', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 200);
  if (!text) return res.status(400).end();
  try {
    const tts = new gTTS({ text, lang: 'ar', slow: false });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    tts.stream().pipe(res);
  } catch (err) {
    res.status(500).end();
  }
});

module.exports = router;
```

- [ ] **Step 3: Register**

In `backend/src/app.js`, add: `app.use('/api/tts', require('./routes/tts'));`

- [ ] **Step 4: Install gtts**

Run: `cd backend && npm install gtts`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/tts.js backend/src/app.js backend/package.json backend/package-lock.json
git commit -m "feat(backend): add gTTS fallback proxy for missing EveryAyah coverage"
```

---

# Phase P8 — Frontend word-by-word render (Track C)

### Task 20: Add word state store + colour tokens

**Files:**
- Create: `frontend/src/services/wordStateStore.js`
- Modify: `frontend/src/constants/colors.js`

- [ ] **Step 1: Install Zustand**

Run: `cd frontend && npm install zustand`

- [ ] **Step 2: Create the store**

Create `frontend/src/services/wordStateStore.js`:

```javascript
import { create } from 'zustand';

// Each word lives in one of four visual states.
export const WordState = {
  Pending: 'pending',
  Mistake: 'mistake',
  Corrected: 'corrected',
  Acknowledged: 'acknowledged',
};

export const useWordStateStore = create((set, get) => ({
  // Shape: { [ayahNum]: { [wordIdx]: WordState } }
  states: {},

  setState: (ayah, wordIdx, state) =>
    set((prev) => ({
      states: {
        ...prev.states,
        [ayah]: { ...(prev.states[ayah] || {}), [wordIdx]: state },
      },
    })),

  reset: () => set({ states: {} }),

  get: (ayah, wordIdx) =>
    (get().states[ayah] || {})[wordIdx] || WordState.Pending,
}));
```

- [ ] **Step 3: Add colour tokens**

Append to `frontend/src/constants/colors.js` (do not remove existing exports):

```javascript
export const wordPending = '#1F2937';       // default text colour
export const wordMistake = '#DC2626';       // red
export const wordCorrected = '#16A34A';     // green
export const wordAcknowledged = '#FCA5A5';  // faded red
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/wordStateStore.js frontend/src/constants/colors.js frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add wordStateStore + colour tokens"
```

---

### Task 21: ReciteScreen word-by-word rendering

**Files:**
- Modify: `frontend/src/screens/ReciteScreen.js`

- [ ] **Step 1: Inspect current screen**

Open `frontend/src/screens/ReciteScreen.js`. Identify how the ayah text is currently rendered (likely a single `<Text>{ayah.text}</Text>`).

- [ ] **Step 2: Replace with word-by-word render**

Inside the ayah rendering JSX, replace the single Text with a flex-wrap of memoized word components. Add at the top of the file:

```jsx
import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { useWordStateStore, WordState } from '../services/wordStateStore';
import {
  wordPending, wordMistake, wordCorrected, wordAcknowledged,
} from '../constants/colors';

const COLOUR_FOR_STATE = {
  [WordState.Pending]: wordPending,
  [WordState.Mistake]: wordMistake,
  [WordState.Corrected]: wordCorrected,
  [WordState.Acknowledged]: wordAcknowledged,
};

const WordToken = memo(function WordToken({ ayah, wordIdx, text }) {
  const state = useWordStateStore((s) => (s.states[ayah] || {})[wordIdx] || WordState.Pending);
  return (
    <Text style={{ color: COLOUR_FOR_STATE[state], fontSize: 24, marginHorizontal: 4 }}>
      {text}
    </Text>
  );
});

function AyahWordRow({ ayahNum, ayahText }) {
  const words = ayahText.split(/\s+/).filter(Boolean);
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', marginVertical: 8 }}>
      {words.map((w, i) => (
        <WordToken key={`${ayahNum}-${i}`} ayah={ayahNum} wordIdx={i} text={w} />
      ))}
    </View>
  );
}
```

Replace the existing single-`<Text>` ayah render with `<AyahWordRow ayahNum={a.number} ayahText={a.text} />`. Keep all other UI (record button, header, footer) untouched.

- [ ] **Step 3: Visual smoke-test**

Run: `cd frontend && npm start`. Open in the Expo dev client. Confirm ayahs render as wrapped tokens, each word in `wordPending` colour (dark grey). No functional change to the recording flow at this point.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/ReciteScreen.js
git commit -m "feat(frontend): render ayahs word-by-word with state-driven colours"
```

---

### Task 22: Audio stream service handles new events

**Files:**
- Modify: `frontend/src/services/audioStreamService.js`

- [ ] **Step 1: Inspect current handler**

Open `frontend/src/services/audioStreamService.js`. Find the WebSocket `onmessage` handler.

- [ ] **Step 2: Extend the handler**

Add cases for the new event types. Import the store and the (yet-to-be-built) TTS queue:

```javascript
import { useWordStateStore, WordState } from './wordStateStore';
import { ttsQueueService } from './ttsQueueService';   // built next task

// Inside onmessage:
const ev = JSON.parse(rawMessage);
switch (ev.type) {
  case 'partial_mistake':
    useWordStateStore.getState().setState(ev.ayah, ev.word_index, WordState.Mistake);
    if (ev.audio_url) {
      ttsQueueService.enqueue({
        url: ev.audio_url,
        timing: ev.audio_word_timing,
        fallbackUrl: ev.audio_fallback_url,
      });
    }
    break;
  case 'word_corrected':
    useWordStateStore.getState().setState(ev.ayah, ev.word_index, WordState.Corrected);
    break;
  case 'mistake_acknowledged':
    useWordStateStore.getState().setState(ev.ayah, ev.word_index, WordState.Acknowledged);
    break;
  // ... keep all existing cases (mistake, final_report, ok, unclear, error, etc.) ...
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/audioStreamService.js
git commit -m "feat(frontend): handle partial_mistake/word_corrected/mistake_acknowledged"
```

---

# Phase P9 — TTS queue + prefetch (Track C)

### Task 23: ttsQueueService

**Files:**
- Create: `frontend/src/services/ttsQueueService.js`

- [ ] **Step 1: Create the queue**

Create `frontend/src/services/ttsQueueService.js`:

```javascript
import { Audio } from 'expo-av';

const MAX_QUEUE = 2;

class TtsQueueService {
  constructor() {
    this.queue = [];
    this.playing = false;
  }

  enqueue(item) {
    // Drop oldest if queue is at cap — prevents pile-up under rapid mistakes
    while (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(item);
    this._drain();
  }

  async _drain() {
    if (this.playing) return;
    const item = this.queue.shift();
    if (!item) return;
    this.playing = true;
    try {
      const uri = item.url || item.fallbackUrl;
      if (!uri) {
        this.playing = false;
        return this._drain();
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, positionMillis: item.timing?.start_ms || 0 },
      );
      if (item.timing?.end_ms) {
        sound.setOnPlaybackStatusUpdate(async (s) => {
          if (s.isLoaded && s.positionMillis >= item.timing.end_ms) {
            await sound.stopAsync();
            await sound.unloadAsync();
            this.playing = false;
            this._drain();
          }
        });
      } else {
        sound.setOnPlaybackStatusUpdate(async (s) => {
          if (s.isLoaded && s.didJustFinish) {
            await sound.unloadAsync();
            this.playing = false;
            this._drain();
          }
        });
      }
    } catch (err) {
      this.playing = false;
      this._drain();
    }
  }

  clear() {
    this.queue = [];
  }
}

export const ttsQueueService = new TtsQueueService();
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/ttsQueueService.js
git commit -m "feat(frontend): add TTS queue service with seek + drain"
```

---

### Task 24: wordAudioPrefetch

**Files:**
- Create: `frontend/src/services/wordAudioPrefetch.js`

- [ ] **Step 1: Create prefetcher**

Create `frontend/src/services/wordAudioPrefetch.js`:

```javascript
import * as FileSystem from 'expo-file-system';

const BASE = 'https://everyayah.com/data/Husary_64kbps';

async function ensureDir() {
  const dir = `${FileSystem.cacheDirectory}tts/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

export async function prefetchRange(surahId, ayahStart, ayahEnd) {
  const dir = await ensureDir();
  const tasks = [];
  for (let a = ayahStart; a <= ayahEnd; a++) {
    const key = `${String(surahId).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`;
    const url = `${BASE}/${key}`;
    const local = `${dir}${key}`;
    const info = await FileSystem.getInfoAsync(local);
    if (info.exists) continue;
    tasks.push(FileSystem.downloadAsync(url, local).catch(() => null));
  }
  await Promise.all(tasks);
}

export function localUrlFor(surahId, ayahId) {
  const key = `${String(surahId).padStart(3, '0')}${String(ayahId).padStart(3, '0')}.mp3`;
  return `${FileSystem.cacheDirectory}tts/${key}`;
}
```

- [ ] **Step 2: Hook into ReciteScreen**

In `frontend/src/screens/ReciteScreen.js`, when the user taps Start (or the session starts), call:

```jsx
import { prefetchRange } from '../services/wordAudioPrefetch';

useEffect(() => {
  if (selection) {
    prefetchRange(selection.surahId, selection.ayahStart, selection.ayahEnd);
  }
}, [selection]);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/wordAudioPrefetch.js frontend/src/screens/ReciteScreen.js
git commit -m "feat(frontend): prefetch ayah-level mp3s on session start"
```

---

### Task 25: Visual smoke test on device

- [ ] **Step 1: Run all three services**

Three terminals:
- `cd ai-service && py -3.11 -m uvicorn app.main:app --host 0.0.0.0 --port 8000`
- `cd backend && npm run dev`
- `cd frontend && npm start`

- [ ] **Step 2: Connect a device via Cloudflare Tunnel**

`cloudflared tunnel --url http://localhost:5000` → note the public URL. Point the RN dev build at it.

- [ ] **Step 3: Manual recitation**

Select Al-Baqarah ayah 23, tap record, intentionally mispronounce word 3 or 4. Confirm:
- Word turns red within ~1 s of finishing it.
- Correct word plays through device speaker within ~1.3 s.
- Re-reading the corrected word turns it green.
- Skipping past it fades to acknowledged after 2 s.

Document any failures and iterate.

---

# Phase P10 — HF Space deployment (Track D)

### Task 26: Create the Space

- [ ] **Step 1: Create**

On huggingface.co → New Space → Name `truetilawah-asr` → SDK = Docker → Hardware = CPU Basic → Visibility = Private.

- [ ] **Step 2: Clone the Space repo locally**

```
git clone https://huggingface.co/spaces/<user>/truetilawah-asr hf-space
```

- [ ] **Step 3: Copy ai-service contents**

Copy the contents of `ai-service/` (everything: app/, scripts/, tests/, Dockerfile, requirements\*.txt, .env.example) into `hf-space/`. **Do not copy** `models/` or `data/` (they're regenerated at build time inside the container).

- [ ] **Step 4: Adjust the Dockerfile for HF specifics**

In `hf-space/Dockerfile`, the existing Dockerfile from Task 17 is already HF-compatible (port 7860). No edits needed.

- [ ] **Step 5: Set Space secret**

In the Space settings on huggingface.co, add a secret:
- Name: `AI_SERVICE_AUTH_TOKEN`
- Value: the 32-byte hex from prerequisites.

- [ ] **Step 6: Push**

```
cd hf-space
git add .
git commit -m "initial Tarteel streaming service"
git push
```

First build will run for ~8 minutes (mostly Tarteel model download + conversion). Watch the build log.

- [ ] **Step 7: Verify**

In the Space's logs, look for `[Startup] OK Ready.`. The WSS URL will be `wss://<user>-truetilawah-asr.hf.space/ws/evaluate`.

---

### Task 27: Point Node at the HF Space

- [ ] **Step 1: Update backend/.env**

```ini
AI_SERVICE_WSS_URL=wss://<user>-truetilawah-asr.hf.space/ws/evaluate
AI_SERVICE_AUTH_TOKEN=<same value as HF Space secret>
```

- [ ] **Step 2: Restart Node**

`cd backend && npm run dev`. Confirm logs say it's connecting to the HF URL.

- [ ] **Step 3: Run replay script**

`cd backend && node scripts/test_audio_ws.js`. Expected: same events flow as in Task 18, just with higher latency due to network hop. No DB-shape changes.

---

### Task 28: Smoke acceptance test

- [ ] **Step 1: 10-recitation manual test**

Pick 10 short ayah ranges (varying surahs, total ~20–30 ayahs). For each:
- Recite naturally — note time-to-highlight and time-to-audio for any mistakes.
- Recite with deliberate errors — confirm red highlight, audio playback, repeat-or-skip behaviour.
- Compare the final `Feedback` rows in MySQL to the manually-flagged errors.

Pass criteria (from spec §9.3):

| Check | Pass criterion |
|---|---|
| Mispronounced word turns red within ~1 s | ≥ 9/10 |
| Correct word audible within ~1.3 s | ≥ 9/10 |
| Re-read corrected word turns green | ≥ 8/10 |
| Skipped mistake fades to acknowledged within 2 s | 10/10 |
| Same `(ayah, word)` never re-fires red in one ayah | 10/10 |
| Final report grade matches `Feedback` rows | 10/10 |

- [ ] **Step 2: Document results**

Append a short results table to `docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md` under a new §13 "Acceptance test results — 2026-MM-DD" with the actual numbers.

- [ ] **Step 3: Commit acceptance log**

```bash
git add docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md
git commit -m "docs: log streaming Tarteel acceptance test results"
```

---

## Done

All 28 tasks complete. Final state:

- ai-service runs Tarteel via faster-whisper on a free HF Space.
- Word lock-in + per-word diff + state machine emit `partial_mistake`, `word_corrected`, `mistake_acknowledged`, `ayah_finalized`.
- Node relays new events; only `ayah_finalized` writes `Feedback`.
- Frontend renders ayahs word-by-word with state-driven colour and instant TTS playback from EveryAyah.
- Repeat-or-skip handled gracefully (no nagging, 2 s timeout, suppressed re-emission).

**Rollback path:** if Tarteel accuracy is unacceptable, set `TRANSCRIPTION_PROVIDER=groq` in the Space env and rebuild. The streaming inner loop is provider-agnostic.
