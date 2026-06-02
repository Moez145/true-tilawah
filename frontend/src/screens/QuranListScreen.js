import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon } from 'react-native-svg';
import { BookOpen } from 'lucide-react-native';
import Header    from '../components/common/Header';
import SearchBar from '../components/dashboard/SearchBar';
import { quranService }   from '../services/quranService';
import { sessionService } from '../services/sessionService';
import { useApp }  from '../context/AppContext';
import { COLORS, BRAND_GRADIENT, FONTS, JUZ_ARABIC_NAMES }  from '../constants';

const TABS = ['Surah', 'Para', 'Page', 'Hizb'];

const PARA_NAMES = ['Alif Lam Meem','Sayaqool','Tilkal Rusull','Lan Tanaloo','Wal Mohsanat','La Yuhibbullah','Wa Iza Samiu','Walau Annana','Qalal Malao',"Wa'lamu","Ya'taziroon","Wa Ma Min Da'abbatin","Wa Ma Ubabri'u",'Rubama','Subhanallazi','Qal Alam','Iqtaraba','Qad Aflaha','Wa Qalallazina','Aman Khalaqa','Utlu Ma Oohiya','Wa Manyaqnut','Wa Mali','Faman Azlam','Elahe Yuruddo','Ha Meem','Qala Fama Khatbukum','Qad Sami Allah','Tabarakallazi','Amma'];

// ─── Quran metadata (juz/page/hizb boundaries) ─────────────────────────────────
// Authoritative source: Al Quran Cloud `/meta` endpoint (Madani Mushaf, 604 pages,
// 30 juz, 60 hizbs derived from 240 hizb-quarters). Boundary refs are
// `{ surah, ayah }` pairs; we compute totalAyahs accurately by converting both
// the boundary and the next boundary to global ayah index using cumulative
// surah ayah counts pulled from `meta.surahs.references`.
let cachedMeta = null;
let inflightMetaPromise = null;
async function fetchQuranMeta() {
  if (cachedMeta) return cachedMeta;
  if (inflightMetaPromise) return inflightMetaPromise;
  inflightMetaPromise = (async () => {
    try {
      const res  = await fetch('https://api.alquran.cloud/v1/meta');
      const json = await res.json();
      if (json?.data) cachedMeta = json.data;
    } catch (e) { console.warn('quran meta:', e?.message); }
    inflightMetaPromise = null;
    return cachedMeta;
  })();
  return inflightMetaPromise;
}

// Map surahNumber → ayahs-counted-before-that-surah (0 for surah 1)
function buildCumulative(surahRefs) {
  const sorted = [...surahRefs].sort((a, b) => a.number - b.number);
  const cum = new Map();
  let total = 0;
  for (const s of sorted) {
    cum.set(s.number, total);
    total += s.numberOfAyahs;
  }
  return { cum, total };
}

function ayahsBetween(start, next, cum, total) {
  const a = (cum.get(start.surah) ?? 0) + start.ayah;
  const b = next ? (cum.get(next.surah) ?? 0) + next.ayah : total + 1;
  return Math.max(0, b - a);
}

function StarBadge({ num }) {
  // 8-pointed star outline (decagon-like) matching the Mushaf-style ayah marker in the doc.
  const points = [];
  const cx = 24, cy = 24, outer = 22, inner = 16, spikes = 8;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    points.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return (
    <View style={s.starWrap}>
      <Svg width={48} height={48} viewBox="0 0 48 48">
        <Polygon points={points.join(' ')} fill="none" stroke={COLORS.primary} strokeWidth={1.5} />
      </Svg>
      <Text style={s.starNum}>{num}</Text>
    </View>
  );
}

function Row({ item, onPress }) {
  const num = item.surahNumber || item.id;
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
      <View style={s.rowLeft}>
        <StarBadge num={num} />
        <View>
          <Text style={s.rowName}>{item.surahName}</Text>
          <Text style={s.rowMeta}>{item.surahType} • {item.totalAyahs} VERSES</Text>
        </View>
      </View>
      <Text style={s.rowAr}>{item.surahNameAr}</Text>
    </TouchableOpacity>
  );
}

