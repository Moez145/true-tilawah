import numpy as np

from app.vad import has_speech, is_recent_silence


class _FakeVad:
    """Probabilistic VAD stand-in: returns p=1.0 for non-zero frames, p=0.0 for zero frames."""

    def reset_states(self): pass

    def __call__(self, chunk_tensor, sr):
        import torch
        chunk = chunk_tensor.numpy()
        p = 1.0 if np.abs(chunk).mean() > 1e-6 else 0.0
        class _R:
            def item(self_): return p
        return _R()


def test_returns_true_when_recent_tail_is_silent():
    sr = 16000
    speech = np.ones(sr * 2, dtype=np.float32)
    silence = np.zeros(int(sr * 0.8), dtype=np.float32)
    buf = np.concatenate([speech, silence])
    assert is_recent_silence(buf, _FakeVad(), last_n_sec=1.0, threshold_sec=0.7) is True


def test_returns_false_when_recent_tail_has_speech():
    sr = 16000
    speech = np.ones(sr * 2, dtype=np.float32)
    buf = speech
    assert is_recent_silence(buf, _FakeVad(), last_n_sec=1.0, threshold_sec=0.7) is False


def test_has_speech_returns_false_on_all_silence():
    sr = 16000
    silence = np.zeros(sr * 3, dtype=np.float32)
    assert has_speech(silence, _FakeVad(), min_speech_sec=0.3) is False


def test_has_speech_returns_true_when_window_has_enough_speech():
    sr = 16000
    silence = np.zeros(sr * 2, dtype=np.float32)
    speech = np.ones(sr * 1, dtype=np.float32)  # 1s of speech ≫ 0.3s required
    buf = np.concatenate([silence, speech])
    assert has_speech(buf, _FakeVad(), min_speech_sec=0.3) is True


def test_has_speech_returns_false_when_window_too_short():
    # less than one Silero frame (512 samples) → returns False without calling VAD
    tiny = np.ones(256, dtype=np.float32)
    assert has_speech(tiny, _FakeVad(), min_speech_sec=0.3) is False


def test_has_speech_short_circuits_on_min_speech_threshold():
    """Should bail out early once enough speech is detected — not scan whole buffer."""
    sr = 16000
    # 0.5 s of speech up front (~15 frames at 32 ms) plenty for min_speech_sec=0.3
    speech = np.ones(int(sr * 0.5), dtype=np.float32)
    silence = np.zeros(int(sr * 2.5), dtype=np.float32)
    buf = np.concatenate([speech, silence])
    assert has_speech(buf, _FakeVad(), min_speech_sec=0.3) is True
