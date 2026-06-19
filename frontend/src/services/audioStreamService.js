import { Audio } from 'expo-av';
import { WS_AUDIO_URL } from '../constants';
import { storage } from '../utils/storage';

// Scans a WAV file's RIFF sub-chunks to find the real 'data' chunk,
// since some Android encoders write extra chunks (LIST/fact/etc.)
// before the audio data, making the header size vary (44, 46, 78...).
function findWavDataOffset(bytes) {
  // RIFF header is 12 bytes: "RIFF"[4] + size[4] + "WAVE"[4]
  if (bytes.length < 12) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    // Each sub-chunk: id[4] + size[4] + data[size]
    const id = String.fromCharCode(
      bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]
    );
    const size =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24);
    const dataStart = offset + 8;
    if (id === 'data') {
      return { dataStart, dataSize: size };
    }
    offset = dataStart + size;
    // WAV sub-chunks are word-aligned — pad by 1 byte if size is odd
    if (size % 2 !== 0) offset += 1;
  }
  return null;
}

class AudioStreamService {
  constructor() {
    this.socket        = null;
    this.seqNo         = 0;
    this.isStreaming   = false;
    this._paused       = false;
    this.demoTimer     = null;
    this.onResult      = null;
    this.onConnection  = null;
    this.onFinalReport = null;
    this._recording    = null;
    this._chunkLoopActive = false;
    this._wsKeepAlive  = null;
  }

  setCallbacks(onResult, onConnection, onFinalReport) {
    this.onResult      = onResult;
    this.onConnection  = onConnection;
    this.onFinalReport = onFinalReport;
  }

