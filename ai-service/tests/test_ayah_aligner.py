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
