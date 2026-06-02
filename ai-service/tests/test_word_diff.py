from app.word_diff import word_diff


def test_all_correct():
    diff = word_diff("a b c", "a b c")
    assert all(d["status"] == "correct" for d in diff)


def test_one_missing():
    diff = word_diff("a b c", "a c")
    statuses = [d["status"] for d in diff]
    assert statuses.count("missing") == 1
    assert next(d["word"] for d in diff if d["status"] == "missing") == "b"


def test_one_extra():
    diff = word_diff("a c", "a b c")
    extras = [d["word"] for d in diff if d["status"] == "extra"]
    assert extras == ["b"]
