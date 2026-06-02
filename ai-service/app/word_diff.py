"""LCS-based word-level diff between expected and recited text."""


def word_diff(correct_norm: str, recited_norm: str) -> list[dict]:
    """LCS-based word-level diff. Returns list of {status, word}."""
    c = correct_norm.split()
    t = recited_norm.split()
    C, T = len(c), len(t)
    dp = [[0] * (T + 1) for _ in range(C + 1)]
    for i in range(1, C + 1):
        for j in range(1, T + 1):
            dp[i][j] = dp[i-1][j-1] + 1 if c[i-1] == t[j-1] else max(dp[i-1][j], dp[i][j-1])
    out, i, j = [], C, T
    while i > 0 or j > 0:
        if i > 0 and j > 0 and c[i-1] == t[j-1]:
            out.append({"status": "correct", "word": c[i-1]})
            i -= 1
            j -= 1
        elif j > 0 and (i == 0 or dp[i][j-1] >= dp[i-1][j]):
            out.append({"status": "extra", "word": t[j-1]})
            j -= 1
        else:
            out.append({"status": "missing", "word": c[i-1]})
            i -= 1
    out.reverse()
    return out


from dataclasses import dataclass

from app.arabic_norm import canonical


@dataclass(frozen=True)
class LockedWordDiff:
    kind: str            # "MATCH" | "MISPRONUNCIATION" | "OMITTED_WORD" | "ADDED_WORD" | "REPETITION"
    incorrect: str
    correct: str
    advance: int         # how many positions to advance the anchor (0 for REPETITION)


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

    if norm_locked == expected:
        return LockedWordDiff(kind="MATCH", incorrect=locked_word,
                              correct=expected_words[position], advance=1)

    # Did the user skip 1 or 2 expected words and land on a later one?
    for skip in range(1, lookahead + 1):
        peek_pos = position + skip
        if peek_pos < len(expected_words) and canonical(expected_words[peek_pos]) == norm_locked:
            return LockedWordDiff(kind="OMITTED_WORD",
                                  incorrect="", correct=expected_words[position],
                                  advance=skip + 1)

    # Doesn't match expected and isn't a skip-ahead → ADDED if Levenshtein distance
    # to expected is huge, else MISPRONUNCIATION.
    from rapidfuzz.distance import Levenshtein
    dist = Levenshtein.distance(norm_locked, expected)
    if dist >= max(3, len(expected) // 2):
        return LockedWordDiff(kind="ADDED_WORD", incorrect=locked_word, correct="", advance=0)
    return LockedWordDiff(kind="MISPRONUNCIATION",
                          incorrect=locked_word, correct=expected_words[position], advance=1)
