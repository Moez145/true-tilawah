from app.word_diff import diff_locked_word, LockedWordDiff


def test_match():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    out = diff_locked_word("ريب", expected_words=expected, position=3)
    assert out.kind == "MATCH"


def test_mispronunciation():
    expected = ["وإن", "كنتم", "في", "ريب"]
    out = diff_locked_word("ربا", expected_words=expected, position=3)
    assert out.kind == "MISPRONUNCIATION"
    assert out.incorrect == "ربا"
    assert out.correct == "ريب"


def test_omitted_word_user_jumped_ahead():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    # user already said pos 0,1,2; their next locked word is "مما" → they skipped "ريب"
    out = diff_locked_word("مما", expected_words=expected, position=3)
    assert out.kind == "OMITTED_WORD"
    assert out.correct == "ريب"
    assert out.advance == 2   # skip past "ريب" then consume "مما"


def test_added_word_when_no_nearby_expected_match():
    expected = ["وإن", "كنتم", "في", "ريب", "مما"]
    out = diff_locked_word("xyz", expected_words=expected, position=3)
    assert out.kind == "ADDED_WORD"
    assert out.advance == 0   # don't advance anchor — anchor stays put
