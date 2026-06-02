# Bookmarks persistence + Profile picture (local) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Controller note:** the user has requested parallel dispatch — see "Parallelization waves" below.

**Goal:** Persist bookmarks across app restarts via AsyncStorage (per-user scoped) and let the user set a profile picture via the photo library; both local-only with hooks for future backend sync.

**Architecture:** Storage extension (5 new methods) drives an AppContext rewrite that loads/persists per-user data. ProfileScreen wires `expo-image-picker` into its existing edit button. Four avatar consumers share one fallback-chain pattern. BookmarksScreen drops dead UI and adds tap-through navigation.

**Tech Stack:** React Native 0.81 + Expo SDK 54 + `@react-native-async-storage/async-storage` (already in deps) + `expo-image-picker` (NEW). No Jest — verification is `node -e` for pure helpers plus manual smoke for UI.

**Spec:** [docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md](../specs/2026-05-19-bookmarks-profile-pic-local.md)

---

## Parallelization waves

Group D has natural sequential dependencies followed by a parallel fan-out:

```
Wave 1 (×2 parallel) ──┐
   T1: constants       │  Wave 2 (×1)        Wave 3 (×1)
   T2: install picker  ├─→  T3: storage  →   T4: AppContext  ─┐
                       ┘                                       │
                                                               ▼
                                              Wave 4 (×4 parallel)
                                              T5: SecondaryScreens
                                              T6: DashboardScreen
                                              T7: TrackScreen
                                              T8: Sidebar

                                              Wave 5: T9 manual smoke
```

Time estimate: 4 sequential waves vs. 9 serial dispatches. Wave 1 also has 2 parallel agents and Wave 4 has 4 — the max-parallelism win.

---

## A note on testing for this plan

The frontend has no Jest runner (verified in Groups A–C). Verification per task:

- **Pure JS / data files (T1, T3)** — `node -e` one-liners.
- **Native package install (T2)** — `node -e "require('expo-image-picker')"` confirms the install + lockfile.
- **Context rewrites (T4)** — read-back grep verification; full behavior tested manually in T9.
- **UI changes (T5, T6, T7, T8)** — `git diff` review per task + manual smoke in T9.

No new test infrastructure. No new Jest config.

---

## A note on dirty working tree

When this plan runs, the working tree has ~24 unrelated dirty files. Only one of them is touched by this plan:

- **Task 1** modifies `frontend/src/constants/index.js` — currently dirty with an unrelated `getDevHost()` refactor. The controller must `git stash push --` that file before dispatching Task 1, and `git stash pop` after the task commits.

All other Group D files are clean. Subagents stage by explicit path and verify `git status --short` before each commit.

---

## File structure recap

| File | Responsibility | Wave |
|---|---|---|
| `frontend/src/constants/index.js` | Add 2 storage key prefixes | 1 |
| `frontend/package.json` + lock | Add `expo-image-picker` | 1 |
| `frontend/src/utils/storage.js` | 4 new methods for bookmarks + avatar URI | 2 |
| `frontend/src/context/AppContext.js` | Load/persist scoped per-user state | 3 |
| `frontend/src/screens/secondary/SecondaryScreens.js` | ProfileScreen pickAvatar + BookmarksScreen cleanup | 4 |
| `frontend/src/screens/DashboardScreen.js` | Avatar fallback chain | 4 |
| `frontend/src/screens/TrackScreen.js` | Avatar fallback chain | 4 |
| `frontend/src/components/layout/Sidebar.js` | Avatar fallback chain | 4 |

---

## Wave 1 — parallel ×2

Tasks 1 and 2 are independent. Dispatch both in one message.

### Task 1: Add storage key prefixes to constants

**Pre-task (controller, before dispatch):**
```bash
cd d:/TrueTilawah
git stash push -m "preserve dirty constants/index.js before Group D Task 1" -- frontend/src/constants/index.js
```
After Task 1 commits, controller pops the stash.

**Files:**
- Modify: `frontend/src/constants/index.js` (~line 52, the `STORAGE_KEYS` block)

- [ ] **Step 1.1: Verify file is clean (after pre-stash)**

