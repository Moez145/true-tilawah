# Silence Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a `waiting_for_speech` event when the reciter has been silent for ≥3 s mid-ayah (not at ayah-end), and a paired `speech_resumed` event when audio activity returns. Today the only silence-aware code is `is_recent_silence` for ayah-end detection — between ayahs / mid-ayah pauses are invisible to the client.

**Architecture:** A new `SilenceWatcher` class (per-WS instance, like `MistakeStateMachine`) that tracks `last_speech_at`. The existing `sweep_loop` in [ws_handler.py](../../../ai-service/app/ws_handler.py) (which already runs every 250 ms for state-machine timeouts) calls `silence_watcher.sweep(now)` to emit `waiting_for_speech` after the threshold elapses. The main loop calls `silence_watcher.on_speech(now)` whenever `has_speech()` returns True, which emits `speech_resumed` (only if previously emitted `waiting_for_speech`). One emit per silent stretch — never spammy.

**Tech Stack:** Python 3.11 · pytest.

---

## File Structure

- Create: [`ai-service/app/silence_watcher.py`](../../../ai-service/app/silence_watcher.py) — `SilenceWatcher` class. Single-responsibility file (matches the per-machine-per-file pattern of `streaming_buffer.py`).
- Modify: [`ai-service/app/config.py`](../../../ai-service/app/config.py) — add `WAITING_FOR_SPEECH_THRESHOLD_SEC` env var (default `3.0`).
- Modify: [`ai-service/app/ws_handler.py`](../../../ai-service/app/ws_handler.py) — instantiate the watcher, wire it into the main loop (after `has_speech()`) and into `sweep_loop`.
- Create: `ai-service/tests/test_silence_watcher.py` — pure-unit tests, no audio needed.

---

### Task 1: Failing unit test for `SilenceWatcher`

**Files:**
- Create: `ai-service/tests/test_silence_watcher.py`

- [ ] **Step 1: Write the failing test**

```python
# ai-service/tests/test_silence_watcher.py
import pytest

from app.silence_watcher import SilenceWatcher


@pytest.fixture
def sw():
    return SilenceWatcher(threshold_sec=3.0)


def test_sweep_emits_nothing_before_any_speech(sw):
    # No speech yet ⇒ can't be silent. Don't fire on a fresh connection.
    assert sw.sweep(now=10.0) == []


def test_sweep_emits_waiting_after_threshold(sw):
    sw.on_speech(now=0.0)
    assert sw.sweep(now=2.9) == []
    out = sw.sweep(now=3.0)
    assert len(out) == 1 and out[0]["type"] == "waiting_for_speech"


def test_waiting_for_speech_only_emits_once_per_silent_stretch(sw):
    sw.on_speech(now=0.0)
    sw.sweep(now=3.0)             # fires
    assert sw.sweep(now=5.0) == []  # already fired — don't spam


def test_on_speech_clears_and_emits_speech_resumed(sw):
    sw.on_speech(now=0.0)
    sw.sweep(now=3.0)             # waiting_for_speech fires
    out = sw.on_speech(now=4.0)   # speech back
    assert [e["type"] for e in out] == ["speech_resumed"]


def test_on_speech_without_prior_waiting_does_not_emit(sw):
    # Speech came back before threshold elapsed — no waiting event was sent,
    # so no speech_resumed either.
    sw.on_speech(now=0.0)
    out = sw.on_speech(now=1.5)
    assert out == []


def test_full_cycle_can_repeat(sw):
    sw.on_speech(now=0.0)
    sw.sweep(now=3.0)              # waiting (1st)
    sw.on_speech(now=4.0)          # resumed (1st)
    sw.sweep(now=8.0)              # waiting (2nd) — threshold from t=4
    out = sw.on_speech(now=9.0)
    assert [e["type"] for e in out] == ["speech_resumed"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
py -3.11 -m pytest tests/test_silence_watcher.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.silence_watcher'`.

---

### Task 2: Implement `SilenceWatcher`

**Files:**
- Create: `ai-service/app/silence_watcher.py`

- [ ] **Step 1: Write the module**

