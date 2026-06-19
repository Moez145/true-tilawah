from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.quran_index import load_quran, build_index, SURAH_NAMES
from app.transcription import get_provider


STATE: dict = {
    "vad":          None,
    "quran":        None,
    "verse_index":  None,
    "inverted":     None,
    "provider":     None,
    "tts":          None,
    "ready":        False,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Startup] Loading Silero VAD (ONNX backend) ...")
    # vad.py now manages its own lazy-loaded ONNX model internally —
    # we just trigger the load here so the first real request isn't slow.
    from app.vad import _ensure_loaded
    try:
        _ensure_loaded()
        STATE["vad"] = "loaded"
        print("[Startup] VAD loaded (ONNX) ✓")
    except Exception as e:
        print(f"[Startup] VAD failed to load: {e} — will fall back to no-VAD mode")
        STATE["vad"] = None

    print("[Startup] Loading Quran dataset ...")
    STATE["quran"] = load_quran()
    STATE["verse_index"], STATE["inverted"] = build_index(STATE["quran"])

    print("[Startup] Initialising transcription provider ...")
    STATE["provider"] = get_provider()

    print("[Startup] Loading TTS resolver ...")
    from app.tts_resolver import TTSResolver
    STATE["tts"] = TTSResolver()

    STATE["ready"] = True
    print(f"[Startup] OK Ready. {sum(len(v) for v in STATE['quran'].values())} verses indexed.")
    yield
    print("[Shutdown] Done.")