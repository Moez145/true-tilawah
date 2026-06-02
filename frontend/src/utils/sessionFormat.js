// Session display helpers — pure, no React.
// Used by Track / Sessions / SessionDetail screens + SessionRow component.

export const STATUS_STYLE = {
  COMPLETED: { label: 'Complete',    bg: '#DCFCE7', fg: '#15803D' },
  ABANDONED: { label: 'Incomplete',  bg: '#FFEDD5', fg: '#C2410C' },
  ACTIVE:    { label: 'In progress', bg: '#DBEAFE', fg: '#1E40AF' },
};

// Format an ISO date string as "Today", "Yesterday", or "Mon, May 17".
// Uses the user's locale. Hermes supports Intl since RN 0.71.
export function formatSessionDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yStart     = new Date(todayStart);
  yStart.setDate(yStart.getDate() - 1);

  if (d >= todayStart) return 'Today';
  if (d >= yStart)     return 'Yesterday';

  // Older: "Mon, May 17"
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    }).format(d);
  } catch {
    // Hermes pre-0.71 or i18n disabled — graceful fallback.
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }
}

// Lookup helpers against the AppContext.surahs array. The array shape comes
// from the backend's GET /api/quran/surahs response: each entry has
// surahNumber + surahName + surahNameAr + totalAyahs + surahType.
export function resolveSurahName(surahId, surahs) {
  const s = (surahs || []).find(x => x.surahNumber === surahId);
  return s?.surahName || `Surah ${surahId}`;
}

export function resolveSurahNameAr(surahId, surahs) {
  const s = (surahs || []).find(x => x.surahNumber === surahId);
  return s?.surahNameAr || '';
}

export function resolveTotalAyahs(surahId, surahs) {
  const s = (surahs || []).find(x => x.surahNumber === surahId);
  return s?.totalAyahs ?? 0;
}
