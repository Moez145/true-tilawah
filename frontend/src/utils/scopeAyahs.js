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
    const stripped = t.replace(/[ً-ٰٟۖ-ۭ]/g, '');
    n += stripped.replace(/\s+/g, '').length;
  }
  return n;
}
