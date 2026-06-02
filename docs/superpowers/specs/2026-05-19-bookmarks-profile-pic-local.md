# Bookmarks persistence + Profile picture (local) — spec (Group D)

**Status:** Approved, awaiting plan.
**Date:** 2026-05-19.
**Scope:** Persist bookmarks across app restarts via AsyncStorage. Let the user pick a profile picture from the photo library and have it appear app-wide. Both features local-only for v1 with API surfaces shaped so a future backend-sync feature can plug in without re-architecting. Drop two pieces of dead UI on BookmarksScreen.
**Not in this spec:** Backend sync of either feature, dashboard polish (Group E), Recite RTL carousel (Group E).

## 1. Why

Three problems with today's state:

1. **Bookmarks vanish on restart.** `AppContext.bookmarks` is plain in-memory state — no AsyncStorage persistence. A user who bookmarks an ayah, kills the app, and re-opens it sees an empty Bookmarks tab. The most basic expectation of a "save for later" feature is broken.
2. **No way to set a profile picture.** ProfileScreen renders `user?.avatarUrl || <unsplash stock photo>` and the "edit" gear icon next to the avatar has no `onPress`. The user can't replace the stock photo at all.
3. **BookmarksScreen has dead UI.** "Add new collection" implies a collections feature that doesn't exist. The MoreVertical (⋮) icon on each row has no action.

A latent bug also gets fixed in passing: `bookmarks` is not currently scoped to the user. Switching accounts would surface the previous user's bookmarks to the new user. This spec namespaces both bookmarks and avatar URI by `userId` in AsyncStorage.

## 2. Goal

- Bookmarks persist across app restarts. Add/remove operations write to AsyncStorage. On mount, the AppContext loads bookmarks for the currently signed-in user.
- The user can tap the gear icon on ProfileScreen to launch the photo library picker, choose an image, and have it appear as their avatar everywhere (Profile, Dashboard, Track, Sidebar).
- The chosen avatar URI is stored in AsyncStorage and persists across app restarts.
- Bookmarks and avatar are scoped per-user. Logging out and back in as the same user restores them. Logging in as a different user shows their own (or empty) state.
- The "Add new collection" button and the MoreVertical row affordance on BookmarksScreen are removed. Tapping a bookmark row navigates to the surah's Detail screen.

Success = a user can bookmark ayahs, set an avatar, kill the app, reopen, and find both restored. A second user logging in on the same device sees their own data, not the first user's.

## 3. Non-goals

- **No backend sync.** Both features live entirely on the device. Future spec(s) will add sync — by then the local layer is the source of truth and sync is a write-through layer on top.
- **No camera picker.** Library only (per brainstorm). Adding the camera would require `NSCameraUsageDescription` on iOS + camera permission flow on Android.
- **No "Remove photo" action.** Vetoed during brainstorm. To clear, the user can pick a different photo or future spec adds it.
- **No collections feature for bookmarks.** Drop the dead UI; revisit later if user demand emerges.
- **No scroll-to-ayah on Detail when opened from a bookmark.** Detail currently renders the whole surah from the top. Future polish.
- **No image compression / resizing beyond `quality: 0.85`** on the picker call. Defer.
- **No multi-image history per user.** One URI per user; replaces on every pick.
- **No tests.** Frontend has no test runner (verified in earlier groups). Verification is `node -e` for the storage layer plus manual smoke on Android dev client.

## 4. Design

### 4.1 Storage layer

`frontend/src/utils/storage.js` — add 4 new methods. Place them after `setUserData` / `getUserData`, before `clearAll`:

```js
async setBookmarks(userId, list) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(
      `${STORAGE_KEYS.BOOKMARKS_PREFIX}${userId}`,
      JSON.stringify(list || []),
    );
  } catch {}
},
async getBookmarks(userId) {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_KEYS.BOOKMARKS_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
},
async setAvatarUri(userId, uri) {
  if (!userId) return;
  try {
    if (uri) {
      await AsyncStorage.setItem(`${STORAGE_KEYS.AVATAR_URI_PREFIX}${userId}`, String(uri));
    } else {
      await AsyncStorage.removeItem(`${STORAGE_KEYS.AVATAR_URI_PREFIX}${userId}`);
    }
  } catch {}
},
async getAvatarUri(userId) {
  if (!userId) return null;
  try {
    return await AsyncStorage.getItem(`${STORAGE_KEYS.AVATAR_URI_PREFIX}${userId}`);
  } catch { return null; }
},
```

The existing `clearAll` is **not** modified. Logging out clears tokens + user-data but **not** the per-user bookmarks or avatar — those persist so the same user logging back in gets their data restored.

### 4.2 Constants

`frontend/src/constants/index.js` — extend `STORAGE_KEYS` with two prefixes:

