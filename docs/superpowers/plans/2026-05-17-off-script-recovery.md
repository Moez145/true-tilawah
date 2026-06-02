# Off-Script Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface two off-script transitions that the streaming pipeline currently swallows silently: (1) the reciter jumps to a different ayah inside their selected scope (e.g. 23 → 25, skipping 24), and (2) the reciter goes off-script entirely (alignment lost). Both currently mutate `last_anchor` without telling the client.

**Architecture:** Two new wire events emitted from [ws_handler.py](../../../ai-service/app/ws_handler.py): `ayah_switched` (intra-scope jump) and `out_of_scope` (alignment failure after an anchor). When a jump is detected, the **old** ayah is finalized first via the existing `ayah_finalized` path so `Feedback` rows persist and the summary stays consistent with CLAUDE.md's "persistence is per ayah, not per session" rule. `out_of_scope` is already in the wire vocabulary (CLAUDE.md §"How the realtime feedback pipeline works"); `ayah_switched` is a small additive extension. Backend `audio.ws.js` is event-pass-through so it needs no changes.

**Tech Stack:** Python 3.11 · FastAPI WebSocket · pytest.

---

## File Structure

- Modify: [`ai-service/app/ws_handler.py`](../../../ai-service/app/ws_handler.py) — detect `new_anchor.ayah != last_anchor.ayah` before assigning `last_anchor`. Detect the `align_partial → None with prior anchor` path. Emit the two events.
- Create: `ai-service/tests/test_off_script_recovery.py` — focused unit tests on the ayah-switch / out-of-scope branches by calling `align_partial` directly.

No new modules; no `ScopedAligner` API change.

---

### Task 1: Failing test — ayah-switch detection via align_partial

**Files:**
- Create: `ai-service/tests/test_off_script_recovery.py`

- [ ] **Step 1: Write the failing test**

```python
# ai-service/tests/test_off_script_recovery.py
from app.config import VerseScope
from app.ayah_aligner import ScopedAligner, AyahAnchor


def _quran_fixture() -> dict[int, dict[int, str]]:
    """Minimal 3-ayah scope used by the tests."""
    return {
        2: {
            23: "وإن كنتم في ريب مما نزلنا على عبدنا",
            24: "فإن لم تفعلوا ولن تفعلوا فاتقوا النار",
            25: "وبشر الذين آمنوا وعملوا الصالحات أن لهم جنات",
        }
    }


def test_align_partial_switches_ayah_when_user_jumps_within_scope():
    scope = VerseScope(surah_id=2, ayah_start=23, ayah_end=25)
    aligner = ScopedAligner(scope, _quran_fixture())

    # First the user recites words from ayah 23 → anchor lands on 23.
    anchor_23 = aligner.align_partial(["وإن", "كنتم", "في", "ريب"])
    assert anchor_23 is not None and anchor_23.ayah == 23

    # Now they jump and start reciting ayah 25 — distinctive words only.
    new_anchor = aligner.align_partial(
        ["وبشر", "الذين", "آمنوا", "وعملوا", "الصالحات"],
        last_anchor=anchor_23,
    )
    assert new_anchor is not None
    # The bug we want covered: new_anchor.ayah must be 25, not 23.
    assert new_anchor.ayah == 25


def test_align_partial_returns_none_when_user_goes_fully_off_script():
    scope = VerseScope(surah_id=2, ayah_start=23, ayah_end=25)
    aligner = ScopedAligner(scope, _quran_fixture())
    anchor_23 = aligner.align_partial(["وإن", "كنتم", "في", "ريب"])
    assert anchor_23 is not None

    # User starts saying gibberish that matches no ayah in scope.
    new_anchor = aligner.align_partial(
        ["foo", "bar", "baz", "quux", "asdf"],
        last_anchor=anchor_23,
    )
    # align_partial drops the anchor when score collapses below the gating
    # threshold for the same ayah and no other ayah scores >= 60.
    assert new_anchor is None
```

- [ ] **Step 2: Run the test — both should already pass**

```bash
py -3.11 -m pytest tests/test_off_script_recovery.py -v
```
Expected: PASS for both. (These tests pin the *existing* `align_partial` behavior so Tasks 2-4 can rely on it. If either fails, the bug is in `align_partial` and needs fixing first.)

- [ ] **Step 3: Commit**

```bash
git add ai-service/tests/test_off_script_recovery.py
git commit -m "test(ai-service): pin align_partial behavior for ayah-switch / off-script"
```

---

### Task 2: Add `ayah_switched` event when an intra-scope jump is detected

**Files:**
- Modify: `ai-service/app/ws_handler.py:246-251` (right after `last_anchor = new_anchor` is set)

