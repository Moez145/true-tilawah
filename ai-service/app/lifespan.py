from contextlib import asynccontextmanager

import torch
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
    print("[Startup] Loading Silero VAD ...")
    vad_model, _ = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False,
        trust_repo=True,
    )
    vad_model.double()
    STATE["vad"] = vad_model
    print("[Startup] VAD loaded (float32) ✓")

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