```bash
cd d:/TrueTilawah
git status --short frontend/src/constants/index.js
```
Expected: no output. If you see ANY output, STOP and report BLOCKED — pre-stash didn't work.

- [ ] **Step 1.2: Find the STORAGE_KEYS block**

Current content (around line 52–56):
```js
export const STORAGE_KEYS = {
  ACCESS_TOKEN:  '@tt_access_token',
  REFRESH_TOKEN: '@tt_refresh_token',
  USER_DATA:     '@tt_user_data',
};
```

Replace with:
```js
export const STORAGE_KEYS = {
  ACCESS_TOKEN:        '@tt_access_token',
  REFRESH_TOKEN:       '@tt_refresh_token',
  USER_DATA:           '@tt_user_data',
  BOOKMARKS_PREFIX:    '@tt_bookmarks:',
  AVATAR_URI_PREFIX:   '@tt_avatar_uri:',
};
```

Do NOT touch any other line in the file.

- [ ] **Step 1.3: Verify the diff is exactly the 2 added lines**

```bash
cd d:/TrueTilawah
git diff frontend/src/constants/index.js
```
Expected diff: 3 existing fields slightly re-indented (or just whitespace-stable) + 2 new lines (`BOOKMARKS_PREFIX` and `AVATAR_URI_PREFIX`). Total approximate stat: `+5 / -3` or `+2 / 0` depending on whether your re-indent affects existing lines.

If you see ANY changes outside the `STORAGE_KEYS` block, STOP and report BLOCKED — the stash didn't isolate the dirty work.

- [ ] **Step 1.4: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/constants/index.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/constants/index.js` (M in first column = staged). All others should be ` M` (unstaged). If any other file has `M ` first column, run `git restore --staged <path>`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): add bookmarks + avatar URI storage key prefixes

Two new STORAGE_KEYS prefixes for per-user scoped AsyncStorage:
- BOOKMARKS_PREFIX  → @tt_bookmarks:<userId>
- AVATAR_URI_PREFIX → @tt_avatar_uri:<userId>

Consumed in Task 3 (storage methods) and Task 4 (AppContext).

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: one file changed, ~`+2` lines.

---

### Task 2: Install expo-image-picker

**Files:**
- Modify: `frontend/package.json` (add 1 dep)
- Modify: `frontend/package-lock.json` (regenerated)

- [ ] **Step 2.1: Verify files are clean**

```bash
cd d:/TrueTilawah
git status --short frontend/package.json frontend/package-lock.json
```
Expected: no output (both clean).

- [ ] **Step 2.2: Run the Expo-aware installer**

```bash
cd d:/TrueTilawah/frontend
npx expo install expo-image-picker
```

This auto-resolves to the version compatible with Expo SDK 54. Expected: success message, ~10 packages added/updated in lockfile.

If `npx expo install` is not available, fall back to:
```bash
cd d:/TrueTilawah/frontend
npm install expo-image-picker@~17.0.7
```
(Pinned to the SDK 54-compatible release.)

- [ ] **Step 2.3: Verify the package resolves**

```bash
cd d:/TrueTilawah/frontend
node -e "const p = require('expo-image-picker'); console.log('exports:', Object.keys(p).slice(0, 5).join(','));"
```
Expected output: prints a list of exports (e.g. `MediaTypeOptions,launchImageLibraryAsync,...`). If it errors with "Cannot find module", the install didn't complete — STOP and report BLOCKED.

Also confirm package.json now lists the dep:
```bash
grep '"expo-image-picker"' frontend/package.json
```
Expected: one line, e.g. `"expo-image-picker": "~17.0.7",`

- [ ] **Step 2.4: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/package.json frontend/package-lock.json
git status --short --untracked-files=no | head -5
```
Expected first two lines:
```
M  frontend/package-lock.json
M  frontend/package.json
```
(Order may swap.) All other lines should have ` M` (unstaged).