The current code at [ws_handler.py:226-250](../../../ai-service/app/ws_handler.py#L226-L250) computes `new_anchor` and unconditionally writes `last_anchor = new_anchor`. We need to detect the ayah change BEFORE the assignment, finalize the old ayah, then emit `ayah_switched`.

- [ ] **Step 1: Read the block to confirm line numbers**

```bash
py -3.11 -c "import linecache; print(''.join(linecache.getline('app/ws_handler.py', i) for i in range(220, 255)))"
```

- [ ] **Step 2: Insert the ayah-switch branch**

In [ws_handler.py:226-250](../../../ai-service/app/ws_handler.py#L226-L250), find:
```python
                    new_anchor = aligner.align_partial(prefix, last_anchor=last_anchor)
                    if new_anchor is None:
                        # align_partial intentionally returns None until ≥3 words are
                        # locked (without a prior anchor), or when the score drops far
                        # below an existing anchor. The first case is normal early in
                        # a recitation; the second means the reciter went off-scope.
                        if last_anchor is None and len(prefix) < 3:
                            _dbg(
                                f"  alignment deferred — only {len(prefix)} word(s) locked "
                                f"({prefix!r}); waiting for ≥3 before anchoring"
                            )
                        else:
                            _dbg(
                                f"  alignment FAILED for prefix={prefix!r} "
                                f"(reciter likely off-scope or transcript unreliable)"
                            )
                            if last_anchor is not None:
                                state_machine.reset_ayah(last_anchor.ayah)
                                last_anchor = None
                        continue
                    last_anchor = new_anchor
```

Replace with:
```python
                    new_anchor = aligner.align_partial(prefix, last_anchor=last_anchor)
                    if new_anchor is None:
                        if last_anchor is None and len(prefix) < 3:
                            _dbg(
                                f"  alignment deferred — only {len(prefix)} word(s) locked "
                                f"({prefix!r}); waiting for ≥3 before anchoring"
                            )
                        else:
                            _dbg(
                                f"  alignment FAILED for prefix={prefix!r} "
                                f"(reciter likely off-scope or transcript unreliable)"
                            )
                            if last_anchor is not None:
                                # Off-script entirely. Emit out_of_scope so the
                                # frontend can show a hint ("we lost you").
                                await ws.send_json({
                                    "type": "out_of_scope",
                                    "from_ayah": last_anchor.ayah,
                                })
                                state_machine.reset_ayah(last_anchor.ayah)
                                last_anchor = None
                        continue

                    # Intra-scope jump: reciter moved to a different ayah without
                    # finishing the current one. Finalize the old ayah with whatever
                    # mistakes we collected, then notify the client.
                    if last_anchor is not None and new_anchor.ayah != last_anchor.ayah:
                        old_ayah = last_anchor.ayah
                        if old_ayah not in ayah_finalized_for:
                            final_mistakes = state_machine.pending_payloads_for_ayah(old_ayah)
                            _dbg(
                                f"AYAH SWITCH detected: finalizing old ayah={old_ayah} "
                                f"→ new ayah={new_anchor.ayah} (skipped without pause)"
                            )
                            await ws.send_json({
                                "type": "ayah_finalized",
                                "ayah": old_ayah,
                                "mistakes": final_mistakes,
                            })
                            summary.record(old_ayah, last_anchor.score, final_mistakes)
                            ayah_finalized_for.add(old_ayah)
                            state_machine.reset_ayah(old_ayah)
                        await ws.send_json({
                            "type": "ayah_switched",
                            "from_ayah": old_ayah,
                            "to_ayah": new_anchor.ayah,
                            "word_index": new_anchor.position,
                        })

                    last_anchor = new_anchor
```

- [ ] **Step 3: Run the full test suite — no regressions allowed**

```bash
py -3.11 -m pytest tests/ -v
```
Expected: existing tests stay green. `test_off_script_recovery.py` already passes (Task 1 was characterization).

- [ ] **Step 4: Commit**

```bash
git add ai-service/app/ws_handler.py
git commit -m "feat(ai-service): emit ayah_switched + out_of_scope on alignment transitions"
```

---

### Task 3: Test that the new events fire end-to-end

**Files:**
- Modify: `ai-service/tests/test_off_script_recovery.py` — append a `TestClient`-based test that drives the WS handler with a simulated transcript-locking sequence.

This one is intentionally lightweight: we mock the ASR provider to emit a scripted transcript so we don't need real audio.

- [ ] **Step 1: Append the integration test**

```python
# Append to ai-service/tests/test_off_script_recovery.py
import asyncio
import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.lifespan import lifespan, STATE
from app.ws_handler import handle_ws_evaluate
from app.transcription.base import TranscriptionResult


class _ScriptedProvider:
    """Yields pre-scripted ASR results so the test doesn't need real audio."""
    def __init__(self, scripts: list[str]):
        self._scripts = list(scripts)
        self._i = 0
    async def transcribe(self, pcm, language="ar", initial_prompt=None):
        if self._i >= len(self._scripts):
            text = self._scripts[-1]
        else:
            text = self._scripts[self._i]
            self._i += 1
        return TranscriptionResult(text=text, confidence=None, raw={"language": "ar"})


def test_ayah_switched_event_fires(monkeypatch):
    app = FastAPI(lifespan=lifespan)
    app.websocket("/ws/evaluate")(handle_ws_evaluate)

    with TestClient(app) as client:
        if not STATE["ready"]:
            pytest.skip("AI service not ready in test env")

        # Replace ASR with our scripted one. Sequence: enough ayah-23 words to
        # anchor, then ayah-25 words to trigger a switch.
        scripted = _ScriptedProvider([
            "وإن كنتم في",
            "وإن كنتم في ريب",
            "وإن كنتم في ريب مما",
            "وبشر الذين آمنوا",
            "وبشر الذين آمنوا وعملوا",
            "وبشر الذين آمنوا وعملوا الصالحات",
        ])
        monkeypatch.setitem(STATE, "provider", scripted)

        with client.websocket_connect("/ws/evaluate") as ws:
            ws.send_text(json.dumps({"surahId": 2, "ayahStart": 23, "ayahEnd": 25}))
            assert json.loads(ws.receive_text())["type"] == "ready"

            # Send dummy float32 PCM chunks — the scripted provider ignores them.
            dummy = (np.random.rand(8000).astype(np.float32) - 0.5) * 0.3
            for _ in range(20):
                ws.send_bytes(dummy.tobytes())
            ws.send_text("STOP")

            seen = []
            for _ in range(200):
                try:
                    seen.append(json.loads(ws.receive_text())["type"])
                except Exception:
                    break

        # We don't assert exact ordering — alignment may converge on different
        # iterations depending on lock-in timing. We assert the switch event
        # appeared at least once.
        assert "ayah_switched" in seen, f"no ayah_switched in {seen}"
```

- [ ] **Step 2: Run it**

```bash
py -3.11 -m pytest tests/test_off_script_recovery.py::test_ayah_switched_event_fires -v
```
Expected: PASS, or SKIP if the lifespan can't fully load (e.g. missing Tarteel model in CI). On a dev box with the model converted, it should pass.

- [ ] **Step 3: Commit**

```bash
git add ai-service/tests/test_off_script_recovery.py
git commit -m "test(ai-service): integration coverage for ayah_switched event"
```

---

### Task 4: Document the new wire events

**Files:**
- Modify: `CLAUDE.md` — append the two new event names to the wire-vocabulary line and clarify `out_of_scope` is now emitted.

- [ ] **Step 1: Update wire vocabulary line**

In CLAUDE.md, find:
```
Wire vocabulary: `ready | partial_mistake | word_corrected | mistake_acknowledged | ayah_finalized | mistake | unclear | out_of_scope | final_report | error`.
```

Update to:
```
Wire vocabulary: `ready | partial_mistake | word_corrected | mistake_acknowledged | ayah_finalized | ayah_switched | mistake | unclear | out_of_scope | final_report | error`. `ayah_switched` fires when the reciter jumps to a different ayah inside their scope without pausing (e.g. 23 → 25). `out_of_scope` fires when alignment is lost after having an anchor (the reciter went fully off-script).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document ayah_switched + out_of_scope wire events"
```

---

## Self-Review Notes

- **Spec coverage:** Two transitions covered — intra-scope jump (`ayah_switched`) and alignment lost (`out_of_scope`). Old ayah is finalized before the switch so `Feedback` rows persist per CLAUDE.md's "persistence is per ayah" rule.
- **No backend API changes:** `audio.ws.js` is event-pass-through ([backend/CLAUDE.md] confirms — events are forwarded verbatim). The two new event types just flow through.
- **No frontend changes required:** Per scope, the frontend's `wordStateStore` already keys by `(ayahNumber, wordIdx)`. The new events are additive; if the frontend doesn't handle them, behavior is identical to today's silent ayah switches.
- **State machine safety:** `state_machine.reset_ayah(old_ayah)` is the same call used by `ayah_finalized` today, so no new state-machine API.
- **Edge case (placement check):** the ayah-switch branch must run BEFORE `last_anchor = new_anchor`, otherwise `state_machine.pending_payloads_for_ayah(old_ayah)` would receive the wrong old anchor. The plan inserts it correctly.
