"""Rolling audio buffer + word-level stability tracker for streaming ASR."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from app.arabic_norm import canonical  # used by StableTracker (Task 5)


class RollingBuffer:
    """Append-only float32 PCM buffer with a windowed read view.

    Memory is capped to `window_sec + max_extra_sec` to bound RAM.
    """

    def __init__(self, sample_rate: int, window_sec: float, max_extra_sec: float = 1.0):
        self.sr = sample_rate
        self.window_sec = window_sec
        self.max_samples = int((window_sec + max_extra_sec) * sample_rate)
        self._buf = np.zeros(0, dtype=np.float32)

    def append(self, chunk: np.ndarray) -> None:
        if chunk.dtype != np.float32:
            chunk = chunk.astype(np.float32)
        self._buf = np.concatenate([self._buf, chunk])
        if len(self._buf) > self.max_samples:
            self._buf = self._buf[-self.max_samples:]

    def window(self) -> np.ndarray:
        return self.recent(self.window_sec)

    def recent(self, sec: float) -> np.ndarray:
        n = int(sec * self.sr)
        if len(self._buf) <= n:
            return self._buf.copy()
        return self._buf[-n:].copy()

    def __len__(self) -> int:
        return len(self._buf)


@dataclass(frozen=True)
class LockedWord:
    position: int     # 0-based index in the transcript
    text: str         # normalised form (canonical())


class StableTracker:
    """Locks words that appear at the same position across N consecutive runs."""

    def __init__(self, lock_in_runs: int = 2):
        assert lock_in_runs >= 2, "lock_in_runs must be >= 2"
        self.lock_in_runs = lock_in_runs
        self._prev_runs: list[list[str]] = []
        self._locked: dict[int, str] = {}  # position -> normalised word

    def feed(self, transcript: str) -> list[LockedWord]:
        words = [canonical(w) for w in transcript.split() if w.strip()]

        # Drift detection: if the rolling ASR window has moved past previously-
        # locked content (e.g. the reciter transitioned to the next ayah without
        # a >SILENCE_THRESHOLD pause that would have triggered the explicit
        # tracker.reset() in ws_handler's ayah-end finalize path), the locked
        # dict is stale and blocks every subsequent ayah from acquiring any
        # locks. We detect this by checking how many locked words still appear
        # at their locked positions in the latest transcript — if the majority
        # are gone, the window has clearly shifted and we reset.
        if self._locked:
            matches = sum(
                1 for pos, w in self._locked.items()
                if pos < len(words) and words[pos] == w
            )
            if matches * 2 < len(self._locked):
                self._locked.clear()
                self._prev_runs.clear()

        self._prev_runs.append(words)
        if len(self._prev_runs) > self.lock_in_runs:
            self._prev_runs.pop(0)
        if len(self._prev_runs) < self.lock_in_runs:
            return []

        newly: list[LockedWord] = []
        # Consider all positions EXCEPT the tail of the most recent transcript
        # (the tail is tentative — give it one more run to confirm).
        latest = self._prev_runs[-1]
        candidate_positions = range(len(latest) - 1)
        for pos in candidate_positions:
            if pos in self._locked:
                continue
            # All runs must agree at this position
            if all(pos < len(run) and run[pos] == latest[pos] for run in self._prev_runs):
                self._locked[pos] = latest[pos]
                newly.append(LockedWord(position=pos, text=latest[pos]))
        return newly

    def current_locked(self) -> list[str]:
        return [self._locked[p] for p in sorted(self._locked)]

    def reset(self) -> None:
        self._prev_runs.clear()
        self._locked.clear()
