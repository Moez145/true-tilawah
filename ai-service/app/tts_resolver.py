"""Resolve a (surah, ayah, word_index) into TTS audio URLs."""
import json
from pathlib import Path
from typing import Optional

from app.config import TTS_WORD_TIMING_INDEX_PATH


class TTSResolver:
    def __init__(self, index_path: str = TTS_WORD_TIMING_INDEX_PATH):
        # Guard: skip loading if path is empty or not a valid file
        if index_path and index_path.strip():
            path = Path(index_path)
            if path.exists() and path.is_file():
                self._index = json.loads(path.read_text(encoding="utf-8"))
                print(f"[TTS] Loaded word timing index from {path}")
            else:
                self._index = {}
                print(f"[TTS] Word timing index not found at {path} — fallback mode")
        else:
            self._index = {}
            print(f"[TTS] No TTS_WORD_TIMING_INDEX_PATH set — fallback mode")

    def resolve(self, surah: int, ayah: int, word_index: int,
                fallback_word: Optional[str] = None) -> dict:
        key = f"{surah:03d}{ayah:03d}"
        entry = self._index.get(key)
        if entry:
            words  = entry.get("words") or []
            timing = words[word_index] if 0 <= word_index < len(words) else None
            return {
                "audio_url":          entry.get("audio_url"),
                "audio_word_timing":  timing,
                "audio_fallback_url": None,
            }
        # Unknown ayah → gTTS fallback URL the client can fetch
        fb = None
        if fallback_word:
            fb = f"/api/tts/gtts?text={fallback_word}"
        return {"audio_url": None, "audio_word_timing": None, "audio_fallback_url": fb}