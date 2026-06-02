import json
import asyncio
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


async def safe_send(ws: WebSocket, data: dict) -> bool:
    """Send JSON safely — returns False if connection is closed."""
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
    # Track which ayahs already had audio feedback sent
    audio_sent = set()

    await safe_send(ws, {"type": "ready"})
    print("[WS] Ready — waiting for audio")

    async def process_buffer(buf: np.ndarray):
        """Transcribe buffer and send mistake events."""
        duration = len(buf) / VAD_SAMPLE_RATE
        print(f"[WS] Transcribing {duration:.2f}s")

        try:
            tr = await provider.transcribe(buf.astype(np.float32))
        except Exception as e:
            print(f"[WS] Transcription error: {e}")
            await safe_send(ws, {"type": "error", "code": "asr_failed", "message": str(e)})
            return

        text = (tr.text or "").strip()
        if not text:
            print("[WS] Empty transcription — skipping")
            await safe_send(ws, {"type": "unclear"})
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

        # Build word-level mistakes
        mistakes = build_mistakes(text, match)

        # Add tajweed violations
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

            # play_audio=True only ONCE per ayah so phone doesn't replay every chunk
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
            print(f"[WS] 0 mistake(s) on ayah {ayah} — correct")
            await safe_send(ws, {"type": "ok", "ayah": ayah})

    try:
        while True:
            try:
                # ── 60s timeout per chunk — prevents hanging forever ──────────
                msg = await asyncio.wait_for(ws.receive(), timeout=60.0)
            except asyncio.TimeoutError:
                print("[WS] Receive timeout — closing")
                break

            # STOP signal
            if "text" in msg:
                txt = msg["text"].strip().upper()
                if txt == "STOP":
                    print("[WS] STOP received")
                    break
                # Ignore other text messages
                continue

            # Audio binary chunk
            if "bytes" in msg and msg["bytes"]:
                raw = msg["bytes"]

                # Backend sends JSON {"type":"audio","seq":N,"pcm":"<base64>"}
                try:
                    import base64
                    parsed = json.loads(raw.decode("utf-8"))
                    if parsed.get("type") == "audio":
                        pcm_bytes = base64.b64decode(parsed["pcm"])
                        chunk = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    else:
                        continue
                except Exception:
                    # Raw float32 binary fallback
                    try:
                        chunk = np.frombuffer(raw, dtype=np.float32)
                        if len(chunk) > 4:
                            chunk = chunk[1:]  # strip 4-byte seqNo header
                    except Exception:
                        continue

                if len(chunk) == 0:
                    continue

                buffer = np.concatenate([buffer, chunk])
                duration = len(buffer) / VAD_SAMPLE_RATE
                print(f"[WS] Buffer: {duration:.2f}s")

                # Process every 3 seconds of audio
                if len(buffer) >= VAD_SAMPLE_RATE * 3:
                    buf_to_process = buffer.copy()
                    buffer = np.array([], dtype=np.float32)  # clear immediately
                    await process_buffer(buf_to_process)

    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except Exception as e:
        print(f"[WS] Unexpected error: {e}")

    # ── Final report ──────────────────────────────────────────────────────────
    final = summary.finalize()
    print(f"[WS] Final: accuracy={final.get('averageAccuracy', 0)} grade={final.get('grade', '—')}")
    await safe_send(ws, {"type": "final_report", **final})

    try:
        await ws.close()
    except Exception:
        pass