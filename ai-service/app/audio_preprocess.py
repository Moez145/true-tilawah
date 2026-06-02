"""Audio preprocessing — single-responsibility wrapper around noisereduce.

Stationary spectral gating: estimates a noise profile from the input and
subtracts it across the whole window. Fast (~30 ms on a 4 s @ 16 kHz window),
no model download, no GPU.

Returns the input unchanged if it's too short for the FFT window so the
caller can use a uniform "always call this" wiring without size checks.
"""
from __future__ import annotations

import numpy as np

# Minimum samples required by noisereduce's default FFT window (n_fft=2048).
# Inputs shorter than this pass through unchanged.
_MIN_SAMPLES = 2048


def reduce_noise(pcm_float32: np.ndarray, sample_rate: int) -> np.ndarray:
    if pcm_float32.size < _MIN_SAMPLES:
        return pcm_float32.astype(np.float32, copy=False)
    import noisereduce as nr
    cleaned = nr.reduce_noise(
        y=pcm_float32,
        sr=sample_rate,
        stationary=True,
        prop_decrease=0.75,    # 1.0 over-suppresses speech; 0.75 is a safe middle.
    )
    return cleaned.astype(np.float32, copy=False)
