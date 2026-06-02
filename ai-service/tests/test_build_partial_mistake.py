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
