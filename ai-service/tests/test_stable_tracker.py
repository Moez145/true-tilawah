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


def test_drift_reset_when_rolling_window_moves_past_locked_content():
    """When the ASR rolling window shifts past previously-locked words (e.g.
    the user transitions to a new ayah without enough silence to trigger
    the explicit tracker.reset() in the ayah-end finalize path), the tracker
    must detect drift and clear stale locks so new content can lock.

    Without this, all subsequent ayahs are blocked: position 0/1/2 stay
    claimed by the previous ayah's words and the new transcript can't acquire
    any locks. End user sees: no highlights, no TTS, no mistake events after
    the first ayah.
    """
    t = StableTracker(lock_in_runs=2)

    # Lock ayah-2 of Al-Fatihah at positions 0-2 ("العالمين" stays at tail).
    t.feed("الحمد لله رب العالمين")
    t.feed("الحمد لله رب العالمين")
    assert t.current_locked() == ["الحمد", "لله", "رب"]

    # Rolling window now contains ONLY ayah-3 audio. Whisper produces
    # ayah-3 text where the locked words no longer appear at their positions.
    t.feed("الرحمن الرحيم")
    locked = t.feed("الرحمن الرحيم")

    # After drift reset + lock-in, position 0 should be the new ayah-3 word.
    assert "الرحمن" in t.current_locked(), (
        f"drift reset failed: tracker still holds stale locks {t.current_locked()}"
    )
    # The first feed after drift triggers reset; the second locks at least pos 0.
    assert any(w.position == 0 and w.text == "الرحمن" for w in locked), (
        f"expected pos 0 to lock as الرحمن after drift, got {[(w.position, w.text) for w in locked]}"
    )


def test_drift_reset_tolerates_one_word_difference():
    """A single word changing inside an otherwise-matching transcript must
    NOT trigger a drift reset — Whisper occasionally revises one word
    while the rest is stable. Only a MAJORITY mismatch counts as drift.
    """
    t = StableTracker(lock_in_runs=2)
    t.feed("بسم الله الرحمن")
    t.feed("بسم الله الرحمن")
    # 2 positions locked (pos 0=بسم, pos 1=الله; tail pos 2=الرحمن excluded)
    assert len(t.current_locked()) == 2

    # Whisper revises pos 0 only — majority (pos 1) still matches.
    t.feed("سم الله الرحمن الرحيم")
    # Locks must NOT be wiped — stale-detection should only fire on majority drift.
    assert "الله" in t.current_locked(), (
        f"single-word revision wrongly triggered drift reset; locked={t.current_locked()}"
    )