```python
# ai-service/app/silence_watcher.py
"""Mid-ayah silence detector for the streaming WS pipeline.

Emits `waiting_for_speech` once when the reciter has been silent for
`threshold_sec`, and `speech_resumed` when audio activity returns.
Stateless across reset — instantiated once per WS connection.
"""
from typing import Optional


class SilenceWatcher:
    def __init__(self, threshold_sec: float):
        self.threshold_sec = threshold_sec
        self._last_speech_at: Optional[float] = None
        self._waiting_emitted = False

    def on_speech(self, now: float) -> list[dict]:
        """Call when has_speech() returned True for the current window."""
        events: list[dict] = []
        if self._waiting_emitted:
            events.append({"type": "speech_resumed"})
            self._waiting_emitted = False
        self._last_speech_at = now
        return events

    def sweep(self, now: float) -> list[dict]:
        """Call periodically (e.g. from the existing sweep loop)."""
        if self._last_speech_at is None or self._waiting_emitted:
            return []
        elapsed = now - self._last_speech_at
        if elapsed >= self.threshold_sec:
            self._waiting_emitted = True
            return [{"type": "waiting_for_speech",
                     "silence_sec": round(elapsed, 2)}]
        return []
```

- [ ] **Step 2: Run the tests — all 6 must pass**

```bash
py -3.11 -m pytest tests/test_silence_watcher.py -v
```
Expected: 6 PASS.

- [ ] **Step 3: Commit**

```bash
git add ai-service/app/silence_watcher.py ai-service/tests/test_silence_watcher.py
git commit -m "feat(ai-service): SilenceWatcher emits waiting_for_speech / speech_resumed"
```

---

### Task 3: Add the env var

**Files:**
- Modify: `ai-service/app/config.py:14-18` (audio block)

- [ ] **Step 1: Add the env var**

