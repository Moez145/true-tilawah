"""
Aligns a transcribed utterance to one of the user's selected ayahs.
This is the SCOPED replacement for the legacy full-Quran verse_detector.
"""
from rapidfuzz import fuzz, process as rf_process

from app.config import VerseScope
from app.quran_index import normalize


class ScopedAligner:
    """
    Built once per WS session from the user's VerseScope.
    Holds a small inverted index of just the user's selected ayahs.
    """

    def __init__(self, scope: VerseScope, quran: dict[int, dict[int, str]]):
        self.scope = scope
        # Build verse list restricted to scope
        self.verses: list[tuple[int, int, str, str, list[str]]] = []
        for ayah_num in range(scope.ayah_start, scope.ayah_end + 1):
            text = quran.get(scope.surah_id, {}).get(ayah_num)
            if text is None:
                continue
            norm = normalize(text)
            self.verses.append((scope.surah_id, ayah_num, text, norm, norm.split()))

    def align(self, recited_text: str) -> dict | None:
        """
        Returns the best-matching ayah from scope, or None if nothing matches well.
        Output: {"surah": int, "ayah": int, "verse_text": str, "verse_norm": str,
                 "verse_words": list[str], "score": float}
        """
        if not self.verses:
            return None
        recited_norm = normalize(recited_text)
        if len(recited_norm.split()) < 1:
            return None

        best_score, best_idx = 0.0, -1
        for idx, (s, a, orig, v_norm, v_words) in enumerate(self.verses):
            score = (
                fuzz.WRatio(recited_norm, v_norm)          / 100 * 0.3 +
                fuzz.partial_ratio(recited_norm, v_norm)   / 100 * 0.4 +
                fuzz.token_set_ratio(recited_norm, v_norm) / 100 * 0.3
            )
            if score > best_score:
                best_score, best_idx = score, idx

        if best_score < 0.45 or best_idx < 0:
            return None

        s, a, orig, v_norm, v_words = self.verses[best_idx]
        return {
            "surah": s, "ayah": a,
            "verse_text": orig, "verse_norm": v_norm,
            "verse_words": v_words, "score": round(best_score, 4),
        }


from dataclasses import dataclass
from typing import Optional

from app.arabic_norm import canonical


@dataclass(frozen=True)
class AyahAnchor:
    ayah: int
    position: int   # 0-based next-expected-position in the ayah
    score: float    # RapidFuzz partial_ratio at time of anchor


def _align_partial_impl(self: "ScopedAligner", words_so_far: list[str],
                        last_anchor: Optional[AyahAnchor] = None) -> Optional[AyahAnchor]:
    if len(words_so_far) < 3 and last_anchor is None:
        return None

    normed = [canonical(w) for w in words_so_far]
    partial_text = " ".join(normed)

    # Score against every ayah in scope (self.verses tuples: (surah, ayah, orig, norm, words))
    best_ayah: Optional[int] = None
    best_score: float = 0.0
    for s_id, ayah_num, orig, v_norm, v_words in self.verses:
        ref_norm = " ".join(canonical(w) for w in v_norm.split())
        score = fuzz.partial_ratio(partial_text, ref_norm)
        if score > best_score:
            best_score = score
            best_ayah = ayah_num

    if best_ayah is None:
        return None

    # If we had an anchor and the new best is the same ayah, allow the score
    # to drop a bit (Whisper edits) before invalidating.
    if last_anchor is not None and best_ayah == last_anchor.ayah:
        if best_score < (last_anchor.score - 25):
            return None  # anchor invalidated; caller resets state
        return AyahAnchor(ayah=best_ayah, position=len(normed), score=best_score)

    # New anchor candidate — require min score
    if best_score < 60.0:
        return None
    return AyahAnchor(ayah=best_ayah, position=len(normed), score=best_score)


# Attach as method on ScopedAligner
ScopedAligner.align_partial = _align_partial_impl
