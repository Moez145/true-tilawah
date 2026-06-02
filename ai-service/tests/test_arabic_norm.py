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
