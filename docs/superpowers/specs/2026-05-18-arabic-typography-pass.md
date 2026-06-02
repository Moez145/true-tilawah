# Arabic typography pass — spec (Group A of multi-feature UX batch)

**Status:** Approved, awaiting plan.
**Date:** 2026-05-18.
**Scope:** Replace the app's single Arabic font with a Quran.com-style Mushaf font, and surface the authentic Arabic Juz names in the Para tab plus the Detail banner.
**Not in this spec:** Surah-Name decorative font, Indo-Pak script, dashboard polish, retain rework, progress rework, bookmarks, profile picture — those are Groups B–E and ship in their own spec/plan cycles.

## 1. Why

Two distinct asks in the user's batch:

1. **Font.** Today the only Arabic font in the bundle is `AmiriQuran_400Regular` (Google Fonts). It's a perfectly fine book-typography font, but it doesn't look like the Madani Mushaf that Quran.com renders by default. Users compare True Tilawah to Quran.com side by side; the visual mismatch is jarring.
2. **Para names.** The "Para" tab in the Read screen (a.k.a. Quran list) currently shows `الجزء 1`, `الجزء 2`, … on the right of each row. That literally reads "The juz 1" — generic, not the actual Juz name. The classical Arabic Juz names (`آلم`, `سَيَقُولُ`, `تِلْكَ ٱلرُّسُلُ`, …, `عَمَّ`) are the standard way to refer to Juz in Quran study and are what Quran.com / Tanzil / KFGQPC printings use.

This spec addresses both with the smallest possible diff.

## 2. Goal

