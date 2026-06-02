import numpy as np

from app.streaming_buffer import RollingBuffer


def test_append_and_window():
    rb = RollingBuffer(sample_rate=16000, window_sec=2.0)
    rb.append(np.ones(16000, dtype=np.float32))   # 1 s
    rb.append(np.ones(16000, dtype=np.float32))   # 1 s total = 2 s
    window = rb.window()
    assert window.shape == (32000,)
    assert window.dtype == np.float32


def test_window_caps_to_window_sec_plus_tail():
    rb = RollingBuffer(sample_rate=16000, window_sec=2.0, max_extra_sec=1.0)
    rb.append(np.ones(16000 * 5, dtype=np.float32))   # 5 s
    # Internal buffer is capped at (window_sec + max_extra_sec) s = 48000 samples.
    assert len(rb) == 48000
    # window() returns only the most-recent `window_sec` slice (what feeds ASR).
    assert len(rb.window()) == 32000
    # recent(2.0) is the same slice (window_sec == 2.0 here).
    assert len(rb.recent(2.0)) == 32000


def test_recent_short_buffer_returns_all():
    rb = RollingBuffer(sample_rate=16000, window_sec=2.0)
    rb.append(np.ones(8000, dtype=np.float32))   # 0.5 s
    assert len(rb.recent(2.0)) == 8000
