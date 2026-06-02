import io
import wave

import numpy as np
import httpx

from .base import TranscriptionProvider, TranscriptionResult

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
SAMPLE_RATE = 16_000  # Silero VAD outputs 16 kHz


def _pcm_to_wav_bytes(pcm: np.ndarray) -> bytes:
    """Convert a float32 PCM array (–1.0 … 1.0) to a 16-bit mono WAV blob."""
    pcm_clipped = np.clip(pcm, -1.0, 1.0)
    pcm_int16 = (pcm_clipped * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)          # 16-bit  → 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_int16.tobytes())
    return buf.getvalue()


class GroqProvider(TranscriptionProvider):
    def __init__(self, api_key: str, model: str = "whisper-large-v3") -> None:
        if not api_key:
            raise ValueError("GROQ_API_KEY is empty – set it in your .env file.")
        self._api_key = api_key
        self._model = model

    async def transcribe(
        self,
        pcm_float32: np.ndarray,
        language: str = "ar",
        initial_prompt: str | None = None,
    ) -> TranscriptionResult:
        wav_bytes = _pcm_to_wav_bytes(pcm_float32)

        data: dict = {
            "model": self._model,
            "language": language,
            "response_format": "verbose_json",  # gives us confidence-like fields
        }
        if initial_prompt:
            data["prompt"] = initial_prompt

        files = {
            "file": ("audio.wav", wav_bytes, "audio/wav"),
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                data=data,
                files=files,
            )

        if response.status_code != 200:
            raise RuntimeError(
                f"Groq transcription failed [{response.status_code}]: {response.text}"
            )

        payload = response.json()

        text: str = payload.get("text", "").strip()

        # `verbose_json` returns per-segment avg_logprob; take the mean as a
        # rough confidence proxy (logprob → probability).
        segments = payload.get("segments") or []
        confidence: float | None = None
        if segments:
            import math
            avg_logprob = sum(s.get("avg_logprob", 0.0) for s in segments) / len(segments)
            confidence = round(math.exp(avg_logprob), 4)   # 0.0 – 1.0

        return TranscriptionResult(text=text, confidence=confidence, raw=payload)
