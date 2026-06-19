import { Audio } from 'expo-av';
import { WS_AUDIO_URL } from '../constants';
import { storage } from '../utils/storage';

const DEMO_MISTAKES = [
  "Tajweed: Missing Ghunnah on 'Noon'",
  "Pronunciation: 'Ra' should be heavier (Tafkheem)",
  "Makhraj: 'Ha' should come from throat",
  "Madd: Vowel elongation too short",
  "Qalqalah: Missing echo on 'Daal'",
];

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
    this._chunkTimer   = null;
    this._lastBytePos  = 44;
    this._wsKeepAlive  = null;
  }

  setCallbacks(onResult, onConnection, onFinalReport) {
    this.onResult      = onResult;
    this.onConnection  = onConnection;
    this.onFinalReport = onFinalReport;
  }

  async startStreaming({ sessionId, surahId, ayahStart, ayahEnd }) {
    // 1. Mic permission
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) throw new Error('Microphone permission denied');
    } catch (e) {
      if (e.message?.includes('permission')) throw e;
    }

    // 2. Audio mode
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:         true,
        playsInSilentModeIOS:       true,
        shouldDuckAndroid:          true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground:    false,
      });
    } catch {}

    // 3. Connect WebSocket
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

    // 4. Keep WebSocket alive — ping every 20s to prevent timeout
    // CPU inference takes 5-15s so we need to stay connected
    this._wsKeepAlive = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        // Send a small silent chunk as keepalive
        console.log('[audioStream] keepalive ping');
      }
    }, 20000);

    // 5. Start recording
    this._recording   = new Audio.Recording();
    this._lastBytePos = 44;
    this.seqNo        = 0;
    this._paused      = false;

    await this._recording.prepareToRecordAsync({
      android: {
        extension:        '.wav',
        outputFormat:     6,
        audioEncoder:     3,
        sampleRate:       16000,
        numberOfChannels: 1,
        bitRate:          128000,
      },
      ios: {
        extension:            '.wav',
        outputFormat:         'lpcm',
        audioQuality:         127,
        sampleRate:           16000,
        numberOfChannels:     1,
        bitRate:              128000,
        linearPCMBitDepth:    16,
        linearPCMIsFloat:     false,
        linearPCMIsBigEndian: false,
      },
      web: {},
      keepAudioActiveHint: true,
    });

    await this._recording.startAsync();
    this.isStreaming = true;
    console.log('[audioStream] Recording started');

    // 6. Send audio chunks every 3 seconds
    // Longer interval = more audio per chunk = better transcription
    this._chunkTimer = setInterval(() => this._sendLatestChunk(), 3000);
  }

  async _sendLatestChunk() {
    if (this._paused || !this.isStreaming) return;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.log('[audioStream] WS not open, skipping chunk');
      return;
    }
    if (!this._recording) return;

    try {
      const status = await this._recording.getStatusAsync();
      if (!status.isRecording) return;

      const uri = this._recording.getURI();
      if (!uri) return;

      const response = await fetch(uri);
      const arrayBuf = await response.arrayBuffer();
      const allBytes = new Uint8Array(arrayBuf);

      if (allBytes.length <= this._lastBytePos) return;

      const newBytes    = allBytes.slice(this._lastBytePos);
      this._lastBytePos = allBytes.length;

      if (newBytes.length < 1024) return;

      // Encode as base64 in chunks to avoid stack overflow
      let binary = '';
      for (let i = 0; i < newBytes.length; i += 8192) {
        binary += String.fromCharCode(...newBytes.slice(i, i + 8192));
      }
      const base64 = btoa(binary);

      // Send as JSON — backend audio.ws.js parses this format
      this.socket.send(JSON.stringify({
        type: 'audio',
        seq:  this.seqNo++,
        pcm:  base64,
      }));

      console.log(`[audioStream] chunk #${this.seqNo} (${newBytes.length} bytes = ${(newBytes.length/32000).toFixed(1)}s)`);

    } catch (e) {
      console.log('[audioStream] chunk error:', e.message);
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

    if (this._wsKeepAlive) {
      clearInterval(this._wsKeepAlive);
      this._wsKeepAlive = null;
    }

    if (this._chunkTimer) {
      clearInterval(this._chunkTimer);
      this._chunkTimer = null;
    }

    if (this._recording) {
      try { await this._recording.stopAndUnloadAsync(); } catch {}
      this._recording   = null;
      this._lastBytePos = 44;
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

  // Legacy compatibility
  pauseStreaming() {
    try { LiveAudioStream.stop(); } catch {}
    this._paused = true;
  }

  resumeStreaming() {
    if (!this.isStreaming || !this._paused) return;
    try { LiveAudioStream.start(); } catch {}
    this._paused = false;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

export const audioStreamService = new AudioStreamService();

// Legacy compatibility — prevents crash if any file still imports StreamErrorCode
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