```bash
git commit -m "$(cat <<'EOF'
chore(frontend): add expo-image-picker dependency

Native module used by Task 4 (ProfileScreen pickAvatar handler). After
this lands, an EAS dev client rebuild is required before the import
resolves at runtime — flagged in the spec's testing section.

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 2 files changed (`package.json` + `package-lock.json`).

---

**[CONTROLLER PAUSE BETWEEN WAVE 1 AND WAVE 2]** After both Wave 1 agents return:
1. Pop the constants stash:
   ```bash
   cd d:/TrueTilawah && git stash pop
   ```
2. Verify with `git status --short frontend/src/constants/index.js` — should show ` M` (unstaged dirty work restored).

---

## Wave 2 — single agent

### Task 3: Add storage methods for bookmarks + avatar URI

**Files:**
- Modify: `frontend/src/utils/storage.js`

- [ ] **Step 3.1: Verify file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/utils/storage.js
```
Expected: no output.

- [ ] **Step 3.2: Confirm Task 1's constants exist**

```bash
grep -nE "BOOKMARKS_PREFIX|AVATAR_URI_PREFIX" frontend/src/constants/index.js
```
Expected: two lines. If empty, Wave 1 Task 1 didn't land — STOP and report BLOCKED.

- [ ] **Step 3.3: Add the new methods**

Open `frontend/src/utils/storage.js`. Find the `setUserData` / `getUserData` methods and the `clearAll` method. Add 4 new methods between them (after `getUserData`, before `clearAll`).

Current shape:
```js
export const storage = {
  async setAccessToken(token) { ... },
  async getAccessToken() { ... },
  async setRefreshToken(token) { ... },
  async getRefreshToken() { ... },
  async setUserData(user) { ... },
  async getUserData() { ... },
  async clearAll() { ... },
};
```

Insert these 4 methods right before `async clearAll`:

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

Do NOT modify `clearAll` — it intentionally leaves the new keys in place (bookmarks/avatar persist across logout/login).

- [ ] **Step 3.4: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/utils/storage.js
```
Expected: roughly `+30 / 0`. All additions are new methods between `getUserData` and `clearAll`. No other lines changed.

- [ ] **Step 3.5: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/utils/storage.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/utils/storage.js`. All others ` M`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): add bookmarks + avatar URI storage methods

Four new AsyncStorage helpers, each scoped by userId:
- setBookmarks(userId, list) / getBookmarks(userId)
- setAvatarUri(userId, uri)  / getAvatarUri(userId)

Empty/null userId is treated as no-op (defensive — avoids writing
unscoped keys when state is in flux during login transitions).

clearAll() intentionally NOT modified — bookmarks and avatar persist
across logout/login so the same user gets their data restored.

Consumed in Task 4 (AppContext rewrite).

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 1 file changed, ~`+30` lines.

---

## Wave 3 — single agent

### Task 4: Rewrite AppContext to load + persist per-user state

**Files:**
- Modify: `frontend/src/context/AppContext.js`