```js
export const STORAGE_KEYS = {
  ACCESS_TOKEN:        '@tt_access_token',
  REFRESH_TOKEN:       '@tt_refresh_token',
  USER_DATA:           '@tt_user_data',
  BOOKMARKS_PREFIX:    '@tt_bookmarks:',
  AVATAR_URI_PREFIX:   '@tt_avatar_uri:',
};
```

The full storage key for a user `abc123` is `@tt_bookmarks:abc123` / `@tt_avatar_uri:abc123`.

### 4.3 AppContext changes

`frontend/src/context/AppContext.js` — multiple additions. The full new body:

```js
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { storage } from '../utils/storage';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [surahs,             setSurahsState]      = useState([]);
  const [surahsLoaded,       setSurahsLoaded]     = useState(false);
  const [bookmarks,          setBookmarks]        = useState([]);
  const [localAvatarUri,     setLocalAvatarUriState] = useState(null);
  const [persistedLoaded,    setPersistedLoaded]  = useState(false);
  const [currentSession,     setCurrentSession]   = useState(null);

  // On user change: load (or clear) per-user persisted state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPersistedLoaded(false);
      if (!userId) {
        setBookmarks([]);
        setLocalAvatarUriState(null);
        setPersistedLoaded(true);
        return;
      }
      const [bm, av] = await Promise.all([
        storage.getBookmarks(userId),
        storage.getAvatarUri(userId),
      ]);
      if (cancelled) return;
      setBookmarks(Array.isArray(bm) ? bm : []);
      setLocalAvatarUriState(av || null);
      setPersistedLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setSurahData = useCallback((data) => {
    setSurahsState(data);
    setSurahsLoaded(true);
  }, []);

  const addBookmark = useCallback((item) => {
    setBookmarks((prev) => {
      const exists = prev.some(
        (b) => b.surahId === item.surahId && b.ayahNumber === item.ayahNumber,
      );
      const next = exists ? prev : [item, ...prev];
      if (!exists && userId) storage.setBookmarks(userId, next);
      return next;
    });
  }, [userId]);

  const removeBookmark = useCallback((surahId, ayahNumber) => {
    setBookmarks((prev) => {
      const next = prev.filter(
        (b) => !(b.surahId === surahId && b.ayahNumber === ayahNumber),
      );
      if (userId) storage.setBookmarks(userId, next);
      return next;
    });
  }, [userId]);

  const isBookmarked = useCallback(
    (surahId, ayahNumber) =>
      bookmarks.some((b) => b.surahId === surahId && b.ayahNumber === ayahNumber),
    [bookmarks],
  );

  const setLocalAvatarUri = useCallback((uri) => {
    setLocalAvatarUriState(uri || null);
    if (userId) storage.setAvatarUri(userId, uri);
  }, [userId]);

  return (
    <AppContext.Provider value={{
      surahs, surahsLoaded, setSurahData,
      bookmarks, addBookmark, removeBookmark, isBookmarked,
      localAvatarUri, setLocalAvatarUri,
      persistedLoaded,
      currentSession, setCurrentSession,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
};
```

Net behavior changes:
- `bookmarks` is loaded from AsyncStorage on user change.
- `addBookmark` / `removeBookmark` write through to AsyncStorage when a user is signed in.
- `localAvatarUri` is loaded from AsyncStorage on user change, and `setLocalAvatarUri` writes through.
- `persistedLoaded` is `true` after the initial load; consumers don't have to wait for it, but it's available if they want to suppress UI flicker on first paint.
- On logout (`userId` becomes null), `bookmarks` and `localAvatarUri` reset to defaults; the disk content is **not** touched.

The existing `useApp()` consumers continue to work — `bookmarks`, `addBookmark`, `removeBookmark`, `isBookmarked` are the same names. New consumers gain `localAvatarUri` and `setLocalAvatarUri`.

### 4.4 ProfileScreen — wire the edit button

`frontend/src/screens/secondary/SecondaryScreens.js`, `ProfileScreen` function. Changes:

- Import `expo-image-picker` and `useApp`.
- Add `pickAvatar` callback.
- Change the `<TouchableOpacity style={s.editBtn}>` to call `pickAvatar` on press.
- Change the avatar `Image` source to fall back through `localAvatarUri || user?.avatarUrl || <unsplash>`.

