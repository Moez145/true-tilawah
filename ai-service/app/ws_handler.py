import json
import asyncio
import base64
import time
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from app.config import VerseScope, VAD_SAMPLE_RATE
from app.lifespan import STATE
from app.ayah_aligner import ScopedAligner
from app.pipeline import build_mistakes, SummaryAccumulator

# Tajweed rules for violation detection
TAJWEED_RULES = [
    {
        'name':     'Qalqala',
        'letters':  set('قطبجد'),
        'tip':      'Letters ق ط ب ج د require a slight echo/bounce sound (Qalqalah).',
        'severity': 'medium',
    },
    {
        'name':     'Ghunna',
        'letters':  set('نم'),
        'tip':      'Letters ن and م with shaddah require nasalization (Ghunnah) for 2 counts.',
        'severity': 'medium',
    },
    {
        'name':     'Madd',
        'letters':  set('اوي'),
        'tip':      'Elongate this vowel for the correct number of counts (Madd).',
        'severity': 'low',
    },
]

# ── Tunable thresholds ────────────────────────────────────────────────────────
SILENCE_RMS_THRESHOLD   = 0.01   # below this RMS = treat buffer as silence/noise
MIN_ALIGN_SCORE         = 0.55   # below this = not a real match, ignore
MIN_TRANSCRIPT_WORDS    = 2      # transcripts shorter than this are usually hallucinations


def check_tajweed(word: str, correct_word: str) -> list:
    violations = []
    for rule in TAJWEED_RULES:
        for ch in rule['letters']:
            if ch in correct_word and ch not in word:
                violations.append({
                    'type':        'TAJWEED_VIOLATION',
                    'incorrect':   word,
                    'correct':     correct_word,
                    'tajweedRule': rule['name'],
                    'severity':    rule['severity'],
                    'tip':         rule['tip'],
                })
                break
    return violations


def has_audio_energy(buf: np.ndarray, threshold: float = SILENCE_RMS_THRESHOLD) -> bool:
    """Cheap silence gate — fallback if VAD is unavailable."""
    if len(buf) == 0:
        return False
    rms = float(np.sqrt(np.mean(buf.astype(np.float64) ** 2)))
    return rms > threshold


async def safe_send(ws: WebSocket, data: dict) -> bool:
    try:
        await ws.send_json(data)
        return True
    except Exception:
        return False