- [ ] **Step 4.1: Verify file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/context/AppContext.js
```
Expected: no output.

- [ ] **Step 4.2: Replace the file body entirely**

The existing file is 51 lines. Replace its full content with:

```jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { storage } from '../utils/storage';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [surahs,         setSurahsState]      = useState([]);
  const [surahsLoaded,   setSurahsLoaded]     = useState(false);
  const [bookmarks,      setBookmarks]        = useState([]);
  const [localAvatarUri, setLocalAvatarUriState] = useState(null);
  const [persistedLoaded,setPersistedLoaded]  = useState(false);
  const [currentSession, setCurrentSession]   = useState(null);

  // Load (or clear) per-user persisted state when the signed-in user changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPersistedLoaded(false);
      if (!userId) {
        // Logout — clear in-memory state. Disk content is preserved so the
        // same user logging back in gets their bookmarks + avatar restored.
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

- [ ] **Step 4.3: Confirm App.js wraps in the right order**

```bash
grep -nE "AuthProvider|AppProvider" frontend/App.js
```
Expected: `AuthProvider` opens BEFORE `AppProvider` (i.e. `<AuthProvider><AppProvider>...`). If the order is reversed, `useAuth()` inside `AppProvider` will throw — STOP and report BLOCKED (this would require a separate fix to App.js).

- [ ] **Step 4.4: Verify the diff**

```bash
cd d:/TrueTilawah
git diff --stat frontend/src/context/AppContext.js
```
Expected: roughly `+95 / -45` (the file roughly doubles in size).

Sanity grep — confirm the existing public API is preserved:
```bash
grep -nE "addBookmark|removeBookmark|isBookmarked|setSurahData|setCurrentSession" frontend/src/context/AppContext.js
```
Expected: each function appears (as a `const ... = useCallback` or as a context value). If any are missing, you broke the public API — fix it.

- [ ] **Step 4.5: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/context/AppContext.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/context/AppContext.js`. All others ` M`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): AppContext loads + persists per-user bookmarks + avatar

Subscribes to useAuth().user?.id. On user change, loads bookmarks and
localAvatarUri from AsyncStorage scoped to that user. addBookmark /
removeBookmark / setLocalAvatarUri write through to disk on every call.

On logout (userId becomes null), in-memory state clears but disk is
preserved — re-login restores the prior user's data.

Existing public API (bookmarks, addBookmark, removeBookmark,
isBookmarked, setSurahData, currentSession) preserved. Adds
localAvatarUri, setLocalAvatarUri, persistedLoaded.

Consumed by ProfileScreen + 3 avatar consumers in Task 5–8.

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 1 file changed, ~`+95 / -45`.

---

## Wave 4 — parallel ×4

Tasks 5–8 each modify a different file. Dispatch all four in one message.

### Task 5: ProfileScreen pickAvatar + BookmarksScreen cleanup

**Files:**
- Modify: `frontend/src/screens/secondary/SecondaryScreens.js`

- [ ] **Step 5.1: Verify file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/screens/secondary/SecondaryScreens.js
```
Expected: no output.

- [ ] **Step 5.2: Update the imports block**

Find the existing imports at the top of `SecondaryScreens.js`:

```js
import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  TextInput, Image, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Plus, Bookmark, MoreVertical, Settings, Eye,
  CheckCircle2, Search, ChevronRight,
} from 'lucide-react-native';
import Header from '../../components/common/Header';
import { useAuth } from '../../context/AuthContext';
import { useApp }  from '../../context/AppContext';
import { COLORS }  from '../../constants';
import { getShadow } from '../../utils/helpers';
```

Replace with:

```js
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  TextInput, Image, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  Bookmark, Settings, Eye,
  CheckCircle2, Search, ChevronRight,
} from 'lucide-react-native';
import Header from '../../components/common/Header';
import { useAuth } from '../../context/AuthContext';
import { useApp }  from '../../context/AppContext';
import { COLORS }  from '../../constants';
import { getShadow } from '../../utils/helpers';
```

Changes:
- Added `useCallback` to the React import.
- Added `Alert` to the react-native import.
- Added `import * as ImagePicker from 'expo-image-picker';`
- Removed `Plus` and `MoreVertical` from lucide imports (only used by dead UI we're removing).

- [ ] **Step 5.3: Replace the BookmarksScreen function**

Find the existing `BookmarksScreen` function (around lines 18–52). Replace ENTIRELY with:

```jsx
// ─── Bookmarks ────────────────────────────────────────────────────────────────
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
                title:       b.surahName,
                mode:        'surah',
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

Changes vs original:
- Removed the `<TouchableOpacity style={s.addBtn}>` "Add new collection" block (was always above the bookmark list).
- Removed the `<MoreVertical size={20} ...>` icon from the right side of each row.
- Added `onPress={() => navigation.navigate('Detail', {...})}` to each row.
- Used `${b.surahId}-${b.ayahNumber}-${i}` for the key (stable + unique).

- [ ] **Step 5.4: Replace the ProfileScreen function**

Find the existing `ProfileScreen` function (around lines 54–86). Replace ENTIRELY with:

```jsx
// ─── Profile ──────────────────────────────────────────────────────────────────
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
        <Text style={s.profileName}>{user?.fullName || 'User'}</Text>
        <Text style={s.profileLevel}>Beginner Student</Text>
        <View style={s.fields}>
          {[
            { label: 'Full Name', value: user?.fullName || '—' },
            { label: 'Email',     value: user?.email    || '—' },
            { label: 'Joined',    value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—' },
          ].map(f => (
            <View key={f.label} style={s.field}>
              <Text style={s.fieldLabel}>{f.label}</Text>
              <Text style={s.fieldValue}>{f.value}</Text>
            </View>
          ))}
        </View>
        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
```

Changes vs original:
- Added `useApp` destructure of `localAvatarUri` and `setLocalAvatarUri`.
- Added `pickAvatar` callback (permission request + library launch + write-through to context).
- Changed Image source URI to start with `localAvatarUri ||` (rest unchanged).
- Added `onPress={pickAvatar}` and `activeOpacity={0.7}` to the edit button (was inert).

The `SettingsScreen`, `HelpScreen`, and styles block are UNCHANGED.

- [ ] **Step 5.5: Remove dead styles**

Find these style entries in the styles block at the bottom of the file:

```js
addBtn:          { ... },
addIcon:         { ... },
addLabel:        { ... },
```

Remove all three. They were only used by the deleted "Add new collection" UI.

- [ ] **Step 5.6: Verify the diff**

```bash
cd d:/TrueTilawah
git diff --stat frontend/src/screens/secondary/SecondaryScreens.js
```
Expected: roughly `+45 / -25` lines.

Sanity grep — should return NO output:
```bash
grep -nE "MoreVertical|Plus,|addBtn:|addIcon:|addLabel:|Add new collection" frontend/src/screens/secondary/SecondaryScreens.js
```
If any of these still appear, you missed a deletion.

- [ ] **Step 5.7: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/secondary/SecondaryScreens.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/screens/secondary/SecondaryScreens.js`. All others ` M`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): ProfileScreen avatar picker + BookmarksScreen cleanup

ProfileScreen:
- Wires the previously-inert gear button to expo-image-picker's
  launchImageLibraryAsync. Handles permission denial with a clear
  Alert pointing to phone Settings.
- Image source now reads localAvatarUri || user.avatarUrl || stock,
  so the user's chosen photo replaces the unsplash fallback.

BookmarksScreen:
- Drops "Add new collection" button (implied a feature that doesn't
  exist).
- Drops the dead MoreVertical row icon.
- Tapping a bookmark row now navigates to the surah's Detail screen.

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 1 file changed, ~`+45 / -25`.

---

### Task 6: DashboardScreen avatar fallback

**Files:**
- Modify: `frontend/src/screens/DashboardScreen.js`

- [ ] **Step 6.1: Verify file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/screens/DashboardScreen.js
```
Expected: no output.

- [ ] **Step 6.2: Locate the imports and the avatar source line**

```bash
grep -nE "useApp\b|avatarUrl" frontend/src/screens/DashboardScreen.js | head -5
```
Expected: shows the existing avatar source line around line 121. May or may not show `useApp` (let's add it if missing).

- [ ] **Step 6.3: Add the `useApp` import if missing**

Check first:
```bash
grep -nE "from '../context/AppContext'" frontend/src/screens/DashboardScreen.js
```

If empty (no `useApp` import yet), find the imports block at the top of the file and add right after the existing `useAuth` import (or wherever `useApp` would fit naturally):

```js
import { useApp } from '../context/AppContext';
```

If the import already exists, skip this step.

- [ ] **Step 6.4: Pull `localAvatarUri` from `useApp`**

Find where the component destructures from `useAuth()`. It looks like:

```js
const { user } = useAuth();
```

Add immediately below it (or merge if `useApp` already destructures other values):

```js
const { localAvatarUri } = useApp();
```

If `useApp` is already used and destructures e.g. `const { surahs } = useApp();`, modify it to include `localAvatarUri`:

```js
const { surahs, localAvatarUri } = useApp();
```

- [ ] **Step 6.5: Update the avatar Image source**

Around line 121, find:

```jsx
source={{ uri: user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
```

Replace with:

```jsx
source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
```

- [ ] **Step 6.6: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/DashboardScreen.js
```
Expected: 2 small regions changed — the import / destructure addition and the one-line source URI change. Total `+3 / -1` approximately.

- [ ] **Step 6.7: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/DashboardScreen.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/screens/DashboardScreen.js`. All others ` M`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): DashboardScreen avatar uses localAvatarUri fallback

The user's chosen profile picture (from ProfileScreen → expo-image-picker)
now appears on the Dashboard hero card, replacing the unsplash stock
when set. Fallback chain: localAvatarUri || user.avatarUrl || stock.

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 1 file, ~`+3 / -1`.

---

### Task 7: TrackScreen avatar fallback

**Files:**
- Modify: `frontend/src/screens/TrackScreen.js`

This task is structurally identical to Task 6 but for a different file.

- [ ] **Step 7.1: Verify file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/screens/TrackScreen.js
```
Expected: no output.

- [ ] **Step 7.2: Confirm useApp is already imported**

```bash
grep -nE "useApp\b" frontend/src/screens/TrackScreen.js
```
Expected: shows existing import + usage (Group C added it). If empty, add the import:

```js
import { useApp } from '../context/AppContext';
```

- [ ] **Step 7.3: Pull `localAvatarUri` from `useApp`**

Find the existing destructure (added in Group C):

```js
const { surahs } = useApp();
```

Change to:

```js
const { surahs, localAvatarUri } = useApp();
```

- [ ] **Step 7.4: Update the avatar Image source**

Find around line 177:

```jsx
source={{ uri: user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
```

Replace with:

```jsx
source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
```

- [ ] **Step 7.5: Verify and commit**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/TrackScreen.js
```
Expected: 1–2 small regions. Total ~`+1 / -1`.

```bash
git add frontend/src/screens/TrackScreen.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/screens/TrackScreen.js`. All others ` M`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): TrackScreen hero avatar uses localAvatarUri fallback

The user's chosen profile picture now appears on the Progress hero
card. Fallback chain: localAvatarUri || user.avatarUrl || stock.

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 1 file, ~`+1 / -1`.

---

### Task 8: Sidebar avatar fallback

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.js`

Structurally identical to Tasks 6 and 7.

- [ ] **Step 8.1: Verify file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/components/layout/Sidebar.js
```
Expected: no output.

- [ ] **Step 8.2: Check current imports**

```bash
head -10 frontend/src/components/layout/Sidebar.js
grep -n "useApp\b" frontend/src/components/layout/Sidebar.js
```

If `useApp` isn't imported, add this line near the existing context imports (or after the `useAuth` import):

```js
import { useApp } from '../../context/AppContext';
```

(Note: from `components/layout/`, the path is `../../context/AppContext` — two dots up.)

- [ ] **Step 8.3: Pull `localAvatarUri` from `useApp`**

Inside the Sidebar component, after the existing `useAuth` destructure, add:

```js
const { localAvatarUri } = useApp();
```

- [ ] **Step 8.4: Update the avatar Image source**

Find line 21 area:

```jsx
source={{ uri: user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
```

Replace with:

```jsx
source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
```

- [ ] **Step 8.5: Verify and commit**

```bash
cd d:/TrueTilawah
git diff frontend/src/components/layout/Sidebar.js
```
Expected: 2 small regions (import + destructure + source URI). ~`+3 / -1`.

```bash
git add frontend/src/components/layout/Sidebar.js
git status --short --untracked-files=no | head -5
```
Expected first line: `M  frontend/src/components/layout/Sidebar.js`. All others ` M`.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): Sidebar avatar uses localAvatarUri fallback

The user's chosen profile picture now appears on the drawer's avatar
slot. Fallback chain: localAvatarUri || user.avatarUrl || stock.

Refs: docs/superpowers/specs/2026-05-19-bookmarks-profile-pic-local.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```
Expected: 1 file, ~`+3 / -1`.

---

## Wave 5 — manual smoke (user-driven)

### Task 9: Visual + functional smoke on Android dev client

Because Task 2 adds a native module (`expo-image-picker`), the user MUST rebuild the dev client before testing:

```bash
cd d:/TrueTilawah/frontend
npx expo prebuild --platform android
npx expo run:android
```

Then walk the spec's §6 acceptance checklist:

- [ ] **9.1 Bookmark persistence (cold-start).** Open a surah on Detail, tap the bookmark icon on an ayah, navigate to BookmarksScreen, confirm row appears. Kill app fully (swipe out from recents). Re-open. BookmarksScreen still shows the row.
- [ ] **9.2 Bookmark removal persistence.** From Detail, tap bookmark icon to un-bookmark. BookmarksScreen empty. Restart app — still empty.
- [ ] **9.3 Avatar picker happy path.** Profile → tap gear → photo library opens → choose a photo (any from your gallery) → returns to Profile. New avatar visible.
- [ ] **9.4 Avatar app-wide propagation.** From Profile, navigate to Dashboard, Track, and open the Sidebar drawer. Same chosen avatar visible everywhere.
- [ ] **9.5 Avatar persistence.** Kill the app. Re-open. Avatar still visible on all 4 surfaces.
- [ ] **9.6 Permission denied flow.** In phone Settings, revoke photo library permission for True Tilawah. In the app, tap the gear button. See an Alert: "Photo access needed — please allow photo library access in your phone Settings to choose a profile picture." Re-grant permission. Tap gear again. Picker now opens.
- [ ] **9.7 Account scoping (requires a second account).** Add a bookmark + set an avatar as User A. Log out. Log in as User B. BookmarksScreen empty. Avatar back to stock. Add different bookmark + avatar for B. Log out. Log back in as A. A's bookmarks + avatar restored.
- [ ] **9.8 BookmarksScreen UI cleanup.** Confirm: no "Add new collection" button at top. No vertical-dots icon on each row. Tapping a row navigates to the surah's Detail screen.

If any step fails, capture the symptom (screenshot or error log) and report back — I'll dispatch a fix.

---

## Self-Review checklist (controller-side, before handoff)

1. **Spec coverage:**
   - ✅ Storage methods (§4.1) → Task 3.
   - ✅ STORAGE_KEYS prefixes (§4.2) → Task 1.
   - ✅ AppContext rewrite (§4.3) → Task 4.
   - ✅ ProfileScreen pickAvatar (§4.4) → Task 5.
   - ✅ 4 avatar consumers (§4.5) → Tasks 5 (ProfileScreen), 6 (Dashboard), 7 (Track), 8 (Sidebar).
   - ✅ BookmarksScreen cleanup (§4.6) → Task 5.
   - ✅ expo-image-picker install (§4.7) → Task 2.
   - ✅ Manual smoke checklist (§6) → Task 9.
2. **Placeholder scan:** No "TBD", "TODO", or "Add appropriate X" in any task. Every code block is complete.
3. **Type / name consistency:**
   - `localAvatarUri` and `setLocalAvatarUri` consistent across Tasks 4, 5, 6, 7, 8.
   - `STORAGE_KEYS.BOOKMARKS_PREFIX` / `STORAGE_KEYS.AVATAR_URI_PREFIX` consistent across Tasks 1, 3.
   - `setBookmarks(userId, list)` / `getBookmarks(userId)` / `setAvatarUri(userId, uri)` / `getAvatarUri(userId)` consistent across Tasks 3, 4.
4. **File-path consistency:** All paths use `frontend/src/...`. Sidebar import path is `../../context/AppContext` (two dots — different from screens which use one).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-bookmarks-profile-pic-local.md`.

**The user has requested parallel dispatch** (consistent with Group C). The 4-wave structure above gives the controller:
- Wave 1 — 2 parallel agents (T1 + T2), pre-stash on `constants/index.js` required before dispatch.
- Wave 2 — 1 agent (T3). Pop stash before dispatch.
- Wave 3 — 1 agent (T4).
- Wave 4 — 4 parallel agents (T5 + T6 + T7 + T8).
- Wave 5 — manual smoke by the user.

Estimated time: 4 sequential subagent waves + 1 manual step. Roughly 60–70% of the time a fully-serial dispatch would take.
