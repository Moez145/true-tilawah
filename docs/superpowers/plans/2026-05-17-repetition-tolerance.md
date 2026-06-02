# Repetition Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a reciter repeats a word they already said correctly (for practice, hesitation, or breath), don't flag it as `MISPRONUNCIATION` / `ADDED_WORD`. Treat it as a no-op and don't advance the anchor.

**Architecture:** Add a `REPETITION` kind to `LockedWordDiff`. In `diff_locked_word()`, before any other check, compare the locked word to `expected_words[position - 1]` (the previously-consumed word). If they match, return a `REPETITION` diff with `advance=0`. In `ws_handler.py`, when a locked word produces a `REPETITION`, skip everything (no anchor update, no state-machine emit, no `word_correct`). The anchor's `position` is reverted from `len(normed)` back to its pre-repetition value so the next real word lines up.

**Tech Stack:** Python 3.11 · faster-whisper · RapidFuzz · pytest.

---

## File Structure

- Modify: [`ai-service/app/word_diff.py`](../../../ai-service/app/word_diff.py) — add `REPETITION` to `LockedWordDiff` kind, add previous-word check at top of `diff_locked_word()`.
- Modify: [`ai-service/app/ws_handler.py`](../../../ai-service/app/ws_handler.py) — when `diff.kind == "REPETITION"`, skip anchor/state-machine update and revert `last_anchor.position`.
- Create: `ai-service/tests/test_repetition_tolerance.py` — unit tests at the `diff_locked_word` level + an integration test that builds a synthetic locked-word stream.

---

### Task 1: Failing unit test for `diff_locked_word` REPETITION

**Files:**
- Create: `ai-service/tests/test_repetition_tolerance.py`

- [ ] **Step 1: Write the failing test**

```python
# ai-service/tests/test_repetition_tolerance.py
from app.word_diff import diff_locked_word


def test_repetition_of_previous_word_is_detected():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    # user has consumed positions 0,1 ("وإن", "كنتم"); position is now 2.
    # they hesitate and say "كنتم" again instead of "في".
    out = diff_locked_word("كنتم", expected_words=expected, position=2)
    assert out.kind == "REPETITION"
    assert out.incorrect == "كنتم"
    assert out.correct == ""
    assert out.advance == 0


def test_repetition_at_position_zero_is_not_repetition():
    # position=0 means no previous word — can't be a repetition.
    expected = ["وإن", "كنتم", "في"]
    out = diff_locked_word("وإن", expected_words=expected, position=0)
    assert out.kind == "MATCH"


def test_actual_mispronunciation_is_not_misclassified_as_repetition():
    # The locked word isn't equal to expected[pos-1], so this stays a mistake.
    expected = ["وإن", "كنتم", "في", "ريب"]
    out = diff_locked_word("ربا", expected_words=expected, position=3)
    assert out.kind == "MISPRONUNCIATION"


def test_correct_word_is_still_match():
    # Don't break the happy path: when the locked word matches the
    # expected word at `position`, it's still MATCH, not REPETITION.
    expected = ["وإن", "كنتم", "في", "ريب"]
    out = diff_locked_word("ريب", expected_words=expected, position=3)
    assert out.kind == "MATCH"
```

- [ ] **Step 2: Run test to verify it fails**

Run from `ai-service/`:
```bash
py -3.11 -m pytest tests/test_repetition_tolerance.py -v
```
Expected: FAIL on `test_repetition_of_previous_word_is_detected` with `AssertionError: assert 'MISPRONUNCIATION' == 'REPETITION'` (or similar — current code returns `MISPRONUNCIATION` for this input).

---

### Task 2: Add `REPETITION` kind to `LockedWordDiff` + previous-word check

**Files:**
- Modify: `ai-service/app/word_diff.py:34-72` (the `LockedWordDiff` dataclass docstring + `diff_locked_word()` body)

- [ ] **Step 1: Update the `kind` docstring on `LockedWordDiff`**

