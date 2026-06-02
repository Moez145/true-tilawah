from app.config import TRANSCRIPTION_PROVIDER, GROQ_API_KEY
from .base import TranscriptionProvider, TranscriptionResult


def get_provider() -> TranscriptionProvider:
    import os
    print(f"[provider-debug] TRANSCRIPTION_PROVIDER={TRANSCRIPTION_PROVIDER!r}")
    print(f"[provider-debug] GROQ_API_KEY len={len(GROQ_API_KEY)} preview={GROQ_API_KEY[:8] if GROQ_API_KEY else '<empty>'}")
    print(f"[provider-debug] os.environ GROQ_API_KEY len={len(os.environ.get('GROQ_API_KEY', ''))}")

    if TRANSCRIPTION_PROVIDER == "groq":
        from .groq import GroqProvider
        return GroqProvider(api_key=GROQ_API_KEY)

    if TRANSCRIPTION_PROVIDER == "local_whisper":
        from .local_whisper import LocalWhisperProvider
        return LocalWhisperProvider()

    raise ValueError(f"Unknown TRANSCRIPTION_PROVIDER: {TRANSCRIPTION_PROVIDER}")


__all__ = ["TranscriptionProvider", "TranscriptionResult", "get_provider"]