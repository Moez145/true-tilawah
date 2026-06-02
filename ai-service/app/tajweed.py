"""Tajweed (recitation rule) checks.

The `_DIAC` regex used for stripping diacritics is imported from
`app.quran_index` instead of being duplicated.
"""
import re

from rapidfuzz import fuzz

from app.quran_index import _DIAC, normalize as _norm

_QALQALA = set("قطبجد")
_MADD = set("اوي")
_GHUNNA = re.compile(r"[نم]ّ")


def check_tajweed(verse_original: str, recited: str) -> list[dict]:
    errors = []
    c_words = verse_original.split()
    t_set = set(_norm(recited).split())
    t_list = recited.split()

    for word in c_words:
        base = _DIAC.sub("", word)
        for ch in base:
            if ch in _QALQALA:
                if _norm(word) not in t_set:
                    errors.append({"rule": "Qalqala", "word": word, "severity": "medium",
                                   "tip": f"'{ch}' needs a brief echo/bounce."})
                break

    for word in c_words:
        if any(ch in _MADD for ch in _DIAC.sub("", word)):
            wn = _norm(word)
            best_sc, best_tw = 0, ""
            for tw in t_list:
                sc = fuzz.ratio(wn, _norm(tw))
                if sc > best_sc:
                    best_sc, best_tw = sc, tw
            if len(wn) - len(_norm(best_tw)) >= 2:
                errors.append({"rule": "Madd", "word": word, "severity": "high",
                               "tip": "Elongate the long vowel (2 to 6 counts)."})

    for word in c_words:
        if _GHUNNA.search(word) and _norm(word) not in t_set:
            errors.append({"rule": "Ghunna", "word": word, "severity": "medium",
                           "tip": "Nasalise Noon/Meem with shadda for 2 counts."})
    return errors


def check_tajweed_violations(locked_word: str, expected_words: list[str], position: int) -> list[dict]:
    """Per-word tajweed check for the streaming pipeline.

    Returns HIGH-severity violations only (today: Madd). Each dict has keys
    `rule`, `severity`, `tip`. Returns an empty list when the word looks fine
    or the position is out of range.
    """
    if position < 0 or position >= len(expected_words):
        return []
    exp = expected_words[position]
    exp_base = _DIAC.sub("", exp)
    # Only surface Madd today (the sole HIGH-severity rule).
    if any(ch in _MADD for ch in exp_base):
        exp_norm = _norm(exp)
        loc_norm = _norm(locked_word)
        if len(exp_norm) - len(loc_norm) >= 2:
            return [{"rule": "Madd", "severity": "high",
                     "tip": "Elongate the long vowel (2 to 6 counts)."}]
    return []
