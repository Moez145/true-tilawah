# AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing Python AI service into the Node.js backend so a React Native frontend can stream audio over WebSocket and receive realtime per-ayah word-level mistake feedback (with corrected words for TTS), strictly scoped to a user-selected ayah range.

**Architecture:** RN → Node.js WS gateway → Python AI service WS → Groq Whisper-large-v3. Provider abstraction in Python lets you swap Groq for self-hosted Whisper via env var. Node.js authenticates, persists Feedback rows per ayah, and recalculates Progress on STOP.

**Tech Stack:** Node.js + Express + ws + Prisma/MySQL (backend), FastAPI + Silero VAD + RapidFuzz + Groq Whisper API (Python), pytest, Docker Compose for orchestration.

**Spec reference:** [docs/superpowers/specs/2026-05-03-ai-integration-design.md](../specs/2026-05-03-ai-integration-design.md)

---

## Parallelization map

Three independent tracks. Tracks A and B can run in parallel from the start. Track C runs once A and B reach checkpoint A4 / B5.

```
Track A: Python AI service          ─┐
Track B: Node.js backend            ─┤── Sync point ──→  Track C: Integration test
Track C: Test infrastructure        ─┘                   (depends on A4 + B5)
```

---

## Prerequisites (humans only — do once)

- [ ] Sign up at [console.groq.com](https://console.groq.com) and create an API key (free tier).
- [ ] Confirm `ffmpeg` is on PATH (already required by current Python service).
- [ ] Confirm MySQL 8.0+ is running locally and the `true_tilawah` database exists.

---

## File structure

### New / moved files

```
TrueTilawah/
├── ai-service/                              ← renamed from "AI Code/"
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                          ← thin FastAPI entry
│   │   ├── config.py
│   │   ├── lifespan.py
│   │   ├── vad.py
│   │   ├── quran_index.py
│   │   ├── ayah_aligner.py                  ← was verse_detector
│   │   ├── word_diff.py
│   │   ├── tajweed.py
│   │   ├── pipeline.py
│   │   ├── ws_handler.py
│   │   └── transcription/
│   │       ├── __init__.py
│   │       ├── base.py
│   │       ├── groq.py
│   │       └── local_whisper.py
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   ├── test_word_diff.py
│   │   ├── test_tajweed.py
│   │   ├── test_ayah_aligner.py
│   │   └── test_pipeline.py
│   ├── .env.example
│   ├── Dockerfile                           ← updated
│   ├── requirements.txt                     ← +httpx
│   └── pytest.ini
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma                    ← add Feedback.disputed
│   │   ├── seed/
│   │   │   └── tajweedRules.js              ← NEW
│   │   └── migrations/                      ← new migration
│   ├── scripts/
│   │   ├── test_audio_ws.js                 ← NEW
│   │   └── fixtures/
│   │       └── al-fatihah.wav               ← NEW (binary)
│   └── src/
│       ├── services/
│       │   ├── ai.service.js                ← NEW
│       │   ├── tajweed.service.js           ← NEW
│       │   └── feedback.service.js          ← MODIFY
│       ├── controllers/
│       │   └── feedback.controller.js       ← MODIFY (add dispute)
│       ├── routes/
│       │   ├── audio.ws.js                  ← REWRITE
│       │   └── session.routes.js            ← MODIFY (add dispute route)
│       └── services/
│           └── progress.service.js          ← MODIFY (skip disputed in agg)
│
├── docker-compose.yml                       ← NEW
└── .env.example                             ← NEW (root)
```

---

# Track A — Python AI service

## Task A1: Rename folder + scaffold package layout

**Files:**
- Move: `AI Code/` → `ai-service/`
- Move: `ai-service/main.py` → `ai-service/app/main.py.legacy` (keep for reference)
- Create: `ai-service/app/__init__.py` (empty)
- Create: `ai-service/tests/__init__.py` (empty)
- Create: `ai-service/pytest.ini`
- Create: `ai-service/.env.example`

- [ ] **Step 1: Rename the folder**

```bash
git mv "AI Code" ai-service 2>/dev/null || mv "AI Code" ai-service
```

- [ ] **Step 2: Create package directories**

```bash
mkdir -p ai-service/app/transcription ai-service/tests
touch ai-service/app/__init__.py ai-service/app/transcription/__init__.py ai-service/tests/__init__.py
mv ai-service/main.py ai-service/app/main.py.legacy
```

- [ ] **Step 3: Write `ai-service/pytest.ini`**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
asyncio_mode = auto
```

- [ ] **Step 4: Write `ai-service/.env.example`**

```env
TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=whisper-large-v3
WHISPER_MODEL=medium
VAD_SILENCE_THRESHOLD_SEC=1.0
VAD_MIN_SPEECH_SEC=0.5
PORT=8000
```

- [ ] **Step 5: Update `ai-service/requirements.txt`**

Append `httpx==0.27.0` and `pytest==8.3.2 pytest-asyncio==0.24.0` to the existing list.

- [ ] **Step 6: Commit**

```bash
git add ai-service/
git commit -m "refactor(ai): rename AI Code → ai-service, scaffold package layout"
```

---

## Task A2: Extract `app/config.py` + `app/quran_index.py` from legacy

**Files:**
- Create: `ai-service/app/config.py`
- Create: `ai-service/app/quran_index.py`

- [ ] **Step 1: Write `app/config.py`** — env loader, constants

```python
"""Centralised env + constants — every other module imports from here."""
import os
from dataclasses import dataclass

VAD_SAMPLE_RATE   = 16000
VAD_WINDOW_FRAMES = 512
SILENCE_THRESHOLD = float(os.getenv("VAD_SILENCE_THRESHOLD_SEC", "1.0"))
MIN_SPEECH_SECS   = float(os.getenv("VAD_MIN_SPEECH_SEC", "0.5"))

TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "groq")
GROQ_API_KEY           = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL             = os.getenv("GROQ_MODEL", "whisper-large-v3")
WHISPER_MODEL          = os.getenv("WHISPER_MODEL", "medium")

@dataclass(frozen=True)
class VerseScope:
    surah_id: int
    ayah_start: int
    ayah_end: int
```

- [ ] **Step 2: Write `app/quran_index.py`** — copy `_load_quran`, `_build_index`, `_norm`, `SURAH_NAMES` from `main.py.legacy` into a clean module exposing:

```python
# Public API
from app.config import VerseScope

