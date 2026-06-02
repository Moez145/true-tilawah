# Progress / Sessions rework — spec (Group C of multi-feature UX batch)

**Status:** Approved, awaiting plan.
**Date:** 2026-05-19.
**Scope:** Rework the Track (Progress) screen to surface a Recent Sessions list, add a paginated all-sessions screen and a per-session detail screen, and wire a "Recite Again" flow that pre-selects a previous session's scope on the Recite tab.
**Not in this spec:** Bookmarks (Group D), profile picture (Group D), RTL carousel on Recite (Group E), dashboard polish (Group E).

## 1. Why

Three problems with today's Progress experience:

1. **No session-level visibility.** The Track screen shows aggregate stats (overall accuracy, streak, total time) and a bar chart of error-percentage-per-session, but there's no way to drill into *which* session corresponded to *which* bar. A user can't say "this bar was my Surah Al-Baqarah 23-28 attempt yesterday" — the bars are anonymous.
2. **Hardcoded dummy data on "Daily Insights".** The Today/Yesterday card on Track is wired to lifetime totals (since the backend has no per-day endpoint) and falls back to literal "—" for Yesterday. Users see dead UI that doesn't reflect their actual day.
3. **No re-attempt flow.** A user who abandoned Surah Al-Baqarah 23-28 yesterday has no way to start a fresh session with the same range without manually re-picking it in the Recite scope modal. Friction for the most common follow-up action.

## 2. Goal

- Track screen surfaces the last 5 sessions inline as tap-through rows, replacing the anonymous bar chart.
- "See all" link opens a paginated full sessions list (SessionsScreen).
- Tapping a session opens a detail screen (SessionDetailScreen) with the session's metadata, every error logged for that session, a "Recite Again" button that pre-selects the same scope on Recite, and a "Delete Session" button.
- The Daily Insights card is dropped entirely (was always blank Yesterday + lifetime-not-daily Today).
- Other Track elements (hero card, performance ring, streak/time stats, Error Types tajweed cards) are unchanged.

Success = a user can see their last 5 sessions on Track, tap into any one to review the mistakes, and re-recite the same range with one button tap.

## 3. Non-goals

- **No backend changes.** Every endpoint needed already exists: `GET /api/sessions?page&limit`, `GET /api/sessions/:id`, `GET /api/sessions/:sessionId/feedback`, `DELETE /api/sessions/:id`.
- **No status filter pills on SessionsScreen.** YAGNI; the status pill on each row gives visual scanning. Add later if usage demands.
- **No non-tajweed error counts in Track's Error Types section.** Vetoed during brainstorm.
- **No wiring of the Bell icon, no "Beginner Student" level computation.** Vetoed.
- **No per-session audio playback.** Recordings exist as a Prisma model but no playback UI surface yet.
- **No bookmark-from-session-detail.** Group D scope.
- **No accuracy gauge on SessionDetail.** Plain percentage number suffices — vetoed during brainstorm.
- **No parent/child session linking** for the Recite Again flow. The new session is independent, just shares the same surah/ayah range.
- **No new tests** — frontend has no Jest runner. Verification is manual smoke on Android dev client.

## 4. Design

### 4.1 TrackScreen.js changes

**Removals:**

- The entire `Daily Insights` card (`<View style={s.insightCard}>` and everything inside it).
- The two-column wrapper (`<View style={s.twoCol}>`) — Overall Performance moves to full width.
- The `topTwo` / `todayLine` derivations that fed the insights card.
- The `Error History (Last 30 days)` card: the `chartCard` JSX block + `HistoryBar` component + the `errorBars` derivation.
- All styles only used by the removed UI: `twoCol`, `insightCard`, `insightItem`, `insightDay`, `insightVal`, `insightBarA`, `insightBarB`, `insightBarMuted`, `chartCard`, `chartTitle`, `chart`, `barWrap`, `barTrack`, `barFill`, `barLbl`.

**Additions:**

- Fetch the most recent 5 sessions in the existing `load` function:
  ```js
  const sessionsRes = await Promise.allSettled([
    sessionService.getSessions({ page: 1, limit: 5 }),
  ]);
  // ...handle response, store in recentSessions state
  ```
