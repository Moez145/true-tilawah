// backend/src/services/ai.service.js
const WebSocket = require("ws");

const HOST       = process.env.AI_SERVICE_HOST     || "localhost";
const PORT       = process.env.AI_SERVICE_PORT     || "8000";
const PATH       = process.env.AI_SERVICE_WS_PATH  || "/ws/evaluate";
const TIMEOUT_MS = parseInt(process.env.AI_SERVICE_TIMEOUT_MS || "30000", 10); // increased to 30s
const WSS_URL_OVERRIDE = process.env.AI_SERVICE_WSS_URL   || null;
const AUTH_TOKEN       = process.env.AI_SERVICE_AUTH_TOKEN || null;

function resolveUrl() {
  return WSS_URL_OVERRIDE || `ws://${HOST}:${PORT}${PATH}`;
}

function connect({ surahId, ayahStart, ayahEnd, userId, sessionId }) {
  return new Promise((resolve, reject) => {
    const url     = resolveUrl();
    const options = AUTH_TOKEN
      ? { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
      : {};

    console.log(`[AI] Connecting to: ${url}`);
    const ws = new WebSocket(url, options);

    // Increased timeout — AI service needs time to load model
    let openTimer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`AI service did not open within ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    ws.once("open", () => {
      clearTimeout(openTimer);
      console.log(`[AI] Connected — sending config: surah=${surahId} ayahs=${ayahStart}-${ayahEnd}`);

      // Send config frame
      ws.send(JSON.stringify({ surahId, ayahStart, ayahEnd, userId, sessionId }));

      // Wait for "ready" event from Python before resolving
      // This ensures the AI service has processed the config
      let readyTimer = setTimeout(() => {
        console.log(`[AI] No ready event received — proceeding anyway`);
        resolve(makeClient(ws));
      }, 5000);

      ws.once("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "ready") {
            clearTimeout(readyTimer);
            console.log(`[AI] AI service ready`);
            resolve(makeClient(ws));
          }
        } catch {}
      });
    });

    ws.once("error", (err) => {
      clearTimeout(openTimer);
      console.error(`[AI] Connection error: ${err.message}`);
      reject(err);
    });
  });
}

function makeClient(ws) {
  return {
    sendAudio: (float32Buf) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(float32Buf, { binary: true });
      }
    },
    sendStop: () => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`[AI] Sending STOP`);
        ws.send("STOP");
      }
    },
    onEvent: (cb) =>
      ws.on("message", (data) => {
        try { cb(JSON.parse(data.toString())); }
        catch (e) { console.error("AI event parse error:", e.message); }
      }),
    onClose: (cb) => ws.on("close", cb),
    onError: (cb) => ws.on("error", cb),
    close:   ()  => { try { ws.close(); } catch {} },
    raw: ws,
  };
}

module.exports = { connect };