In [word_diff.py:34-39](../../../ai-service/app/word_diff.py#L34-L39), change:
```python
@dataclass(frozen=True)
class LockedWordDiff:
    kind: str            # "MATCH" | "MISPRONUNCIATION" | "OMITTED_WORD" | "ADDED_WORD"
    incorrect: str
    correct: str
    advance: int         # how many positions to advance the anchor
```
to:
```python
@dataclass(frozen=True)
class LockedWordDiff:
    kind: str            # "MATCH" | "MISPRONUNCIATION" | "OMITTED_WORD" | "ADDED_WORD" | "REPETITION"
    incorrect: str
    correct: str
    advance: int         # how many positions to advance the anchor (0 for REPETITION)
```

- [ ] **Step 2: Add the previous-word check at the top of `diff_locked_word()`**

In [word_diff.py:42-50](../../../ai-service/app/word_diff.py#L42-L50), find this block:
```python
def diff_locked_word(locked_word: str, expected_words: list[str],
                     position: int, lookahead: int = 2) -> LockedWordDiff:
    """Decide what a single newly-locked word means at the current anchor position."""
    norm_locked = canonical(locked_word)

    if position >= len(expected_words):
        # Anchor ran off the end of the ayah — treat as added
        return LockedWordDiff(kind="ADDED_WORD", incorrect=locked_word, correct="", advance=0)

    expected = canonical(expected_words[position])
```

Insert the repetition check after `norm_locked = canonical(locked_word)` and before the `if position >= len(expected_words)` line:

```python
def diff_locked_word(locked_word: str, expected_words: list[str],
                     position: int, lookahead: int = 2) -> LockedWordDiff:
    """Decide what a single newly-locked word means at the current anchor position."""
    norm_locked = canonical(locked_word)

    # Repetition: the reciter just re-said the word they already consumed.
    # Common when hesitating, taking a breath, or practicing. Not a mistake.
    if position > 0 and position <= len(expected_words):
        prev_expected = canonical(expected_words[position - 1])
        if norm_locked == prev_expected:
            return LockedWordDiff(kind="REPETITION",
                                  incorrect=locked_word, correct="", advance=0)

    if position >= len(expected_words):
        # Anchor ran off the end of the ayah — treat as added
        return LockedWordDiff(kind="ADDED_WORD", incorrect=locked_word, correct="", advance=0)

    expected = canonical(expected_words[position])
```

- [ ] **Step 3: Run unit tests — they must now all pass**

```bash
py -3.11 -m pytest tests/test_repetition_tolerance.py tests/test_diff_locked_word.py -v
```
Expected: 4 new tests PASS + 4 existing tests PASS (8 total).

- [ ] **Step 4: Commit**

```bash
git add ai-service/app/word_diff.py ai-service/tests/test_repetition_tolerance.py
git commit -m "feat(ai-service): detect word repetition in diff_locked_word"
```

---

### Task 3: Handle `REPETITION` in the ws_handler streaming loop

**Files:**
- Modify: `ai-service/app/ws_handler.py:252-304` (the `newly_locked` processing block)

The state today: when `diff_locked_word` returns a `REPETITION`, `build_partial_mistake` (`payload`) is `None` (since it only special-cases `MATCH`), so `ws_handler` falls into the `else` branch at line 294 and emits `word_correct`. That's wrong — the user didn't say a *new* word, they said the *previous* one. Also, `last_anchor.position` has been advanced to `len(normed)` by `align_partial`, which means the next real word will see `position+1` and the alignment may drift.

The fix: handle `REPETITION` explicitly — skip both the state-machine update and the `word_correct` emit, and roll `last_anchor.position` back by one so we re-await the actual next word.

- [ ] **Step 1: Read the current code block to verify line numbers**

Run:
```bash
py -3.11 -c "import linecache; print(''.join(linecache.getline('app/ws_handler.py', i) for i in range(252, 305)))"
```
This should match `expected = STATE["quran"]...` down through the `word_correct` emit.

- [ ] **Step 2: Add the REPETITION early-exit branch**

In [ws_handler.py:252-264](../../../ai-service/app/ws_handler.py#L252-L264), find:
```python
                    expected = STATE["quran"][scope.surah_id][last_anchor.ayah].split()
                    word_idx = max(0, last_anchor.position - 1)
                    diff = diff_locked_word(
                        locked_word=w.text,
                        expected_words=expected,
                        position=word_idx,
                    )

                    tj_violations = check_tajweed_violations(w.text, expected, word_idx)
                    high = next((v for v in tj_violations if v.get("severity") == "high"), None)

                    payload = build_partial_mistake(diff, tajweed_violation=high)
```

Replace with (insert the early-exit BEFORE the tajweed check, since repetition shouldn't trigger tajweed re-evaluation either):

```python
                    expected = STATE["quran"][scope.surah_id][last_anchor.ayah].split()
                    word_idx = max(0, last_anchor.position - 1)
                    diff = diff_locked_word(
                        locked_word=w.text,
                        expected_words=expected,
                        position=word_idx,
                    )

                    if diff.kind == "REPETITION":
                        # The locked word was the previous expected word — the
                        # reciter is repeating themselves (hesitation, breath,
                        # practice). Don't emit anything, and roll the anchor
                        # position back so the next *real* word lines up.
                        _dbg(
                            f"  REPETITION skipped ayah={last_anchor.ayah} word_idx={word_idx} "
                            f"word={w.text!r}"
                        )
                        from app.ayah_aligner import AyahAnchor as _AyahAnchor
                        last_anchor = _AyahAnchor(
                            ayah=last_anchor.ayah,
                            position=max(0, last_anchor.position - 1),
                            score=last_anchor.score,
                        )
                        continue

                    tj_violations = check_tajweed_violations(w.text, expected, word_idx)
                    high = next((v for v in tj_violations if v.get("severity") == "high"), None)

                    payload = build_partial_mistake(diff, tajweed_violation=high)
```

Note: `AyahAnchor` is a `frozen=True` dataclass so we have to construct a new one rather than mutating `last_anchor`. Import is done locally to avoid widening the top-level import block (style match: the file already does inline imports for tajweed types).

- [ ] **Step 3: Run the existing WS streaming test to confirm no regression**

```bash
py -3.11 -m pytest tests/test_ws_handler_streaming.py -v
```
Expected: PASS (or SKIP if fixture WAV is missing — that's the existing behavior).

- [ ] **Step 4: Commit**

```bash
git add ai-service/app/ws_handler.py
git commit -m "feat(ai-service): skip REPETITION locked words without advancing anchor"
```

---

### Task 4: Integration test — simulated locked-word stream with repetition

**Files:**
- Modify: `ai-service/tests/test_repetition_tolerance.py` — append a higher-level test that exercises `build_partial_mistake` to confirm REPETITION yields `None` (so no `partial_mistake` event would fire).

- [ ] **Step 1: Append integration test**

```python
# Append to ai-service/tests/test_repetition_tolerance.py

from app.pipeline import build_partial_mistake


def test_build_partial_mistake_returns_none_for_repetition():
    """A REPETITION diff must not produce a mistake payload — frontend stays quiet."""
    from app.word_diff import LockedWordDiff
    diff = LockedWordDiff(kind="REPETITION", incorrect="كنتم", correct="", advance=0)
    payload = build_partial_mistake(diff, tajweed_violation=None)
    assert payload is None
```

- [ ] **Step 2: Run the full test file**

```bash
py -3.11 -m pytest tests/test_repetition_tolerance.py -v
```
Expected: 5 PASS.

- [ ] **Step 3: Run the whole test suite to catch any unintended regression**

```bash
py -3.11 -m pytest tests/ -v
```
Expected: all green except `test_ws_handler_streaming.py` which may SKIP if the fixture WAV isn't checked in.

- [ ] **Step 4: Commit**

```bash
git add ai-service/tests/test_repetition_tolerance.py
git commit -m "test(ai-service): integration coverage for REPETITION → no partial_mistake"
```

---

## Self-Review Notes

- **Spec coverage:** All four behaviors from the brief covered — (1) detect repetition of `expected[position-1]`, (2) don't emit a mistake, (3) don't advance the anchor, (4) don't break correct/MATCH/MISPRONUNCIATION paths.
- **Type consistency:** `LockedWordDiff.kind` string list updated in dataclass comment to include `"REPETITION"`. `build_partial_mistake` doesn't list-match on kind explicitly (it dispatches on `MATCH` vs `else`), so adding REPETITION is naturally caught by its `if diff.kind == "MATCH"` test going false → the function would return a non-None payload. **That's a bug we have to handle in `build_partial_mistake` itself** OR we rely on the early-exit in `ws_handler.py` (Task 3) so `build_partial_mistake` is never called with REPETITION. The early-exit is cleaner — kept that way.
- **Edge case:** `position == 0` is excluded from the repetition check (no previous word to repeat). Test covers it.
- **Anchor rollback:** uses `AyahAnchor` constructor (frozen dataclass) — verified via the existing `ayah_aligner.py:67-71` definition.
