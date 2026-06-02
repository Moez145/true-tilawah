"""Centralised env + constants — every other module imports from here."""
import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
    _ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
    if _ENV_PATH.exists():
        load_dotenv(_ENV_PATH, override=True)
except ImportError:
    pass

# ── VAD ───────────────────────────────────────────────────────────────────────
VAD_SAMPLE_RATE   = 16000
VAD_WINDOW_FRAMES = 512
SILENCE_THRESHOLD = float(os.getenv("VAD_SILENCE_THRESHOLD_SEC", "1.0"))
MIN_SPEECH_SECS   = float(os.getenv("VAD_MIN_SPEECH_SEC", "0.5"))

# ── Streaming ─────────────────────────────────────────────────────────────────
STREAM_CHUNK_SEC             = float(os.getenv("STREAM_CHUNK_SEC", "0.032"))
STREAM_WINDOW_SEC            = float(os.getenv("STREAM_WINDOW_SEC", "6.0"))
STREAM_LOCK_IN_RUNS          = int(os.getenv("STREAM_LOCK_IN_RUNS", "2"))
MAX_BUFFER_SEC               = float(os.getenv("MAX_BUFFER_SEC", "30.0"))
SILENCE_FLUSH_SEC            = float(os.getenv("SILENCE_FLUSH_SEC", "1.0"))
PENDING_CORRECTION_TIMEOUT_SEC = float(os.getenv("PENDING_CORRECTION_TIMEOUT_SEC", "8.0"))

# ── Audio ─────────────────────────────────────────────────────────────────────
AUDIO_NOISE_REDUCE_ENABLED   = os.getenv("AUDIO_NOISE_REDUCE_ENABLED", "true").lower() == "true"

# ── Transcription ─────────────────────────────────────────────────────────────
TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "groq")
GROQ_API_KEY           = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL             = os.getenv("GROQ_MODEL", "whisper-large-v3")
WHISPER_MODEL          = os.getenv("WHISPER_MODEL", "medium")
AI_SERVICE_AUTH_TOKEN = os.getenv("AI_SERVICE_AUTH_TOKEN", "")

# ── Alignment ─────────────────────────────────────────────────────────────────
ALIGNER_FUZZY_THRESHOLD = float(os.getenv("ALIGNER_FUZZY_THRESHOLD", "0.6"))
ALIGNER_WINDOW          = int(os.getenv("ALIGNER_WINDOW", "20"))

# ── TTS ───────────────────────────────────────────────────────────────────────
TTS_WORD_TIMING_INDEX_PATH = os.getenv("TTS_WORD_TIMING_INDEX_PATH", "")
TTS_AUDIO_BASE_URL         = os.getenv("TTS_AUDIO_BASE_URL", "https://everyayah.com/data/Alafasy_128kbps")
TTS_FALLBACK_BASE_URL      = os.getenv("TTS_FALLBACK_BASE_URL", "https://cdn.islamic.network/quran/audio/128/ar.alafasy")

@dataclass(frozen=True)
class VerseScope:
    surah_id:   int
    ayah_start: int
    ayah_end:   int