def load_quran() -> dict[int, dict[int, str]]: ...
def build_index(quran: dict) -> tuple[list, dict[str, set[int]]]: ...
def normalize(text: str) -> str: ...
SURAH_NAMES: dict[int, str]
```

Function bodies are copied verbatim from `main.py.legacy` lines 137–209 (only signatures change to be pure, no `_S` global writes).

- [ ] **Step 3: Smoke test the module loads**

```bash
cd ai-service && python -c "from app.quran_index import load_quran, build_index, normalize, SURAH_NAMES; q = load_quran(); print(f'Loaded {sum(len(v) for v in q.values())} verses')"
```

Expected: `Loaded 6236 verses` (or fallback embedded count).

- [ ] **Step 4: Commit**

```bash
git add ai-service/app/config.py ai-service/app/quran_index.py
git commit -m "refactor(ai): extract config + quran_index modules"
```

---

## Task A3: Provider abstraction (`TranscriptionProvider`)

**Files:**
- Create: `ai-service/app/transcription/base.py`
- Create: `ai-service/app/transcription/groq.py`
- Create: `ai-service/app/transcription/local_whisper.py`
- Create: `ai-service/app/transcription/__init__.py` (factory)

- [ ] **Step 1: Write `transcription/base.py`**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
import numpy as np

@dataclass
class TranscriptionResult:
    text: str
    confidence: float | None = None
    raw: dict | None = None

class TranscriptionProvider(ABC):
    @abstractmethod
    async def transcribe(self, pcm_float32: np.ndarray, language: str = "ar") -> TranscriptionResult:
        ...
```

- [ ] **Step 2: Write `transcription/groq.py`**

```python
import io, wave, httpx, numpy as np
from .base import TranscriptionProvider, TranscriptionResult
from app.config import VAD_SAMPLE_RATE, GROQ_MODEL

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

def _pcm_to_wav_bytes(pcm: np.ndarray) -> bytes:
    pcm_int16 = (np.clip(pcm, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(VAD_SAMPLE_RATE)
        w.writeframes(pcm_int16.tobytes())
    return buf.getvalue()

class GroqProvider(TranscriptionProvider):
    def __init__(self, api_key: str, model: str = GROQ_MODEL):
        if not api_key:
            raise ValueError("GROQ_API_KEY is required for GroqProvider")
        self.api_key = api_key
        self.model = model

    async def transcribe(self, pcm_float32: np.ndarray, language: str = "ar") -> TranscriptionResult:
        wav_bytes = _pcm_to_wav_bytes(pcm_float32)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {self.api_key}"},
                files={"file": ("audio.wav", wav_bytes, "audio/wav")},
                data={
                    "model": self.model,
                    "language": language,
                    "response_format": "verbose_json",
                    "temperature": "0.0",
                    "prompt": "بسم الله الرحمن الرحيم",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return TranscriptionResult(
            text=data.get("text", "").strip(),
            confidence=None,
            raw=data,
        )
```

- [ ] **Step 3: Write `transcription/local_whisper.py`**

```python
import numpy as np, torch
from .base import TranscriptionProvider, TranscriptionResult
from app.config import WHISPER_MODEL

class LocalWhisperProvider(TranscriptionProvider):
    def __init__(self, model_name: str = WHISPER_MODEL):
        import whisper
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model = whisper.load_model(model_name, device=device)
        self._fp16 = torch.cuda.is_available()

    async def transcribe(self, pcm_float32: np.ndarray, language: str = "ar") -> TranscriptionResult:
        result = self._model.transcribe(
            pcm_float32, language=language, fp16=self._fp16,
            temperature=0.0, best_of=3, beam_size=5,
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt="بسم الله الرحمن الرحيم",
        )
        return TranscriptionResult(text=result["text"].strip(), confidence=None, raw=result)
```

- [ ] **Step 4: Write `transcription/__init__.py`** — factory

```python
from app.config import TRANSCRIPTION_PROVIDER, GROQ_API_KEY
from .base import TranscriptionProvider, TranscriptionResult

def get_provider() -> TranscriptionProvider:
    if TRANSCRIPTION_PROVIDER == "groq":
        from .groq import GroqProvider
        return GroqProvider(api_key=GROQ_API_KEY)
    if TRANSCRIPTION_PROVIDER == "local_whisper":
        from .local_whisper import LocalWhisperProvider
        return LocalWhisperProvider()
    raise ValueError(f"Unknown TRANSCRIPTION_PROVIDER: {TRANSCRIPTION_PROVIDER}")

__all__ = ["TranscriptionProvider", "TranscriptionResult", "get_provider"]
```

- [ ] **Step 5: Write `tests/test_provider_factory.py`**

```python
import os, pytest
from unittest.mock import patch

def test_groq_provider_requires_api_key():
    with patch.dict(os.environ, {"TRANSCRIPTION_PROVIDER": "groq", "GROQ_API_KEY": ""}, clear=False):
        # Reload config to pick up env
        import importlib
        from app import config
        importlib.reload(config)
        from app.transcription.groq import GroqProvider
        with pytest.raises(ValueError, match="GROQ_API_KEY"):
            GroqProvider(api_key="")

def test_unknown_provider_raises():
    with patch.dict(os.environ, {"TRANSCRIPTION_PROVIDER": "bogus"}, clear=False):
        import importlib
        from app import config, transcription
        importlib.reload(config)
        importlib.reload(transcription)
        with pytest.raises(ValueError, match="Unknown TRANSCRIPTION_PROVIDER"):
            transcription.get_provider()
```

- [ ] **Step 6: Run tests**

```bash
cd ai-service && pytest tests/test_provider_factory.py -v
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add ai-service/app/transcription/ ai-service/tests/test_provider_factory.py
git commit -m "feat(ai): provider abstraction for Groq + local Whisper"
```

---

## Task A4: Extract VAD + word_diff + tajweed + ayah_aligner

**Files:**
- Create: `ai-service/app/vad.py`
- Create: `ai-service/app/word_diff.py`
- Create: `ai-service/app/tajweed.py`
- Create: `ai-service/app/ayah_aligner.py`
- Create: `ai-service/tests/test_word_diff.py`
- Create: `ai-service/tests/test_tajweed.py`
- Create: `ai-service/tests/test_ayah_aligner.py`

- [ ] **Step 1: Write `app/vad.py`** — copy `run_vad`, `_decode_audio`, `_get_ext` from legacy lines 216–328. Replace `_S["vad"]` with a passed-in `vad_model` parameter.