async def handle_ws_evaluate(ws: WebSocket):
    await ws.accept()

    if not STATE.get("ready"):
        await safe_send(ws, {"type": "error", "code": "not_ready"})
        await ws.close()
        return

    # ── 1. First message must be JSON config ─────────────────────────────────
    try:
        first = await asyncio.wait_for(ws.receive(), timeout=15.0)
        if "text" not in first:
            await safe_send(ws, {"type": "error", "code": "config_required"})
            await ws.close()
            return
        cfg   = json.loads(first["text"])
        scope = VerseScope(
            surah_id   = int(cfg["surahId"]),
            ayah_start = int(cfg["ayahStart"]),
            ayah_end   = int(cfg["ayahEnd"]),
        )
    except (asyncio.TimeoutError, KeyError, ValueError, json.JSONDecodeError) as e:
        await safe_send(ws, {"type": "error", "code": "invalid_config", "message": str(e)})
        await ws.close()
        return

    print(f"[WS] Config: surah={scope.surah_id} ayahs={scope.ayah_start}-{scope.ayah_end}")

    aligner   = ScopedAligner(scope, STATE["quran"])
    summary   = SummaryAccumulator()
    provider  = STATE["provider"]
    buffer    = np.array([], dtype=np.float32)
    audio_sent = set()  # ayahs that already got audio feedback this session

    await safe_send(ws, {"type": "ready"})
    print("[WS] Ready — waiting for audio")

    async def process_buffer(buf: np.ndarray):
        duration = len(buf) / VAD_SAMPLE_RATE
        t_start = time.monotonic()

        # ── Gate 1: VAD — yes/no check only, NEVER trim/concatenate the audio ──
        # Trimming was scrambling natural pauses between words (e.g. Madd
        # elongation), which broke alignment and caused false "wrong ayah" hits.
        speech_detected = None
        try:
            from app.vad import has_speech
            t_vad0 = time.monotonic()
            speech_detected = has_speech(buf, None)
            t_vad1 = time.monotonic()
            print(f"[WS] VAD check: {t_vad1 - t_vad0:.2f}s — speech={speech_detected}")
        except Exception as e:
            print(f"[WS] VAD unavailable ({e}) — falling back to energy gate")
            speech_detected = None

        if speech_detected is None:
            # VAD failed to run at all — fall back to RMS energy gate
            speech_detected = has_audio_energy(buf)

        if not speech_detected:
            print(f"[WS] {duration:.2f}s buffer — no speech detected, skipping "
                  f"(total gate time {time.monotonic() - t_start:.2f}s)")
            return

        # ── Transcribe the FULL, UNTRIMMED buffer — preserves natural pauses ──
        print(f"[WS] Transcribing {duration:.2f}s")
        t_asr0 = time.monotonic()
        try:
            tr = await provider.transcribe(buf.astype(np.float32))
        except Exception as e:
            print(f"[WS] Transcription error: {e}")
            await safe_send(ws, {"type": "error", "code": "asr_failed", "message": str(e)})
            return
        t_asr1 = time.monotonic()
        print(f"[WS] ASR (Groq) took {t_asr1 - t_asr0:.2f}s")

        text = (tr.text or "").strip()
        if not text:
            print("[WS] Empty transcription — skipping")
            return

        # ── Gate 2: too-short transcripts are usually hallucinated noise ──────
        if len(text.split()) < MIN_TRANSCRIPT_WORDS:
            print(f"[WS] Transcript too short ({text!r}) — likely noise, skipping")
            return

        print(f"[WS] Transcribed: '{text}'")

        match = aligner.align(text)
        if match is None:
            print(f"[WS] Out of scope: '{text}'")
            await safe_send(ws, {
                "type":        "out_of_scope",
                "you_recited": text,
                "message":     f"Please recite Surah {scope.surah_id} Ayah {scope.ayah_start}-{scope.ayah_end}.",
            })
            return

        ayah  = match.get("ayah")
        score = match.get("score", 0)
        print(f"[WS] Aligned: ayah={ayah} score={score:.3f}")

        # ── Gate 3: low-confidence match = probably not real speech ──────────
        if score < MIN_ALIGN_SCORE:
            print(f"[WS] Score {score:.3f} below {MIN_ALIGN_SCORE} — treating as noise, not a mistake")
            return

        mistakes = build_mistakes(text, match)

        recited_words  = text.split()
        expected_words = (STATE["quran"].get(scope.surah_id, {}).get(ayah, "")).split()
        for i, word in enumerate(recited_words):
            exp = expected_words[i] if i < len(expected_words) else ""
            if exp:
                for v in check_tajweed(word, exp):
                    mistakes.append(v)

        summary.record(ayah, score, mistakes)

        if mistakes:
            count = len(mistakes)
            print(f"[WS] {count} mistake(s) on ayah {ayah}")
            for m in mistakes:
                print(f"  → [{m['type']}] '{m.get('incorrect','')}' → '{m.get('correct','')}' ({m.get('tajweedRule')})")

            play_audio = ayah not in audio_sent
            if play_audio:
                audio_sent.add(ayah)

            await safe_send(ws, {
                "type":       "mistake",
                "ayah":       ayah,
                "mistakes":   mistakes,
                "play_audio": play_audio,
            })
        else:
            print(f"[WS] 0 mistake(s) on ayah {ayah} — correct, sending confirmation")
            audio_sent.discard(ayah)
            await safe_send(ws, {
                "type":    "ok",
                "ayah":    ayah,
                "message": "Correct recitation",
            })

        print(f"[WS] Total process_buffer time: {time.monotonic() - t_start:.2f}s")

    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=60.0)
            except asyncio.TimeoutError:
                print("[WS] Receive timeout — closing")
                break

            if "text" in msg:
                txt = msg["text"].strip().upper()
                if txt == "STOP":
                    print("[WS] STOP received")
                    break
                continue

            if "bytes" in msg and msg["bytes"]:
                raw = msg["bytes"]
                try:
                    parsed = json.loads(raw.decode("utf-8"))
                    if parsed.get("type") == "audio":
                        pcm_bytes = base64.b64decode(parsed["pcm"])
                        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    else:
                        continue
                except Exception:
                    try:
                        chunk = np.frombuffer(raw, dtype=np.float32)
                        if len(chunk) > 4:
                            chunk = chunk[1:]
                    except Exception:
                        continue

                if len(chunk) == 0:
                    continue

                buffer = np.concatenate([buffer, chunk])
                duration = len(buffer) / VAD_SAMPLE_RATE
                print(f"[WS] Buffer: {duration:.2f}s")

                if len(buffer) >= VAD_SAMPLE_RATE * 3:
                    buf_to_process = buffer.copy()
                    buffer = np.array([], dtype=np.float32)
                    await process_buffer(buf_to_process)

    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except Exception as e:
        print(f"[WS] Unexpected error: {e}")

    final = summary.finalize()
    print(f"[WS] Final: accuracy={final.get('averageAccuracy', 0)} grade={final.get('grade', '—')}")
    await safe_send(ws, {"type": "final_report", **final})

    try:
        await ws.close()
    except Exception:
        pass