# Retain rework — spec (Group B of multi-feature UX batch)

**Status:** Approved, awaiting plan.
**Date:** 2026-05-18.
**Scope:** Rework the Retain screen and RetainResults screen so they feel parallel to the Recite flow: per-ayah carousel with real-time word-level mistake coloring, explicit Save Session before navigating to Results, and Results that show only real session data (no dummies). Drop dead UI along the way.
**Not in this spec:** Re-recite from session detail (Group C), bookmarks (Group D), profile picture (Group D), Recite-screen RTL tweaks (Group E).

## 1. Why

Three independent problems with today's Retain flow:

1. **Dead UI.** The Record/Write mode tabs at the top of RetainScreen never branch — switching to "Write" changes the visual selection but nothing else. The static mode tabs are also repeated on RetainResults purely as decoration. The "Short Summary" button on Results has no `onPress`. All of this is debt the user hits every session.
2. **Mismatch with Recite.** Recite has a per-ayah carousel with word-by-word red/green coloring driven by the streaming `partial_mistake` / `word_corrected` / `mistake_acknowledged` events, an inline mistake panel, and an explicit Save button. Retain has a single-ayah hint box, no per-word feedback, and silently auto-completes the session on Stop. Users learn Recite first and find Retain's reduced affordances confusing.
3. **Hardcoded results.** RetainResults' "Alphabets mistakes 59 / 2303" is literal hardcoded text. "Words mistakes 10 / 319" falls back to "10 / 319" if no real feedback. "Most common error" falls back to "Addition of 'waw' before verses". The user is told a believable number that has nothing to do with their actual recitation.

## 2. Goal

- Retain looks and behaves like Recite during recording — per-ayah RTL carousel, per-word coloring driven by the same streaming events, TTS of the correct word on mistake, inline mistake panel below the mic.
- On Stop, the session is **not** auto-completed. The user sees their mistakes and explicitly taps **Save Session** to commit + navigate to RetainResults, or **Reset** to abandon and start over.
- RetainResults shows three rows of **real data**: alphabets mistakes (count of letter-level errors / total letters in scope), words mistakes (count of word-level errors / total words in scope), most common error (most-frequent mistake type for this session). No fallback dummies anywhere.
- The Record/Write mode tabs, the single-ayah hint box, the static mode tabs on Results, and the dead "Short Summary" button are removed.

Success = a user who tested Retain alongside Recite cannot identify any feature gap during recording, and the Results screen shows only numbers derived from this session's actual mistakes.

## 3. Non-goals

- **No new audio engine, no new tajweed rules.** Retain reuses the existing `audioStreamService` + `wordStateStore` + WS event vocabulary unchanged.
- **No backend changes.** `sessionService.createSession` / `completeSession` / `abandonSession` and the WS handler are all unchanged. Retain consumes them.
- **No re-recite from Results.** That's part of Group C (Progress / session-detail rework).
- **No bookmark wiring on Results.** That's Group D.
- **No layout / color redesign.** This is a render-tree change + a save-flow change. Card sizes, gauge, gradient banner, mic visuals, COLORS palette — all untouched.
- **No shared CarouselComponent abstraction.** Recite and Retain currently use the same carousel math in two separate files; we'll extract one tiny utility (`fetchScopeAyahs`) but not a full shared carousel. Premature shared abstraction is out of scope; revisit if a third screen wants the same carousel.
- **No new tests.** The frontend has no Jest runner (verified during Group A); verification is `node -e` for any pure-data assertions and manual Android-dev-client smoke for UI.

## 4. Design

### 4.1 RetainScreen.js

**Removals:**

- The `ModeTabs` component definition (`function ModeTabs({...}) { ... }`) — gone entirely.
- The `mode` state and `setMode` (line 33) — gone.
- The render-site `<ModeTabs ... />` line — gone.
- The `verseBox` JSX block that renders the single starting ayah hint — gone.
- The "Record" toggle (the Switch labeled "Record" in the toggleRow) — gone. The mic button is the only start/stop affordance.
- The `startingVerse` / `setStartingVerse` state — gone. The "first ayah" fetch in `pickRandom` is replaced by an all-ayahs-in-range fetch.

**Additions / changes:**

