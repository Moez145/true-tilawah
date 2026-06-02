# Retain rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Retain screen to UX parity with Recite (per-ayah RTL carousel + real-time word coloring + explicit Save flow), and replace all dummy data on RetainResults with real per-session computations.

**Architecture:** Reuse Recite's existing carousel pattern + the existing `wordStateStore` + the same WS event vocabulary (`partial_mistake` / `word_corrected` / `mistake_acknowledged`). Extract one small utility (`utils/scopeAyahs.js`) shared between Recite and Retain — three functions: `fetchScopeAyahs`, `countWords`, `countLetters`. All other duplication between the screens is left in place (premature shared abstraction would couple two screens whose roles may diverge).

**Tech Stack:** React Native 0.81 + Expo SDK 54, Zustand (`wordStateStore`), `expo-speech` (TTS, lazy-required), `react-native-reanimated` (mic anim, unchanged).

**Spec:** [docs/superpowers/specs/2026-05-18-retain-rework-design.md](../specs/2026-05-18-retain-rework-design.md)

---

## A note on testing for this plan

Same constraints as Group A: the frontend has no Jest setup. Verification per task is:

- **Pure JS helpers (Task 1)** — `node -e` one-liners against `utils/scopeAyahs.js`. Deterministic.
- **Single-file edits with no behavior change (Task 2)** — `git diff` review + Metro bundler load check.
- **UI changes (Tasks 3, 4, 5, 6)** — manual smoke on an Android dev client, scripted in Task 7.

No new test infrastructure. No new Jest config.

---

## A note on dirty working tree

When this plan runs, the working tree has ~24 unrelated dirty files (an in-flight ai-service refactor and a `getDevHost()` refactor in `frontend/src/constants/index.js`). Two tasks touch dirty files:

- **Task 2** modifies `frontend/src/screens/ReciteScreen.js` — currently dirty. The controller must `git stash push --` that file before dispatching, and `git stash pop` after the task commits. The subagent itself is told to assume the file is clean.

All other tasks touch clean files (`RetainScreen.js`, `RetainResultsScreen.js`, new files only). Subagents stage by explicit path and verify `git status --short` before committing.

---

## File structure recap

| File | Responsibility | Created/Modified |
|---|---|---|
| `frontend/src/utils/scopeAyahs.js` | Pure helpers: scope fetch + word + letter counting | NEW |
| `frontend/src/screens/ReciteScreen.js` | Use shared `fetchScopeAyahs` | Modified (1 spot) |
| `frontend/src/screens/RetainResultsScreen.js` | Drop dummies + dead UI + rename button | Modified (heavy) |
| `frontend/src/screens/RetainScreen.js` | Drop old UI + carousel + WordToken + Save flow | Modified (heavy, multiple commits) |

---

## Task 1: Add `utils/scopeAyahs.js`

**Files:**
- Create: `frontend/src/utils/scopeAyahs.js`

- [ ] **Step 1.1: Write the file**

Create `frontend/src/utils/scopeAyahs.js` with this content:

```js
import { quranService } from '../services/quranService';

// Pulls every ayah in [start, end] from the backend, falling back to
// Al-Quran-Cloud uthmani text if the backend has no rows. Returns
// [{ ayahNumber, uthmaniText, ... }, ...] — same shape both code paths.
// Reused by ReciteScreen + RetainScreen.
export async function fetchScopeAyahs(surahId, start, end) {
  try {
    const data = await quranService.getAyahRange(surahId, start, end);
    const ayahs = data?.ayahs || [];
    if (ayahs.length) return ayahs;
  } catch {}
  try {
    const res  = await fetch(`https://api.alquran.cloud/v1/surah/${surahId}/quran-uthmani`);
    const json = await res.json();
    const all  = json?.data?.ayahs || [];
    return all
      .filter(a => a.numberInSurah >= start && a.numberInSurah <= end)
      .map(a => ({ ayahNumber: a.numberInSurah, uthmaniText: a.text }));
  } catch {
    return [];
  }
}

// Sum of whitespace-separated word counts across all ayahs in the scope.
export function countWords(scopeAyahs) {
  let n = 0;
  for (const a of scopeAyahs) {
    const t = a?.uthmaniText || a?.text || '';
    n += t.split(/\s+/).filter(Boolean).length;
  }
  return n;
}

