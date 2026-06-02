"""Builds a local index of (surah, ayah) -> ayah-level mp3 URL on EveryAyah.

Word-level timing (start_ms/end_ms per word in the ayah mp3) is NOT publicly
available from EveryAyah, so we leave the per-word timing slots empty and let
the frontend play the whole ayah clip from the start. The Quran.com API does
provide word timings; that's a future enhancement.

Run: py -3.11 -m scripts.build_word_timing_index
"""
import json
from pathlib import Path

from app.config import TTS_AUDIO_BASE_URL

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "word_timings.json"


def main() -> int:
    index: dict = {}
    # Surah ayah counts (114 surahs, source: known fixed numbers)
    SURAH_AYAH_COUNTS = [
        7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,
        112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,
        59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,
        52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,
        21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6
    ]
    for surah_id, count in enumerate(SURAH_AYAH_COUNTS, start=1):
        for ayah_num in range(1, count + 1):
            key = f"{surah_id:03d}{ayah_num:03d}"
            index[key] = {
                "audio_url": f"{TTS_AUDIO_BASE_URL}/{key}.mp3",
                "words": []   # empty until Quran.com word timings are integrated
            }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(f"[done] wrote {len(index)} entries -> {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
