import wave
from pathlib import Path

import numpy as np
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "al-baqarah-23.wav"


def _load_wav_float32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getframerate() == 16000
        frames = w.readframes(w.getnframes())
    pcm_int16 = np.frombuffer(frames, dtype=np.int16)
    return (pcm_int16.astype(np.float32) / 32768.0).copy()


@pytest.mark.asyncio
async def test_tarteel_transcribes_arabic():
    if not FIXTURE.exists():
        pytest.skip("fixture WAV not present")
    from app.transcription.tarteel import TarteelProvider
    provider = TarteelProvider()
    pcm = _load_wav_float32(FIXTURE)
    result = await provider.transcribe(pcm)
    # Tarteel may return empty for a silence-only fixture — we only assert it
    # returns a string (not None) and (when there's speech) contains Arabic.
    assert isinstance(result.text, str)
    if len(pcm) / 16000 >= 1.0 and pcm.std() > 0.01:
        # Real recitation → expect Arabic letters
        has_arabic = any("؀" <= ch <= "ۿ" for ch in result.text)
        assert has_arabic, f"no Arabic in output: {result.text!r}"