1. **All-ayahs-in-scope fetch.**
   - Add a new helper at `frontend/src/utils/scopeAyahs.js`:
     ```js
     // Reused by ReciteScreen + RetainScreen. Pulls every ayah in [start, end]
     // from the backend, falling back to Al-Quran-Cloud uthmani text if the
     // backend has no rows. Returns [{ ayahNumber, uthmaniText, ... }, ...].
     import { quranService } from '../services/quranService';
     export async function fetchScopeAyahs(surahId, start, end) {
       try {
         const data = await quranService.getAyahRange(surahId, start, end);
         const ayahs = data?.ayahs || [];
         if (ayahs.length) return ayahs;
       } catch {}
       try {
         const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahId}/quran-uthmani`);
         const json = await res.json();
         const all = json?.data?.ayahs || [];
         return all
           .filter(a => a.numberInSurah >= start && a.numberInSurah <= end)
           .map(a => ({ ayahNumber: a.numberInSurah, uthmaniText: a.text }));
       } catch { return []; }
     }
     ```
   - ReciteScreen has the same helper inline today (lines 53–70). Extract to the util and import from both screens. This is the only shared abstraction in this spec.
   - In `pickRandom` (and any new `setSurah`-driven effect), call `fetchScopeAyahs(surahNumber, start, end)` and store the array in a new `scopeAyahs` state. Drop the single-ayah fetch that exists today.

2. **Carousel.**
   - Add the same carousel constants used by Recite:
     ```js
     const { width: SCREEN_W } = Dimensions.get('window');
     const CARD_W = Math.min(SCREEN_W - 72, 340);
     const CARD_GAP = 14;
     const SNAP = CARD_W + CARD_GAP;
     const SIDE_PAD = (SCREEN_W - CARD_W) / 2;
     ```
   - State: `currentIdx`, `setCurrentIdx`. Ref: `carouselRef`.
   - Render: when `showVerses` is true and `scopeAyahs.length > 0`, render a `<FlatList horizontal>` with snap-to-interval = SNAP. Each row is an ayah card — same outer structure as Recite's card (number pill, error badge when that ayah has mistakes, word tokens).
   - Each word is a `WordToken` component identical to Recite's: `useWordStateStore((s) => (s.states[ayah] || {})[wordIdx] || WordState.Pending)` and `<Text style={[s.ayahArabicWord, { color: WORD_STATE_COLOUR[state] }]}>`. Copy the `WORD_STATE_COLOUR` map verbatim.
   - Carousel nav row (prev / next buttons + "Ayah N" label) — same as Recite.
   - Placeholder cards when not loaded / loading / empty — same as Recite's three placeholder branches.

3. **Toggle rename.**
   - Rename `showStarting` state → `showVerses`. Default still `true`.
   - The toggle label changes from "Show starting verse" → "Show verses".
   - Carousel renders only when `showVerses` is true. When false, the carousel block is hidden but the mic + summary panel still render.

4. **Streaming event wiring (NEW — mirrors Recite exactly).**
   - In the existing `wireCallbacks` function, replace the tally-only handler with the full Recite-style switch:
     - `partial_mistake` → set word state to `Mistake`, optionally `speakWord(correct)`, prepend mistake to `mistakes` state.
     - `word_corrected` → set word state to `Corrected`.
     - `word_correct` → set word state to `Correct` (first-try green).
     - `mistake_acknowledged` → set word state to `Acknowledged`.
     - `mistake` (ayah-finalized batch from Node) → append mistakes to state, speak each `correct`.
     - `unclear` / `out_of_scope` → soft notice in the panel.
     - `error` → `Alert.alert('Analysis problem', ...)`.
   - Add a `mistakes` state array, same shape as Recite. Drop `mistakeCountsRef` — counts are now derivable from `mistakes` via a `useMemo` if needed for the score calc.
   - Add the `speakWord` function with the "now-speaking" indicator (`speakingWord` state) — straight copy from Recite, including the 3.5 s safety timeout.
   - Reset the `wordStateStore` and `mistakes` at the start of each recording (just like Recite's `setMistakes([]); useWordStateStore.getState().reset();`).

5. **Save / Reset flow.**
   - Small inline helpers used below (define once at module top, near the existing `ERROR_TYPES` array):
     ```js
     function clamp(n, lo, hi) {
       n = Number.isFinite(+n) ? +n : lo;
       return Math.min(Math.max(n, lo), hi);
     }
     function countByType(mistakes) {
       const counts = {};
       for (const m of mistakes) {
         const t = m?.type;
         if (!t) continue;
         counts[t] = (counts[t] || 0) + 1;
       }
       return counts;
     }
     function pickMostCommon(counts) {
       let max = 0, winner = null;
       for (const t of ['MISPRONUNCIATION','OMITTED_WORD','ADDED_WORD','TAJWEED_VIOLATION']) {
         if ((counts[t] || 0) > max) { max = counts[t]; winner = t; }
       }
       return winner;
     }
     ```
     (`clamp` is duplicated from ReciteScreen for now; revisit if a fourth screen needs it. `countByType` and `pickMostCommon` are file-local helpers.)
   - `onStop` becomes a pure recording-teardown — it stops anims, stops the audio stream, but **does not** call `completeSession` or `navigate`. It leaves `mistakes` visible.
     ```js
     const onStop = async () => {
       stopAnims();
       setIsRecording(false);
       await cleanupRecording({ abandon: false }); // stops WS, does not abandon, does not complete
     };
     ```
   - New `handleSave`:
     ```js
     const handleSave = async () => {
       if (!sessionRef.current) { Alert.alert('Info', 'Start recording first'); return; }
       setSaving(true);
       try {
         // Already stopped via onStop. If still recording, stop first.
         if (isRecordingRef.current) await cleanupRecording({ abandon: false });
         const counts = countByType(mistakes);
         const totalMistakes = mistakes.length;
         const accuracyScore = clamp(Math.round(100 - totalMistakes * 4), 0, 100);
         let mostCommonError = pickMostCommon(counts);
         await sessionService.completeSession(sessionRef.current.id, {
           transcript: '', accuracyScore,
         });
         const totalWords  = countWords(scopeAyahs);    // from utils/scopeAyahs
         const totalLetters = countLetters(scopeAyahs); // from utils/scopeAyahs
         navigation.navigate('RetainResults', {
           sessionId: sessionRef.current.id,
           surahId: surah.surahNumber,
           surahName: surah.surahName,
           surahNameAr: surah.surahNameAr,
           verseRange,
           accuracyScore,
           mistakes,           // NEW — pass the full array, not just counts
           mistakeCounts: counts,
           mostCommonError,
           totalWords,         // NEW
           totalLetters,       // NEW
         });
         sessionRef.current = null;
       } catch (err) {
         Alert.alert('Error', err?.message || 'Failed to save session');
       } finally {
         setSaving(false);
       }
     };
     ```
   - New `handleReset`:
     ```js
     const handleReset = async () => {
       if (isRecordingRef.current) await cleanupRecording({ abandon: true });
       setMistakes([]);
       useWordStateStore.getState().reset();
       setSpeakingWord(null);
       // Stay on screen. User can pick a new surah / press mic again.
     };
     ```
   - Bottom button row (below the inline mistake panel):
     ```jsx
     <View style={s.btnRow}>
       <Button onPress={handleReset} variant="outline" size="md" style={s.btn}>Reset</Button>
       <Button onPress={handleSave}  variant="secondary" size="md" loading={saving} style={s.btn}>
         Save Session
       </Button>
     </View>
     ```
     Mirrors Recite's bottom row exactly.

6. **Inline mistake panel.**
   - Render below the mic, only when `mistakes.length > 0` OR `isRecording` (so the empty state shows while recording).
   - Same JSX as Recite's `mistakePanel` block: header, `visibleMistakes = mistakes.slice(0, 3)`, each rendered as an `mCard` with type-label + Arabic correct word + tip + optional TTS replay button.
   - Reuse the `MistakeIcon` component + `TYPE_LABELS` map. Copy from Recite — same justification as the carousel: small enough that a shared module is premature.

7. **Shuffle gating.**
   - Disable the Shuffle button when `isRecording` (already done) **and** when `mistakes.length > 0 && !isRecording` (post-stop, pre-save). Otherwise shuffling would lose unreviewed mistakes.

8. **Imports added to RetainScreen.js:**
   ```js
   import { LinearGradient } from 'expo-linear-gradient';            // already there? no — add
   import { ChevronLeft, ChevronRight, AlertCircle, Minus, Plus, Star } from 'lucide-react-native';  // add the icons
   import Button from '../components/common/Button';                  // add
   import { useWordStateStore, WordState } from '../services/wordStateStore';  // add
   import { FONTS } from '../constants';                              // add
   ```
   And `expo-speech` lazy-required at top, same pattern as Recite (`try { Speech = require('expo-speech'); } catch { Speech = null; }`).

### 4.2 RetainResultsScreen.js

**Removals:**

- The static `ModeTabs` block (lines 129-132).
- The dead "Short Summary" button (line 148).
- All three result-row fallback dummies — line 152 (`"59 / 2303"`), line 153 (`'10 / 319'`), line 154 (`'Addition of "waw" before verses'`).

**Replace dummies with real-data computation:**

- New helpers (top of file, or pulled from the new `utils/scopeAyahs.js`):
  ```js
  // Count letter-level mistakes: TAJWEED_VIOLATION + MISPRONUNCIATION
  function countLetterMistakes(mistakes) {
    let n = 0;
    for (const m of mistakes) {
      if (m.type === 'TAJWEED_VIOLATION' || m.type === 'MISPRONUNCIATION') n++;
    }
    return n;
  }

  // Count word-level mistakes: MISPRONUNCIATION + OMITTED_WORD + ADDED_WORD
  function countWordMistakes(mistakes) {
    let n = 0;
    for (const m of mistakes) {
      if (m.type === 'MISPRONUNCIATION' || m.type === 'OMITTED_WORD' || m.type === 'ADDED_WORD') n++;
    }
    return n;
  }
  ```
- Read new params:
  ```js
  const mistakes      = Array.isArray(params.mistakes) ? params.mistakes : [];
  const totalWords    = Number.isFinite(params.totalWords)   ? params.totalWords   : null;
  const totalLetters  = Number.isFinite(params.totalLetters) ? params.totalLetters : null;
  ```
- Derived display strings:
  ```js
  const letterMistakeCount = countLetterMistakes(mistakes);
  const wordMistakeCount   = countWordMistakes(mistakes);
  const alphabetsValue = totalLetters != null ? `${letterMistakeCount} / ${totalLetters}` : `${letterMistakeCount}`;
  const wordsValue     = totalWords   != null ? `${wordMistakeCount} / ${totalWords}`     : `${wordMistakeCount}`;
  const mostCommonLabel = mostCommonError && ERROR_LABEL[mostCommonError]
    ? ERROR_LABEL[mostCommonError]
    : (mistakes.length > 0 ? 'Mixed' : 'No mistakes');
  ```
  (Note: no dummy fallback. If `totalLetters` / `totalWords` aren't passed, we show only the numerator. If `mistakes` is empty, "Most common error" reads "No mistakes" — honest.)
- Drop the `useEffect`-based `feedbackService.getSessionFeedback` fetch — we now have the mistake list passed directly from Retain. Saves one network roundtrip.
- Drop the `feedbackCount` state.

**Rename the bottom button:**

- "Save your progress" → "Back to Retain". The `onPress` already navigates to Retain — only the label and the icon change. (Use `ArrowLeft` from `lucide-react-native` instead of `Bookmark`.) No fake-save semantics.

### 4.3 utils/scopeAyahs.js

New file with three exports:

```js
import { quranService } from '../services/quranService';

