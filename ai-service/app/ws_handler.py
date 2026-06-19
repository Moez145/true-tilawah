import json
import re
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from app.config import VerseScope, VAD_SAMPLE_RATE
from app.lifespan import STATE
from app.ayah_aligner import ScopedAligner
from app.pipeline import build_mistakes, SummaryAccumulator

# ── Tajweed rules ─────────────────────────────────────────────────────────────
TAJWEED_RULES = [
    {
        "code":     "QALQALA",
        "name":     "Qalqala",
        "letters":  ["ق", "ط", "ب", "ج", "د"],
        "tip":      "Qalqala: Letters ق ط ب ج د require a slight echo/bounce when silent.",
        "severity": "medium",
    },
    {
        "code":     "GHUNNA",
        "name":     "Ghunna",
        "letters":  ["ن", "م"],
        "tip":      "Ghunna: Nasalization required on Noon and Meem with shaddah.",
        "severity": "medium",
    },
    {
        "code":     "MADD",
        "name":     "Madd (Elongation)",
        "letters":  ["ا", "و", "ي"],
        "tip":      "Madd: Vowel must be elongated 2-6 counts depending on the type.",
        "severity": "high",
    },
]

def check_all_tajweed(recited_text: str, correct_text: str) -> list:
    violations = []
    def strip(t): return re.sub(r'[\u064B-\u065F\u0670]', '', t)
    rec_words = recited_text.split()
    cor_words = correct_text.split()
    for i in range(min(len(rec_words), len(cor_words))):
        rec = strip(rec_words[i])
        cor = strip(cor_words[i])
        if rec == cor:
            continue
        for rule in TAJWEED_RULES:
            for letter in rule["letters"]:
                if letter in cor_words[i] and letter not in rec_words[i]:
                    violations.append({
                        "type":        "TAJWEED_VIOLATION",
                        "incorrect":   rec_words[i],
                        "correct":     cor_words[i],
                        "tajweedRule": rule["name"],
                        "severity":    rule["severity"],
                        "tip":         rule["tip"],
                    })
                    break
    return violations


async def safe_send(ws, data):
    try:
        await ws.send_json(data)
        return True
    except Exception:
        return False


async def handle_ws_evaluate(ws: WebSocket):
    await ws.accept()

    if not STATE["ready"]:
        await safe_send(ws, {"type": "error", "code": "not_ready"})
        try: await ws.close()
        except: pass
        return

    # 1. Receive config frame
    try:
        first = await ws.receive()
        if "text" not in first:
            await safe_send(ws, {"type": "error", "code": "config_required"})
            try: await ws.close()
            except: pass
            return
        cfg   = json.loads(first["text"])
        scope = VerseScope(
            surah_id=int(cfg["surahId"]),
            ayah_start=int(cfg["ayahStart"]),
            ayah_end=int(cfg["ayahEnd"]),
        )
        print(f"[WS] Config: surah={scope.surah_id} ayahs={scope.ayah_start}-{scope.ayah_end}")
    except WebSocketDisconnect:
        return
    except Exception as e:
        print(f"[WS] Config error: {e}")
        await safe_send(ws, {"type": "error", "code": "invalid_config"})
        try: await ws.close()
        except: pass
        return

    aligner  = ScopedAligner(scope, STATE["quran"])
    summary  = SummaryAccumulator()
    provider = STATE["provider"]
    buffer   = np.array([], dtype=np.float32)

    # Track which ayahs already had feedback played — only play once per ayah
    ayahs_with_feedback = set()

    if not await safe_send(ws, {"type": "ready"}):
        return
    print(f"[WS] Ready — waiting for audio")

    try:
        while True:
            try:
                msg = await ws.receive()
            except (WebSocketDisconnect, RuntimeError):
                print(f"[WS] Client disconnected")
                break

            if msg.get("type") == "websocket.disconnect":
                break

            # Text frame
            if "text" in msg:
                txt = msg["text"].strip()
                if txt.upper() == "STOP":
                    print(f"[WS] STOP — buffer={len(buffer)/VAD_SAMPLE_RATE:.2f}s")
                    if len(buffer) >= int(0.5 * VAD_SAMPLE_RATE):
                        await _process_buffer(
                            buffer, provider, aligner,
                            summary, scope, ws, ayahs_with_feedback
                        )
                    break
                continue

            # Binary frame: [4-byte seqNo][float32 PCM]
            if "bytes" in msg:
                raw = msg["bytes"]
                if len(raw) < 8:
                    continue

                chunk  = np.frombuffer(raw[4:], dtype=np.float32).copy()
                if len(chunk) == 0:
                    continue

                buffer = np.concatenate([buffer, chunk])
                print(f"[WS] Buffer: {len(buffer)/VAD_SAMPLE_RATE:.2f}s")

                # Process every 2 seconds
                if len(buffer) >= VAD_SAMPLE_RATE * 2:
                    try:
                        buffer = await _process_buffer(
                            buffer, provider, aligner,
                            summary, scope, ws, ayahs_with_feedback
                        )
                    except (WebSocketDisconnect, RuntimeError):
                        break

    except (WebSocketDisconnect, RuntimeError):
        pass

    fr = summary.finalize()
    print(f"[WS] Final: accuracy={fr.get('averageAccuracy',0):.1f} grade={fr.get('grade','?')}")
    await safe_send(ws, {"type": "final_report", **fr})
    try: await ws.close()
    except: pass


