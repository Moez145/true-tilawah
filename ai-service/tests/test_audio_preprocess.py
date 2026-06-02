import numpy as np

from app.audio_preprocess import reduce_noise


def _make_signal_plus_noise(sr: int = 16000, sec: float = 2.0) -> tuple[np.ndarray, np.ndarray]:
    """Returns (clean_tone, noisy_tone) — a 440 Hz tone with broadband noise added."""
    t = np.linspace(0, sec, int(sr * sec), endpoint=False, dtype=np.float32)
    tone = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    rng = np.random.default_rng(seed=42)
    noise = (rng.standard_normal(len(t)).astype(np.float32) * 0.05)
    noisy = (tone + noise).astype(np.float32)
    return tone, noisy


def test_reduce_noise_decreases_rms_noise_floor():
    tone, noisy = _make_signal_plus_noise()
    cleaned = reduce_noise(noisy, sample_rate=16000)
    # Cleaned audio should have a smaller noise-floor RMS than the noisy input
    # in the silent leading 100 ms (which is mostly noise in our generator).
    n = int(0.1 * 16000)
    rms_noisy = float(np.sqrt(np.mean(noisy[:n] ** 2)))
    rms_clean = float(np.sqrt(np.mean(cleaned[:n] ** 2)))
    assert rms_clean < rms_noisy * 0.9, (
        f"expected ≥10% noise reduction, got rms {rms_clean:.4f} vs {rms_noisy:.4f}"
    )


def test_reduce_noise_preserves_shape_and_dtype():
    _, noisy = _make_signal_plus_noise()
    cleaned = reduce_noise(noisy, sample_rate=16000)
    assert cleaned.dtype == np.float32
    assert cleaned.shape == noisy.shape


def test_reduce_noise_on_empty_input_returns_empty():
    empty = np.zeros(0, dtype=np.float32)
    out = reduce_noise(empty, sample_rate=16000)
    assert out.shape == (0,)
    assert out.dtype == np.float32


def test_reduce_noise_on_very_short_input_passes_through():
    # noisereduce can fail on inputs shorter than the FFT window; we must handle that.
    short = (np.random.rand(100).astype(np.float32) - 0.5)
    out = reduce_noise(short, sample_rate=16000)
    assert out.shape == short.shape
    assert out.dtype == np.float32


def test_reduce_noise_destroys_pure_speech_known_limitation():
    """Pinned regression test for the reason AUDIO_NOISE_REDUCE_ENABLED defaults to False.

    Stationary noise reduction without a `y_noise` reference clip estimates
    the noise spectrum FROM THE INPUT ITSELF. On a 4-second window of pure
    speech (no background noise), the "noise estimate" becomes the average
    speech spectrum, and applying spectral gating subtracts speech itself.
    The result loses >50% of energy and corrupts formants → Whisper
    hallucinates on the corrupted input.

    If someone later swaps in a speech-safe approach (e.g. noise-clip-based,
    or non-stationary mode with proper SNR estimation), this test will FAIL
    and signal that AUDIO_NOISE_REDUCE_ENABLED can be flipped back to default-on.
    """
    sr = 16000
    rng = np.random.default_rng(seed=0)
    # Build a speech-like broadband signal: white noise band-pass-filtered
    # to the speech bandwidth (200-3000 Hz). Not real speech, but spectrally
    # similar enough to expose the issue.
    from scipy.signal import butter, sosfilt
    white = rng.standard_normal(sr * 4).astype(np.float32) * 0.3
    sos = butter(4, [200, 3000], btype='band', fs=sr, output='sos')
    speech_like = sosfilt(sos, white).astype(np.float32)

    cleaned = reduce_noise(speech_like, sample_rate=sr)

    rms_in = float(np.sqrt(np.mean(speech_like ** 2)))
    rms_out = float(np.sqrt(np.mean(cleaned ** 2)))
    preservation = rms_out / rms_in

    assert preservation < 0.5, (
        f"Pure speech preserved at {preservation:.0%} — noise reduction may now "
        f"be speech-safe. Re-evaluate the AUDIO_NOISE_REDUCE_ENABLED default in config.py."
    )