export async function fetchScopeAyahs(surahId, start, end) {
  // (body shown in §4.1.1)
}

export function countWords(scopeAyahs) {
  let n = 0;
  for (const a of scopeAyahs) {
    const t = a?.uthmaniText || a?.text || '';
    n += t.split(/\s+/).filter(Boolean).length;
  }
  return n;
}

export function countLetters(scopeAyahs) {
  // Strip whitespace + Arabic tashkeel / small letters / dagger-alef.
  // We count *letter codepoints* — fatha/kasra/damma/sukun etc. are diacritics,
  // not letters, so they don't add to the alphabet count.
  let n = 0;
  for (const a of scopeAyahs) {
    const t = a?.uthmaniText || a?.text || '';
    const stripped = t.replace(/[ً-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/g, '');
    n += stripped.replace(/\s+/g, '').length;
  }
  return n;
}
```

(The wide regex covers tashkeel + Quranic annotation marks. The number is a friendly informational denominator, not a precision metric.)

## 5. Data integrity

- `mistakes` array passed via `navigation.navigate` params survives a focused screen transition. RetainResults is a stack screen pushed on top of Retain, so the params live for the lifetime of that screen instance. No persistence beyond that — if the user backgrounds the app and reopens, they'll land on whichever screen the navigator restores. That's existing behavior; no regression.
- `sessionService.completeSession` already persists `accuracyScore` and the `Feedback` rows are persisted per ayah-finalized event by the backend. If RetainResults is reopened later (e.g. from Group C's session list), the mistakes can be re-fetched via `feedbackService.getSessionFeedback` — that path stays intact for future use, but is **not used in this spec** because we pass the array directly.

## 6. Testing

No frontend test runner. Acceptance is visual on an Android dev client:

1. **Mode-tabs removal regression.** Open Retain. No Record/Write tabs at the top. Open RetainResults (after a recording). No static mode tabs. No Short Summary button.
2. **Carousel renders.** Open Retain → pick a surah (or accept the random one) → carousel shows all ayahs in the range, snap-scrolls horizontally, each card has the ayah number pill + Arabic text in Uthmanic Hafs (Group A's font). Toggle "Show verses" off → carousel disappears. Toggle back on → reappears.
3. **Real-time coloring works.** Tap mic. Recite a portion that has a known mistake (e.g. omit a word). Within ~1 s, the omitted word in the carousel goes red. Speak the correct word → it goes green. Move on without re-reading → it fades to acknowledged-red.
4. **Mistake panel populates.** Below the mic, the latest 3 mistakes show with type label, Arabic correct word in Quran font, optional tip. Empty state reads "Listening for recitation errors…" while recording or "Mistakes will appear here." when idle.
5. **TTS fires.** When the AI service emits a `partial_mistake`, the device speaks the `correct` word in Arabic. The "SPEAKING" pill flashes on screen during playback.
6. **Save flow.** Tap mic again to stop. UI stays on Retain; mistakes still visible. Tap Save Session → loading spinner on the button → navigates to RetainResults.
7. **Reset flow.** After stopping, tap Reset instead. Mistakes panel clears, word coloring clears. User can shuffle / pick a new range / restart.
8. **Real Results data.**
   - Alphabets mistakes row reads e.g. `7 / 432` — the numerator is the count of TAJWEED_VIOLATION + MISPRONUNCIATION mistakes from this session, the denominator is the letter count of the scope ayahs.
   - Words mistakes row reads e.g. `5 / 89`.
   - Most common error row reads one of: Mispronunciation / Omitted words / Added words / Tajweed violations / Mixed / No mistakes. **Never "Addition of 'waw' before verses".**
   - "Back to Retain" button at the bottom navigates back to Retain.
9. **Zero-mistakes path.** Recite perfectly. Save. Results: gauge shows 100, all three rows read `0 / N`, "Most common error" reads "No mistakes". Score-based congrats line at the top reads the high-score variant.
10. **Shuffle gating.** While recording → shuffle disabled. After stop, before Save / Reset → shuffle disabled. After Reset → shuffle enabled again.

## 7. Risks

- **Inline duplication with Recite.** RetainScreen.js will end up with ~80% of its WS-callback wiring identical to ReciteScreen.js. We accept this duplication: a shared CarouselComponent would prematurely couple two screens whose roles may diverge (e.g. Retain could later add a "no peek" mode that hides the carousel mid-recording). The single shared helper is `fetchScopeAyahs` + `countWords` + `countLetters`. Refactor to a shared component only if a third screen wants it.
- **`onStop` no longer auto-completes.** Today's behavior: stop → completeSession → navigate. New behavior: stop → linger. Users who tap the mic to stop and walk away will have an in-flight session that gets garbage-collected on next mount (the existing `useFocusEffect` cleanup calls `abandonSession`). Net: session-status `ACTIVE → ABANDONED` instead of `ACTIVE → COMPLETED` for "tap mic and leave" users. That's the correct semantics — they didn't actually save it.
- **`scopeAyahs` size.** A 30-verse range could be ~5 KB of text passed through `navigation.navigate` params. React Navigation handles this fine. Not a concern.
- **Word denominator includes basmala for non-Fatiha?** The `uthmaniText` from the backend / Al-Quran-Cloud does NOT include the leading basmala for non-Fatiha surahs (Fatiha's ayah 1 IS the basmala). So `countWords` is correct without special-casing.

## 8. Open questions

None. Carousel visibility default, save-flow direction, dummy-replacement strategy, and word-coloring inclusion all settled in the brainstorm.

## 9. Follow-ups (out of scope)

- Shared CarouselComponent if Retain and Recite stay this similar long-term.
- "Retake" button on RetainResults that pre-selects the same surah/range on Retain. Defer until Group C (session-detail re-recite is the canonical pattern; reusing it here is cheap once Group C lands).
- A Retain-only "no peek" mode that auto-hides the carousel as soon as recording starts. The current toggle satisfies it manually.

## 10. Implementation surface

| File | Change |
|---|---|
| `frontend/src/screens/RetainScreen.js` | Heavy rewrite of the render tree (carousel, WordToken, mistake panel, Save/Reset row, drop ModeTabs + single-verse box + Record toggle). ~+150 / -60 lines. |
| `frontend/src/screens/RetainResultsScreen.js` | Drop static ModeTabs, drop Short Summary, replace 3 dummy values with real computations, rename Save button. Drop the `useEffect` feedback fetch. ~+25 / -35 lines. |
| `frontend/src/utils/scopeAyahs.js` | New ~40-line helper module with `fetchScopeAyahs` + `countWords` + `countLetters`. |
| `frontend/src/screens/ReciteScreen.js` | Replace its inline `fetchScopeAyahs` (lines 53-70) with the shared one. ~+1 / -17 lines. |

Total: 3 modified + 1 new. No backend, no AI-service, no test-suite touch.
