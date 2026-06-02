/**
 * audio.ws.js  →  backend/src/routes/audio.ws.js
 *
 * WebSocket endpoint: ws://localhost:5000/ws/audio
 * Query params:  ?token=<accessToken>&sessionId=<uuid>
 *
 * Pipeline:
 *   RN → /ws/audio (this file) → Python /ws/evaluate (ai.service.js)
 *
 * Wire format from RN per binary frame:
 *   [4-byte big-endian uint32 seqNo][int16 PCM bytes @ 16 kHz mono]
 *
 * Python expects binary frames of float32 PCM. We strip the seqNo, drop
 * out-of-order chunks, convert int16 → float32, and forward.
 *
 * The text string "STOP" from RN is forwarded to Python; Python's
 * `final_report` event triggers session completion + closes both WS.
 */

const { verifyAccessToken } = require("../utils/jwt.util");
const prisma = require("../models/prismaClient");
const aiClient = require("../services/ai.service");
const tajweedService = require("../services/tajweed.service");
const { createFeedbackBatch } = require("../services/feedback.service");
const {
  completeSession,
  abandonSession,
} = require("../services/session.service");

async function mapMistakesToFeedback(event) {
  const rows = [];
  for (let i = 0; i < event.mistakes.length; i++) {
    const m = event.mistakes[i];
    const tajweedRule = m.tajweedRule
      ? await tajweedService.getRuleByName(m.tajweedRule)
      : null;
    rows.push({
      errorType: m.type,
      incorrectWord: m.incorrect || "",
      correctWord: m.correct || "",
      wordPosition: i,
      ayahNumber: event.ayah,
      ruleApplied: m.tajweedRule || null,
      tajweedRuleId: tajweedRule ? tajweedRule.id : null,
      confidenceScore:
        typeof event.confidence === "number" ? event.confidence : null,
    });
  }
  return rows;
}

