import { NativeModules, Platform } from 'react-native';

// Re-export the entire color palette (COLORS, BRAND_GRADIENT, FEATURE_CARDS, etc.)
export * from './colors';
export { JUZ_ARABIC_NAMES } from './juzNames';

// ─── API URLs ──────────────────────────────────────────────────────────────────
// In a dev build, Metro serves the JS bundle from `http://<laptop-LAN-ip>:8081/...`
// The laptop is also where the Node backend (:5000) runs, so we can reuse that
// host. This makes the app auto-adapt to DHCP IP changes — no more editing
// `.env` whenever the laptop gets a new address.
//
// Priority:
//   1. Auto-detected Metro host (DEV only) — survives DHCP rebinds
//   2. EXPO_PUBLIC_*_URL env vars (production builds, manual override)
//   3. Platform default (emulator/simulator only)
const DEV_PORT = 5000;

// ✅ Change to
function getDevHost() {
  if (true) return null;
  const scriptURL = NativeModules?.SourceCode?.scriptURL || '';
  // scriptURL looks like "http://192.168.100.7:8081/index.bundle?platform=..."
  const m = scriptURL.match(/\/\/((?:\d{1,3}\.){3}\d{1,3}|\[[^\]]+\]|[\w-]+(?:\.[\w-]+)*)/);
  return m ? m[1] : null;
}

const DEV_HOST = getDevHost();
const FALLBACK_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE_URL =
  (DEV_HOST && `http://${DEV_HOST}:${DEV_PORT}/api`) ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  `http://${FALLBACK_HOST}:${DEV_PORT}/api`;

export const WS_AUDIO_URL =
  (DEV_HOST && `ws://${DEV_HOST}:${DEV_PORT}/ws/audio`) ||
  process.env.EXPO_PUBLIC_WS_AUDIO_URL ||
  `ws://${FALLBACK_HOST}:${DEV_PORT}/ws/audio`;

if (__DEV__) {
  console.log(`[config] DEV_HOST=${DEV_HOST} API_BASE_URL=${API_BASE_URL} WS_AUDIO_URL=${WS_AUDIO_URL}`);
}

// ─── Google OAuth ──────────────────────────────────────────────────────────────
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com';

// ─── AsyncStorage Keys ─────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  ACCESS_TOKEN:        '@tt_access_token',
  REFRESH_TOKEN:       '@tt_refresh_token',
  USER_DATA:           '@tt_user_data',
  BOOKMARKS_PREFIX:    '@tt_bookmarks:',
  AVATAR_URI_PREFIX:   '@tt_avatar_uri:',
};

// ─── Fonts ─────────────────────────────────────────────────────────────────────
// FONTS.quran is the single source of truth for every Arabic glyph in the app.
// Loaded once in App.js via useFonts → expo-font. Change the family name here
// AND the require() path in App.js if you ever swap fonts again.
export const FONTS = {
  quran: 'UthmanicHafs',
};

// ─── Audio ─────────────────────────────────────────────────────────────────────
export const AUDIO_CHUNK_INTERVAL_MS = 250;