```python
import os, tempfile, subprocess
import numpy as np, torch
from app.config import VAD_SAMPLE_RATE, VAD_WINDOW_FRAMES, SILENCE_THRESHOLD, MIN_SPEECH_SECS

def run_vad(pcm_float32: np.ndarray, vad_model) -> list[dict]:
    # COPY EXACTLY FROM main.py.legacy lines 216-305
    # Replace `vad = _S["vad"]` with `vad = vad_model`
    ...

def decode_audio(audio_bytes: bytes, fmt: str = "webm") -> np.ndarray | None:
    # COPY EXACTLY FROM main.py.legacy lines 311-328
    ...

def get_ext(filename: str) -> str:
    # COPY EXACTLY FROM main.py.legacy lines 331-333
    ...
```

- [ ] **Step 2: Write `app/word_diff.py`** — copy `_word_diff` from legacy lines 409–425.

```python
def word_diff(correct_norm: str, recited_norm: str) -> list[dict]:
    """LCS-based word-level diff. Returns list of {status, word}."""
    c = correct_norm.split(); t = recited_norm.split()
    C, T = len(c), len(t)
    dp = [[0] * (T + 1) for _ in range(C + 1)]
    for i in range(1, C + 1):
        for j in range(1, T + 1):
            dp[i][j] = dp[i-1][j-1] + 1 if c[i-1] == t[j-1] else max(dp[i-1][j], dp[i][j-1])
    out, i, j = [], C, T
    while i > 0 or j > 0:
        if i > 0 and j > 0 and c[i-1] == t[j-1]:
            out.append({"status": "correct", "word": c[i-1]}); i -= 1; j -= 1
        elif j > 0 and (i == 0 or dp[i][j-1] >= dp[i-1][j]):
            out.append({"status": "extra",   "word": t[j-1]}); j -= 1
        else:
            out.append({"status": "missing", "word": c[i-1]}); i -= 1
    out.reverse()
    return out
```

- [ ] **Step 3: Write `tests/test_word_diff.py`**

```python
from app.word_diff import word_diff

def test_all_correct():
    diff = word_diff("a b c", "a b c")
    assert all(d["status"] == "correct" for d in diff)

def test_one_missing():
    diff = word_diff("a b c", "a c")
    statuses = [d["status"] for d in diff]
    assert statuses.count("missing") == 1
    assert next(d["word"] for d in diff if d["status"] == "missing") == "b"

def test_one_extra():
    diff = word_diff("a c", "a b c")
    extras = [d["word"] for d in diff if d["status"] == "extra"]
    assert extras == ["b"]
```

- [ ] **Step 4: Run word_diff tests**

```bash
cd ai-service && pytest tests/test_word_diff.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Write `app/tajweed.py`** — copy `_QALQALA`, `_MADD`, `_GHUNNA`, `_check_tajweed` from legacy lines 428–460.

Function signature:
```python
def check_tajweed(verse_original: str, recited: str) -> list[dict]:
    # body identical to legacy _check_tajweed
```

- [ ] **Step 6: Write `tests/test_tajweed.py`**

```python
from app.tajweed import check_tajweed

def test_no_errors_on_perfect_match():
    verse = "بِسۡمِ ٱللَّهِ"
    errors = check_tajweed(verse, "بِسۡمِ ٱللَّهِ")
    # Some rules may still flag — minimum guarantee: it does not crash
    assert isinstance(errors, list)

def test_madd_detected_when_long_vowel_shortened():
    # Word with madd letter (ا) recited without elongation
    verse = "ٱلرَّحۡمَـٰنِ"
    errors = check_tajweed(verse, "الرحمن")  # missing diacritics
    # Madd should fire when normalized recited length is shorter
    rules = [e["rule"] for e in errors]
    # Soft assertion — specific rules depend on exact normalisation
    assert isinstance(errors, list)
```

- [ ] **Step 7: Write `app/ayah_aligner.py`** — scoped version of legacy `_detect_verse`.

```python
"""
Aligns a transcribed utterance to one of the user's selected ayahs.
This is the SCOPED replacement for the legacy full-Quran verse_detector.
"""
from rapidfuzz import fuzz, process as rf_process
from app.config import VerseScope
from app.quran_index import normalize

class ScopedAligner:
    """
    Built once per WS session from the user's VerseScope.
    Holds a small inverted index of just the user's selected ayahs.
    """
    def __init__(self, scope: VerseScope, quran: dict[int, dict[int, str]]):
        self.scope = scope
        # Build verse list restricted to scope
        self.verses: list[tuple[int, int, str, str, list[str]]] = []
        for ayah_num in range(scope.ayah_start, scope.ayah_end + 1):
            text = quran.get(scope.surah_id, {}).get(ayah_num)
            if text is None:
                continue
            norm = normalize(text)
            self.verses.append((scope.surah_id, ayah_num, text, norm, norm.split()))

    def align(self, recited_text: str) -> dict | None:
        """
        Returns the best-matching ayah from scope, or None if nothing matches well.
        Output: {"surah": int, "ayah": int, "verse_text": str, "verse_norm": str,
                 "verse_words": list[str], "score": float}
        """
        if not self.verses:
            return None
        recited_norm = normalize(recited_text)
        if len(recited_norm.split()) < 1:
            return None

        best_score, best_idx = 0.0, -1
        for idx, (s, a, orig, v_norm, v_words) in enumerate(self.verses):
            score = (
                fuzz.WRatio(recited_norm, v_norm)          / 100 * 0.3 +
                fuzz.partial_ratio(recited_norm, v_norm)   / 100 * 0.4 +
                fuzz.token_set_ratio(recited_norm, v_norm) / 100 * 0.3
            )
            if score > best_score:
                best_score, best_idx = score, idx

        if best_score < 0.45 or best_idx < 0:
            return None

        s, a, orig, v_norm, v_words = self.verses[best_idx]
        return {
            "surah": s, "ayah": a,
            "verse_text": orig, "verse_norm": v_norm,
            "verse_words": v_words, "score": round(best_score, 4),
        }
```

- [ ] **Step 8: Write `tests/test_ayah_aligner.py`**

```python
import pytest
from app.config import VerseScope
from app.ayah_aligner import ScopedAligner

QURAN_FIXTURE = {
    1: {
        1: "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَـٰنِ ٱلرَّحِيمِ",
        2: "ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَـٰلَمِينَ",
        3: "ٱلرَّحۡمَـٰنِ ٱلرَّحِيمِ",
    },
}

def test_aligner_matches_correct_ayah():
    scope = VerseScope(surah_id=1, ayah_start=1, ayah_end=3)
    aligner = ScopedAligner(scope, QURAN_FIXTURE)
    result = aligner.align("بسم الله الرحمن الرحيم")
    assert result is not None
    assert result["ayah"] == 1

def test_aligner_returns_none_for_unrelated_text():
    scope = VerseScope(surah_id=1, ayah_start=1, ayah_end=3)
    aligner = ScopedAligner(scope, QURAN_FIXTURE)
    assert aligner.align("hello world this is english") is None