```jsx
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../../context/AppContext';
import { Alert } from 'react-native'; // add to existing react-native import
import React, { useState, useCallback } from 'react';

export function ProfileScreen({ navigation }) {
  const { user } = useAuth();
  const { localAvatarUri, setLocalAvatarUri } = useApp();

  const pickAvatar = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo access needed',
          'Please allow photo library access in your phone Settings to choose a profile picture.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (uri) setLocalAvatarUri(uri);
    } catch (e) {
      Alert.alert("Couldn't pick photo", e?.message || 'Please try again.');
    }
  }, [setLocalAvatarUri]);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="My Profile" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.profileContent} showsVerticalScrollIndicator={false}>
        <View style={s.avatarWrap}>
          <Image
            source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
            style={s.avatar}
          />
          <TouchableOpacity style={s.editBtn} onPress={pickAvatar} activeOpacity={0.7}>
            <Settings size={14} color={COLORS.white} />
          </TouchableOpacity>
        </View>
        {/* ...rest unchanged... */}
      </ScrollView>
    </SafeAreaView>
  );
}
```

### 4.5 Avatar fallback in the 3 other consumers

For each of `Sidebar.js`, `DashboardScreen.js`, `TrackScreen.js`:

1. Import `useApp` if not already imported.
2. Pull `localAvatarUri` from `useApp()`.
3. Change the `Image` `source` URI to:
   ```js
   uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop'
   ```

Each is a one-line addition (the `useApp` destructure) plus a one-line edit (the source URI). Tiny diff per file. The fallback chain order is intentional: local override beats backend value beats stock.

### 4.6 BookmarksScreen cleanup

`frontend/src/screens/secondary/SecondaryScreens.js`, `BookmarksScreen` function. Changes:

**Remove:**
- The `<TouchableOpacity style={s.addBtn}>...Add new collection...</TouchableOpacity>` block.
- The `<MoreVertical size={20} color={COLORS.gray300} />` icon at the right of each row.
- The `Plus` and `MoreVertical` icon imports (only used by the removed UI).
- The `s.addBtn` / `s.addIcon` / `s.addLabel` styles.

**Add:**
- Tap-through navigation on each row: `onPress={() => navigation.navigate('Detail', { surahNumber: b.surahId, title: b.surahName, mode: 'surah' })}`.

After the changes the BookmarksScreen body looks like:

```jsx
export function BookmarksScreen({ navigation }) {
  const { bookmarks } = useApp();
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="Bookmarks" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {bookmarks.length === 0 ? (
          <View style={s.empty}>
            <Bookmark size={52} color={COLORS.gray300} />
            <Text style={s.emptyTitle}>No bookmarks yet</Text>
            <Text style={s.emptySub}>Bookmark ayahs while reading to save them here</Text>
          </View>
        ) : (
          bookmarks.map((b, i) => (
            <TouchableOpacity
              key={`${b.surahId}-${b.ayahNumber}-${i}`}
              style={[s.collectionItem, getShadow(2)]}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Detail', {
                surahNumber: b.surahId,
                title: b.surahName,
                mode: 'surah',
              })}
            >
              <View style={s.collectionLeft}>
                <View style={s.collectionIcon}><Bookmark size={22} color={COLORS.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.collectionTitle}>{b.surahName} : {b.ayahNumber}</Text>
                  <Text style={s.collectionMeta} numberOfLines={1}>{b.text}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
```

The `key` uses `surahId-ayahNumber-index` since two bookmarks for the same ayah shouldn't exist but the index makes React happy in any case.

### 4.7 expo-image-picker dependency

`frontend/package.json` — add to `dependencies`:

```json
"expo-image-picker": "~17.0.7",
```