- New `recentSessions` state initialized to `[]`.
- New "Recent Sessions" card replacing the chart card, same outer styling (`getShadow(1)` + `borderColor: gray100` + `borderRadius: 22`):
  - Card header row: title "Recent Sessions" + "See all →" link (right-aligned, opens `Sessions` stack screen).
  - Body: maps `recentSessions` to `<SessionRow>` components.
  - Empty state: a centered placeholder with text "No sessions yet — tap the mic on Recite to start." when `recentSessions.length === 0` and `!loading`.
- New `<SessionRow>` component (defined inline in TrackScreen.js, also imported by SessionsScreen):
  ```jsx
  function SessionRow({ session, surahs, onPress }) {
    const surah = surahs.find(x => x.surahNumber === session.surahId);
    const name  = surah?.surahName || `Surah ${session.surahId}`;
    const ar    = surah?.surahNameAr || '';
    return (
      <TouchableOpacity onPress={onPress} style={s.sessionRow} activeOpacity={0.7}>
        <View style={s.sessionIcon}>
          <Text style={s.sessionIconTxt}>{session.surahId}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.sessionTitleRow}>
            <Text style={s.sessionTitle}>{name}</Text>
            {ar ? <Text style={s.sessionTitleAr}>{ar}</Text> : null}
          </View>
          <Text style={s.sessionMeta}>
            Ayahs {session.ayahStart}–{session.ayahEnd} · {formatSessionDate(session.startTime)}
          </Text>
        </View>
        <View style={s.sessionRight}>
          <StatusPill status={session.status} />
          <Text style={s.sessionScore}>{Math.round(session.accuracyScore ?? 0)}%</Text>
        </View>
      </TouchableOpacity>
    );
  }
  ```
- New `<StatusPill>` helper (also inline, reused by SessionsScreen + SessionDetailScreen — see §4.5 for extraction note):
  ```jsx
  const STATUS_STYLE = {
    COMPLETED: { label: 'Complete',   bg: '#DCFCE7', fg: '#15803D' },
    ABANDONED: { label: 'Incomplete', bg: '#FFEDD5', fg: '#C2410C' },
    ACTIVE:    { label: 'In progress',bg: '#DBEAFE', fg: '#1E40AF' },
  };
  function StatusPill({ status }) {
    const v = STATUS_STYLE[status] || STATUS_STYLE.ACTIVE;
    return (
      <View style={[s.statusPill, { backgroundColor: v.bg }]}>
        <Text style={[s.statusPillTxt, { color: v.fg }]}>{v.label}</Text>
      </View>
    );
  }
  ```
- New `formatSessionDate(iso)` helper using `Intl.DateTimeFormat`. Returns "Today", "Yesterday", or `Mon, May 17` for older dates. Hermes (the default RN engine) supports `Intl` since RN 0.71; no new dependency.

**Layout change:**