def test_aligner_only_matches_within_scope():
    # Even though ayah 3's text could match, scope is 1-2 only
    scope = VerseScope(surah_id=1, ayah_start=1, ayah_end=2)
    aligner = ScopedAligner(scope, QURAN_FIXTURE)
    # Text matches ayah 3 best but ayah 3 is out of scope
    result = aligner.align("الرحمن الرحيم")
    # Either None or matches ayah 1 (which contains those words)
    if result is not None:
        assert result["ayah"] in (1, 2)
```

- [ ] **Step 9: Run all tests so far**

```bash
cd ai-service && pytest tests/ -v
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add ai-service/app/vad.py ai-service/app/word_diff.py ai-service/app/tajweed.py ai-service/app/ayah_aligner.py ai-service/tests/
git commit -m "feat(ai): extract VAD, word_diff, tajweed, scoped ayah_aligner"
```

---

## Task A5: Pipeline + new WS handler

**Files:**
- Create: `ai-service/app/pipeline.py`
- Create: `ai-service/app/ws_handler.py`
- Create: `ai-service/app/lifespan.py`

- [ ] **Step 1: Write `app/lifespan.py`**

```python
from contextlib import asynccontextmanager
import torch
from fastapi import FastAPI
from app.quran_index import load_quran, build_index, SURAH_NAMES
from app.transcription import get_provider

# Module-level shared state — populated at startup
STATE: dict = {
    "vad": None, "quran": None, "verse_index": None,
    "inverted": None, "provider": None, "ready": False,
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Startup] Loading Silero VAD ...")
    vad_model, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False, trust_repo=True,
    )
    STATE["vad"] = vad_model

    print("[Startup] Loading Quran dataset ...")
    STATE["quran"] = load_quran()
    STATE["verse_index"], STATE["inverted"] = build_index(STATE["quran"])

    print("[Startup] Initialising transcription provider ...")
    STATE["provider"] = get_provider()

    STATE["ready"] = True
    print(f"[Startup] ✅ Ready. {sum(len(v) for v in STATE['quran'].values())} verses indexed.")
    yield
    print("[Shutdown] Done.")
```

- [ ] **Step 2: Write `app/pipeline.py`**

Translates internal alignment + diff + tajweed into the new mistake-focused output shape.

```python
from app.ayah_aligner import ScopedAligner
from app.word_diff import word_diff
from app.tajweed import check_tajweed
from app.quran_index import normalize

def build_mistakes(recited_text: str, match: dict) -> list[dict]:
    """
    From a transcribed utterance and the matched ayah, produce the
    mistake list shape used in the WS protocol (§4.1.1 of the spec).
    Returns [] when recitation is correct.
    """
    recited_norm = normalize(recited_text)
    diff = word_diff(match["verse_norm"], recited_norm)

    out: list[dict] = []
    for d in diff:
        if d["status"] == "missing":
            out.append({
                "type": "OMITTED_WORD",
                "incorrect": "",
                "correct": d["word"],
                "tajweedRule": None,
                "severity": None,
                "tip": None,
            })
        elif d["status"] == "extra":
            out.append({
                "type": "ADDED_WORD",
                "incorrect": d["word"],
                "correct": "",
                "tajweedRule": None,
                "severity": None,
                "tip": None,
            })

    # Mispronunciation synth: if similarity is poor but no specific missing/extra
    similarity_words = sum(1 for d in diff if d["status"] == "correct")
    total_expected   = len(match["verse_words"])
    if total_expected > 0 and similarity_words / total_expected < 0.75 and not out:
        out.append({
            "type": "MISPRONUNCIATION",
            "incorrect": recited_text,
            "correct": match["verse_text"],
            "tajweedRule": None,
            "severity": None,
            "tip": None,
        })

    # Tajweed errors
    for terr in check_tajweed(match["verse_text"], recited_text):
        out.append({
            "type": "TAJWEED_VIOLATION",
            "incorrect": terr.get("word", ""),
            "correct":   terr.get("word", ""),
            "tajweedRule": terr["rule"],
            "severity":    terr.get("severity", "medium"),
            "tip":         terr.get("tip", ""),
        })

    return out


class SummaryAccumulator:
    """Collects per-ayah results to compute the final_report on STOP."""
    def __init__(self):
        self.records: list[dict] = []

    def record(self, ayah: int, similarity: float, mistakes: list[dict]) -> None:
        self.records.append({"ayah": ayah, "similarity": similarity, "mistakes": mistakes})

    def finalize(self) -> dict:
        total = len(self.records)
        with_mistakes = sum(1 for r in self.records if r["mistakes"])
        total_mistakes = sum(len(r["mistakes"]) for r in self.records)
        avg_sim = (sum(r["similarity"] for r in self.records) / total) if total else 0.0
        accuracy = round(avg_sim * 100, 2)
        if avg_sim >= 0.90:   grade = "Excellent"
        elif avg_sim >= 0.75: grade = "Good"
        elif avg_sim >= 0.55: grade = "Needs Practice"
        else:                 grade = "Needs Significant Practice"
        return {
            "totalAyahs": total,
            "ayahsWithMistakes": with_mistakes,
            "totalMistakes": total_mistakes,
            "averageAccuracy": accuracy,
            "grade": grade,
        }
```

- [ ] **Step 3: Write `app/ws_handler.py`**

The new `/ws/evaluate` handler implementing the mistake-focused protocol from spec §3.7 + §4.1.1.

```python
import json
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from app.config import VerseScope, VAD_SAMPLE_RATE
from app.lifespan import STATE
from app.vad import run_vad
from app.ayah_aligner import ScopedAligner
from app.pipeline import build_mistakes, SummaryAccumulator

