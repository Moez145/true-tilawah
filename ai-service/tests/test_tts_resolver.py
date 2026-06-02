import json
from pathlib import Path

import pytest

from app.tts_resolver import TTSResolver


@pytest.fixture
def tmp_index(tmp_path):
    p = tmp_path / "wt.json"
    p.write_text(json.dumps({
        "002023": {"audio_url": "https://example.com/002023.mp3", "words": []},
    }, ensure_ascii=False), encoding="utf-8")
    return p


def test_resolve_known_ayah(tmp_index):
    r = TTSResolver(index_path=tmp_index)
    out = r.resolve(surah=2, ayah=23, word_index=4)
    assert out["audio_url"] == "https://example.com/002023.mp3"
    assert out["audio_word_timing"] is None
    assert out["audio_fallback_url"] is None


def test_resolve_unknown_ayah_returns_fallback(tmp_index):
    r = TTSResolver(index_path=tmp_index)
    out = r.resolve(surah=99, ayah=1, word_index=0, fallback_word="ريب")
    assert out["audio_url"] is None
    assert out["audio_fallback_url"] is not None
    assert "ريب" in out["audio_fallback_url"]