function registerAudioWebSocket(app) {
  app.ws("/ws/audio", async (ws, req) => {
    // TEMP diagnostic — remove after WS auth path is verified working
    console.log(
      `[WS-DEBUG] /ws/audio entered. url=${req.url} ` +
        `query=${JSON.stringify(req.query)} ` +
        `hasToken=${!!(req.query && req.query.token)} ` +
        `hasSessionId=${!!(req.query && req.query.sessionId)}`
    );

    const { token, sessionId } = req.query || {};

    // ── 1. Auth ──────────────────────────────────────────────
    if (!token || !sessionId) {
      console.log("[WS-DEBUG] closing 4001 — missing token/sessionId");
      ws.close(4001, "token + sessionId required");
      return;
    }
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      ws.close(4001, "invalid token");
      return;
    }

    const session = await prisma.session
      .findFirst({
        where: { id: sessionId, userId: decoded.id, status: "ACTIVE" },
      })
      .catch(() => null);
    if (!session) {
      ws.close(4003, "session not found / not active");
      return;
    }

    // ── 2. Open child WS to Python ───────────────────────────
    let ai;
    try {
      ai = await aiClient.connect({
        surahId: session.surahId,
        ayahStart: session.ayahStart,
        ayahEnd: session.ayahEnd,
        userId: decoded.id,
        sessionId,
      });
    } catch (err) {
      console.error("AI connect failed:", err.message);
      ws.close(4503, "AI service unavailable");
      return;
    }

    console.log(`WS opened — user:${decoded.id} session:${sessionId}`);
    console.log(
      `[WS-DEBUG] post-open state: ws.readyState=${ws.readyState} ` +
        `listeners(message)=${ws.listenerCount("message")} ` +
        `listeners(close)=${ws.listenerCount("close")} ` +
        `listeners(error)=${ws.listenerCount("error")}`
    );

    // TEMP — catch any low-level WS errors that might explain silent message drops
    ws.on("error", (err) => {
      console.error(`[WS-DEBUG] ws error: ${err && err.message}`);
    });

    // ── 3. Audio pump RN → Python ────────────────────────────
    let expectedSeq = 0;
    let stopSent = false;
    let finalReportSeen = false;
    // TEMP diagnostic counters
    let chunksReceived = 0;
    let chunksForwarded = 0;
    let chunksDropped = 0;
    let totalBytesFromRn = 0;

    // Convert int16 PCM bytes → float32 buffer and forward to Python.
    // Used by both the text-frame audio path (RN/Hermes) and the binary
    // path (test_audio_ws.js, future native clients).
    const forwardPcm = (int16Bytes, seq, totalFrameBytes) => {
      if (seq < expectedSeq) {
        chunksDropped++;
        return;
      }
      expectedSeq = seq + 1;
      const i16 = new Int16Array(
        int16Bytes.buffer,
        int16Bytes.byteOffset,
        int16Bytes.byteLength / 2
      );
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      ai.sendAudio(Buffer.from(f32.buffer));
      chunksForwarded++;
      totalBytesFromRn += totalFrameBytes;
      if (chunksForwarded === 1 || chunksForwarded % 25 === 0) {
        console.log(
          `[WS-DEBUG] audio chunks recv=${chunksReceived} forward=${chunksForwarded} drop=${chunksDropped} bytesFromRn=${totalBytesFromRn} (latest pcm bytes=${int16Bytes.length})`
        );
      }
    };

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const txt = data.toString();
        const trimmed = txt.trim();

        // STOP — finalize.
        if (trimmed.toUpperCase() === "STOP") {
          console.log(`[WS-DEBUG] STOP from RN`);
          ai.sendStop();
          stopSent = true;
          return;
        }

        // Try parsing as JSON. RN/Hermes downgrades binary sends to text on
        // Android, so the frontend wraps each chunk as
        //   {"type":"audio","seq":N,"pcm":"<base64 int16 PCM>"}.
        // The first frame from the frontend is also JSON (scope) but lacks
        // a `type` field — silently ignored here since the backend already
        // got the scope from the DB session record.
        let msg = null;
        try { msg = JSON.parse(trimmed); } catch { /* not JSON */ }

        if (msg && msg.type === "audio" && typeof msg.pcm === "string" && Number.isInteger(msg.seq)) {
          const pcmBytes = Buffer.from(msg.pcm, "base64");
          if (pcmBytes.byteLength === 0) return;
          chunksReceived++;
          forwardPcm(pcmBytes, msg.seq, trimmed.length);
          return;
        }

        // Anything else is unexpected text. Log a short preview and ignore.
        console.log(`[WS-DEBUG] ignoring text frame: "${trimmed.slice(0, 60)}"`);
        return;
      }

      // Binary audio chunk: [4-byte BE seqNo][int16 PCM]
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.byteLength < 4) return;
      const seq = buf.readUInt32BE(0);
      chunksReceived++;
      forwardPcm(buf.subarray(4), seq, buf.byteLength);
    });

    // ── 4. Result handler Python → RN + DB ──────────────────
    ai.onEvent(async (evt) => {
      // TEMP diagnostic — log every event Python emits
      const preview = JSON.stringify(evt).slice(0, 200);
      console.log(`[WS-DEBUG] ← Python event: ${preview}`);

      // Streaming pipeline events: relay verbatim, do NOT persist.
      // Legacy `mistake` (from non-streaming providers) AND new `ayah_finalized`
      // (from the streaming pipeline) both persist + relay-as-`mistake`.
      const forRn =
        evt.type === "ayah_finalized" ? { ...evt, type: "mistake" } : evt;
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(forRn));

      try {
        if (evt.type === "mistake" || evt.type === "ayah_finalized") {
          const rows = await mapMistakesToFeedback(evt);
          if (rows.length > 0) {
            await createFeedbackBatch(sessionId, decoded.id, rows);
          }
        } else if (evt.type === "final_report") {
          finalReportSeen = true;
          await completeSession(sessionId, decoded.id, {
            transcript: null,
            accuracyScore: evt.averageAccuracy ?? 0,
          });
          ai.close();
          if (ws.readyState === ws.OPEN) ws.close(1000, "completed");
        }
        // partial_mistake, word_corrected, mistake_acknowledged, word_correct: relay only, no DB write.
      } catch (err) {
        console.error("audio.ws result handler error:", err);
      }
    });

    // ── 5. Disconnect handling ───────────────────────────────
    ws.on("close", async (code) => {
      console.log(`WS closed — session:${sessionId} code:${code}`);
      if (!stopSent) {
        try {
          ai.sendStop();
        } catch (_) {
          /* ignore */
        }
      }
      // If no final_report arrived → abandon
      setTimeout(async () => {
        if (!finalReportSeen) {
          try {
            await abandonSession(sessionId, decoded.id);
          } catch (e) {
            /* already abandoned/completed */
          }
        }
        try {
          ai.close();
        } catch (_) {
          /* ignore */
        }
      }, 3000);
    });

    ai.onClose(() => {
      if (ws.readyState === ws.OPEN && !finalReportSeen) {
        ws.close(4503, "AI service disconnected");
      }
    });

    ai.onError((err) => console.error("AI WS error:", err.message));
  });
}

module.exports = { registerAudioWebSocket };