In [config.py:14-18](../../../ai-service/app/config.py#L14-L18), append a new line under the audio block:
```python
# ── Audio / VAD ────────────────────────────────────────────────
VAD_SAMPLE_RATE   = 16000
VAD_WINDOW_FRAMES = 512
SILENCE_THRESHOLD = float(os.getenv("VAD_SILENCE_THRESHOLD_SEC", "0.7"))
MIN_SPEECH_SECS   = float(os.getenv("VAD_MIN_SPEECH_SEC", "0.5"))
WAITING_FOR_SPEECH_THRESHOLD_SEC = float(os.getenv("WAITING_FOR_SPEECH_THRESHOLD_SEC", "3.0"))
```

- [ ] **Step 2: Verify the import works**

```bash
py -3.11 -c "from app.config import WAITING_FOR_SPEECH_THRESHOLD_SEC; print(WAITING_FOR_SPEECH_THRESHOLD_SEC)"
```
Expected output: `3.0`.

---

### Task 4: Wire the watcher into `ws_handler.py`

**Files:**
- Modify: `ai-service/app/ws_handler.py` — imports + 3 wiring points.

- [ ] **Step 1: Add the import**

In [ws_handler.py:14-30](../../../ai-service/app/ws_handler.py#L14-L30), find the config import block:
```python
from app.config import (
    VerseScope,
    VAD_SAMPLE_RATE,
    STREAM_CHUNK_SEC,
    STREAM_WINDOW_SEC,
    STREAM_LOCK_IN_RUNS,
    PENDING_CORRECTION_TIMEOUT_SEC,
    SILENCE_THRESHOLD,
)
```
Append `WAITING_FOR_SPEECH_THRESHOLD_SEC,`:
```python
from app.config import (
    VerseScope,
    VAD_SAMPLE_RATE,
    STREAM_CHUNK_SEC,
    STREAM_WINDOW_SEC,
    STREAM_LOCK_IN_RUNS,
    PENDING_CORRECTION_TIMEOUT_SEC,
    SILENCE_THRESHOLD,
    WAITING_FOR_SPEECH_THRESHOLD_SEC,
)
```

And after the `from app.auth import check_bearer_token` line, add:
```python
from app.silence_watcher import SilenceWatcher
```

- [ ] **Step 2: Instantiate the watcher**

In [ws_handler.py:89](../../../ai-service/app/ws_handler.py#L89), right after `state_machine = MistakeStateMachine(...)`, add:
```python
    state_machine = MistakeStateMachine(timeout_sec=PENDING_CORRECTION_TIMEOUT_SEC)
    silence_watcher = SilenceWatcher(threshold_sec=WAITING_FOR_SPEECH_THRESHOLD_SEC)
```

- [ ] **Step 3: Wire `on_speech` into the main loop**

In [ws_handler.py:182-185](../../../ai-service/app/ws_handler.py#L182-L185), find:
```python
            if not has_speech(window, vad_model, min_speech_sec=0.3):
                if audio_chunks_received % 20 == 0:
                    _dbg(f"  VAD: window is silent — skipping ASR")
                continue
```
Replace with:
```python
            if not has_speech(window, vad_model, min_speech_sec=0.3):
                if audio_chunks_received % 20 == 0:
                    _dbg(f"  VAD: window is silent — skipping ASR")
                continue

            # Speech detected — clear any pending silence-indicator state.
            for ev in silence_watcher.on_speech(now=time.monotonic()):
                await ws.send_json(ev)
```

- [ ] **Step 4: Wire `sweep` into the existing sweep_loop**

In [ws_handler.py:109-117](../../../ai-service/app/ws_handler.py#L109-L117), find:
```python
    async def sweep_loop():
        while not stop_sweep.is_set():
            await asyncio.sleep(0.25)
            for ev in state_machine.sweep(now=time.monotonic()):
                try:
                    await ws.send_json(ev)
                except Exception:
                    return
```
Replace with:
```python
    async def sweep_loop():
        while not stop_sweep.is_set():
            await asyncio.sleep(0.25)
            now = time.monotonic()
            for ev in state_machine.sweep(now=now):
                try:
                    await ws.send_json(ev)
                except Exception:
                    return
            for ev in silence_watcher.sweep(now=now):
                try:
                    await ws.send_json(ev)
                except Exception:
                    return
```

- [ ] **Step 5: Run the whole test suite**

```bash
py -3.11 -m pytest tests/ -v
```
Expected: existing tests still pass; new silence-watcher tests still pass.

- [ ] **Step 6: Commit**

```bash
git add ai-service/app/config.py ai-service/app/ws_handler.py
git commit -m "feat(ai-service): wire SilenceWatcher into the streaming loop"
```

---

### Task 5: Document the new events

**Files:**
- Modify: `CLAUDE.md` — wire vocabulary line + env vars table.

- [ ] **Step 1: Update wire vocabulary**

Find the wire vocabulary line in CLAUDE.md and append `waiting_for_speech | speech_resumed`. Example: if Off-Script Recovery plan already ran, the line will look like:
```
Wire vocabulary: `ready | partial_mistake | word_corrected | mistake_acknowledged | ayah_finalized | ayah_switched | mistake | unclear | out_of_scope | final_report | error`.
```
Update to:
```
Wire vocabulary: `ready | partial_mistake | word_corrected | mistake_acknowledged | ayah_finalized | ayah_switched | mistake | unclear | out_of_scope | waiting_for_speech | speech_resumed | final_report | error`. `waiting_for_speech` fires once after the reciter is silent for `WAITING_FOR_SPEECH_THRESHOLD_SEC` (default 3 s) mid-ayah; `speech_resumed` fires when audio activity returns.
```

- [ ] **Step 2: Add env var to the env-vars table**

Append a row to the "Environment variables (overview)" table in CLAUDE.md:
```
| `WAITING_FOR_SPEECH_THRESHOLD_SEC` | ai-service | ❌ (defaults `3.0`) | How long mid-ayah silence must last before `waiting_for_speech` event fires. |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document waiting_for_speech / speech_resumed wire events"
```

---

## Self-Review Notes

- **Spec coverage:** waiting fires once after threshold; resumed fires only if waiting fired; no spam; full cycle can repeat.
- **No new asyncio task:** reuses the existing `sweep_loop` so we don't add another coroutine.
- **Threshold env-tunable:** matches the existing pattern (`SILENCE_THRESHOLD`, `PENDING_CORRECTION_TIMEOUT_SEC`).
- **No DB / API surface change:** events are purely WS-relayed. `audio.ws.js` doesn't need updates (pass-through).
- **Frontend can ignore:** if `ReciteScreen.js` doesn't subscribe to the new events, behavior is identical to today.
- **Edge case:** `_last_speech_at is None` (fresh connection, no audio yet) → `sweep()` returns `[]`. Test covers this.