- The `<View style={s.twoCol}>` two-column row is removed. The Overall Performance card is now a single-column card spanning the full content width. Its internal layout is unchanged — ring on the left, mini-stats below. (Could optionally be restructured to put the mini-stats on the right of the ring, but that's a follow-up tweak — out of scope for this spec.)

**Section ordering after changes:**

1. Hero card (My Progress) — unchanged
2. Overall Performance (now full width) — unchanged
3. Recent Sessions card — NEW (replaces Error History chart)
4. Error Types section (Ghunna / Madd / Qalqala) — unchanged

### 4.2 SessionsScreen.js (NEW)

Path: `frontend/src/screens/SessionsScreen.js`

Layout:

- Header: "All Sessions" + back button (via the shared `Header` component).
- FlatList of `<SessionRow>` items.
  - `data`: `sessions` state (array, appended as pages load).
  - `onEndReached={loadMore}` with `onEndReachedThreshold={0.5}`.
  - `ListFooterComponent`: a small `<ActivityIndicator>` shown while `loadingMore` is true.
  - `refreshControl`: pull-to-refresh that resets state to page 1.
  - `ListEmptyComponent`: "No sessions yet" message when `!loading && sessions.length === 0`.
- Tap a row → `navigation.navigate('SessionDetail', { sessionId: session.id, session })` (we pass the whole session object so the detail screen has metadata without a refetch round-trip).

State:

```js
const [sessions,      setSessions]      = useState([]);
const [page,          setPage]          = useState(1);
const [hasMore,       setHasMore]       = useState(true);
const [loading,       setLoading]       = useState(true);
const [loadingMore,   setLoadingMore]   = useState(false);
const [refreshing,    setRefreshing]    = useState(false);
```

Pagination logic:

```js
const PAGE_SIZE = 15;

const fetchPage = async (pageNum) => {
  const res = await sessionService.getSessions({ page: pageNum, limit: PAGE_SIZE });
  // backend returns { sessions: [...], pagination: { page, limit, total } }
  return res;
};

const loadFirstPage = async () => {
  setLoading(true);
  try {
    const res = await fetchPage(1);
    setSessions(res?.sessions || []);
    setPage(1);
    setHasMore((res?.sessions?.length || 0) >= PAGE_SIZE);
  } catch (e) {
    setSessions([]);
    setHasMore(false);
  } finally {
    setLoading(false);
  }
};

const loadMore = async () => {
  if (loadingMore || !hasMore) return;
  setLoadingMore(true);
  try {
    const next = page + 1;
    const res = await fetchPage(next);
    const newOnes = res?.sessions || [];
    setSessions(prev => [...prev, ...newOnes]);
    setPage(next);
    setHasMore(newOnes.length >= PAGE_SIZE);
  } catch {
    setHasMore(false);
  } finally {
    setLoadingMore(false);
  }
};

const onRefresh = async () => {
  setRefreshing(true);
  await loadFirstPage();
  setRefreshing(false);
};
```

### 4.3 SessionDetailScreen.js (NEW)

Path: `frontend/src/screens/SessionDetailScreen.js`

Route params: `{ sessionId: string, session?: object }`. The `session` object is optional but typically passed from the list screen so we don't need a refetch round-trip for metadata.

Layout:

- Header: surah English name (e.g. "Al-Baqarah") + back button.
- **Metadata card** (gradient banner similar to other screens):
  - Surah Arabic name (large, FONTS.quran)
  - "Ayahs X – Y"
  - Status pill (Complete / Incomplete / In progress)
  - Date in long form: "May 18, 2026"
  - Accuracy: `${Math.round(score)}%` in large text
  - Duration if `session.durationSec` present: `Math.round(durationSec / 60) min`
- **Errors section**:
  - Section label "Mistakes".
  - Loads `feedbackService.getSessionFeedback(sessionId)` on mount. Returns array of Feedback rows (each has `errorType` + `expectedText` + `actualText` + `tajweedRule?` + `tip?` + `ayahNumber` etc.).
  - Each error renders as a card mirroring the Recite mistake panel `<mCard>`:
    - Icon by errorType (Minus / Plus / Star / AlertCircle).
    - Type label + "Ayah N".
    - Arabic correct word (Quran font).
    - Tip text if present.
  - Loading state: `<ActivityIndicator />` while feedbacks are being fetched.
  - Empty state: a green-themed celebration card — checkmark icon + "Perfect recitation ✓" — when feedbacks.length === 0 and not loading.
- **Bottom button row** (sticky-ish, just at end of scroll content):
  - "Delete Session" (outline, red text, red border).
  - "Recite Again" (primary).

Delete handler:
```js
const handleDelete = () => {
  Alert.alert(
    'Delete this session?',
    'This will permanently remove the session and all its mistakes from your progress.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await sessionService.deleteSession(sessionId);
            navigation.goBack();
          } catch (e) {
            Alert.alert('Couldn\'t delete', e?.message || 'Try again.');
          }
        },
      },
    ],
  );
};
```

Recite Again handler:
```js
const handleReciteAgain = () => {
  navigation.navigate('Main', {
    screen: 'MainTabs',
    params: {
      screen: 'Recite',
      params: {
        prefilledScope: {
          surahId:     session.surahId,
          surahName:   resolveSurahName(session.surahId, surahs),
          surahNameAr: resolveSurahNameAr(session.surahId, surahs),
          totalAyahs:  resolveTotalAyahs(session.surahId, surahs),
          ayahStart:   session.ayahStart,
          ayahEnd:     session.ayahEnd,
        },
      },
    },
  });
};
```

The `resolveSurahName` / `resolveSurahNameAr` / `resolveTotalAyahs` helpers read from `useApp().surahs`. If the surah isn't in the local array yet, fall back to defaults; ReciteScreen handles missing fields gracefully (existing behavior).

### 4.4 ReciteScreen.js — accept prefilledScope

Add this `useEffect` inside the component, near the existing `useEffect`s:

```js
useEffect(() => {
  const pre = route?.params?.prefilledScope;
  if (!pre) return;
  setScope({
    surahId:    pre.surahId,
    surahName:  pre.surahName || `Surah ${pre.surahId}`,
    arabicName: pre.surahNameAr || '',
    totalAyahs: pre.totalAyahs || pre.ayahEnd,
    ayahStart:  pre.ayahStart,
    ayahEnd:    pre.ayahEnd,
  });
  setHasSelectedScope(true);
  // Clear so re-entering the tab via bottom-tab tap doesn't re-apply stale prefill.
  navigation.setParams({ prefilledScope: undefined });
}, [route?.params?.prefilledScope]);
```

Notes:
- The dependency is `route?.params?.prefilledScope` — when set, the effect runs once. After clearing via `setParams`, the dependency value becomes `undefined` and the effect's early-return guards against re-entry.
- Existing `scope` / `hasSelectedScope` setters are unchanged.

### 4.5 Navigation wiring

In `frontend/src/navigation/AppNavigator.js`, register the two new screens as Stack screens at the same level where `Detail` and `RetainResults` are registered:

```jsx
<Stack.Screen name="Sessions"       component={SessionsScreen} />
<Stack.Screen name="SessionDetail"  component={SessionDetailScreen} />
```

Order doesn't matter mechanically but place them next to `Detail` and `RetainResults` for readability.

### 4.6 Shared helpers (extraction question)

Three helpers are needed by multiple screens:
- `SessionRow` — TrackScreen + SessionsScreen.
- `StatusPill` — TrackScreen + SessionsScreen + SessionDetailScreen.
- `formatSessionDate` — all three.

**Decision:** extract them to a new file `frontend/src/components/sessions/SessionRow.js` plus a small helpers util `frontend/src/utils/sessionFormat.js` for `formatSessionDate` and `STATUS_STYLE`. This is one round of shared-abstraction work, not premature. Three call sites justify a module; copy-pasting into three screens would create the kind of drift Group B's spec warned about.

Files:
- `frontend/src/components/sessions/SessionRow.js` — `<SessionRow>` + `<StatusPill>` (both small, single-file is fine).
- `frontend/src/utils/sessionFormat.js` — `formatSessionDate(iso)`, `STATUS_STYLE` constant, `resolveSurahName(surahId, surahs)`, `resolveSurahNameAr(surahId, surahs)`, `resolveTotalAyahs(surahId, surahs)`.

## 5. Data flow

```
TrackScreen
  ├── progressService.getProgress()      → aggregate stats
  ├── progressService.getAccuracyTrend(8) → still used for any future UI? NO — drop the call too.
  ├── progressService.getTajweedViolations() → Error Types cards
  └── sessionService.getSessions({ limit: 5 }) → Recent Sessions list (NEW)

SessionsScreen
  └── sessionService.getSessions({ page, limit: 15 }) → paginated list

SessionDetailScreen
  ├── (uses route.params.session if passed, else)
  ├── sessionService.getSession(id) → metadata
  └── feedbackService.getSessionFeedback(id) → errors list

ReciteScreen
  └── reads route.params.prefilledScope on mount/focus
```

Drop the `progressService.getAccuracyTrend(8)` call from Track since the bar chart that consumed it is gone. Saves one round-trip on every Track load.

Drop the `progressService.getErrorSummary()` call too (it's currently fire-and-forget, no UI binding).

## 6. Testing

No frontend test runner. Acceptance is visual smoke on Android dev client:

1. **TrackScreen layout**
   - Hero card unchanged.
   - Overall Performance card spans full width (was half).
   - No "Daily Insights" card visible.
   - No "Error History" bar chart visible.
   - New "Recent Sessions" card shows last 5 sessions OR an empty state if none.
   - Error Types section unchanged.
2. **Recent Sessions empty state.** Fresh account: card reads "No sessions yet — tap the mic on Recite to start."
3. **Recent Sessions populated.** After at least one Recite or Retain session: card lists those sessions in reverse-chronological order, with the most recent on top. Each row shows surah name, ayah range, date label (Today / Yesterday / Mon May 17), status pill, accuracy percentage.
4. **See all link.** Tap "See all →" — navigates to SessionsScreen.
5. **SessionsScreen pagination.** Scroll to the end of the visible list → loadMore fires → next page appends with a footer spinner. Pull-to-refresh resets to page 1.
6. **Tap a session row.** Navigates to SessionDetailScreen. Metadata is visible immediately (because the session object was passed via route params).
7. **SessionDetail errors.** Errors list loads asynchronously (loading spinner first, then cards or "Perfect recitation ✓").
8. **Recite Again.** From SessionDetail, tap "Recite Again". Navigates to Recite tab. The scope picker now shows the same surah + range as the source session. The Arabic surah name displays correctly.
9. **Delete Session.** From SessionDetail, tap "Delete Session" → confirmation alert → confirm → session deleted from backend → user is bounced back to the list (which no longer contains it). Pull-to-refresh confirms deletion.
10. **Status pill colors.** Sessions in different statuses (COMPLETED / ABANDONED / ACTIVE if any) show distinct pill colors and labels.
11. **Date formatter.** A session from "today" shows "Today". From yesterday shows "Yesterday". From two days ago shows the weekday + month + day. From last month shows the same.

## 7. Risks

- **Recite Again leaves an orphan back-stack entry.** When the user navigates SessionDetail → Recite, the SessionDetail screen stays in the stack history. Hitting back on Recite would return to SessionDetail (or wherever). React Navigation v7 handles this fine — the user can navigate back as expected. We do NOT use `navigation.reset` because that's overkill; the natural stack history is acceptable.
- **prefilledScope re-application.** If the user backs out of Recite and re-enters via the bottom tab, the `setParams({ prefilledScope: undefined })` cleanup ensures the prefill doesn't re-trigger. Manual re-trigger requires another SessionDetail tap.
- **Pagination off-by-one.** The `hasMore = newOnes.length >= PAGE_SIZE` heuristic might leave a trailing "Load more" spinner if the user has exactly a multiple of PAGE_SIZE sessions. After the last page returns fewer than PAGE_SIZE rows, `hasMore` flips false and the spinner stops. Acceptable.
- **Surah name resolution before AppContext.surahs loads.** The fallback `Surah ${surahId}` is visible briefly on a cold-start. Same pattern as existing screens; the surahs array loads quickly after first network call.

## 8. Open questions

None. Sequencing, sessions-list placement, detail-surface type, Recite Again wiring, and polish scope all resolved in the brainstorm.

## 9. Follow-ups (out of scope)

- Status filter pills on SessionsScreen.
- Sort / search on SessionsScreen.
- Per-session audio playback (requires Recording model + storage backend wiring).
- Session-detail bookmark integration (overlaps with Group D).
- Linking re-recite sessions to their parent via a new `parentSessionId` schema field. Future if "attempt history per range" becomes a feature.

## 10. Implementation surface

| File | Change |
|---|---|
| `frontend/src/screens/TrackScreen.js` | Drop Daily Insights + Error History chart + their derivations and styles. Add Recent Sessions card. Drop the now-unused `getAccuracyTrend` + `getErrorSummary` calls. |
| `frontend/src/screens/SessionsScreen.js` | NEW — paginated FlatList with pull-to-refresh + onEndReached. |
| `frontend/src/screens/SessionDetailScreen.js` | NEW — metadata card + errors list + Recite Again + Delete Session buttons. |
| `frontend/src/screens/ReciteScreen.js` | Add `useEffect` that reads `route.params.prefilledScope` and applies it, then clears the param. |
| `frontend/src/navigation/AppNavigator.js` | Register `Sessions` and `SessionDetail` stack screens. |
| `frontend/src/components/sessions/SessionRow.js` | NEW — shared `<SessionRow>` and `<StatusPill>` components. |
| `frontend/src/utils/sessionFormat.js` | NEW — `formatSessionDate`, `STATUS_STYLE`, surah resolver helpers. |

Total: 3 modified + 4 new files. No backend, no AI-service, no test-suite touch.
