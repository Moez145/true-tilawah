"""One-time conversion of tarteel-ai/whisper-base-ar-quran HF model → CTranslate2 int8.

Run: py -3.11 -m scripts.convert_tarteel_model
Idempotent: skips if ./models/tarteel-ct2/model.bin already exists.
"""
import sys
from pathlib import Path

MODEL_ID = "tarteel-ai/whisper-base-ar-quran"
OUT_DIR = Path(__file__).resolve().parent.parent / "models" / "tarteel-ct2"


def main() -> int:
    if (OUT_DIR / "model.bin").exists():
        print(f"[skip] {OUT_DIR} already exists")
        return 0

    try:
        from ctranslate2.converters.transformers import TransformersConverter
    except ImportError:
        print("ctranslate2 not installed; run pip install -r requirements-local-whisper.txt", file=sys.stderr)
        return 1

    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    print(f"[convert] {MODEL_ID} -> {OUT_DIR} (int8)")
    converter = TransformersConverter(MODEL_ID)
    converter.convert(str(OUT_DIR), quantization="int8", force=False)
    print("[done]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
