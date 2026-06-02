import { Audio } from 'expo-av';

// ── Per-ayah CDN — plays ONLY the specific ayah, not the whole surah ──────────
// Format: https://verses.quran.com/Alafasy/mp3/001003.mp3 = Surah 1, Ayah 3
const CDN_BASE = 'https://verses.quran.com/Alafasy/mp3';

// ── Fallback: your backend surah files (used if CDN fails) ────────────────────
const API_BASE   = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.0.100:5000/api';
const AUDIO_BASE = API_BASE.replace('/api', '/audio');

class QuranAudioService {
  constructor() {
    this._sound     = null;
    this._isPlaying = false;
  }

  // CDN per-ayah URL: 001003.mp3 = Surah 1 Ayah 3
  _cdnUrl(surahId, ayahNumber) {
    const s = String(surahId).padStart(3, '0');
    const a = String(ayahNumber).padStart(3, '0');
    return `${CDN_BASE}/${s}${a}.mp3`;
  }

  // Fallback full-surah URL from your backend
  _localUrl(surahId) {
    const s = String(surahId).padStart(3, '0');
    return `${AUDIO_BASE}/${s}.mp3`;
  }

  /**
   * Plays ONLY the specific mispronounced ayah.
   * Tries CDN first (per-ayah file ~5s), falls back to local surah file.
   */
  async playAyah(surahId, ayahNumber) {
    try {
      await this.stop();

      await Audio.setAudioModeAsync({
        allowsRecordingIOS:         false,
        playsInSilentModeIOS:       true,
        shouldDuckAndroid:          true,
        playThroughEarpieceAndroid: false,
      });

      // Use CDN per-ayah file so ONLY that ayah plays
      const url = this._cdnUrl(surahId, ayahNumber);
      console.log(`[QuranAudio] Playing ayah ${surahId}:${ayahNumber} → ${url}`);

      let sound;
      try {
        const result = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true, volume: 1.0 }
        );
        sound = result.sound;
      } catch {
        // CDN failed — fall back to local surah file
        const fallback = this._localUrl(surahId);
        console.log(`[QuranAudio] CDN failed, using local: ${fallback}`);
        const result = await Audio.Sound.createAsync(
          { uri: fallback },
          { shouldPlay: true, volume: 1.0 }
        );
        sound = result.sound;
      }

      this._sound     = sound;
      this._isPlaying = true;

      // Resolves when this ayah finishes playing
      return new Promise((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish || status.error) {
            this._isPlaying = false;
            this.stop().finally(resolve);
          }
        });
      });

    } catch (e) {
      console.log('[QuranAudio] Error:', e.message);
      this._isPlaying = false;
      return Promise.resolve();
    }
  }

  async stop() {
    this._isPlaying = false;
    if (this._sound) {
      try { await this._sound.stopAsync(); }   catch {}
      try { await this._sound.unloadAsync(); } catch {}
      this._sound = null;
    }
  }

  get isPlaying() {
    return this._isPlaying;
  }
}

export const quranAudioService = new QuranAudioService();