// Count Arabic letter codepoints across the scope, stripping whitespace and
// tashkeel / Quranic annotation marks. The number is an informational
// denominator on the Results screen — not a precision metric.
export function countLetters(scopeAyahs) {
  let n = 0;
  for (const a of scopeAyahs) {
    const t = a?.uthmaniText || a?.text || '';
    const stripped = t.replace(/[ً-ٰٟۖ-ۭ]/g, '');
    n += stripped.replace(/\s+/g, '').length;
  }
  return n;
}
```

- [ ] **Step 1.2: Verify the helpers via node**

Run from `frontend/`:

```bash
node -e "
const { countWords, countLetters } = require('./src/utils/scopeAyahs.js');
const ayahs = [
  { uthmaniText: 'بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ' },
  { uthmaniText: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ' },
];
console.log('words:', countWords(ayahs));
console.log('letters:', countLetters(ayahs));
console.log('words empty:', countWords([]));
console.log('letters empty:', countLetters([]));
"
```

Expected output:
```
words: 8
letters: <some integer between 35 and 60>
words empty: 0
letters empty: 0
```

The exact letter count depends on how aggressively diacritics are stripped — we don't pin a single number because the regex strips both tashkeel and Quranic annotation marks. As long as `letters` is a positive integer ≥ 30 and `letters empty` is 0, the helper is correct.

(If `node` complains about ES module syntax, fall back to `node --input-type=module -e "..."` with `import('./src/utils/scopeAyahs.js').then(m => {...})`. Same expected output.)

- [ ] **Step 1.3: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/utils/scopeAyahs.js

# Verify staged list is exactly that one file
git status --short --untracked-files=no | grep '^[AM]' || echo "(staged is correct: shows nothing because A-with-leading-space matches /^A /, see below)"
# (The above grep is approximate. The point: `git add` should only have staged this one path.)

git commit -m "$(cat <<'EOF'
feat(frontend): add utils/scopeAyahs.js — shared helpers

fetchScopeAyahs is extracted from ReciteScreen's inline copy. countWords
and countLetters compute display denominators for the RetainResults
screen (real per-session metrics, no dummies). Reused by ReciteScreen
+ RetainScreen.

Refs: docs/superpowers/specs/2026-05-18-retain-rework-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git show --stat HEAD
```

Expected `git show --stat HEAD` output: one file, `frontend/src/utils/scopeAyahs.js`, ~40 lines added, no other paths.

---

## Task 2: Wire ReciteScreen to the shared helper

**Files:**
- Modify: `frontend/src/screens/ReciteScreen.js:53-70` (replace inline `fetchScopeAyahs`)

**Pre-task action (controller, NOT the implementer):** ReciteScreen.js is dirty with unrelated in-flight work. Before dispatching, the controller runs:

```bash
cd d:/TrueTilawah
git stash push -m "preserve dirty ReciteScreen before Group B Task 2" -- frontend/src/screens/ReciteScreen.js
```

After the task commits, the controller pops the stash:

```bash
cd d:/TrueTilawah
git stash pop
```

The subagent is told `ReciteScreen.js is clean` and should verify with `git status --short frontend/src/screens/ReciteScreen.js` before editing.

- [ ] **Step 2.1: Verify the file is clean (subagent sanity check)**

```bash
cd d:/TrueTilawah
git status --short frontend/src/screens/ReciteScreen.js
```
Expected: no output (file is clean). If you see ANY output, STOP and report BLOCKED.

- [ ] **Step 2.2: Remove the inline helper**

Open `frontend/src/screens/ReciteScreen.js`. Find lines 53-70 — they look like:

```js
// Robust ayah fetcher: tries the backend first, falls back to public Quran API.
async function fetchScopeAyahs(surahId, start, end) {
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
  } catch {
    return [];
  }
}
```

**Delete the entire block** (the comment line + the function definition). Leave the blank line that follows.

- [ ] **Step 2.3: Add the import**

Find the imports block at the top of `ReciteScreen.js`. Add a new import line directly below the last `../services/...` import. Around line 22 you'll find:

```js
import { useWordStateStore, WordState } from '../services/wordStateStore';
```

Immediately AFTER it, add:

```js
import { fetchScopeAyahs } from '../utils/scopeAyahs';
```

Save the file. The `fetchScopeAyahs` calls elsewhere in the file (in the `useEffect` that runs when the scope changes) continue to work — they were already calling the local function with the same signature.

- [ ] **Step 2.4: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/ReciteScreen.js
```

Expected diff: two regions —
1. One added import line near the top.
2. ~18 deleted lines (the comment + the function) somewhere around line 53.

No other changes.

- [ ] **Step 2.5: Stage explicitly and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/ReciteScreen.js
git status --short --untracked-files=no | head -5
```

Expected first line: `M  frontend/src/screens/ReciteScreen.js` (with `M` in the FIRST column = staged). All other lines should have ` M` (space + M = unstaged). If you see ANY other file with `M` in the first column, STOP and run `git restore --staged <path>` for it.

```bash
git commit -m "$(cat <<'EOF'
refactor(frontend): ReciteScreen uses shared fetchScopeAyahs

Replaces the inline helper with the new utils/scopeAyahs.js import.
Behavior unchanged; this prepares Retain to reuse the same fetcher
without duplicating it a third time.

Refs: docs/superpowers/specs/2026-05-18-retain-rework-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```

Expected: one file changed, roughly `+1 -18` lines.

---

## Task 3: RetainResultsScreen — drop dummies + dead UI, real data

**Files:**
- Modify: `frontend/src/screens/RetainResultsScreen.js`

- [ ] **Step 3.1: Verify the file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/screens/RetainResultsScreen.js
```
Expected: no output.

- [ ] **Step 3.2: Update the imports**

Open `frontend/src/screens/RetainResultsScreen.js`. Find the imports at the top:

```js
import { Bookmark, Layers, Shuffle, ChevronDown } from 'lucide-react-native';
import Header from '../components/common/Header';
import { feedbackService } from '../services/feedbackService';
import { COLORS } from '../constants';
```

Replace with:

```js
import { ArrowLeft, Layers, Shuffle, ChevronDown } from 'lucide-react-native';
import Header from '../components/common/Header';
import { COLORS } from '../constants';
```

(Drop the `Bookmark` icon, drop the `feedbackService` import, add `ArrowLeft`.)

Also at the top, remove the `useEffect`, `useState` import if they're only used for `feedbackCount`. Check the existing import:

```js
import React, { useEffect, useState } from 'react';
```

Replace with (we no longer need `useEffect` or `useState`):

```js
import React from 'react';
```

- [ ] **Step 3.3: Add the inline count helpers**

Find the line `const ERROR_LABEL = {` near the top of the file. Insert TWO new helper functions immediately ABOVE it:

```js
// Count letter-level mistakes (TAJWEED_VIOLATION + MISPRONUNCIATION).
function countLetterMistakes(mistakes) {
  let n = 0;
  for (const m of mistakes) {
    if (m?.type === 'TAJWEED_VIOLATION' || m?.type === 'MISPRONUNCIATION') n++;
  }
  return n;
}

// Count word-level mistakes (MISPRONUNCIATION + OMITTED_WORD + ADDED_WORD).
function countWordMistakes(mistakes) {
  let n = 0;
  for (const m of mistakes) {
    if (m?.type === 'MISPRONUNCIATION' || m?.type === 'OMITTED_WORD' || m?.type === 'ADDED_WORD') n++;
  }
  return n;
}

const ERROR_LABEL = {
  ...
```

(Keep the existing `ERROR_LABEL` block exactly as-is.)

- [ ] **Step 3.4: Rewrite the component body**

Find the `export default function RetainResultsScreen({ navigation, route }) {` definition. Replace the entire function body — from the opening `{` after the parameter list to the closing `}` of the `return` — with:

```jsx
export default function RetainResultsScreen({ navigation, route }) {
  const params = route?.params || {};
  const score        = params.accuracyScore ?? 0;
  const surahNameAr  = params.surahNameAr || '—';
  const verseRange   = params.verseRange || [1, 1];
  const mostCommonError = params.mostCommonError;
  const mistakes     = Array.isArray(params.mistakes) ? params.mistakes : [];
  const totalWords   = Number.isFinite(params.totalWords)   ? params.totalWords   : null;
  const totalLetters = Number.isFinite(params.totalLetters) ? params.totalLetters : null;
  const [a, b] = verseRange;

  const letterMistakeCount = countLetterMistakes(mistakes);
  const wordMistakeCount   = countWordMistakes(mistakes);
  const alphabetsValue = totalLetters != null
    ? `${letterMistakeCount} / ${totalLetters}`
    : `${letterMistakeCount}`;
  const wordsValue = totalWords != null
    ? `${wordMistakeCount} / ${totalWords}`
    : `${wordMistakeCount}`;
  const mostCommonLabel = mostCommonError && ERROR_LABEL[mostCommonError]
    ? ERROR_LABEL[mostCommonError]
    : (mistakes.length > 0 ? 'Mixed' : 'No mistakes');

  // Pick a green-ish or amber-ish color so positive values don't all read as
  // "good" when they should read as "needs work".
  const fewMistakes = (n) => n === 0 ? '#22C55E' : n < 5 ? '#22C55E' : '#F97316';

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <Header title="True Tilawah" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.subTitle}>Retain Quran: Random Test</Text>

        {/* Surah selector (mirrors RetainScreen) */}
        <View style={s.surahSel}>
          <View style={s.shuffleBtn}><Shuffle size={22} color={COLORS.primary} /></View>
          <View style={s.surahNameRow}>
            <Text style={s.surahAr}>{surahNameAr}</Text>
            <ChevronDown size={20} color={COLORS.gray400} />
          </View>
          <View style={s.verseBadge}><Text style={s.verseBadgeTxt}>Verses {a} – {b}</Text></View>
        </View>

        <Text style={s.congrats}>{congratsFor(score)}</Text>

        <Gauge score={score} />

        {/* Results — all three rows are real per-session data */}
        <View style={s.results}>
          <ResultRow icon="ظ"  label="Alphabets mistakes"
            value={alphabetsValue} valueColor={fewMistakes(letterMistakeCount)} />
          <ResultRow icon={<Layers size={18} color={COLORS.gray600} />}
            label="Words mistakes"
            value={wordsValue} valueColor={fewMistakes(wordMistakeCount)} />
          <ResultRow icon={<Layers size={18} color={COLORS.gray600} />}
            label="Most common error"
            value={mostCommonLabel}
            valueColor={mistakes.length > 0 ? COLORS.orange : '#22C55E'} small />
        </View>

        <TouchableOpacity style={s.saveBtn}
          onPress={() => navigation.navigate('Main', { screen: 'MainTabs', params: { screen: 'Retain' } })}
          activeOpacity={0.85}>
          <ArrowLeft size={20} color={COLORS.primary} />
          <Text style={s.saveTxt}>Back to Retain</Text>
        </TouchableOpacity>
        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
```

Notes about what's removed:
- The `const score = params.accuracyScore ?? 93;` becomes `?? 0` (no fake 93 fallback).
- The `surahNameAr` fallback `|| 'الكهف'` becomes `'—'`.
- The `verseRange` fallback `|| [66, 88]` becomes `[1, 1]`.
- The static mode tabs block is GONE.
- The "Short Summary" button is GONE.
- The `useEffect` that fetched `feedbackService.getSessionFeedback` is GONE.
- The `feedbackCount` state is GONE.
- The hardcoded `"59 / 2303"` and `'10 / 319'` and `'Addition of "waw" before verses'` are all GONE.

- [ ] **Step 3.5: Remove now-unused styles from the StyleSheet**

In the styles block at the bottom (`const s = StyleSheet.create({...})`), find and REMOVE these entries (they were used by the deleted mode tabs and Summary button):

```js
modeTabs:         { ... },
modeTab:          { ... },
modeTabActive:    { ... },
modeTabTxt:       { ... },
modeTabTxtActive: { ... },
summaryBtn:       { ... },
summaryTxt:       { ... },
```

Leave all other style entries untouched.

- [ ] **Step 3.6: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/RetainResultsScreen.js
```

Expected: significant changes (~50 line deletions + ~25 line additions). Confirm:
- No `ModeTabs` JSX anywhere.
- No `summaryBtn` / `summaryTxt` styles.
- No `feedbackService` / `useEffect` / `useState` imports.
- The button at the bottom reads "Back to Retain" with an `ArrowLeft` icon.
- The three result rows pass `alphabetsValue`, `wordsValue`, `mostCommonLabel` (not hardcoded strings).

- [ ] **Step 3.7: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/RetainResultsScreen.js
git status --short --untracked-files=no | head -5
```

Expected first line: `M  frontend/src/screens/RetainResultsScreen.js`. All others ` M` (unstaged).

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): RetainResults — real per-session data, drop dead UI

Drops the static Record/Write mode tabs (vestigial decoration), the
dead Short Summary button (no onPress), and the feedbackService roundtrip
that always fell back to dummy text. All three result rows now compute
from the mistakes array passed from RetainScreen:
  - Alphabets = TAJWEED_VIOLATION + MISPRONUNCIATION
  - Words     = MISPRONUNCIATION + OMITTED_WORD + ADDED_WORD
  - Most common = real, with "Mixed" or "No mistakes" honest fallbacks
"Save your progress" → "Back to Retain" (no fake-save semantics).

Refs: docs/superpowers/specs/2026-05-18-retain-rework-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```

Expected: one file, roughly `+30 / -60` lines.

---

## Task 4: RetainScreen — remove vestigial UI

**Files:**
- Modify: `frontend/src/screens/RetainScreen.js`

This task is *removals only*. After it lands, the screen still compiles and runs with reduced UI. Tasks 5–6 add the new content.

- [ ] **Step 4.1: Verify the file is clean**

```bash
cd d:/TrueTilawah
git status --short frontend/src/screens/RetainScreen.js
```
Expected: no output.

- [ ] **Step 4.2: Delete the ModeTabs component definition**

Find lines 17-27 of `frontend/src/screens/RetainScreen.js`:

```jsx
function ModeTabs({ mode, onChange }) {
  return (
    <View style={s.modeTabs}>
      {['record', 'write'].map(m => (
        <TouchableOpacity key={m} style={[s.modeTab, mode === m && s.modeTabActive]} onPress={() => onChange(m)} activeOpacity={0.85}>
          <Text style={[s.modeTabTxt, mode === m && s.modeTabTxtActive]}>{m.charAt(0).toUpperCase() + m.slice(1)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
```

Delete the entire function definition.

- [ ] **Step 4.3: Delete the `mode` state**

Find this line near the top of the component (around line 33):

```js
const [mode,         setMode]         = useState('record');
```

Delete it.

- [ ] **Step 4.4: Delete the `startingVerse` state**

Find this line (around line 38):

```js
const [startingVerse, setStartingVerse] = useState(null);
```

Delete it.

- [ ] **Step 4.5: Remove the starting-verse fetch from `pickRandom`**

In the `pickRandom` function (around lines 82-98), find this block at the end:

```js
    setStartingVerse(null);
    if (showStarting) {
      try {
        const data = await quranService.getAyahsBySurah(random.surahNumber);
        const first = data?.ayahs?.find(a => a.ayahNumber === start);
        if (first) setStartingVerse(first);
      } catch {}
    }
```

Delete the entire block (the `setStartingVerse(null);` line and the `if (showStarting) {...}` block). Leave the rest of `pickRandom` intact.

- [ ] **Step 4.6: Rename `showStarting` → `showVerses`**

Find the state declaration:

```js
const [showStarting, setShowStarting] = useState(true);
```

Replace with:

```js
const [showVerses, setShowVerses] = useState(true);
```

Then find the toggle render site (around line 290):

```jsx
<View style={s.toggleItem}>
  <Text style={s.toggleLbl}>Show starting verse</Text>
  <Switch value={showStarting} onValueChange={setShowStarting}
    trackColor={{ false: COLORS.gray200, true: COLORS.secondary }} thumbColor={COLORS.white} />
</View>
```

Replace with:

```jsx
<View style={s.toggleItem}>
  <Text style={s.toggleLbl}>Show verses</Text>
  <Switch value={showVerses} onValueChange={setShowVerses}
    trackColor={{ false: COLORS.gray200, true: COLORS.secondary }} thumbColor={COLORS.white} />
</View>
```

- [ ] **Step 4.7: Delete the ModeTabs render site + the Record toggle + the single-verse box**

Find this block in the return JSX (around lines 271-308):

```jsx
        <ModeTabs mode={mode} onChange={setMode} />

        {/* Surah selector */}
        <View style={s.surahSel}>
          ...
```

Delete just the `<ModeTabs ... />` line. Keep the surah selector block.

Then find the "Record" toggle within the toggleRow (around lines 294-298):

```jsx
<View style={s.toggleItem}>
  <Text style={s.toggleLbl}>Record</Text>
  <Switch value={isRecording} onValueChange={onToggleRecord}
    trackColor={{ false: COLORS.gray200, true: COLORS.secondary }} thumbColor={COLORS.white} />
</View>
```

Delete the entire `<View style={s.toggleItem}>` block for the Record toggle. The `showVerses` toggle stays.

After deleting the Record toggle, the `toggleRow` now only contains one item. Update its style so it doesn't have `justifyContent: 'space-between'` stretching one element across the row. Find this style:

```js
toggleRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
```

Replace with:

```js
toggleRow:        { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 22 },
```

(Single toggle pinned to the right.)

Then find the starting-verse box block (around lines 302-308):

```jsx
        {/* Starting verse */}
        {showStarting && startingVerse && (
          <View style={s.verseBox}>
            <Text style={s.verseTxt}>
              {startingVerse.uthmaniText} ({startingVerse.ayahNumber})
            </Text>
          </View>
        )}
```

Delete the entire block.

- [ ] **Step 4.8: Delete the `onToggleRecord` function**

Find this function (around lines 248-251):

```js
const onToggleRecord = (val) => {
  if (val && !isRecording) onStart();
  else if (!val && isRecording) onStop();
};
```

Delete it.

- [ ] **Step 4.9: Remove unused style entries**

In the styles block at the bottom, REMOVE these (they were used by deleted UI):

```js
modeTabs:         { ... },
modeTab:          { ... },
modeTabActive:    { ... },
modeTabTxt:       { ... },
modeTabTxtActive: { ... },
verseBox:         { ... },
verseTxt:         { ... },
```

Leave all other style entries untouched.

- [ ] **Step 4.10: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/RetainScreen.js
```

Expected: roughly `+5 / -55` lines. Confirm:
- No `function ModeTabs` definition.
- No `mode` / `startingVerse` state references anywhere.
- No `<ModeTabs ... />` in JSX.
- No "Record" Switch.
- No `verseBox` JSX block.
- `showVerses` is the only toggle.
- `modeTabs*` and `verseBox*` styles are gone.

The file should still be syntactically valid React. If you import anything that's now unused (e.g. `quranService` is still used by the outer `useEffect`, so keep it), leave it alone. The next tasks will use most of the existing imports.

- [ ] **Step 4.11: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/RetainScreen.js
git status --short --untracked-files=no | head -5
```

Expected first line: `M  frontend/src/screens/RetainScreen.js`. All others ` M` (unstaged). If you see any other `M ` (with `M` in first column), STOP and run `git restore --staged <path>`.

```bash
git commit -m "$(cat <<'EOF'
refactor(frontend): RetainScreen — drop Record/Write tabs + vestigial UI

Removes the ModeTabs component (Write mode never branched in code),
the Record toggle (the mic button is the only start/stop affordance),
the single-ayah starting-verse hint box, and the associated state +
styles. showStarting → showVerses in anticipation of the carousel that
Task 5 adds.

Carousel + Save flow + word coloring land in subsequent commits.

Refs: docs/superpowers/specs/2026-05-18-retain-rework-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```

Expected: one file, roughly `+5 / -55` lines.

---

## Task 5: RetainScreen — add carousel + WordToken + scopeAyahs fetch

**Files:**
- Modify: `frontend/src/screens/RetainScreen.js`

This task adds the ayah carousel with per-word coloring (`WordToken` subscribed to `wordStateStore`). It also adds the `scopeAyahs` state and replaces `pickRandom`'s single-ayah fetch with the shared `fetchScopeAyahs`. After this task, the carousel renders correctly but words won't actually turn red yet — that's Task 6 (streaming event wiring).

- [ ] **Step 5.1: Add new imports**

Open `frontend/src/screens/RetainScreen.js`. Find the imports block at the top. Update / add:

Replace the current `react-native` import:
```js
import { View, Text, TouchableOpacity, ScrollView, Switch, StyleSheet, Alert } from 'react-native';
```
with (add `FlatList`, `Dimensions`):
```js
import { View, Text, TouchableOpacity, ScrollView, Switch, StyleSheet, Alert, FlatList, Dimensions, ActivityIndicator } from 'react-native';
```

Replace the lucide import:
```js
import { Shuffle, ChevronDown, Mic } from 'lucide-react-native';
```
with (add carousel-nav + mistake-icon icons):
```js
import { Shuffle, ChevronDown, Mic, ChevronLeft, ChevronRight, BookOpen, AlertCircle, Minus, Plus, Star } from 'lucide-react-native';
```

Below the existing `import { COLORS } from '../constants';` line, add:

```js
import { FONTS } from '../constants';
import { fetchScopeAyahs } from '../utils/scopeAyahs';
import { useWordStateStore, WordState } from '../services/wordStateStore';
```

(Note: if there's already an `import { COLORS } from '../constants';`, replace it with `import { COLORS, FONTS } from '../constants';` and remove the separate FONTS import line.)

- [ ] **Step 5.2: Add module-level constants**

Below the existing imports, BEFORE the `ModeTabs` deletion is now empty / before the existing `ERROR_TYPES` array, add:

```js
const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.min(SCREEN_W - 72, 340);
const CARD_GAP = 14;
const SNAP = CARD_W + CARD_GAP;
const SIDE_PAD = (SCREEN_W - CARD_W) / 2;

// Per-word colour mapping — same as ReciteScreen. The wordStateStore is a
// Zustand store keyed by (ayah, wordIndex) and is reset at the start of each
// recording.
const WORD_STATE_COLOUR = {
  [WordState.Pending]:      COLORS.primary,
  [WordState.Correct]:      COLORS.wordCorrected,
  [WordState.Mistake]:      COLORS.wordMistake,
  [WordState.Corrected]:    COLORS.wordCorrected,
  [WordState.Acknowledged]: COLORS.wordAcknowledged,
};

// One word in the carousel. Re-renders only when its own state in the store
// changes — Zustand selector granularity keeps the rest of the card stable.
const WordToken = React.memo(function WordToken({ ayah, wordIdx, text }) {
  const state = useWordStateStore((s) => (s.states[ayah] || {})[wordIdx] || WordState.Pending);
  return (
    <Text style={[s.ayahArabicWord, { color: WORD_STATE_COLOUR[state] }]}>
      {text}
    </Text>
  );
});

function clamp(n, lo, hi) {
  n = Number.isFinite(+n) ? +n : lo;
  return Math.min(Math.max(n, lo), hi);
}
```

(Note: `React` is already imported at the top. If your linter complains about `React.memo`, the existing `import React, { ... } from 'react'` should already cover it.)

- [ ] **Step 5.3: Add `scopeAyahs` + `currentIdx` state, and a carousel ref**

Inside the `RetainScreen` component, just below the existing state declarations (after `verseRange`, `isDemo`, etc.), add:

```js
const [scopeAyahs,   setScopeAyahs]   = useState([]);
const [ayahsLoading, setAyahsLoading] = useState(false);
const [currentIdx,   setCurrentIdx]   = useState(0);
const carouselRef = useRef(null);
```

- [ ] **Step 5.4: Replace `pickRandom` to fetch the full scope**

Find the existing `pickRandom` function (now shorter after Task 4):

```js
const pickRandom = async () => {
  if (!surahs.length) return;
  const random = surahs[Math.floor(Math.random() * surahs.length)];
  setSurah(random);
  const total = random.totalAyahs || 7;
  const start = Math.max(1, Math.min(total - 5, Math.floor(Math.random() * total) + 1));
  const end   = Math.min(total, start + Math.min(20, total - start));
  setVerseRange([start, end]);
};
```

Replace with:

```js
const pickRandom = async () => {
  if (!surahs.length) return;
  const random = surahs[Math.floor(Math.random() * surahs.length)];
  setSurah(random);
  const total = random.totalAyahs || 7;
  const start = Math.max(1, Math.min(total - 5, Math.floor(Math.random() * total) + 1));
  const end   = Math.min(total, start + Math.min(20, total - start));
  setVerseRange([start, end]);
  setCurrentIdx(0);
  setAyahsLoading(true);
  try {
    const ayahs = await fetchScopeAyahs(random.surahNumber, start, end);
    setScopeAyahs(ayahs);
  } catch {
    setScopeAyahs([]);
  } finally {
    setAyahsLoading(false);
  }
};
```

- [ ] **Step 5.5: Add the carousel navigation helper**

Below `pickRandom` (or wherever fits in your existing function ordering), add:

```js
const goToIdx = (idx) => {
  const i = clamp(idx, 0, Math.max(0, scopeAyahs.length - 1));
  setCurrentIdx(i);
  carouselRef.current?.scrollToOffset({ offset: i * SNAP, animated: true });
};
```

- [ ] **Step 5.6: Render the carousel**

Find the ScrollView's children block. After the `toggleRow` and BEFORE the `micWrap`, insert the carousel block:

```jsx
{/* Ayah carousel */}
{showVerses && (
  <View style={s.carouselWrap}>
    {!surah ? (
      <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
        <BookOpen size={36} color={COLORS.gray300} />
        <Text style={s.placeholderTitle}>No surah selected</Text>
        <Text style={s.placeholderSub}>Tap the shuffle button to pick one.</Text>
      </View>
    ) : ayahsLoading ? (
      <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={s.placeholderSub}>Loading verses…</Text>
      </View>
    ) : scopeAyahs.length === 0 ? (
      <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
        <Text style={s.placeholderTitle}>Couldn't load verses</Text>
        <Text style={s.placeholderSub}>Try a different surah.</Text>
      </View>
    ) : (
      <>
        <FlatList
          ref={carouselRef}
          data={scopeAyahs}
          keyExtractor={(it, idx) => String(it.ayahNumber ?? it.id ?? idx)}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={SNAP}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: SIDE_PAD - CARD_GAP / 2 }}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SNAP);
            setCurrentIdx(clamp(idx, 0, scopeAyahs.length - 1));
          }}
          renderItem={({ item, index }) => {
            const isActive = index === currentIdx;
            return (
              <View style={[s.cardOuter, { width: CARD_W, marginHorizontal: CARD_GAP / 2 }]}>
                <View style={[s.ayahCard, !isActive && s.ayahCardFaded]}>
                  <View style={s.ayahCardHeader}>
                    <View style={s.ayahNumPill}>
                      <Text style={s.ayahNumTxt}>Ayah {item.ayahNumber}</Text>
                    </View>
                    <Text style={s.ayahCount}>{index + 1} / {scopeAyahs.length}</Text>
                  </View>
                  <View style={s.ayahArabicWrap}>
                    {((item.uthmaniText || item.text || '').split(/\s+/).filter(Boolean)).map((w, wi) => (
                      <WordToken
                        key={`${item.ayahNumber}-${wi}`}
                        ayah={item.ayahNumber}
                        wordIdx={wi}
                        text={w}
                      />
                    ))}
                  </View>
                </View>
              </View>
            );
          }}
        />
        {scopeAyahs.length > 1 && (
          <View style={s.navRow}>
            <TouchableOpacity
              onPress={() => goToIdx(currentIdx - 1)}
              disabled={currentIdx === 0}
              style={[s.navBtn, currentIdx === 0 && s.navBtnDis]}
              hitSlop={6}
            >
              <ChevronLeft size={20} color={currentIdx === 0 ? COLORS.gray300 : COLORS.primary} />
            </TouchableOpacity>
            <Text style={s.navTxt}>Ayah {scopeAyahs[currentIdx]?.ayahNumber}</Text>
            <TouchableOpacity
              onPress={() => goToIdx(currentIdx + 1)}
              disabled={currentIdx >= scopeAyahs.length - 1}
              style={[s.navBtn, currentIdx >= scopeAyahs.length - 1 && s.navBtnDis]}
              hitSlop={6}
            >
              <ChevronRight size={20} color={currentIdx >= scopeAyahs.length - 1 ? COLORS.gray300 : COLORS.primary} />
            </TouchableOpacity>
          </View>
        )}
      </>
    )}
  </View>
)}
```

- [ ] **Step 5.7: Add the carousel styles**

In the styles block at the bottom, ADD these new entries (insert near the existing `verseBadge*` entries for grouping):

```js
// Carousel
carouselWrap:    { marginTop: 4, marginBottom: 16 },
cardOuter:       { },
ayahCard:        { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray100, borderRadius: 22, padding: 18, minHeight: 200, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 4 },
ayahCardFaded:   { opacity: 0.32, transform: [{ scale: 0.94 }] },
ayahCardHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
ayahNumPill:     { backgroundColor: COLORS.secondaryUltraLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
ayahNumTxt:      { fontSize: 11, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.4 },
ayahCount:       { fontSize: 10, fontWeight: '700', color: COLORS.gray400, letterSpacing: 0.6 },
ayahArabicWrap:  { flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' },
ayahArabicWord:  { fontFamily: FONTS.quran, fontSize: 26, lineHeight: 54, marginHorizontal: 4, writingDirection: 'rtl' },

placeholderCard: { backgroundColor: COLORS.white, borderRadius: 22, borderWidth: 1, borderColor: COLORS.gray100, borderStyle: 'dashed', padding: 24, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
placeholderTitle:{ fontSize: 14, fontWeight: '700', color: COLORS.gray500 },
placeholderSub:  { fontSize: 12, color: COLORS.gray400, textAlign: 'center' },

navRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 4 },
navBtn:          { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
navBtnDis:       { backgroundColor: COLORS.gray100 },
navTxt:          { fontSize: 12, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.6, textTransform: 'uppercase', minWidth: 80, textAlign: 'center' },
```

- [ ] **Step 5.8: Reset wordStateStore on screen mount + before each pickRandom**

Find the existing `useEffect` near the top of the component that loads surahs. Add a new `useEffect` immediately after it that resets the wordStateStore once on mount:

```js
useEffect(() => {
  useWordStateStore.getState().reset();
}, []);
```

Then in `pickRandom`, BEFORE the surah-selection logic, add:

```js
useWordStateStore.getState().reset();
```

So the function starts:
```js
const pickRandom = async () => {
  if (!surahs.length) return;
  useWordStateStore.getState().reset();
  const random = surahs[Math.floor(Math.random() * surahs.length)];
  ...
```

(This is defensive — if the user shuffles after recording, last session's red/green carries over otherwise.)

- [ ] **Step 5.9: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/RetainScreen.js
```

Expected: significant additions (~120 lines), few deletions. Confirm:
- `Dimensions`, `FlatList`, `ActivityIndicator`, `ChevronLeft`, `ChevronRight`, `BookOpen` imports added.
- `FONTS`, `fetchScopeAyahs`, `useWordStateStore`, `WordState` imports added.
- Module-level `SCREEN_W`, `CARD_W`, `SNAP`, `WORD_STATE_COLOUR`, `WordToken`, `clamp` constants exist.
- `scopeAyahs`, `ayahsLoading`, `currentIdx` state added.
- `pickRandom` now calls `fetchScopeAyahs`.
- New carousel JSX block exists between toggleRow and micWrap.
- New carousel styles exist in the styles block.

- [ ] **Step 5.10: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/RetainScreen.js
git status --short --untracked-files=no | head -5
```

Verify only that one file is staged with `M ` in the first column.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): RetainScreen — add ayah carousel with WordToken

Adds a horizontal RTL-snap carousel showing every ayah in the selected
scope. Each word is a WordToken subscribed to wordStateStore (the same
Zustand store ReciteScreen uses). Words start in Pending (primary color);
real-time coloring driven by streaming WS events is wired in the next
commit.

scopeAyahs is fetched via the shared utils/scopeAyahs.js helper. The
existing "Show verses" toggle (renamed from showStarting in the previous
commit) gates carousel visibility.

Refs: docs/superpowers/specs/2026-05-18-retain-rework-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```

Expected: one file, roughly `+150 / -10` lines.

---

## Task 6: RetainScreen — streaming event wiring + Save/Reset flow

**Files:**
- Modify: `frontend/src/screens/RetainScreen.js`

Final RetainScreen task. Adds: streaming-event callback wiring (red/green word coloring), TTS via `expo-speech`, inline mistake panel below the mic, and the Save/Reset bottom button row. `onStop` no longer auto-completes the session; `handleSave` does that explicitly.

- [ ] **Step 6.1: Add `expo-speech` lazy require + `speakWord`**

Find the existing import block at the top. Below the imports, add:

```js
// Optional TTS — gracefully degrades if expo-speech isn't installed (it is, per Group A).
let Speech = null;
try { Speech = require('expo-speech'); } catch { Speech = null; }
function rawSpeak(text, opts) {
  if (!text || !Speech?.speak) return;
  try { Speech.speak(String(text), { language: 'ar', rate: 0.85, ...opts }); } catch {}
}
```

- [ ] **Step 6.2: Add mistake-icon helpers**

Below the `WORD_STATE_COLOUR` const (which already exists from Task 5), add:

```js
function MistakeIcon({ type }) {
  switch (type) {
    case 'OMITTED_WORD':     return <Minus size={16} color={COLORS.gray500} />;
    case 'ADDED_WORD':       return <Plus size={16} color={COLORS.orange} />;
    case 'TAJWEED_VIOLATION':return <Star size={16} color={COLORS.yellow} />;
    case 'MISPRONUNCIATION':
    default:                 return <AlertCircle size={16} color={COLORS.red} />;
  }
}
const TYPE_LABELS = {
  MISPRONUNCIATION:   'Mispronunciation',
  OMITTED_WORD:       'Omitted Word',
  ADDED_WORD:         'Extra Word',
  TAJWEED_VIOLATION:  'Tajweed',
};
```

Also add the helpers from the spec (place near `clamp`):

```js
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

- [ ] **Step 6.3: Add `mistakes`, `speakingWord`, `saving` state**

Inside the `RetainScreen` component, near the existing state block, add:

```js
const [mistakes,     setMistakes]     = useState([]);
const [speakingWord, setSpeakingWord] = useState(null);
const [saving,       setSaving]       = useState(false);
const speakingTimerRef = useRef(null);
```

Drop `mistakeCountsRef` — it's no longer needed (counts derived from `mistakes` array).

In the `onStart` function, find:

```js
mistakeCountsRef.current = {};
```

Replace with (you may need to scope adjust the surrounding lines):

```js
setMistakes([]);
useWordStateStore.getState().reset();
```

- [ ] **Step 6.4: Add `speakWord`**

Add this function inside the component:

```js
const speakWord = useCallback((text) => {
  if (!text) return;
  setSpeakingWord(text);
  if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
  rawSpeak(text, {
    onDone:    () => setSpeakingWord(null),
    onStopped: () => setSpeakingWord(null),
    onError:   () => setSpeakingWord(null),
  });
  speakingTimerRef.current = setTimeout(() => setSpeakingWord(null), 3500);
}, []);
```

- [ ] **Step 6.5: Replace `wireCallbacks` with the full Recite-style handler**

Find the existing `wireCallbacks` function:

```js
const wireCallbacks = () => {
  audioStreamService.setCallbacks(
    (msg) => {
      if (msg?.type !== 'mistake' || !Array.isArray(msg.mistakes)) return;
      for (const m of msg.mistakes) {
        const t = m?.type;
        if (!t) continue;
        mistakeCountsRef.current[t] = (mistakeCountsRef.current[t] || 0) + 1;
      }
    },
    (_connected) => {},
    (_finalReport) => {},
  );
};
```

Replace entirely with:

```js
const wireCallbacks = () => {
  audioStreamService.setCallbacks(
    (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'partial_mistake') {
        const ayah = msg.ayah;
        const wi   = msg.word_index;
        const correct = msg.mistake?.correct;
        if (typeof ayah === 'number' && typeof wi === 'number') {
          useWordStateStore.getState().setState(ayah, wi, WordState.Mistake);
        }
        if (correct) speakWord(correct);
        setMistakes((prev) => [{
          type:        msg.mistake?.type || 'MISPRONUNCIATION',
          incorrect:   msg.mistake?.incorrect   || '',
          correct:     msg.mistake?.correct     || '',
          tajweedRule: msg.mistake?.tajweedRule || null,
          severity:    msg.mistake?.severity    || null,
          tip:         msg.mistake?.tip         || '',
          ayah,
          ts: Date.now(),
        }, ...prev].slice(0, 20));
        return;
      }
      if (msg.type === 'word_corrected') {
        const ayah = msg.ayah, wi = msg.word_index;
        if (typeof ayah === 'number' && typeof wi === 'number') {
          useWordStateStore.getState().setState(ayah, wi, WordState.Corrected);
        }
        return;
      }
      if (msg.type === 'word_correct') {
        const ayah = msg.ayah, wi = msg.word_index;
        if (typeof ayah === 'number' && typeof wi === 'number') {
          useWordStateStore.getState().setState(ayah, wi, WordState.Correct);
        }
        return;
      }
      if (msg.type === 'mistake_acknowledged') {
        const ayah = msg.ayah, wi = msg.word_index;
        if (typeof ayah === 'number' && typeof wi === 'number') {
          useWordStateStore.getState().setState(ayah, wi, WordState.Acknowledged);
        }
        return;
      }
      if (msg.type === 'mistake' && Array.isArray(msg.mistakes)) {
        const stamped = msg.mistakes.map((m) => ({
          type:        m.type        || 'MISPRONUNCIATION',
          incorrect:   m.incorrect   || '',
          correct:     m.correct     || '',
          tajweedRule: m.tajweedRule  || null,
          severity:    m.severity     || null,
          tip:         m.tip          || (msg.message ?? ''),
          ayah:        msg.ayah ?? null,
          ts:          Date.now(),
        }));
        setMistakes((prev) => [...stamped.reverse(), ...prev].slice(0, 20));
        stamped.forEach((m) => { if (m.correct) speakWord(m.correct); });
      } else if (msg.type === 'unclear' || msg.type === 'out_of_scope') {
        setMistakes((prev) => [{
          type: 'MISPRONUNCIATION',
          incorrect: '', correct: '', tajweedRule: null, severity: null,
          tip: msg.message
            || (msg.type === 'unclear'
                ? "Could not hear that clearly — please try again."
                : "That doesn't seem to match the ayahs you selected."),
          ayah: msg.ayah ?? null, ts: Date.now(),
        }, ...prev].slice(0, 20));
      } else if (msg.type === 'error') {
        Alert.alert(
          'Analysis problem',
          msg.message
            ? `The recitation engine reported: ${msg.message}`
            : 'The recitation engine had a problem. Please tap the mic again to retry.',
        );
      }
    },
    (_connected) => {},
    (_finalReport) => {},
  );
};
```

- [ ] **Step 6.6: Replace `onStop` so it no longer auto-completes the session**

Find the existing `onStop` function. Replace entirely with:

```js
const onStop = async () => {
  stopAnims();
  setIsRecording(false);
  // Stop the audio stream but do NOT complete the session. The user will
  // tap Save Session (commits + navigates) or Reset (abandons + clears).
  await cleanupRecording({ abandon: false });
};
```

The previous `onStop` did all the navigation + completeSession work — that moves into `handleSave` next.

- [ ] **Step 6.7: Add `handleSave`**

Add this function inside the component:

```js
const handleSave = async () => {
  if (!sessionRef.current) {
    Alert.alert('Info', 'Start recording first');
    return;
  }
  setSaving(true);
  try {
    if (isRecordingRef.current) {
      stopAnims();
      setIsRecording(false);
      await cleanupRecording({ abandon: false });
    }
    const session = sessionRef.current;
    const counts = countByType(mistakes);
    const totalMistakes = mistakes.length;
    const accuracyScore = clamp(Math.round(100 - totalMistakes * 4), 0, 100);
    const mostCommonError = pickMostCommon(counts);

    try {
      await sessionService.completeSession(session.id, {
        transcript: '',
        accuracyScore,
      });
    } catch {
      // Even if completion fails, still navigate so user sees results.
    }

    // Compute denominators from the fetched scope.
    const { countWords, countLetters } = require('../utils/scopeAyahs');
    const totalWords   = countWords(scopeAyahs);
    const totalLetters = countLetters(scopeAyahs);

    sessionRef.current = null;
    navigation.navigate('RetainResults', {
      sessionId: session.id,
      surahId:   surah?.surahNumber,
      surahName: surah?.surahName,
      surahNameAr: surah?.surahNameAr,
      verseRange,
      accuracyScore,
      mistakes,           // pass full array; Results computes letter/word counts
      mistakeCounts: counts,
      mostCommonError,
      totalWords,
      totalLetters,
    });
  } catch (err) {
    Alert.alert('Error', err?.message || 'Failed to save session');
  } finally {
    setSaving(false);
  }
};
```

(Note: the `require` inside the function is a small concession to avoid a circular-import worry. If the top-of-file import works fine in Metro — which it should, since the helper module has no React imports — you can hoist `import { countWords, countLetters } from '../utils/scopeAyahs';` to the top with `fetchScopeAyahs` instead. Either is fine.)

Actually let's keep it simple and hoist the imports. Find the existing line:
```js
import { fetchScopeAyahs } from '../utils/scopeAyahs';
```
Replace with:
```js
import { fetchScopeAyahs, countWords, countLetters } from '../utils/scopeAyahs';
```

Then in `handleSave`, remove the inline `require` and the `const { countWords, countLetters } = require(...);` line. Use `countWords(scopeAyahs)` and `countLetters(scopeAyahs)` directly.

- [ ] **Step 6.8: Add `handleReset`**

Add this function inside the component:

```js
const handleReset = async () => {
  if (isRecordingRef.current) {
    stopAnims();
    setIsRecording(false);
    await cleanupRecording({ abandon: true });
  }
  setMistakes([]);
  useWordStateStore.getState().reset();
  setSpeakingWord(null);
};
```

- [ ] **Step 6.9: Add the "speaking now" indicator + mistake panel + Reset/Save buttons**

Find the end of the existing `<View style={s.micWrap}>` block in the JSX. After the closing `</View>` of micWrap, ADD these three blocks:

```jsx
{/* Speaking-now indicator */}
{speakingWord ? (
  <View style={s.speakingBar}>
    <View style={s.speakingDot} />
    <Text style={s.speakingLbl}>SPEAKING</Text>
    <Text style={s.speakingWord} numberOfLines={1}>{speakingWord}</Text>
  </View>
) : null}

{/* Inline mistake panel */}
{(isRecording || mistakes.length > 0) && (
  <View style={s.mistakePanel}>
    <View style={s.mistakeHeader}>
      <View style={s.mistakeDot} />
      <Text style={s.mistakeLbl}>Mistake Detection</Text>
      {mistakes.length > 0 && (
        <Text style={s.mistakeCount}>{mistakes.length}</Text>
      )}
    </View>
    {mistakes.length === 0 ? (
      <View style={s.emptyBox}>
        <Text style={s.listeningTxt}>
          {isRecording ? 'Listening for recitation errors…' : 'Mistakes will appear here.'}
        </Text>
      </View>
    ) : (
      <View style={{ gap: 8 }}>
        {mistakes.slice(0, 3).map((m, i) => (
          <View key={`${m.ts}-${i}`} style={s.mCard}>
            <View style={s.mIconWrap}>
              <MistakeIcon type={m.type} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.mRow}>
                <Text style={s.mType}>
                  {TYPE_LABELS[m.type] || 'Mistake'}
                  {m.ayah ? ` · Ayah ${m.ayah}` : ''}
                </Text>
                {m.correct ? (
                  <TouchableOpacity hitSlop={8} onPress={() => speakWord(m.correct)}>
                    <Text style={s.mPlay}>▶</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {m.correct ? <Text style={s.mArabic}>{m.correct}</Text> : null}
              {m.tip ? <Text style={s.mTip}>{m.tip}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    )}
  </View>
)}

{/* Reset / Save Session buttons */}
{(mistakes.length > 0 || isRecording) && (
  <View style={s.btnRow}>
    <TouchableOpacity onPress={handleReset} style={[s.btn, s.btnOutline]} activeOpacity={0.85}>
      <Text style={s.btnOutlineTxt}>Reset</Text>
    </TouchableOpacity>
    <TouchableOpacity
      onPress={handleSave}
      style={[s.btn, s.btnPrimary, saving && s.btnDisabled]}
      activeOpacity={0.85}
      disabled={saving}
    >
      <Text style={s.btnPrimaryTxt}>{saving ? 'Saving…' : 'Save Session'}</Text>
    </TouchableOpacity>
  </View>
)}
```

(Note: Recite uses the shared `Button` common component. For Retain we use inline `TouchableOpacity` to keep the diff small + avoid pulling another import. The visual result is similar.)

- [ ] **Step 6.10: Gate the Shuffle button correctly**

Find the existing Shuffle button:

```jsx
<TouchableOpacity style={s.shuffleBtn} onPress={pickRandom} activeOpacity={0.8} disabled={isRecording}>
```

Replace with:

```jsx
<TouchableOpacity
  style={[s.shuffleBtn, (isRecording || mistakes.length > 0) && s.shuffleBtnDis]}
  onPress={pickRandom}
  activeOpacity={0.8}
  disabled={isRecording || mistakes.length > 0}
>
```

(Disabled while recording AND while mistakes are visible but unsaved — prevents losing unreviewed mistakes by shuffling away.)

- [ ] **Step 6.11: Add the new styles**

In the styles block, ADD these entries (place near the existing entries by visual grouping):

```js
// Speaking-now banner
speakingBar:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.red, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, alignSelf: 'center', marginTop: 12 },
speakingDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.white },
speakingLbl:   { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 1, textTransform: 'uppercase' },
speakingWord:  { fontFamily: FONTS.quran, fontSize: 18, color: COLORS.white, marginLeft: 4, maxWidth: 200 },

// Mistake panel
mistakePanel:  { width: '100%', maxWidth: 360, alignSelf: 'center', marginTop: 16 },
mistakeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
mistakeDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.red },
mistakeLbl:    { fontSize: 10, fontWeight: '800', color: COLORS.red, textTransform: 'uppercase', letterSpacing: 1, flex: 1 },
mistakeCount:  { fontSize: 10, fontWeight: '800', color: COLORS.white, backgroundColor: COLORS.red, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
emptyBox:      { backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FEE2E2', borderRadius: 18, padding: 16, minHeight: 76, justifyContent: 'center' },
listeningTxt:  { fontSize: 11, color: COLORS.gray400, textAlign: 'center', fontStyle: 'italic' },
mCard:         { flexDirection: 'row', gap: 10, backgroundColor: COLORS.redLight, borderLeftWidth: 4, borderLeftColor: COLORS.red, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
mIconWrap:     { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.red, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 2 },
mRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
mType:         { fontSize: 11, fontWeight: '800', color: COLORS.red, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 },
mPlay:         { fontSize: 14, color: COLORS.red, fontWeight: '800' },
mArabic:       { fontFamily: FONTS.quran, fontSize: 24, color: COLORS.primary, textAlign: 'right', writingDirection: 'rtl', marginTop: 6, marginBottom: 4 },
mTip:          { fontSize: 12, color: '#991B1B', lineHeight: 17, fontWeight: '500' },

// Reset / Save buttons
btnRow:        { flexDirection: 'row', gap: 14, paddingHorizontal: 8, marginTop: 22, marginBottom: 8 },
btn:           { flex: 1, borderRadius: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
btnOutline:    { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: 'transparent' },
btnOutlineTxt: { fontSize: 14, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.4 },
btnPrimary:    { backgroundColor: COLORS.secondary },
btnPrimaryTxt: { fontSize: 14, fontWeight: '800', color: COLORS.white, letterSpacing: 0.4 },
btnDisabled:   { opacity: 0.6 },

// Shuffle disabled state
shuffleBtnDis: { opacity: 0.4 },
```

- [ ] **Step 6.12: Verify the diff**

```bash
cd d:/TrueTilawah
git diff frontend/src/screens/RetainScreen.js
```

Expected: roughly `+200 / -25` lines. Confirm:
- `expo-speech` lazy require + `rawSpeak` at the top.
- `MistakeIcon`, `TYPE_LABELS`, `countByType`, `pickMostCommon` defined.
- `mistakes`, `speakingWord`, `saving`, `speakingTimerRef` state declared.
- `speakWord` callback defined.
- `wireCallbacks` is the full Recite-style switch.
- `onStop` no longer calls `completeSession` or `navigate`.
- `handleSave` and `handleReset` functions defined.
- Speaking indicator + mistake panel + Reset/Save buttons rendered.
- Shuffle button disabled when `mistakes.length > 0`.
- New styles added.
- `mistakeCountsRef` no longer referenced anywhere (search for it).

- [ ] **Step 6.13: Stage and commit**

```bash
cd d:/TrueTilawah
git add frontend/src/screens/RetainScreen.js
git status --short --untracked-files=no | head -5
```

Verify only that one file staged with `M ` in first column.

```bash
git commit -m "$(cat <<'EOF'
feat(frontend): RetainScreen — streaming word coloring + Save flow

Wires the same WS event handlers as ReciteScreen: partial_mistake
turns a word red and fires TTS of the correct form, word_corrected
turns it green, mistake_acknowledged fades it to acknowledged-red,
ayah-finalized batches append to the inline mistake panel.

onStop no longer auto-completes the session. The user explicitly taps
Save Session → completeSession → navigate to RetainResults with the
mistakes array + word/letter denominators computed from the carousel
scope. Reset abandons + clears for a fresh attempt without leaving
the screen. Shuffle is disabled while recording AND while unreviewed
mistakes are visible.

Refs: docs/superpowers/specs/2026-05-18-retain-rework-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git show --stat HEAD
```

Expected: one file, roughly `+200 / -25` lines.

---

## Task 7: Visual smoke test

**Files:** (manual, no edits)

- [ ] **Step 7.1: Rebuild the Android dev client if needed**

If you haven't built since Group A's font was added, rebuild. Otherwise, a Metro reload should pick up the JS changes. To be safe:

```bash
cd d:/TrueTilawah/frontend
npx expo start --clear
```

Reload the app on the device.

- [ ] **Step 7.2: Retain — UI removals**

Open Retain. Confirm:
- No "Record" / "Write" tabs at the top.
- No "Record" Switch toggle in the toggle row.
- Only one toggle visible: "Show verses".
- No single-ayah hint box below the toggles.

- [ ] **Step 7.3: Retain — carousel**

Tap Shuffle. After a brief loading state, the carousel should render below the toggles. Confirm:
- Each card shows ayah number + Arabic text in Uthmanic Hafs (Group A's font).
- Horizontal snap-scrolling works.
- Prev / Next buttons under the carousel are wired.
- Toggle "Show verses" off → carousel hides. Toggle back on → reappears.

- [ ] **Step 7.4: Retain — recording with real-time coloring**

Tap the mic. The status should change to "Recording…" (with the existing animations). Recite the displayed verses, but deliberately omit a known word.

Within ~1 s of the omission, the corresponding word in the carousel should turn red. The mistake should appear at the top of the Mistake Detection panel below the mic. If TTS is working, the device should speak the correct word.

If you recite the missed word afterwards correctly, it should turn green.

- [ ] **Step 7.5: Retain — stop, see Save / Reset buttons**

Tap the mic again. Recording stops. The mistake panel keeps showing your mistakes. The Reset and Save Session buttons should now be visible at the bottom of the screen (below the mistake panel).

- [ ] **Step 7.6: Retain — Save Session**

Tap Save Session. Spinner briefly shows on the button label ("Saving…"). RetainResults loads with:
- Gauge showing the actual accuracy score (not 93).
- Surah Arabic name matches the surah you recited (not الكهف unless you recited Al-Kahf).
- Three result rows showing **real numbers**:
  - Alphabets mistakes: `N / M` where N matches your TAJWEED + MISPRON count.
  - Words mistakes: `N / M`.
  - Most common error: matches the type that occurred most often (or "No mistakes" if you were perfect, or "Mixed" if everything was tied).
- "Back to Retain" button at the bottom (not "Save your progress").

- [ ] **Step 7.7: Retain — Reset flow**

Back on Retain, tap Shuffle. Should bring a new surah + reset all state. Recite once, then tap mic to stop, then tap Reset. The mistake panel should clear, the carousel words should return to default color, and the Reset/Save buttons should disappear (now that mistakes.length === 0).

- [ ] **Step 7.8: Retain — Shuffle gating**

While recording (mic active), the Shuffle button should be visually disabled (dimmed) and unresponsive to taps. After Stop with mistakes visible, Shuffle should still be disabled — to shuffle, you must Reset or Save first. After Reset (mistakes cleared), Shuffle re-enables.

- [ ] **Step 7.9: RetainResults — dead UI removed**

On the Results screen (from Step 7.6), confirm:
- No "Record" / "Write" tabs visible.
- No "Short Summary" button visible.
- The bottom button reads "Back to Retain" with an ArrowLeft icon.

- [ ] **Step 7.10: Zero-mistakes smoke test**

Optional: on Retain, pick a short surah you know perfectly. Record + recite perfectly + Stop + Save. Results should show gauge at 100, all three rows at `0 / M`, and "Most common error" reading "No mistakes".

---

## Self-Review checklist (controller-side, before handoff)

1. **Spec coverage:**
   - ✅ Remove ModeTabs + mode state (§4.1 Removals) → Task 4.
   - ✅ Remove single-verse box (§4.1 Removals) → Task 4.
   - ✅ Remove Record toggle (§4.1 Removals) → Task 4.
   - ✅ All-scope ayah fetch via shared helper (§4.1.1) → Task 1 (helper) + Task 5 (call site).
   - ✅ Carousel with WordToken (§4.1.2) → Task 5.
   - ✅ Rename toggle to "Show verses" (§4.1.3) → Task 4.
   - ✅ Streaming event wiring (§4.1.4) → Task 6.
   - ✅ TTS speakWord (§4.1.4) → Task 6.
   - ✅ Save / Reset flow (§4.1.5) → Task 6.
   - ✅ Inline mistake panel (§4.1.6) → Task 6.
   - ✅ Shuffle gating (§4.1.7) → Task 6.
   - ✅ ReciteScreen uses shared fetchScopeAyahs (§4.3) → Task 2.
   - ✅ RetainResults drop dummies (§4.2) → Task 3.
   - ✅ RetainResults drop dead UI (§4.2) → Task 3.
   - ✅ RetainResults rename Save button (§4.2) → Task 3.
2. **Placeholder scan:** No "TBD", "TODO", or "add appropriate X" anywhere. Every step has complete code.
3. **Type consistency:**
   - `JUZ_ARABIC_NAMES` not used here — Group A's concept stays in Group A.
   - `scopeAyahs` shape: `[{ ayahNumber, uthmaniText }, ...]` — used identically in Tasks 1, 5, 6.
   - `mistakes` array shape: `{ type, incorrect, correct, tajweedRule, severity, tip, ayah, ts }` — defined in Task 6, consumed in Task 3 (RetainResults reads `type` only).
   - `wordStateStore` API: `setState(ayah, wordIdx, state)`, `reset()`, `useWordStateStore((s) => ...)` — consistent with ReciteScreen, used identically in Tasks 5 + 6.
4. **File-path consistency:** All paths use `frontend/src/...`. Helper is at `frontend/src/utils/scopeAyahs.js`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-retain-rework.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Same approach we used for Group A.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
