import pytest

from app import transcription


# These tests patch `transcription.TRANSCRIPTION_PROVIDER` directly because
# `app.config` calls `load_dotenv(override=True)` which would otherwise clobber
# any `os.environ` patches with the value from the on-disk `ai-service/.env`.
# The factory reads the imported name binding, not `os.environ` directly, so
# patching the attribute is the cleanest way to exercise the dispatch.


def test_groq_provider_no_longer_supported(monkeypatch):
    """The Groq provider has been removed. Selecting it raises a clear error."""
    monkeypatch.setattr(transcription, "TRANSCRIPTION_PROVIDER", "groq")
    with pytest.raises(ValueError, match="no longer supported"):
        transcription.get_provider()


def test_unknown_provider_raises(monkeypatch):
    monkeypatch.setattr(transcription, "TRANSCRIPTION_PROVIDER", "bogus")
    with pytest.raises(ValueError, match="Unknown TRANSCRIPTION_PROVIDER"):
        transcription.get_provider()