  async startStreaming({ sessionId, surahId, ayahStart, ayahEnd }) {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) throw new Error('Microphone permission denied');
    } catch (e) {
      if (e.message?.includes('permission')) throw e;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:         true,
        playsInSilentModeIOS:       true,
        shouldDuckAndroid:          true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground:    false,
      });
    } catch {}

    const token = await storage.getAccessToken();
    if (!token || !sessionId) throw new Error('Missing token or sessionId');

    const url = `${WS_AUDIO_URL}?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
    console.log('[audioStream] connecting to:', url);
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS connection timeout')), 10000);
      this.socket.onopen  = () => { clearTimeout(t); console.log('[audioStream] WS open'); resolve(); };
      this.socket.onerror = (e) => { clearTimeout(t); reject(new Error(e?.message || 'WS error')); };
    });

    this.onConnection?.(true);

    this.socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        console.log('[audioStream] received:', msg.type, msg.ayah ? `ayah=${msg.ayah}` : '');
        if (msg.type === 'final_report') this.onFinalReport?.(msg);
        else                              this.onResult?.(msg);
      } catch {}
    };

    this.socket.onclose = (e) => {
      console.log('[audioStream] WS closed:', e.code);
      this.onConnection?.(false);
    };

    this._wsKeepAlive = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        console.log('[audioStream] keepalive ping');
      }
    }, 20000);

    this.seqNo      = 0;
    this._paused    = false;
    this.isStreaming = true;
    console.log('[audioStream] Recording loop starting');

    // Loop of short, fully-closed recordings instead of tailing one live file.
    this._chunkLoopActive = true;
    this._runChunkLoop(); // fire and forget — internal while loop
  }

  async _runChunkLoop() {
    while (this._chunkLoopActive && this.isStreaming) {
      if (this._paused) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      let recording = null;
      try {
        recording = new Audio.Recording();
        await recording.prepareToRecordAsync({
          android: {
            extension:        '.wav',
            outputFormat:     6,
            audioEncoder:     3,
            sampleRate:       16000,
            numberOfChannels: 1,
            bitRate:          256000,
          },
          ios: {
            extension:            '.wav',
            outputFormat:         'lpcm',
            audioQuality:         127,
            sampleRate:           16000,
            numberOfChannels:     1,
            bitRate:              256000,
            linearPCMBitDepth:    16,
            linearPCMIsFloat:     false,
            linearPCMIsBigEndian: false,
          },
          web: {},
          keepAudioActiveHint: true,
        });

        if (!this._chunkLoopActive || !this.isStreaming) {
          // stop() was called while we were preparing — bail before starting
          try { await recording.stopAndUnloadAsync(); } catch {}
          break;
        }

        this._recording = recording;
        await recording.startAsync();

        // Record for ~3s. Check _paused/_chunkLoopActive mid-wait so stop is responsive.
        const segmentMs = 3000;
        const stepMs = 100;
        let waited = 0;
        while (waited < segmentMs && this._chunkLoopActive && this.isStreaming) {
          await new Promise(r => setTimeout(r, stepMs));
          waited += stepMs;
        }

        // Only this loop iteration "owns" `recording` now.
        // Clear the shared reference BEFORE stopping, so stopStreaming()
        // can no longer reach in and double-stop the same object.
        const wasOwner = (this._recording === recording);
        if (wasOwner) this._recording = null;

        let uri = null;
        try {
          // Finalize — this is what makes the WAV header/data correct and complete.
          await recording.stopAndUnloadAsync();
          uri = recording.getURI();
        } catch (stopErr) {
          // Already stopped/unloaded by stopStreaming() racing us — not fatal,
          // just means this segment is lost. Continue the loop normally.
          console.log('[audioStream] segment stop race (expected occasionally):', stopErr.message);
        }

        if (!this._chunkLoopActive || !this.isStreaming) break;
        if (uri) await this._sendFinishedRecording(uri);

      } catch (e) {
        console.log('[audioStream] chunk loop error:', e.message);
        try { await recording?.stopAndUnloadAsync(); } catch {}
        if (this._recording === recording) this._recording = null;
        // brief backoff so a persistent error doesn't spin-loop
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  async _sendFinishedRecording(uri) {
    if (this._paused) return;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.log('[audioStream] WS not open, skipping chunk');
      return;
    }

    try {
      const response = await fetch(uri);
      const arrayBuf = await response.arrayBuffer();
      const allBytes = new Uint8Array(arrayBuf);

      // Fully-closed WAV file: header is finalized and correct now.
      // Don't assume a fixed 44-byte header — some Android encoders write
      // extra sub-chunks (LIST/fact/etc.) before 'data', shifting the real
      // offset. Scan the RIFF chunks to find the actual data start/size.
      const wavInfo = findWavDataOffset(allBytes);
      if (!wavInfo) {
        console.log('[audioStream] could not find WAV data chunk, skipping');
        return;
      }

      let { dataStart, dataSize } = wavInfo;
      // Some encoders write dataSize=0 or a placeholder mid-recording;
      // clamp to whatever bytes are actually available in the file.
      const available = allBytes.length - dataStart;
      if (dataSize <= 0 || dataSize > available) dataSize = available;
      // Ensure an even byte count (whole int16 samples only) — trim any
      // stray trailing byte so PCM16 alignment never drifts.
      if (dataSize % 2 !== 0) dataSize -= 1;
      if (dataSize < 1024) return;

      const pcmBytes = allBytes.slice(dataStart, dataStart + dataSize);

      let binary = '';
      for (let i = 0; i < pcmBytes.length; i += 8192) {
        binary += String.fromCharCode(...pcmBytes.slice(i, i + 8192));
      }
      const base64 = btoa(binary);

      this.socket.send(JSON.stringify({
        type: 'audio',
        seq:  this.seqNo++,
        pcm:  base64,
      }));

      console.log(`[audioStream] chunk #${this.seqNo} (${pcmBytes.length} bytes = ${(pcmBytes.length/32000).toFixed(1)}s, dataStart=${dataStart})`);

    } catch (e) {
      console.log('[audioStream] send error:', e.message);
    }
  }

  pauseStreaming() {
    this._paused = true;
    console.log('[audioStream] PAUSED');
  }

  resumeStreaming() {
    this._paused = false;
    console.log('[audioStream] RESUMED');
  }

  async stopStreaming() {
    this.isStreaming = false;
    this._paused     = false;
    this._chunkLoopActive = false;

    if (this._wsKeepAlive) {
      clearInterval(this._wsKeepAlive);
      this._wsKeepAlive = null;
    }

    // Give the loop a brief moment to notice the flags and exit cleanly
    // before we try to touch _recording ourselves.
    await new Promise(r => setTimeout(r, 150));

    if (this._recording) {
      try { await this._recording.stopAndUnloadAsync(); } catch {}
      this._recording = null;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      try { this.socket.send('STOP'); } catch {}
      await new Promise(r => setTimeout(r, 1000));
      try { this.socket.close(); } catch {}
    }
    this.socket = null;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:   false,
        playsInSilentModeIOS: true,
      });
    } catch {}

    console.log('[audioStream] stopped');
  }

  startDemoMode() {
    console.log('[audioStream] Demo mode ON');
    let count = 0;
    this.demoTimer = setInterval(() => {
      count++;
      if (count % 2 === 0) {
        this.onResult?.({
          type:     'mistake',
          ayah:     1,
          message:  'Demo mistake detected',
          mistakes: [{
            type:        'MISPRONUNCIATION',
            incorrect:   'الرَّحْمَنِ',
            correct:     'الرَّحِيمِ',
            tajweedRule: null,
            tip:         'Demo: Incorrect pronunciation detected',
          }],
        });
      }
    }, 5000);
  }

  stopDemoMode() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

export const audioStreamService = new AudioStreamService();

export const StreamErrorCode = {
  MIC_PERMISSION:     'MIC_PERMISSION',
  MIC_HARDWARE:       'MIC_HARDWARE',
  NO_TOKEN:           'NO_TOKEN',
  WS_TIMEOUT:         'WS_TIMEOUT',
  WS_AUTH_FAILED:     'WS_AUTH_FAILED',
  WS_SESSION_INVALID: 'WS_SESSION_INVALID',
  WS_AI_UNAVAILABLE:  'WS_AI_UNAVAILABLE',
  WS_NETWORK:         'WS_NETWORK',
};