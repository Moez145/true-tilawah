#!/usr/bin/env node
/**
 * Manual end-to-end test: pretends to be a React Native app.
 *
 * Usage:
 *   node scripts/test_audio_ws.js <wav> [surah] [ayahStart] [ayahEnd]
 *
 * Examples:
 *   node scripts/test_audio_ws.js scripts/fixtures/al-fatihah.wav
 *   node scripts/test_audio_ws.js scripts/fixtures/myrecording.wav 2 23 28
 *
 * Defaults: surah=1, ayahStart=1, ayahEnd=7  (Al-Fatihah).
 *
 * Steps:
 *  1. Logs in (or registers) a test user → gets accessToken
 *  2. Creates a Session for the given surah / ayah range
 *  3. Opens WS to /ws/audio
 *  4. Streams the WAV (after stripping the 44-byte header) in real-time
 *     pacing — chunks of 4096 bytes (256 ms each at 16 kHz int16 mono)
 *  5. Prints every JSON event from the server
 *  6. Sends "STOP", waits for final_report, exits
 */
const fs   = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const API   = process.env.API_URL || "http://localhost:5000";
const WSURL = process.env.WS_URL  || "ws://localhost:5000";
const EMAIL = "wstest@example.com";
const PASS  = "Test1234X";

function postJson(url, body, token) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const buf = Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Content-Length": buf.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end",  () => resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }));
    });
    req.on("error", reject);
    req.write(buf); req.end();
  });
}

async function main() {
  const wavPath  = process.argv[2];
  const surahId   = parseInt(process.argv[3] || "1",  10);
  const ayahStart = parseInt(process.argv[4] || "1",  10);
  const ayahEnd   = parseInt(process.argv[5] || "7",  10);

  if (!wavPath || !fs.existsSync(wavPath)) {
    console.error("Usage: node scripts/test_audio_ws.js <wav> [surah] [ayahStart] [ayahEnd]");
    console.error("Example: node scripts/test_audio_ws.js my.wav 2 23 28");
    process.exit(1);
  }
  console.log(`✓ Range: Surah ${surahId}, Ayahs ${ayahStart}-${ayahEnd}`);

  // 1. Login (try) else register
  let { status, body } = await postJson(`${API}/api/auth/login`, { email: EMAIL, password: PASS });
  if (status !== 200) {
    console.log("Login failed, registering test user...");
    ({ status, body } = await postJson(`${API}/api/auth/register`, {
      fullName: "WS Test", email: EMAIL, password: PASS,
    }));
    if (status !== 201) { console.error("Register failed:", body); process.exit(1); }
  }
  const token = body.data.accessToken;
  console.log("✓ Authenticated");

  // 2. Create session
  const sess = await postJson(`${API}/api/sessions`,
    { surahId, ayahStart, ayahEnd }, token);
  if (sess.status !== 201) { console.error("Session create failed:", sess.body); process.exit(1); }
  const sessionId = sess.body.data.id;
  console.log("✓ Session:", sessionId);

  // 3. Open WS
  const ws = new WebSocket(`${WSURL}/ws/audio?token=${token}&sessionId=${sessionId}`);

  ws.on("message", (raw) => {
    const evt = JSON.parse(raw.toString());
    console.log("◀", JSON.stringify(evt, null, 2));
    if (evt.type === "final_report") {
      console.log("\n=== FINAL ===");
      console.log(`Grade: ${evt.grade}, Accuracy: ${evt.averageAccuracy}%`);
      ws.close();
    }
  });

  ws.on("close", (code) => { console.log(`WS closed (${code})`); process.exit(0); });
  ws.on("error", (err) => { console.error("WS error:", err.message); process.exit(1); });

  ws.on("open", async () => {
    console.log("✓ WS open, streaming WAV...");
    // 4. Strip 44-byte WAV header, stream in 4096-byte chunks at 256 ms cadence
    const buf = fs.readFileSync(wavPath).slice(44);
    const CHUNK = 4096;
    let seq = 0;
    for (let off = 0; off < buf.length; off += CHUNK) {
      const audio = buf.subarray(off, off + CHUNK);
      const frame = Buffer.alloc(4 + audio.length);
      frame.writeUInt32BE(seq++, 0);
      audio.copy(frame, 4);
      ws.send(frame, { binary: true });
      await new Promise((r) => setTimeout(r, 250)); // simulate realtime
    }
    console.log("✓ All audio sent, sending STOP");
    ws.send("STOP");
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