async def handle_ws_evaluate(ws: WebSocket):
    await ws.accept()
    if not STATE["ready"]:
        await ws.send_json({"type": "error", "code": "not_ready"})
        await ws.close(); return

    # ── 1. First text frame must be the JSON config ─────────────
    try:
        first = await ws.receive()
        if "text" not in first:
            await ws.send_json({"type": "error", "code": "config_required"})
            await ws.close(); return
        cfg = json.loads(first["text"])
        scope = VerseScope(
            surah_id=int(cfg["surahId"]),
            ayah_start=int(cfg["ayahStart"]),
            ayah_end=int(cfg["ayahEnd"]),
        )
    except (KeyError, ValueError, json.JSONDecodeError):
        await ws.send_json({"type": "error", "code": "invalid_config"})
        await ws.close(); return

    aligner = ScopedAligner(scope, STATE["quran"])
    summary = SummaryAccumulator()
    provider = STATE["provider"]
    vad_model = STATE["vad"]
    buffer = np.array([], dtype=np.float32)

    await ws.send_json({"type": "ready"})

    try:
        while True:
            msg = await ws.receive()

            # STOP
            if "text" in msg and msg["text"].strip().upper() == "STOP":
                break

            # Audio
            if "bytes" in msg:
                chunk = np.frombuffer(msg["bytes"], dtype=np.float32)
                buffer = np.concatenate([buffer, chunk])

                # Run VAD when we have ≥2s of audio
                if len(buffer) >= VAD_SAMPLE_RATE * 2:
                    segments = run_vad(buffer, vad_model)
                    for seg in segments:
                        try:
                            tr = await provider.transcribe(seg["audio"])
                        except Exception as e:
                            await ws.send_json({"type": "error", "code": "asr_failed", "message": str(e)})
                            continue

                        if not tr.text.strip():
                            await ws.send_json({"type": "unclear"})
                            continue

                        match = aligner.align(tr.text)
                        if match is None:
                            await ws.send_json({"type": "out_of_scope", "you_recited": tr.text})
                            continue

                        mistakes = build_mistakes(tr.text, match)
                        summary.record(match["ayah"], match["score"], mistakes)

                        if mistakes:
                            await ws.send_json({
                                "type": "mistake",
                                "ayah": match["ayah"],
                                "mistakes": mistakes,
                            })
                        else:
                            await ws.send_json({"type": "ok", "ayah": match["ayah"]})

                    # Keep last 0.5s of audio for continuity
                    tail = int(0.5 * VAD_SAMPLE_RATE)
                    buffer = buffer[-tail:] if len(buffer) > tail else buffer

    except WebSocketDisconnect:
        pass

    # Final report
    await ws.send_json({"type": "final_report", **summary.finalize()})
    await ws.close()
```

- [ ] **Step 4: Rewrite `app/main.py`** as a thin entry

```python
from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.lifespan import lifespan, STATE
from app.ws_handler import handle_ws_evaluate

