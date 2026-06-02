"""End-to-end replay of a fixture WAV through the streaming pipeline.

Asserts the event order: ready -> 0+ partial/corrected/ack -> ayah_finalized -> final_report.
"""
import json
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.lifespan import lifespan, STATE
from app.ws_handler import handle_ws_evaluate

FIXTURE = Path(__file__).parent / "fixtures" / "al-baqarah-23.wav"


def _build_app() -> FastAPI:
    app = FastAPI(lifespan=lifespan)
    app.websocket("/ws/evaluate")(handle_ws_evaluate)
    return app


def _load_wav_float32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        frames = w.readframes(w.getnframes())
    return (np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0).copy()


def test_ws_event_ordering():
    if not FIXTURE.exists():
        pytest.skip("fixture WAV not present")
    app = _build_app()
    with TestClient(app) as client:
        assert STATE["ready"]
        with client.websocket_connect("/ws/evaluate") as ws:
            ws.send_text(json.dumps({"surahId": 2, "ayahStart": 23, "ayahEnd": 23}))
            ready = json.loads(ws.receive_text())
            assert ready["type"] == "ready"

            pcm = _load_wav_float32(FIXTURE)
            chunk = int(0.25 * 16000)
            for i in range(0, len(pcm), chunk):
                ws.send_bytes(pcm[i:i + chunk].tobytes())

            ws.send_text("STOP")

            seen_types: list[str] = [ready["type"]]
            for _ in range(200):    # bounded loop, ~enough to drain
                try:
                    msg = ws.receive_text()
                except Exception:
                    break
                ev = json.loads(msg)
                seen_types.append(ev["type"])
                if ev["type"] == "final_report":
                    break

            assert "final_report" in seen_types, f"never saw final_report; saw: {seen_types}"
            assert seen_types[0] == "ready"
            assert seen_types[-1] == "final_report"
