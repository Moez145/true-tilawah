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


def test_build_partial_mistake_returns_none_for_repetition():
    """A REPETITION diff must not produce a mistake payload — frontend stays quiet."""
    from app.pipeline import build_partial_mistake
    from app.word_diff import LockedWordDiff
    diff = LockedWordDiff(kind="REPETITION", incorrect="كنتم", correct="", advance=0)
    payload = build_partial_mistake(diff, tajweed_violation=None)
    assert payload is None