- Every Arabic glyph rendered in the app — ayah body text, surah names, bismillah, Juz names — uses **KFGQPC HAFS Uthmanic Script** (the open-redistributable font behind Quran.com's default reader).
- The Para tab shows the authentic Juz name (e.g. `آلم`) on the right side of each row, in the new Mushaf font, instead of the generic `الجزء N`.
- When the user taps a Para row and lands on the Detail screen, the gradient banner also shows the Juz Arabic name in big Mushaf font — visual consistency between list and detail.

Success = a user reading the Para tab in True Tilawah sees the same Arabic glyph style and the same Juz names they'd see in a printed Madani Mushaf or on Quran.com.

## 3. Non-goals

- **No decorative Surah Names font.** The user explicitly chose "Uthmanic Hafs only" over the two-font option. Surah Arabic names (e.g. `الْفَاتِحَة`) will render in Uthmanic Hafs at a smaller size — visually consistent, no second font.
- **No Indo-Pak (Nastaliq) variant.** The user picked the Uthmani/Madani option.
- **No new Arabic content for Hizb or Page tabs.** Those keep `حزب N` / `صفحة N` — no canonical Arabic names exist for individual hizbs or pages.
- **No backend changes.** Surah Arabic names come from the existing Quran seed and are unchanged; only the *font* they render in changes.
- **No layout / spacing redesign.** This is a font swap + a 30-entry data file. UI structure is untouched.
- **No download-on-first-launch font loader.** The font ships in the bundle as an asset.

## 4. Design

### 4.1 Font asset

- **Family:** KFGQPC HAFS Uthmanic Script.
- **File:** `frontend/assets/fonts/UthmanicHafs.ttf` (single regular weight). Approx 500 KB.
- **License:** Free for redistribution per KFGQPC terms. We include `frontend/assets/fonts/LICENSE-UthmanicHafs.txt` alongside the font.
- **Loading:** Add to the existing `useFonts` call in `frontend/App.js` (no new font loader infrastructure):
  ```js
  const [fontsLoaded] = useFonts({
    UthmanicHafs: require('./assets/fonts/UthmanicHafs.ttf'),
  });
  ```
  The existing splash-gate logic (`if (!fontsLoaded || !minElapsed)`) continues to work — no startup flash of fallback glyphs.

### 4.2 Constant rewire

- `frontend/src/constants/index.js`:
  ```js
  export const FONTS = {
    quran: 'UthmanicHafs',  // was: 'AmiriQuran_400Regular'
  };
  ```
- Every site that reads `FONTS.quran` (today: ReciteScreen banner + ayah words + picker surah-name, DetailScreen bismillah + range-mode surah header, AyahItem ayah body) automatically picks up the new font with **zero code change**. The constant is the single source of truth.
- One usage site does **not** currently route through `FONTS.quran` — `s.rowAr` in `QuranListScreen.js` sets only `fontSize` and `color`, so the surah / juz Arabic name on the right of each row renders in the platform default font. Section 4.5 wires that style to `FONTS.quran` explicitly so it joins the rest.

### 4.3 Drop the old dependency

- Remove `"@expo-google-fonts/amiri-quran": "^0.4.1"` from `frontend/package.json`.
- Remove `import { useFonts, AmiriQuran_400Regular } from '@expo-google-fonts/amiri-quran'` in `frontend/App.js` and replace with `import { useFonts } from 'expo-font'` (the same hook from a different package — `expo-font` is already a transitive dependency and supports the local-`require` form).
- `npm install` after the package.json edit; `package-lock.json` updates.

### 4.4 Juz names data

New file `frontend/src/constants/juzNames.js`:

```js
// Authentic Arabic Juz names — the opening phrase of each Juz, as used in the
// Madani Mushaf and on quran.com. Index N − 1 corresponds to Juz N (1..30).
export const JUZ_ARABIC_NAMES = [
  'آلم',                  // 1
  'سَيَقُولُ',            // 2
  'تِلْكَ ٱلرُّسُلُ',     // 3
  'لَن تَنَالُوا۟',        // 4
  'وَٱلْمُحْصَنَـٰتُ',     // 5
  'لَا يُحِبُّ ٱللَّهُ',  // 6
  'وَإِذَا سَمِعُوا۟',     // 7
  'وَلَوْ أَنَّنَا',       // 8
  'قَالَ ٱلْمَلَأُ',      // 9
  'وَٱعْلَمُوٓا۟',         // 10
  'يَعْتَذِرُونَ',        // 11
  'وَمَا مِن دَآبَّةٍ',    // 12
  'وَمَآ أُبَرِّئُ',       // 13
  'رُّبَمَا',             // 14
  'سُبْحَـٰنَ ٱلَّذِيٓ',   // 15
  'قَالَ أَلَمْ',         // 16
  'ٱقْتَرَبَ',            // 17
  'قَدْ أَفْلَحَ',         // 18
  'وَقَالَ ٱلَّذِينَ',    // 19
  'أَمَّنْ خَلَقَ',        // 20
  'ٱتْلُ مَآ أُوحِىَ',     // 21
  'وَمَن يَقْنُتْ',       // 22
  'وَمَا لِىَ',           // 23
  'فَمَنْ أَظْلَمُ',       // 24
  'إِلَيْهِ يُرَدُّ',      // 25
  'حم',                   // 26
  'قَالَ فَمَا خَطْبُكُمْ',// 27
  'قَدْ سَمِعَ ٱللَّهُ',  // 28
  'تَبَارَكَ ٱلَّذِى',    // 29
  'عَمَّ',                // 30
];
```

Re-export from `frontend/src/constants/index.js`:
```js
export { JUZ_ARABIC_NAMES } from './juzNames';
```

### 4.5 Para tab wiring

`frontend/src/screens/QuranListScreen.js`:

- Remove the inline `PARA_NAMES` array (it's the English transliteration list — still useful for the Detail screen, so we'll keep it there).
- Import `JUZ_ARABIC_NAMES` from constants.
- In the `PARAS` `useMemo`, change one line:
  ```js
  // before
  surahNameAr: `الجزء ${i + 1}`,
  // after
  surahNameAr: JUZ_ARABIC_NAMES[i] || `الجزء ${i + 1}`,  // fallback only if index missing
  ```
- The right-column `<Text style={s.rowAr}>` already renders `item.surahNameAr` — no JSX change needed.
- Style tweak on `s.rowAr` so the Mushaf font reads well at a glance:
  ```js
  rowAr: {
    fontFamily: FONTS.quran,
    fontSize: 22,           // was 18
    color: COLORS.primary,
    // writingDirection: 'rtl' implicit for RTL chars in RN
  },
  ```
  This same style is used for surah Arabic names in the Surah tab, so they get a small visual upgrade too — same font, same size — which is intentional and consistent with "all Arabic words use the Quran.com font."

### 4.6 Detail banner wiring (the Juz banner change)

`frontend/src/screens/DetailScreen.js`:

- Keep the existing `PARA_NAMES` import (the English-transliteration array stays — it's the `englishName` line on the banner).
- Import `JUZ_ARABIC_NAMES` from constants.
- In the `mode === 'juz'` branch of the banner block, derive:
  ```js
  arabicName = JUZ_ARABIC_NAMES[rangeNumber - 1] || '';
  ```
- Render the Arabic name **between `bannerEn` and `bannerMeta`** so visual order is: title (`Juz 1`) → English transliteration (`Alif Lam Meem`) → Arabic Juz name (`آلم`, big Mushaf) → meta (`JUZ 1 • N VERSES`). Guarded so non-juz modes don't render an empty `<Text>`:
  ```jsx
  {englishName ? <Text style={s.bannerEn}>{englishName}</Text> : null}
  {arabicName ? <Text style={s.bannerArabic}>{arabicName}</Text> : null}
  <Text style={s.bannerMeta}>{displayMeta}</Text>
  ```
- Add a style:
  ```js
  bannerArabic: {
    fontFamily: FONTS.quran,
    fontSize: 36,
    color: COLORS.white,
    marginTop: 8,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  ```

Note: this only fires for `mode === 'juz'`. Page and Hizb modes have no canonical Arabic name, so `arabicName` stays empty and the line doesn't render.

## 5. Data integrity

- The 30 Juz strings in `juzNames.js` are the standard opening phrases used by KFGQPC, Tanzil, and Quran.com. They include the tashkeel (diacritics) so they render correctly in any Mushaf font.
- If a future contributor wants to change the orthography (e.g. drop tashkeel, switch to a different Juz-naming convention), this file is the single source of truth — no other place in the app stores Juz names.

## 6. Testing

This is a typography pass — there's no logic to unit-test. Acceptance is visual:

1. **Font swap acceptance** — fresh build on an Android dev client. Open ReciteScreen, DetailScreen (a surah), AyahItem (an ayah row), and the picker modal in ReciteScreen. Confirm every Arabic glyph is rendering in Uthmanic Hafs (Mushaf style — round letterforms, tashkeel above/below in classical positions) and not Amiri Quran (more book-typography, slightly thicker strokes).
2. **Para tab acceptance** — open Read → Para tab. Each of the 30 rows shows the authentic Juz name on the right side, not `الجزء N`. Specifically: row 1 = `آلم`, row 2 = `سَيَقُولُ`, row 26 = `حم`, row 30 = `عَمَّ`.
3. **Juz-banner acceptance** — tap row 1 (Para 1). Detail screen banner shows: title "Juz 1", English subtitle "Alif Lam Meem", Arabic name "آلم" in large Mushaf font below.
4. **Splash gating acceptance** — cold-start the app. Splash holds long enough for the font to load (no flash of fallback glyphs in the first ayah card on ReciteScreen).
5. **Page/Hizb tab regression** — Page tab still shows `صفحة N`; Hizb tab still shows `حزب N`. No Arabic name added there.
6. **Bismillah regression** — Detail screen for a surah still renders `بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ` correctly (now in Uthmanic Hafs).

No backend, no AI service, no test-suite changes. Pure RN bundle change.

## 7. Risks

- **License compliance.** KFGQPC fonts are free to redistribute, but require an attribution notice. We include `LICENSE-UthmanicHafs.txt` in `assets/fonts/` and add a one-line credit in the app's Help / About screen during a later cycle (out of scope for this spec — flagged as a follow-up).
- **Bundle size.** Adding one ~500 KB .ttf to the EAS-built app is negligible vs. the existing native libraries (react-native-live-audio-stream, reanimated). Net change after dropping `@expo-google-fonts/amiri-quran` is roughly +0 (Amiri Quran is the same ballpark).
- **Glyph fallback for missing chars.** Uthmanic Hafs covers the full Quranic Arabic codepoint range including the Unicode 6+ Quranic annotation marks. The Madani Mushaf text we already use from al-Quran-Cloud and the backend uses this exact orthography, so there are no missing-glyph squares.
- **Future contributor confusion.** A new dev seeing `AmiriQuran_400Regular` in commit history but `UthmanicHafs` in the constant might be momentarily confused. The plan file's commit message will call out the swap explicitly.

## 8. Open questions

None. Both font choice and Para-row placement were settled in the brainstorm exchange.

## 9. Follow-ups (out of scope, tracked for later)

- App-wide font-loading abstraction (not needed for one font, but if Groups B–E ever add a second Arabic font, revisit).
- About / Help screen attribution line for KFGQPC font credit.
- Surah Names decorative font (deferred per user's "Uthmanic Hafs only" choice — can be added in a later spec if visual fidelity demands it).
- Indo-Pak script user-toggle (deferred — not in original ask).

## 10. Implementation surface

| File | Change |
|---|---|
| `frontend/assets/fonts/UthmanicHafs.ttf` | New asset. |
| `frontend/assets/fonts/LICENSE-UthmanicHafs.txt` | New attribution file. |
| `frontend/App.js` | Switch `useFonts` source from `@expo-google-fonts/amiri-quran` to `expo-font` + local require. |
| `frontend/package.json` | Drop `@expo-google-fonts/amiri-quran` dep. |
| `frontend/package-lock.json` | Regenerated by `npm install`. |
| `frontend/src/constants/index.js` | `FONTS.quran = 'UthmanicHafs'`; re-export `JUZ_ARABIC_NAMES`. |
| `frontend/src/constants/juzNames.js` | New, 30-entry array. |
| `frontend/src/screens/QuranListScreen.js` | Use `JUZ_ARABIC_NAMES` in `PARAS`; tweak `s.rowAr` style. |
| `frontend/src/screens/DetailScreen.js` | Add Arabic Juz name to banner when `mode === 'juz'`. |

Total: 6 modified + 3 new = 9 files. No backend, no AI-service, no test-suite touch.