async def _process_buffer(buffer, provider, aligner, summary, scope, ws, ayahs_with_feedback):
    """Transcribe → align → detect mistakes → send result (no VAD)."""

    # Skip VAD entirely — it has float/double issues
    # Transcribe the whole buffer directly
    audio = buffer.astype(np.float32)
    print(f"[WS] Transcribing {len(audio)/VAD_SAMPLE_RATE:.2f}s")

    try:
        tr = await provider.transcribe(audio)
    except Exception as e:
        print(f"[WS] ASR error: {e}")
        await safe_send(ws, {"type": "error", "code": "asr_failed", "message": str(e)})
        return np.array([], dtype=np.float32)

    text = tr.text.strip()
    print(f"[WS] Transcribed: {text!r}")

    if not text or len(text) < 2:
        await safe_send(ws, {"type": "unclear", "message": "Could not hear clearly — please try again."})
        return np.array([], dtype=np.float32)

    # Alignment
    match = aligner.align(text)

    if match is None:
        print(f"[WS] Out of scope: {text!r}")
        await safe_send(ws, {
            "type":        "out_of_scope",
            "you_recited": text,
            "message":     f"Please recite Surah {scope.surah_id} Ayah {scope.ayah_start}–{scope.ayah_end}.",
        })
        return np.array([], dtype=np.float32)

    print(f"[WS] Aligned: ayah={match['ayah']} score={match['score']:.3f}")

    # Word mistakes
    mistakes = build_mistakes(text, match)

    # Tajweed violations
    try:
        correct_text = STATE["quran"][scope.surah_id][match["ayah"]]
        tajweed_v    = check_all_tajweed(text, correct_text)
        existing     = {m.get("incorrect", "") for m in mistakes}
        for v in tajweed_v:
            if v["incorrect"] not in existing:
                mistakes.append(v)
    except Exception as e:
        print(f"[WS] Tajweed error: {e}")

    summary.record(match["ayah"], match["score"], mistakes)
    print(f"[WS] {len(mistakes)} mistake(s) on ayah {match['ayah']}")
    for m in mistakes:
        print(f"  → [{m['type']}] '{m.get('incorrect','')}' → '{m.get('correct','')}' ({m.get('tajweedRule','')})")

    if mistakes:
        ayah_num = match["ayah"]

        # Only send audio feedback ONCE per ayah
        # After first mistake on an ayah, mark it — subsequent mistakes
        # show in the panel but don't trigger audio again
        play_audio = ayah_num not in ayahs_with_feedback
        if play_audio:
            ayahs_with_feedback.add(ayah_num)

        await safe_send(ws, {
            "type":       "mistake",
            "ayah":       ayah_num,
            "mistakes":   mistakes,
            "play_audio": play_audio,  # Frontend uses this to decide whether to play
            "message":    f"{len(mistakes)} mistake(s) in Ayah {ayah_num}",
        })
    else:
        # Correct — reset feedback for this ayah so next attempt can play again
        ayah_num = match["ayah"]
        ayahs_with_feedback.discard(ayah_num)
        await safe_send(ws, {
            "type":    "ok",
            "ayah":    ayah_num,
            "message": "Correct recitation ✓",
        })

    return np.array([], dtype=np.float32)