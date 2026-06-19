import { Audio } from 'expo-av';
import { WS_AUDIO_URL } from '../constants';
import { storage } from '../utils/storage';

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

    // ── NEW: loop of short, fully-closed recordings instead of tailing one live file ──
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

        // Finalize — this is what makes the WAV header/data correct and complete
        await recording.stopAndUnloadAsync();
        this._recording = null;

        if (!this._chunkLoopActive || !this.isStreaming) break;

        const uri = recording.getURI();
        if (!uri) continue;

        await this._sendFinishedRecording(uri);

      } catch (e) {
        console.log('[audioStream] chunk loop error:', e.message);
        try { await recording?.stopAndUnloadAsync(); } catch {}
        this._recording = null;
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
      // Standard PCM WAV header is 44 bytes for this config (no extra chunks).
      if (allBytes.length <= 44) return;
      const pcmBytes = allBytes.slice(44);

      if (pcmBytes.length < 1024) return;

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

      console.log(`[audioStream] chunk #${this.seqNo} (${pcmBytes.length} bytes = ${(pcmBytes.length/32000).toFixed(1)}s)`);

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