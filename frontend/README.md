# True Tilawah — React Native Frontend

> Complete Expo + React Native (JavaScript) mobile app for Quranic Recitation  
> Fully connected to the Node.js/Express/Prisma/MySQL backend

---

## 📁 Project Structure

```
TrueTilawah/
├── App.js                              # Root entry point
├── app.json                            # Expo configuration
├── babel.config.js
├── package.json
├── .env.example                        # Copy to .env
│
└── src/
    ├── constants/index.js              # API URLs, Colors, Storage keys
    ├── context/
    │   ├── AuthContext.js              # Auth state + login/logout/register
    │   └── AppContext.js               # Global: surahs, bookmarks, session
    ├── navigation/
    │   └── AppNavigator.js             # Stack + Drawer + BottomTab navigation
    ├── services/
    │   ├── apiClient.js                # Axios + JWT interceptors + auto-refresh
    │   ├── authService.js              # Login, Register, Google OAuth, Apple Sign-In
    │   ├── quranService.js             # Surahs, Ayahs, ranges, Tajweed rules
    │   ├── sessionService.js           # Create/complete/abandon sessions
    │   ├── progressService.js          # Stats, trend, errors, tajweed violations
    │   ├── feedbackService.js          # Log mistakes (single + batch)
    │   └── audioStreamService.js       # Mic capture + WebSocket real-time streaming
    ├── utils/
    │   ├── storage.js                  # AsyncStorage helpers
    │   └── helpers.js                  # Share, greeting, shadow
    ├── components/
    │   ├── common/
    │   │   ├── Button.js               # Animated button (5 variants)
    │   │   ├── Card.js                 # Default/gradient/outline card
    │   │   ├── Header.js               # Sticky header with back/menu/search
    │   │   ├── Input.js                # Text input with label/error/icons
    │   │   └── SidebarItem.js          # Drawer nav item
    │   ├── layout/
    │   │   ├── Sidebar.js              # Left drawer with user info + nav
    │   │   └── SearchActionModal.js    # Memorize vs Recite action picker
    │   ├── dashboard/
    │   │   ├── DashboardCard.js        # Feature cards
    │   │   └── SearchBar.js            # Animated search with results
    │   └── quran/
    │       └── AyahItem.js             # Verse card (share/play/bookmark)
    └── screens/
        ├── OnboardingScreen.js
        ├── AuthScreen.js               # Login/Register + Google + Apple
        ├── DashboardScreen.js          # Home with real API data
        ├── QuranListScreen.js          # Surah/Para/Page/Hizb + search
        ├── DetailScreen.js             # Surah detail with live ayahs
        ├── ReciteScreen.js             # Mic + WebSocket + session
        ├── TrackScreen.js              # Progress charts + API data
        ├── RetainScreen.js
        ├── RetainTestScreen.js
        ├── RetainResultsScreen.js
        └── secondary/
            ├── BookmarksScreen.js
            ├── ProfileScreen.js
            ├── SettingsScreen.js
            └── HelpScreen.js
```

---

## ⚡ Quick Start (3 Steps)

### 1. Install dependencies
```bash
cd TrueTilawah
npm install
```

### 2. Configure the API URL

Open `src/constants/index.js` and set the correct URL for your environment:

```js
// Android Emulator  → 10.0.2.2
// iOS Simulator     → localhost
// Physical device   → your machine's WiFi IP (e.g. 192.168.1.x)

export const API_BASE_URL = 'http://10.0.2.2:5000/api';
export const WS_AUDIO_URL = 'ws://10.0.2.2:5000/ws/audio';
```

### 3. Start (backend must be running first)
```bash
# Terminal 1 — start the backend
cd ../backend && npm run dev

# Terminal 2 — start the React Native app
cd TrueTilawah && npx expo start

# Then press:  a = Android emulator,  i = iOS simulator,  or scan QR for Expo Go
```

---

## 📱 Backend API Endpoints Used

