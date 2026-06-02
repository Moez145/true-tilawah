from abc import ABC, abstractmethod
from dataclasses import dataclass
import numpy as np


@dataclass
class TranscriptionResult:
    text: str
    confidence: float | None = None
    raw: dict | None = None


class TranscriptionProvider(ABC):
    @abstractmethod
    async def transcribe(
        self,
        pcm_float32: np.ndarray,
        language: str = "ar",
        initial_prompt: str | None = None,
    ) -> TranscriptionResult:
        ...