export default function QuranListScreen({ navigation }) {
  const { surahs, surahsLoaded, setSurahData } = useApp();
  const [tab,           setTab]           = useState('Surah');
  const [searchVisible, setSearchVisible] = useState(false);
  const [query,         setQuery]         = useState('');
  const [loading,       setLoading]       = useState(!surahsLoaded);
  const [refreshing,    setRefreshing]    = useState(false);
  const [lastSession,   setLastSession]   = useState(null);
  const [meta,          setMeta]          = useState(cachedMeta);
  const [metaLoading,   setMetaLoading]   = useState(!cachedMeta);

  useEffect(() => { if (!surahsLoaded) loadSurahs(); }, []);
  useEffect(() => { loadLastSession(); }, []);

  // Fetch Quran metadata (juz/page/hizb boundaries) once per app session.
  useEffect(() => {
    if (cachedMeta) return;
    let cancelled = false;
    fetchQuranMeta().then((m) => {
      if (cancelled) return;
      setMeta(m);
      setMetaLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const loadSurahs = async () => {
    try { setLoading(true); const d = await quranService.getAllSurahs(); setSurahData(d); }
    catch (e) { console.warn('QuranList:', e.message); }
    finally { setLoading(false); }
  };

  const loadLastSession = async () => {
    try {
      const res = await sessionService.getSessions({ page: 1, limit: 1, status: 'COMPLETED' });
      const sess = res?.sessions?.[0] || null;
      setLastSession(sess);
    } catch (e) {
      console.warn('QuranList lastSession:', e.message);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    // Invalidate the meta cache so we re-pull boundaries on pull-to-refresh.
    cachedMeta = null;
    await Promise.all([
      surahsLoaded ? Promise.resolve() : loadSurahs(),
      loadLastSession(),
      fetchQuranMeta().then((m) => { setMeta(m); setMetaLoading(false); }),
    ]);
    setRefreshing(false);
  };

  // Cumulative ayah counts, derived from authoritative meta.surahs data.
  const cumulative = useMemo(() => {
    if (!meta?.surahs?.references) return null;
    return buildCumulative(meta.surahs.references);
  }, [meta]);

  const PARAS = useMemo(() => {
    if (!meta?.juzs?.references || !cumulative) return [];
    const refs = meta.juzs.references;
    return refs.map((r, i) => ({
      id:          i + 1,
      surahNumber: i + 1,
      surahName:   PARA_NAMES[i] || `Para ${i + 1}`,
      surahNameAr: JUZ_ARABIC_NAMES[i] || `الجزء ${i + 1}`,
      surahType:   'Para',
      totalAyahs:  ayahsBetween(r, refs[i + 1], cumulative.cum, cumulative.total),
    }));
  }, [meta, cumulative]);

  const HIZBS = useMemo(() => {
    if (!meta?.hizbQuarters?.references || !cumulative) return [];
    // Every 4th hizb-quarter (indices 0, 4, 8, …) is the start of a Hizb.
    const starts = meta.hizbQuarters.references.filter((_, i) => i % 4 === 0);
    return starts.map((r, i) => ({
      id:          i + 1,
      surahNumber: i + 1,
      surahName:   `Hizb ${i + 1}`,
      surahNameAr: `حزب ${i + 1}`,
      surahType:   'Hizb',
      totalAyahs:  ayahsBetween(r, starts[i + 1], cumulative.cum, cumulative.total),
    }));
  }, [meta, cumulative]);

  const PAGES = useMemo(() => {
    if (!meta?.pages?.references || !cumulative) return [];
    const refs = meta.pages.references;
    return refs.map((r, i) => ({
      id:          i + 1,
      surahNumber: i + 1,
      surahName:   `Page ${i + 1}`,
      surahNameAr: `صفحة ${i + 1}`,
      surahType:   'Page',
      totalAyahs:  ayahsBetween(r, refs[i + 1], cumulative.cum, cumulative.total),
    }));
  }, [meta, cumulative]);

  const data = useMemo(() => {
    const q = query.toLowerCase();
    const filterFn = (it) => !q || it.surahName?.toLowerCase().includes(q) || it.surahNameAr?.includes(query);
    switch (tab) {
      case 'Surah': return q ? surahs.filter(filterFn) : surahs;
      case 'Para':  return q ? PARAS.filter(filterFn)  : PARAS;
      case 'Page':  return q ? PAGES.filter(filterFn)  : PAGES;
      case 'Hizb':  return q ? HIZBS.filter(filterFn)  : HIZBS;
      default: return surahs;
    }
  }, [tab, surahs, query, PARAS, PAGES, HIZBS]);

  const showLoader = (tab === 'Surah' && loading)
    || (tab !== 'Surah' && (metaLoading || !cumulative));

  const onPress = useCallback((item) => {
    if (tab === 'Surah') {
      navigation.navigate('Detail', {
        mode:        'surah',
        surahNumber: item.surahNumber,
        title:       item.surahName,
        arabicName:  item.surahNameAr,
        meta:        `${item.surahType} • ${item.totalAyahs} VERSES`,
      });
      return;
    }

    // Compute the (startSurah/startAyah → nextSurah/nextAyah) boundary pair for
    // Para / Page / Hizb so DetailScreen can pull ayahs from the backend per surah.
    let refs;
    if (tab === 'Para')      refs = meta?.juzs?.references;
    else if (tab === 'Page') refs = meta?.pages?.references;
    else if (tab === 'Hizb') refs = meta?.hizbQuarters?.references?.filter((_, i) => i % 4 === 0);
    if (!refs) return;

    const idx   = item.id - 1;
    const start = refs[idx];
    const next  = refs[idx + 1] || null;
    if (!start) return;

    const modeMap = { Para: 'juz', Page: 'page', Hizb: 'hizb' };
    navigation.navigate('Detail', {
      mode:        modeMap[tab],
      rangeNumber: item.id,
      boundaries: {
        startSurah: start.surah,
        startAyah:  start.ayah,
        nextSurah:  next?.surah ?? null,
        nextAyah:   next?.ayah  ?? null,
      },
      title: item.surahName,
      meta:  `${item.surahType.toUpperCase()} • ${item.totalAyahs} VERSES`,
    });
  }, [tab, navigation, meta]);

  // Resolve last-read banner content from the most recent COMPLETED session.
  const lastRead = useMemo(() => {
    if (!lastSession) return null;
    const surah = surahs.find(s => s.surahNumber === lastSession.surahId);
    if (!surah) return null;
    const range = (lastSession.ayahEnd && lastSession.ayahEnd > lastSession.ayahStart)
      ? `${lastSession.ayahStart}-${lastSession.ayahEnd}`
      : `${lastSession.ayahStart}`;
    return {
      surah,
      title: surah.surahName,
      sub:   `Ayah No: ${range}`,
    };
  }, [lastSession, surahs]);

  const onLastReadPress = () => {
    if (!lastRead) return;
    const { surah } = lastRead;
    navigation.navigate('Detail', {
      surahNumber: surah.surahNumber,
      title:       surah.surahName,
      arabicName:  surah.surahNameAr,
      meta:        `${surah.surahType} • ${surah.totalAyahs} VERSES`,
    });
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="True Tilawah" onBack={() => navigation.navigate('Dashboard')} onSearchClick={() => setSearchVisible(p => !p)} />

      <SearchBar visible={searchVisible} searchQuery={query} searchResults={[]}
        placeholder={`Search ${tab}...`} onQueryChange={setQuery} onResultClick={() => {}} />

      {/* Last read banner */}
      <View style={s.bannerWrap}>
        <TouchableOpacity activeOpacity={lastRead ? 0.85 : 1} onPress={onLastReadPress} disabled={!lastRead}>
          <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.banner}>
            <View>
              <View style={s.bannerMeta}><BookOpen size={14} color="rgba(255,255,255,0.9)" /><Text style={s.bannerMetaTxt}>Last Read</Text></View>
              {lastRead ? (
                <>
                  <Text style={s.bannerTitle}>{lastRead.title}</Text>
                  <Text style={s.bannerSub}>{lastRead.sub}</Text>
                </>
              ) : (
                <>
                  <Text style={s.bannerTitle}>Begin your journey</Text>
                  <Text style={s.bannerSub}>Start your first recitation</Text>
                </>
              )}
            </View>
            <BookOpen size={60} color="rgba(255,255,255,0.2)" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        {TABS.map(t => (
          <TouchableOpacity key={t} style={s.tabItem} onPress={() => setTab(t)}>
            <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>{t}</Text>
            {tab === t && <View style={s.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>

      {showLoader
        ? <View style={s.loader}><ActivityIndicator size="large" color={COLORS.primary} /></View>
        : <FlatList
            data={data}
            keyExtractor={it => String(it.surahNumber || it.id)}
            renderItem={({ item }) => <Row item={item} onPress={() => onPress(item)} />}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
            initialNumToRender={20}
            maxToRenderPerBatch={30}
            windowSize={10}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.loader}>
                <Text style={{ color: COLORS.gray400, fontSize: 13 }}>
                  Couldn't load {tab.toLowerCase()} data. Pull down to retry.
                </Text>
              </View>
            }
          />
      }
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: COLORS.white },
  bannerWrap:   { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 14 },
  banner:       { borderRadius: 26, padding: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerMeta:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  bannerMetaTxt:{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  bannerTitle:  { fontSize: 20, fontWeight: '700', color: COLORS.white },
  bannerSub:    { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  tabRow:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  tabItem:      { flex: 1, alignItems: 'center', paddingVertical: 15, position: 'relative' },
  tabTxt:       { fontSize: 14, fontWeight: '700', color: COLORS.gray400 },
  tabTxtActive: { color: COLORS.primary },
  tabIndicator: { position: 'absolute', bottom: 0, left: 10, right: 10, height: 3, backgroundColor: COLORS.primary, borderRadius: 2 },
  list:         { paddingHorizontal: 24, paddingTop: 6, paddingBottom: 24 },
  loader:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  rowLeft:      { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  starWrap:     { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  starNum:      { position: 'absolute', fontSize: 12, fontWeight: '700', color: COLORS.primary },
  rowName:      { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  rowMeta:      { fontSize: 10, color: COLORS.gray400, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
  rowAr:        { fontFamily: FONTS.quran, fontSize: 22, color: COLORS.primary },
});