| Service | Endpoint | Description |
|---------|----------|-------------|
| Auth | `POST /auth/register` | Register new user |
| Auth | `POST /auth/login` | Login, receive tokens |
| Auth | `POST /auth/refresh` | Refresh access token |
| Auth | `GET  /auth/profile` | Get user profile |
| Quran | `GET /quran/surahs` | All 114 Surahs |
| Quran | `GET /quran/surahs/:n/ayahs` | Ayahs for a Surah |
| Quran | `GET /quran/surahs/:n/range` | Ayah range for session |
| Quran | `GET /quran/tajweed-rules` | Tajweed rules |
| Sessions | `POST /sessions` | Create session |
| Sessions | `PATCH /sessions/:id/complete` | Complete session |
| Sessions | `PATCH /sessions/:id/abandon` | Abandon session |
| Sessions | `GET  /sessions` | List sessions |
| Feedback | `POST /sessions/:id/feedback/batch` | Log mistakes |
| Progress | `GET /progress` | Overall stats |
| Progress | `GET /progress/trend` | Accuracy trend |
| Progress | `GET /progress/errors` | Error breakdown |
| Progress | `GET /progress/tajweed` | Tajweed violations |
| WebSocket | `WS /ws/audio?token=&sessionId=` | Real-time audio |

---

## 🔐 OAuth Setup

### Google Sign-In
1. [Google Cloud Console](https://console.cloud.google.com) → Create credentials for Web, Android, iOS
2. Update `src/constants/index.js`:
   ```js
   export const GOOGLE_WEB_CLIENT_ID     = 'xxx.apps.googleusercontent.com';
   export const GOOGLE_ANDROID_CLIENT_ID = 'xxx.apps.googleusercontent.com';
   export const GOOGLE_IOS_CLIENT_ID     = 'xxx.apps.googleusercontent.com';
   ```
3. Backend needs `POST /auth/google` endpoint (not in original backend — add it or use email/password fallback)

### Apple Sign-In (iOS only)
- Requires Apple Developer account ($99/yr)
- Enable "Sign in with Apple" capability in Xcode
- Backend needs `POST /auth/apple` endpoint
- Falls back gracefully with alert if backend route doesn't exist

---

## 🎙️ WebSocket Audio Streaming

```
User taps Mic
    ↓
App creates session via POST /api/sessions
    ↓
App connects WebSocket: ws://backend:5000/ws/audio?token=TOKEN&sessionId=ID
    ↓
Backend verifies token + session → opens connection
    ↓
App records audio (expo-av) → sends heartbeat every 250ms
    ↓
Backend processes audio → returns JSON mistakes in real-time
    ↓
App displays mistakes in ReciteScreen
    ↓
User stops → App calls PATCH /sessions/:id/complete with accuracy score
    ↓
App logs mistakes via POST /sessions/:id/feedback/batch
```

**Demo mode**: If WebSocket fails (backend down), app auto-switches to demo mode with simulated mistakes every 2.5 seconds.

---

## 🛠 Troubleshooting

| Problem | Fix |
|---------|-----|
| `Network request failed` on Android | Use `10.0.2.2` not `localhost` |
| Metro bundler crash | Run `npx expo start --clear` |
| `Reanimated` error | Ensure `react-native-reanimated/plugin` is last in babel.config.js |
| iOS pod errors | `cd ios && pod install && cd ..` |
| Icons not showing | `npx expo install lucide-react-native react-native-svg` |
| App stuck on spinner | Check backend is running on port 5000 |
| WS connection timeout | Check `WS_AUDIO_URL` in constants/index.js |

---

## 📦 Key Packages

| Package | Version | Purpose |
|---------|---------|---------|
| expo | ~51.0.28 | App framework |
| react-native | 0.74.5 | Core RN |
| react-native-reanimated | ~3.10.1 | 60fps animations |
| @react-navigation/native | ^6.1.17 | Navigation |
| @react-navigation/drawer | ^6.6.15 | Sidebar |
| @react-navigation/bottom-tabs | ^6.5.20 | Bottom tabs |
| expo-av | ~14.0.7 | Audio recording |
| expo-auth-session | ~5.5.2 | Google OAuth |
| expo-apple-authentication | ~6.4.2 | Apple Sign-In |
| expo-linear-gradient | ~13.0.2 | Gradients |
| react-native-svg | 15.2.0 | Charts & SVGs |
| axios | ^1.7.2 | HTTP client |
| @react-native-async-storage/async-storage | 1.23.1 | Token storage |
| lucide-react-native | ^0.383.0 | Icons |

---

## 🏗 Building for Production

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure EAS
eas build:configure

# Build for Android (APK/AAB)
eas build --platform android

# Build for iOS (IPA)
eas build --platform ios
```
