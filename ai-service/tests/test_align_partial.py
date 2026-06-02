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