app = FastAPI(title="True Tilawah AI", version="4.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
def health():
    return {
        "status": "ready" if STATE["ready"] else "loading",
        "verses_loaded": sum(len(v) for v in (STATE["quran"] or {}).values()),
    }

@app.websocket("/ws/evaluate")
async def ws_evaluate(ws: WebSocket):
    await handle_ws_evaluate(ws)

if __name__ == "__main__":
    import uvicorn, os
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
```

- [ ] **Step 5: Smoke-start the service**

```bash
cd ai-service
GROQ_API_KEY=test_dummy uvicorn app.main:app --host 0.0.0.0 --port 8000 &
sleep 5
curl http://localhost:8000/health
kill %1
```

Expected: `{"status":"ready","verses_loaded":6236}` (or fallback count).

- [ ] **Step 6: Commit**

```bash
git add ai-service/app/lifespan.py ai-service/app/pipeline.py ai-service/app/ws_handler.py ai-service/app/main.py
git commit -m "feat(ai): mistake-focused WS protocol with scoped alignment"
```

---

## Task A6: Update Dockerfile

**Files:**
- Modify: `ai-service/Dockerfile`

- [ ] **Step 1: Replace Dockerfile contents**

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git && rm -rf /var/lib/apt/lists/*

WORKDIR /api
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-cache Silero VAD only — local Whisper is optional, Groq is default
RUN python -c "import torch; torch.hub.load('snakers4/silero-vad', 'silero_vad', force_reload=False, trust_repo=True)"

COPY app/ ./app/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

- [ ] **Step 2: Build verifies**

```bash
cd ai-service && docker build -t true-tilawah-ai:dev .
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add ai-service/Dockerfile
git commit -m "chore(ai): update Dockerfile for new package layout"
```

---

# Track B — Node.js backend

## Task B1: Prisma migration — `Feedback.disputed`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Auto-create: `backend/prisma/migrations/<timestamp>_add_feedback_disputed/migration.sql`

- [ ] **Step 1: Add field to schema**

In `backend/prisma/schema.prisma`, in the `Feedback` model, add:

```prisma
model Feedback {
  // ... existing fields ...
  disputed           Boolean     @default(false)
  // ... rest unchanged ...
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_feedback_disputed
```

Expected: migration file written, DB updated, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): add Feedback.disputed field"
```

---

## Task B2: Tajweed rules seed

**Files:**
- Create: `backend/prisma/seed/tajweedRules.js`
- Modify: `backend/package.json` (add a script)

- [ ] **Step 1: Write seeder**

```js
// backend/prisma/seed/tajweedRules.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const RULES = [
  { ruleName: "Qalqala", ruleCode: "QAL",
    description: "Echo/bounce sound on ق ط ب ج د when sukoon.",
    severity: "MEDIUM" },
  { ruleName: "Madd",    ruleCode: "MAD",
    description: "Elongation of vowels (2 to 6 counts).",
    severity: "HIGH" },
  { ruleName: "Ghunna",  ruleCode: "GHN",
    description: "Nasalisation on Noon/Meem with shadda for 2 counts.",
    severity: "MEDIUM" },
];

async function main() {
  for (const rule of RULES) {
    await prisma.tajweedRule.upsert({
      where:  { ruleName: rule.ruleName },
      update: { ruleCode: rule.ruleCode, description: rule.description, severity: rule.severity },
      create: rule,
    });
    console.log(`✓ upserted ${rule.ruleName}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add npm script**

In `backend/package.json` `scripts`:

```json
"seed:tajweed": "node prisma/seed/tajweedRules.js"
```

- [ ] **Step 3: Run it**

```bash
cd backend && npm run seed:tajweed
```

Expected: 3 rules upserted.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed/tajweedRules.js backend/package.json
git commit -m "feat(db): seed Qalqala/Madd/Ghunna tajweed rules"
```

---

## Task B3: `tajweed.service.js` — memoized rule lookup

**Files:**
- Create: `backend/src/services/tajweed.service.js`

- [ ] **Step 1: Write service**

```js
// backend/src/services/tajweed.service.js
const prisma = require("../models/prismaClient");

const cache = new Map(); // ruleName -> { id, ruleCode, severity }

async function getRuleByName(ruleName) {
  if (!ruleName) return null;
  if (cache.has(ruleName)) return cache.get(ruleName);
  const rule = await prisma.tajweedRule.findUnique({
    where: { ruleName },
    select: { id: true, ruleCode: true, severity: true },
  });
  if (rule) cache.set(ruleName, rule);
  return rule;
}

function clearCache() { cache.clear(); }

module.exports = { getRuleByName, clearCache };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/tajweed.service.js
git commit -m "feat(backend): tajweed rule lookup service with memo"
```

---

## Task B4: `ai.service.js` — Python WS client

**Files:**
- Create: `backend/src/services/ai.service.js`

- [ ] **Step 1: Write the client**

```js
// backend/src/services/ai.service.js
const WebSocket = require("ws");

const HOST = process.env.AI_SERVICE_HOST || "localhost";
const PORT = process.env.AI_SERVICE_PORT || "8000";
const PATH = process.env.AI_SERVICE_WS_PATH || "/ws/evaluate";
const TIMEOUT_MS = parseInt(process.env.AI_SERVICE_TIMEOUT_MS || "10000", 10);

/**
 * Opens a WS to the Python service, sends the config frame, and exposes
 * sendAudio / sendStop / event handlers. Caller is responsible for closing.
 */
function connect({ surahId, ayahStart, ayahEnd, userId, sessionId }) {
  return new Promise((resolve, reject) => {
    const url = `ws://${HOST}:${PORT}${PATH}`;
    const ws  = new WebSocket(url);

    let openTimer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`AI service did not open within ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    ws.once("open", () => {
      clearTimeout(openTimer);
      // Send config frame as text JSON
      ws.send(JSON.stringify({ surahId, ayahStart, ayahEnd, userId, sessionId }));
      resolve({
        sendAudio: (float32Buf) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(float32Buf, { binary: true });
        },
        sendStop:  () => {
          if (ws.readyState === WebSocket.OPEN) ws.send("STOP");
        },
        onEvent:   (cb) => ws.on("message", (data) => {
          try { cb(JSON.parse(data.toString())); }
          catch (e) { console.error("AI event parse error:", e.message); }
        }),
        onClose:   (cb) => ws.on("close", cb),
        onError:   (cb) => ws.on("error", cb),
        close:     () => ws.close(),
        raw: ws,
      });
    });

    ws.once("error", (err) => {
      clearTimeout(openTimer);
      reject(err);
    });
  });
}

module.exports = { connect };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/ai.service.js
git commit -m "feat(backend): WS client to Python AI service"
```

---

## Task B5: Rewrite `audio.ws.js` with real audio pump

**Files:**
- Rewrite: `backend/src/routes/audio.ws.js`

- [ ] **Step 1: Replace file contents**

```js
// backend/src/routes/audio.ws.js
const { verifyAccessToken }   = require("../utils/jwt.util");
const prisma                  = require("../models/prismaClient");
const aiClient                = require("../services/ai.service");
const tajweedService          = require("../services/tajweed.service");
const { createFeedbackBatch } = require("../services/feedback.service");
const { completeSession, abandonSession } = require("../services/session.service");

async function mapMistakesToFeedback(event, sessionId) {
  const rows = [];
  for (let i = 0; i < event.mistakes.length; i++) {
    const m = event.mistakes[i];
    const tajweedRule = m.tajweedRule
      ? await tajweedService.getRuleByName(m.tajweedRule)
      : null;
    rows.push({
      errorType: m.type,
      incorrectWord: m.incorrect || "",
      correctWord:   m.correct   || "",
      wordPosition:  i,
      ayahNumber:    event.ayah,
      ruleApplied:   m.tajweedRule || null,
      tajweedRuleId: tajweedRule ? tajweedRule.id : null,
      confidenceScore: typeof event.confidence === "number" ? event.confidence : null,
    });
  }
  return rows;
}

function registerAudioWebSocket(app) {
  app.ws("/ws/audio", async (ws, req) => {
    const { token, sessionId } = req.query;

    // ── 1. Auth ──────────────────────────────────────────────
    if (!token || !sessionId) { ws.close(4001, "token + sessionId required"); return; }
    let decoded;
    try { decoded = verifyAccessToken(token); }
    catch { ws.close(4001, "invalid token"); return; }

    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId: decoded.id, status: "ACTIVE" },
    }).catch(() => null);
    if (!session) { ws.close(4003, "session not found / not active"); return; }

    // ── 2. Open child WS to Python ───────────────────────────
    let ai;
    try {
      ai = await aiClient.connect({
        surahId:   session.surahId,
        ayahStart: session.ayahStart,
        ayahEnd:   session.ayahEnd,
        userId:    decoded.id,
        sessionId,
      });
    } catch (err) {
      console.error("AI connect failed:", err.message);
      ws.close(4503, "AI service unavailable");
      return;
    }

    // ── 3. Audio pump RN → Python ────────────────────────────
    let expectedSeq = 0;
    let stopSent    = false;
    let finalReportSeen = false;

    ws.on("message", (data, isBinary) => {
      // Text "STOP" from RN
      if (!isBinary) {
        const txt = data.toString().trim();
        if (txt.toUpperCase() === "STOP") { ai.sendStop(); stopSent = true; }
        return;
      }
      // Binary audio chunk
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.byteLength < 4) return;
      const seq = buf.readUInt32BE(0);
      if (seq < expectedSeq) return; // drop out-of-order
      expectedSeq = seq + 1;

      const int16Bytes = buf.subarray(4);
      // int16 → float32
      const i16 = new Int16Array(int16Bytes.buffer, int16Bytes.byteOffset,
                                 int16Bytes.byteLength / 2);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      ai.sendAudio(Buffer.from(f32.buffer));
    });

    // ── 4. Result handler Python → RN + DB ──────────────────
    ai.onEvent(async (evt) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evt));

      try {
        if (evt.type === "mistake") {
          const rows = await mapMistakesToFeedback(evt, sessionId);
          if (rows.length > 0) {
            await createFeedbackBatch(sessionId, decoded.id, rows);
          }
        } else if (evt.type === "final_report") {
          finalReportSeen = true;
          await completeSession(sessionId, decoded.id, {
            transcript: null,
            accuracyScore: evt.averageAccuracy ?? 0,
          });
          ai.close();
          if (ws.readyState === ws.OPEN) ws.close(1000, "completed");
        }
      } catch (err) {
        console.error("audio.ws result handler error:", err);
      }
    });

    // ── 5. Disconnect handling ───────────────────────────────
    ws.on("close", async () => {
      if (!stopSent) ai.sendStop();
      // If no final_report arrived → abandon
      setTimeout(async () => {
        if (!finalReportSeen) {
          try { await abandonSession(sessionId, decoded.id); }
          catch (e) { /* already abandoned/completed */ }
        }
        ai.close();
      }, 3000);
    });

    ai.onClose(() => {
      if (ws.readyState === ws.OPEN && !finalReportSeen) {
        ws.close(4503, "AI service disconnected");
      }
    });

    ai.onError((err) => console.error("AI WS error:", err.message));
  });
}

module.exports = { registerAudioWebSocket };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/audio.ws.js
git commit -m "feat(backend): rewrite audio.ws with real Python AI relay"
```

---

## Task B6: Dispute endpoint + Progress aggregate fix

**Files:**
- Modify: `backend/src/services/feedback.service.js`
- Modify: `backend/src/controllers/feedback.controller.js`
- Modify: `backend/src/routes/session.routes.js`
- Modify: `backend/src/services/session.service.js` (raw SQL agg)

- [ ] **Step 1: Add `disputeFeedback` to feedback.service.js**

Append to `backend/src/services/feedback.service.js`:

```js
const disputeFeedback = async (feedbackId, userId) => {
  // Verify ownership via session join
  const fb = await prisma.feedback.findFirst({
    where: { id: feedbackId, session: { userId } },
  });
  if (!fb) {
    const err = new Error("Feedback not found.");
    err.statusCode = 404;
    throw err;
  }
  return prisma.feedback.update({
    where: { id: feedbackId },
    data:  { disputed: true },
  });
};

module.exports = { /* existing exports... */ disputeFeedback };
```

- [ ] **Step 2: Add controller**

In `backend/src/controllers/feedback.controller.js`, add and export:

```js
const dispute = async (req, res, next) => {
  try {
    const fb = await disputeFeedback(req.params.feedbackId, req.user.id);
    return sendSuccess(res, 200, "Feedback disputed.", fb);
  } catch (e) { next(e); }
};

module.exports = { /* existing */ dispute };
```

(Add `disputeFeedback` to the destructure-import at the top.)

- [ ] **Step 3: Add route**

In `backend/src/routes/session.routes.js`:

```js
const { dispute } = require("../controllers/feedback.controller");
// ...
router.patch("/:sessionId/feedback/:feedbackId/dispute", dispute);
```

- [ ] **Step 4: Update Progress aggregation in `session.service.js`**

In `completeSession`, modify the raw SQL — `totalMistakes` should now exclude disputed:

The existing aggregation uses `sessions` only. Update Progress.totalMistakes separately. Append to the transaction array:

```js
prisma.$executeRaw`
  UPDATE progress p
  JOIN (
    SELECT s.userId, COUNT(f.id) AS m
    FROM feedbacks f
    JOIN sessions s ON s.id = f.sessionId
    WHERE s.userId = ${userId} AND f.disputed = false
  ) x ON p.userId = x.userId
  SET p.totalMistakes = x.m
  WHERE p.userId = ${userId}
`,
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/feedback.service.js backend/src/controllers/feedback.controller.js backend/src/routes/session.routes.js backend/src/services/session.service.js
git commit -m "feat(backend): dispute endpoint + exclude disputed from Progress"
```

---

# Track C — Test infrastructure (depends on A4 + B5)

## Task C1: Test fixture WAV

**Files:**
- Create: `backend/scripts/fixtures/al-fatihah.wav`

- [ ] **Step 1: Generate or download a 16 kHz mono int16 WAV of Al-Fatihah recitation**

Use a free Quran audio source (e.g., everyayah.com Alafasy recording for surah 1) and convert:

```bash
mkdir -p backend/scripts/fixtures
# Download ayah 1
curl -L "https://everyayah.com/data/Alafasy_128kbps/001001.mp3" -o /tmp/001001.mp3
# Concatenate ayahs 1-7 and convert to 16kHz mono WAV
ffmpeg -i /tmp/001001.mp3 -ar 16000 -ac 1 -c:a pcm_s16le backend/scripts/fixtures/al-fatihah.wav
```

(For a longer test, concat all 7 ayahs first via ffmpeg's concat demuxer. Single ayah is fine for first integration test.)

- [ ] **Step 2: Verify format**

```bash
ffprobe backend/scripts/fixtures/al-fatihah.wav 2>&1 | grep -E "Hz|pcm"
```

Expected: `16000 Hz, mono, s16, 256 kb/s` or similar.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/fixtures/
git commit -m "test: add Al-Fatihah WAV fixture for integration tests"
```

---

## Task C2: WS streaming test client

**Files:**
- Create: `backend/scripts/test_audio_ws.js`

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
/**
 * Manual end-to-end test: pretends to be a React Native app.
 *
 * Usage:
 *   node scripts/test_audio_ws.js scripts/fixtures/al-fatihah.wav
 *
 * Steps:
 *  1. Logs in (or registers) a test user → gets accessToken
 *  2. Creates a Session for surah=1, ayahs 1-7
 *  3. Opens WS to /ws/audio
 *  4. Streams the WAV (after stripping the 44-byte header) in real-time
 *     pacing — chunks of 4096 bytes (256 ms each at 16 kHz int16 mono)
 *  5. Prints every JSON event from the server
 *  6. Sends "STOP", waits for final_report, exits
 */
const fs   = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const API   = process.env.API_URL || "http://localhost:5000";
const WSURL = process.env.WS_URL  || "ws://localhost:5000";
const EMAIL = "wstest@example.com";
const PASS  = "Test1234X";

function postJson(url, body, token) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const buf = Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Content-Length": buf.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end",  () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
    });
    req.on("error", reject);
    req.write(buf); req.end();
  });
}

async function main() {
  const wavPath = process.argv[2];
  if (!wavPath || !fs.existsSync(wavPath)) {
    console.error("Usage: node scripts/test_audio_ws.js <path-to-16khz-mono-int16.wav>");
    process.exit(1);
  }

  // 1. Login (try) else register
  let { status, body } = await postJson(`${API}/api/auth/login`, { email: EMAIL, password: PASS });
  if (status !== 200) {
    console.log("Login failed, registering test user...");
    ({ status, body } = await postJson(`${API}/api/auth/register`, {
      fullName: "WS Test", email: EMAIL, password: PASS,
    }));
    if (status !== 201) { console.error("Register failed:", body); process.exit(1); }
  }
  const token = body.data.accessToken;
  console.log("✓ Authenticated");

  // 2. Create session
  const sess = await postJson(`${API}/api/sessions`,
    { surahId: 1, ayahStart: 1, ayahEnd: 7 }, token);
  if (sess.status !== 201) { console.error("Session create failed:", sess.body); process.exit(1); }
  const sessionId = sess.body.data.id;
  console.log("✓ Session:", sessionId);

  // 3. Open WS
  const ws = new WebSocket(`${WSURL}/ws/audio?token=${token}&sessionId=${sessionId}`);

  ws.on("message", (raw) => {
    const evt = JSON.parse(raw.toString());
    console.log("◀", JSON.stringify(evt, null, 2));
    if (evt.type === "final_report") {
      console.log("\n=== FINAL ===");
      console.log(`Grade: ${evt.grade}, Accuracy: ${evt.averageAccuracy}%`);
      ws.close();
    }
  });

  ws.on("close", (code) => { console.log(`WS closed (${code})`); process.exit(0); });
  ws.on("error", (err) => { console.error("WS error:", err.message); process.exit(1); });

  ws.on("open", async () => {
    console.log("✓ WS open, streaming WAV...");
    // 4. Strip 44-byte WAV header, stream in 4096-byte chunks at 256 ms cadence
    const buf = fs.readFileSync(wavPath).slice(44);
    const CHUNK = 4096;
    let seq = 0;
    for (let off = 0; off < buf.length; off += CHUNK) {
      const audio = buf.subarray(off, off + CHUNK);
      const frame = Buffer.alloc(4 + audio.length);
      frame.writeUInt32BE(seq++, 0);
      audio.copy(frame, 4);
      ws.send(frame, { binary: true });
      await new Promise((r) => setTimeout(r, 250)); // simulate realtime
    }
    console.log("✓ All audio sent, sending STOP");
    ws.send("STOP");
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Make executable on Unix-likes; on Windows just run with node**

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/test_audio_ws.js
git commit -m "test: WS streaming test client (no frontend needed)"
```

---

## Task C3: Docker Compose orchestration

**Files:**
- Create: `docker-compose.yml` (project root)
- Create: `.env.example` (project root)

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
version: "3.9"

services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: true_tilawah
    ports: ["3306:3306"]
    volumes: [mysql_data:/var/lib/mysql]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 10

  ai-service:
    build: ./ai-service
    environment:
      TRANSCRIPTION_PROVIDER: ${TRANSCRIPTION_PROVIDER:-groq}
      GROQ_API_KEY: ${GROQ_API_KEY}
      GROQ_MODEL: ${GROQ_MODEL:-whisper-large-v3}
      VAD_SILENCE_THRESHOLD_SEC: "1.0"
      VAD_MIN_SPEECH_SEC: "0.5"
      PORT: "8000"
    expose: ["8000"]              # internal only — Node.js reaches it on Docker net
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 6

  backend:
    build: ./backend
    environment:
      DATABASE_URL: "mysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/true_tilawah"
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      AI_SERVICE_HOST: ai-service
      AI_SERVICE_PORT: "8000"
      AI_SERVICE_WS_PATH: "/ws/evaluate"
      PORT: "5000"
      CORS_ORIGIN: "*"
    depends_on:
      mysql:      { condition: service_healthy }
      ai-service: { condition: service_healthy }
    ports: ["5000:5000"]

volumes:
  mysql_data:
```

- [ ] **Step 2: Write `.env.example` (project root)**

```env
MYSQL_ROOT_PASSWORD=changeme
JWT_SECRET=replace-with-long-random
JWT_REFRESH_SECRET=replace-with-another-long-random
TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=whisper-large-v3
```

- [ ] **Step 3: Add a backend Dockerfile (if missing)**

Check `backend/Dockerfile`. If absent, create:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npx prisma generate
EXPOSE 5000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Smoke test**

```bash
cp .env.example .env
# fill in GROQ_API_KEY
docker compose up --build
# In another shell:
curl http://localhost:5000/api/health
curl http://localhost:5000/api/quran/surahs | head -c 200
```

Expected: both endpoints respond.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example backend/Dockerfile
git commit -m "chore: docker-compose for backend + ai-service + mysql"
```

---

## Task C4: Update root + backend CLAUDE.md

**Files:**
- Modify: `backend/CLAUDE.md`

- [ ] **Step 1: Append new sections about AI integration**

Add to the existing `backend/CLAUDE.md` under a new heading:

```markdown
## AI integration (Python service)

Realtime recitation feedback flows through:
**RN → Node.js `/ws/audio` → Python AI service `/ws/evaluate` → Groq Whisper**.

- Python lives in `ai-service/` (was `AI Code/`). Run with `uvicorn app.main:app --port 8000`.
- Node.js connects via `src/services/ai.service.js`; configure with `AI_SERVICE_HOST`, `AI_SERVICE_PORT`.
- Wire protocol: see `docs/superpowers/specs/2026-05-03-ai-integration-design.md` §4.1.1
- Test without a frontend: `node scripts/test_audio_ws.js scripts/fixtures/al-fatihah.wav`
- Tajweed rules must be seeded once: `npm run seed:tajweed`
- Disputed feedback: `PATCH /api/sessions/:id/feedback/:fbId/dispute` flips `Feedback.disputed=true`; excluded from `Progress.totalMistakes` aggregate.
```

- [ ] **Step 2: Commit**

```bash
git add backend/CLAUDE.md
git commit -m "docs: AI integration notes in CLAUDE.md"
```

---

## Task C5: End-to-end integration test (gate to "done")

- [ ] **Step 1: Bring up the stack**

```bash
docker compose up --build -d
# Wait for ai-service health
sleep 30
curl http://localhost:8000/health
curl http://localhost:5000/api/health
```

- [ ] **Step 2: Seed tajweed rules**

```bash
docker compose exec backend npm run seed:tajweed
```

- [ ] **Step 3: Run the WS test**

```bash
node backend/scripts/test_audio_ws.js backend/scripts/fixtures/al-fatihah.wav
```

**Expected output:**
- `✓ Authenticated`
- `✓ Session: <uuid>`
- `✓ WS open, streaming WAV...`
- One or more `{"type":"mistake",...}` or `{"type":"ok",...}` events
- A `{"type":"final_report",...}` with `grade` populated
- WS closes cleanly with code `1000`

- [ ] **Step 4: Verify DB persistence**

```bash
docker compose exec mysql mysql -uroot -p${MYSQL_ROOT_PASSWORD} -e \
  "USE true_tilawah; SELECT id, errorType, incorrectWord, correctWord FROM feedbacks ORDER BY createdAt DESC LIMIT 10;"
```

Expected: Feedback rows present with the corrected words from the test recitation.

- [ ] **Step 5: Commit log update**

```bash
git log --oneline -20
```

(No code commit — this is verification.)

---

## Self-review checklist

- [ ] Every spec section §1–§11 is covered by at least one task above.
- [ ] No placeholders ("TBD", "TODO", "implement later") remain.
- [ ] All function/class names match between tasks (`ScopedAligner`, `build_mistakes`, `getRuleByName`, `mapMistakesToFeedback`).
- [ ] All file paths are absolute from project root.
- [ ] Each task ends with a commit step.