(Pinned to the Expo SDK 54-compatible version. The implementer should run `npx expo install expo-image-picker` rather than `npm install` directly — Expo's installer picks the version that matches the SDK.)

Native rebuild requirement: `expo-image-picker` has a native module. If the user is running the existing EAS dev client, they need to rebuild it after this change. Note this in the spec's "Testing" section.

## 5. Data flow

```
Pick avatar:
  ProfileScreen edit-tap → pickAvatar →
    ImagePicker.requestMediaLibraryPermissionsAsync →
    ImagePicker.launchImageLibraryAsync →
    result.assets[0].uri → setLocalAvatarUri(uri) →
      setLocalAvatarUriState(uri) [in-memory] + storage.setAvatarUri(userId, uri) [persist]
  → 4 consumers re-render with new uri

Bookmark:
  AyahItem heart-icon-tap → toggleBookmark →
    addBookmark({surahId, surahName, ayahNumber, text, translation}) | removeBookmark(surahId, ayahNumber) →
      setBookmarks((prev) => next) [in-memory] + storage.setBookmarks(userId, next) [persist]

App restart:
  AppContext useEffect on user change →
    storage.getBookmarks(userId) + storage.getAvatarUri(userId) →
    setBookmarks + setLocalAvatarUriState

Logout:
  AuthContext.logout → setUser(null) →
    AppContext useEffect detects userId=null → setBookmarks([]) + setLocalAvatarUriState(null)
    storage NOT cleared (intentional — preserves data for re-login)
```

## 6. Testing

No frontend test runner. Manual smoke on Android dev client:

1. **Storage layer node check.** A short `node -e` script can verify the new storage methods are at least syntactically valid JavaScript. (Full AsyncStorage behavior needs a device.)
2. **Bookmark persistence.** Open a surah on Detail → tap bookmark icon on an ayah → BookmarksScreen shows it. Kill the app fully. Reopen. BookmarksScreen still shows it.
3. **Bookmark removal persistence.** From Detail, tap the bookmark icon to un-bookmark → BookmarksScreen empty → restart app → still empty.
4. **Avatar picker.** Profile → tap gear → photo library opens → pick → returns. Avatar visible immediately on Profile.
5. **Avatar app-wide.** Open Dashboard, Track, Sidebar (drawer) — all show the new avatar, not the unsplash stock.
6. **Avatar persistence.** Kill the app. Reopen. Avatar still visible.
7. **Permission denied flow.** Long-press app icon → app info → revoke photo permission. Tap picker. See "Photo access needed" Alert. Re-grant permission → picker works again.
8. **Account scoping.** Add a bookmark + set an avatar. Log out. Log in as a second user. BookmarksScreen empty, avatar back to stock photo. Add a different bookmark + avatar for user 2. Log out. Log back in as user 1 — original bookmark + avatar restored.
9. **Dead UI removal.** BookmarksScreen has no "Add new collection" button. No vertical-dots icon on rows. Tapping a row navigates to the surah's Detail screen.

## 7. Risks

- **EAS dev client rebuild.** Adding `expo-image-picker` requires a native rebuild. Until the user runs `npx expo prebuild --platform android && npx expo run:android`, the import will fail at runtime with "Native module not found". Document this in §6 acceptance step 4.
- **Stale URI on app upgrade.** Expo's ImagePicker copies the image into the app's cache. iOS or Android may purge that cache under storage pressure — rare, but the URI would become a 404. The Image's `onError` callback could detect this and fall back to the stock photo. Out of scope for v1; add to follow-ups if real-world reports come in.
- **Race on rapid bookmark toggle.** If the user spam-taps the bookmark icon, multiple `setBookmarks` updates fire in quick succession, each persisting to disk. AsyncStorage serializes its own queue; the last write wins. Acceptable.
- **AppContext circular dependency.** AppProvider imports `useAuth` from AuthContext. As long as `<AuthProvider>` wraps `<AppProvider>` in `App.js` (it does), this is safe. The implementer must NOT swap the wrapping order.
- **First-render flicker.** On a cold start with a signed-in user, the AppContext's persisted-load `useEffect` runs after the initial render — so the first paint shows empty bookmarks / no avatar override, then a re-render fills them in. The `persistedLoaded` flag is exposed so consumers can suppress UI if they care. None of the avatar consumers do; the flicker is one frame on the fallback. Acceptable.

## 8. Open questions

None. Picker source, image storage strategy, BookmarksScreen UI direction, and overall scope all settled in the brainstorm.

## 9. Follow-ups (out of scope)

- Camera as a second picker source + "Remove photo" action.
- Backend sync of bookmarks (`POST/DELETE /api/bookmarks`) — once the backend ships the endpoints.
- Backend sync of avatar (`POST /api/profile/avatar` with multipart upload, persistent `user.avatarUrl` updated server-side).
- Collections / folders for bookmarks (the original "Add new collection" intent).
- Scroll-to-ayah on Detail screen when opened from a bookmark.
- Image compression / resizing pipeline before persisting.
- Multi-image history per user.
- ImagePicker `onError` fallback to stock photo for purged-cache URIs.

## 10. Implementation surface

| File | Change | Estimated diff |
|---|---|---|
| `frontend/src/utils/storage.js` | Add 4 new methods | `+30 / 0` |
| `frontend/src/constants/index.js` | Add 2 storage key prefixes | `+2 / 0` |
| `frontend/src/context/AppContext.js` | Add useAuth import + persisted-load useEffect + localAvatarUri state + write-through bookmarks + setLocalAvatarUri | `+45 / -5` |
| `frontend/src/screens/secondary/SecondaryScreens.js` | ProfileScreen pickAvatar + BookmarksScreen cleanup + dead-style removal | `+45 / -25` |
| `frontend/src/screens/DashboardScreen.js` | Add useApp + avatar fallback chain | `+3 / -1` |
| `frontend/src/screens/TrackScreen.js` | Add useApp + avatar fallback chain | `+2 / -1` |
| `frontend/src/components/layout/Sidebar.js` | Add useApp + avatar fallback chain | `+3 / -1` |
| `frontend/package.json` + `package-lock.json` | Add expo-image-picker | regenerated lockfile |

Total: 7 modified files + 1 package add. No backend, no AI service, no test-suite touch.
