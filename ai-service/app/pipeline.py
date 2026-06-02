"""Translates internal alignment + diff + tajweed into the new mistake-focused
output shape used by the WS protocol (§4.1.1 of the spec).
"""
from app.ayah_aligner import ScopedAligner  # noqa: F401  (public re-export)
from app.word_diff import word_diff
from app.tajweed import check_tajweed
from app.quran_index import normalize


def build_mistakes(recited_text: str, match: dict) -> list[dict]:
    """
    From a transcribed utterance and the matched ayah, produce the
    mistake list shape used in the WS protocol (§4.1.1 of the spec).
    Returns [] when recitation is correct.
    """
    recited_norm = normalize(recited_text)
    diff = word_diff(match["verse_norm"], recited_norm)

    out: list[dict] = []
    for d in diff:
        if d["status"] == "missing":
            out.append({
                "type": "OMITTED_WORD",
                "incorrect": "",
                "correct": d["word"],
                "tajweedRule": None,
                "severity": None,
                "tip": None,
            })
        elif d["status"] == "extra":
            out.append({
                "type": "ADDED_WORD",
                "incorrect": d["word"],
                "correct": "",
                "tajweedRule": None,
                "severity": None,
                "tip": None,
            })

    # Mispronunciation synth: if similarity is poor but no specific missing/extra
    similarity_words = sum(1 for d in diff if d["status"] == "correct")
    total_expected   = len(match["verse_words"])
    if total_expected > 0 and similarity_words / total_expected < 0.75 and not out:
        out.append({
            "type": "MISPRONUNCIATION",
            "incorrect": recited_text,
            "correct": match["verse_text"],
            "tajweedRule": None,
            "severity": None,
            "tip": None,
        })

    # Tajweed errors — only flag HIGH severity (LOW/MEDIUM are advisory only,
    # not surfaced to the user as mistakes per product spec).
    for terr in check_tajweed(match["verse_text"], recited_text):
        if terr.get("severity", "medium").lower() != "high":
            continue
        out.append({
            "type": "TAJWEED_VIOLATION",
            "incorrect": terr.get("word", ""),
            "correct":   terr.get("word", ""),
            "tajweedRule": terr["rule"],
            "severity":    terr.get("severity", "high"),
            "tip":         terr.get("tip", ""),
        })

    return out


class SummaryAccumulator:
    """Collects per-ayah results to compute the final_report on STOP."""

    def __init__(self):
        self.records: list[dict] = []

    def record(self, ayah: int, similarity: float, mistakes: list[dict]) -> None:
        self.records.append({"ayah": ayah, "similarity": similarity, "mistakes": mistakes})

    def finalize(self) -> dict:
        total = len(self.records)
        with_mistakes = sum(1 for r in self.records if r["mistakes"])
        total_mistakes = sum(len(r["mistakes"]) for r in self.records)
        avg_sim = (sum(r["similarity"] for r in self.records) / total) if total else 0.0
        accuracy = round(avg_sim * 100, 2)
        if avg_sim >= 0.90:
            grade = "Excellent"
        elif avg_sim >= 0.75:
            grade = "Good"
        elif avg_sim >= 0.55:
            grade = "Needs Practice"
        else:
            grade = "Needs Significant Practice"
        return {
            "totalAyahs": total,
            "ayahsWithMistakes": with_mistakes,
            "totalMistakes": total_mistakes,
            "averageAccuracy": accuracy,
            "grade": grade,
        }


from typing import Optional

from app.word_diff import LockedWordDiff


def build_partial_mistake(
    diff: LockedWordDiff,
    tajweed_violation: Optional[dict] = None,
) -> Optional[dict]:
    """Build a single mistake payload for a locked word, or None if no issue."""
    if diff.kind == "REPETITION":
        # Reciter re-said the previous word; not a mistake. ws_handler
        # short-circuits before calling this, but stay safe for direct callers.
        return None
    if diff.kind == "MATCH":
        if tajweed_violation and tajweed_violation.get("severity") == "high":
            return {
                "type": "TAJWEED_VIOLATION",
                "incorrect": diff.incorrect,
                "correct": diff.correct,
                "tajweedRule": tajweed_violation["rule"],
                "severity": "high",
                "tip": tajweed_violation.get("tip"),
            }
        return None

    return {
        "type": diff.kind,
        "incorrect": diff.incorrect,
        "correct": diff.correct,
        "tajweedRule": None,
        "severity": None,
        "tip": None,
    }


from dataclasses import dataclass, field
from typing import Literal


_State = Literal["PENDING", "CORRECTED", "ACKNOWLEDGED"]


@dataclass
class _PendingMistake:
    state: _State
    emitted_at: float
    expected_correct_norm: str
    position: int
    payload: dict


class MistakeStateMachine:
    """Per-WS-connection state for emitted partial_mistake events.

    Handles: (a) suppressing re-emission for same (ayah, position),
             (b) turning a pending mistake green when user re-reads it correctly,
             (c) acknowledging a pending mistake when user moves past it,
             (d) timing out pending mistakes after `timeout_sec`.
    """

    def __init__(self, timeout_sec: float):
        self.timeout_sec = timeout_sec
        self._pending: dict[tuple[int, int], _PendingMistake] = {}

    def register_mistake(self, ayah: int, position: int, payload: dict, now: float) -> list[dict]:
        key = (ayah, position)
        if key in self._pending:
            return []   # suppress
        from app.arabic_norm import canonical
        self._pending[key] = _PendingMistake(
            state="PENDING",
            emitted_at=now,
            expected_correct_norm=canonical(payload.get("correct", "")),
            position=position,
            payload=payload,
        )
        return [{"type": "partial_mistake", "ayah": ayah, "word_index": position,
                 "mistake": payload, "state": "pending"}]

    def on_locked_word(self, ayah: int, position: int, locked_normalised: str, now: float) -> list[dict]:
        events: list[dict] = []
        # First check: did the user just re-read a pending mistake correctly?
        for (a, p), pm in list(self._pending.items()):
            if a != ayah or pm.state != "PENDING":
                continue
            if locked_normalised == pm.expected_correct_norm:
                pm.state = "CORRECTED"
                events.append({"type": "word_corrected", "ayah": a, "word_index": p})
                continue   # don't also ack
            # User said the next expected position → ack the pending one
            if position == p + 1:
                pm.state = "ACKNOWLEDGED"
                events.append({"type": "mistake_acknowledged", "ayah": a, "word_index": p})
        return events

    def sweep(self, now: float) -> list[dict]:
        events: list[dict] = []
        for (a, p), pm in list(self._pending.items()):
            if pm.state != "PENDING":
                continue
            if now - pm.emitted_at >= self.timeout_sec:
                pm.state = "ACKNOWLEDGED"
                events.append({"type": "mistake_acknowledged", "ayah": a, "word_index": p})
        return events

    def reset_ayah(self, ayah: int) -> None:
        self._pending = {k: v for k, v in self._pending.items() if k[0] != ayah}

    def pending_payloads_for_ayah(self, ayah: int) -> list[dict]:
        return [pm.payload for (a, _), pm in sorted(self._pending.items())
                if a == ayah]
