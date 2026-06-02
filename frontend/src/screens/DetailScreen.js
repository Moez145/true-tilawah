import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Search } from 'lucide-react-native';
import Header   from '../components/common/Header';
import AyahItem from '../components/quran/AyahItem';
import { quranService } from '../services/quranService';
import { COLORS, FONTS, BRAND_GRADIENT, JUZ_ARABIC_NAMES } from '../constants';

const SURAH_TRANSLATIONS = {
  1: 'The Opening',     2: 'The Cow',         3: 'The Family of Imran',
  4: 'The Women',       5: 'The Table Spread', 6: 'The Cattle',
  7: 'The Heights',     112: 'The Sincerity',  113: 'The Daybreak',
  114: 'The Mankind',
};

const PARA_NAMES = ['Alif Lam Meem','Sayaqool','Tilkal Rusull','Lan Tanaloo','Wal Mohsanat','La Yuhibbullah','Wa Iza Samiu','Walau Annana','Qalal Malao',"Wa'lamu","Ya'taziroon","Wa Ma Min Da'abbatin","Wa Ma Ubabri'u",'Rubama','Subhanallazi','Qal Alam','Iqtaraba','Qad Aflaha','Wa Qalallazina','Aman Khalaqa','Utlu Ma Oohiya','Wa Manyaqnut','Wa Mali','Faman Azlam','Elahe Yuruddo','Ha Meem','Qala Fama Khatbukum','Qad Sami Allah','Tabarakallazi','Amma'];

// Sahih International English translation for one surah — used as a fallback when
// the backend Ayah.translationEn column hasn't been seeded.
async function fetchTranslationMap(surahNumber) {
  try {
    const res = await fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}/en.sahih`);
    const json = await res.json();
    const ayahs = json?.data?.ayahs || [];
    const map = {};
    for (const a of ayahs) map[a.numberInSurah] = a.text;
    return map;
  } catch { return {}; }
}

// Fetch ayahs for a Juz / Page / Hizb. The boundary pair is computed in
// QuranListScreen from the cached `/meta` (which is just universal metadata —
// 30 juz + 604 page + 240 hizb-quarter starting points, no Quranic text).
// Ayah text is pulled from the backend via quranService; only if the backend
// has no data for a surah do we fall back to Al Quran Cloud for that surah.
async function fetchRangeAyahs(boundaries) {
  const { startSurah, startAyah, nextSurah, nextAyah } = boundaries || {};
  if (!startSurah || !startAyah) return [];

  // Which surahs do we need to pull? Inclusive of startSurah; end depends on
  // where the next boundary lands.
  const endSurah = nextSurah
    ? (nextAyah === 1 ? nextSurah - 1 : nextSurah)
    : 114;
  const surahNums = [];
  for (let s = startSurah; s <= endSurah; s++) surahNums.push(s);

  // Fetch each surah from the backend in parallel. If the backend has no rows
  // for a surah, fall back to Al Quran Cloud's uthmani text just for that one.
  const surahDatas = await Promise.all(
    surahNums.map(async (s) => {
      try {
        const data = await quranService.getAyahsBySurah(s);
        if (data?.ayahs?.length) return { surah: s, data };
      } catch {}
      try {
        const res  = await fetch(`https://api.alquran.cloud/v1/surah/${s}/quran-uthmani`);
        const json = await res.json();
        return {
          surah: s,
          data: {
            surahNumber: s,
            surahName:   json?.data?.englishName,
            surahNameAr: json?.data?.name,
            ayahs: (json?.data?.ayahs || []).map(a => ({
              ayahNumber:  a.numberInSurah,
              uthmaniText: a.text,
            })),
          },
        };
      } catch { return { surah: s, data: null }; }
    })
  );

  // Flatten + clip to the boundary range.
  const out = [];
  for (const { surah, data } of surahDatas) {
    if (!data?.ayahs?.length) continue;
    for (const a of data.ayahs) {
      if (surah === startSurah && a.ayahNumber < startAyah) continue;
      if (nextSurah && surah === nextSurah && a.ayahNumber >= nextAyah) continue;
      out.push({
        ayahNumber:    a.ayahNumber,
        uthmaniText:   a.uthmaniText,
        translationEn: a.translationEn,
        surahNumber:   surah,
        surahName:     data.surahName,
        surahNameAr:   data.surahNameAr,
      });
    }
  }

  // If the backend doesn't have translations for these surahs, pull Sahih
  // International from Al Quran Cloud (per-surah, one call each).
  if (out.length && !out.some(a => a.translationEn)) {
    const surahNumsToTr = [...new Set(out.map(a => a.surahNumber))];
    const trMaps = await Promise.all(surahNumsToTr.map(s => fetchTranslationMap(s)));
    const byId = {};
    surahNumsToTr.forEach((s, i) => { byId[s] = trMaps[i]; });
    return out.map(a => ({
      ...a,
      translationEn: byId[a.surahNumber]?.[a.ayahNumber] || '',
    }));
  }
  return out;
}

export default function DetailScreen({ navigation, route }) {
  const {
    mode = 'surah',
    surahNumber,
    rangeNumber,
    boundaries,
    title,
    meta,
  } = route.params || {};

  const [ayahs,   setAyahs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [info,    setInfo]    = useState(null);

  useEffect(() => {
    if (mode === 'surah' && surahNumber)        fetchSurahAyahs();
    else if (mode !== 'surah' && boundaries)    loadRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, surahNumber, rangeNumber, boundaries?.startSurah, boundaries?.startAyah]);

  const fetchSurahAyahs = async () => {
    try {
      setLoading(true);
      const data = await quranService.getAyahsBySurah(surahNumber);
      setInfo(data);
      const baseAyahs = data?.ayahs || [];
      const hasTranslations = baseAyahs.some(a => a.translationEn || a.translation);
      let merged = baseAyahs;
      if (!hasTranslations) {
        const trMap = await fetchTranslationMap(surahNumber);
        merged = baseAyahs.map(a => ({ ...a, translationEn: trMap[a.ayahNumber] || a.translationEn }));
      }
      setAyahs(merged);
    } catch (e) { console.warn('DetailScreen:', e?.message); }
    finally { setLoading(false); }
  };

  const loadRange = async () => {
    try {
      setLoading(true);
      const data = await fetchRangeAyahs(boundaries);
      setAyahs(data);
    } catch (e) { console.warn('DetailScreen range:', e?.message); }
    finally { setLoading(false); }
  };

  // ─── Banner data per mode ────────────────────────────────────────────────────
  let displayTitle = '', englishName = '', displayMeta = '', arabicName = '';
  if (mode === 'surah') {
    displayTitle = title || info?.surahName || '...';
    englishName  = SURAH_TRANSLATIONS[surahNumber] || '';
    displayMeta  = meta || (info ? `${info.surahType} • ${info.totalAyahs} VERSES` : '');
  } else if (mode === 'juz') {
    displayTitle = `Juz ${rangeNumber}`;
    englishName  = PARA_NAMES[rangeNumber - 1] || '';
    arabicName   = JUZ_ARABIC_NAMES[rangeNumber - 1] || '';
    displayMeta  = meta || `JUZ ${rangeNumber} • ${ayahs.length} VERSES`;
  } else if (mode === 'page') {
    displayTitle = `Page ${rangeNumber}`;
    englishName  = '';
    displayMeta  = meta || `PAGE ${rangeNumber} • ${ayahs.length} VERSES`;
  } else if (mode === 'hizb') {
    displayTitle = `Hizb ${rangeNumber}`;
    englishName  = '';
    displayMeta  = meta || `HIZB ${rangeNumber} • ${ayahs.length} VERSES`;
  }

  const isRangeMode = mode !== 'surah';

  const renderItem = ({ item, index }) => {
    if (!isRangeMode) {
      return <AyahItem ayah={item} surahId={surahNumber} surahName={displayTitle} />;
    }
    // Multi-surah view: drop a surah header when the surah changes.
    const prev = ayahs[index - 1];
    const showSurahHeader = !prev || prev.surahNumber !== item.surahNumber;
    return (
      <View>
        {showSurahHeader && (
          <View style={s.surahHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.surahHeaderLbl}>SURAH</Text>
              <Text style={s.surahHeaderName}>{item.surahName}</Text>
            </View>
            <Text style={s.surahHeaderAr}>{item.surahNameAr}</Text>
          </View>
        )}
        <AyahItem ayah={item} surahId={item.surahNumber} surahName={item.surahName} />
      </View>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title={displayTitle} onBack={() => navigation.goBack()}
        rightElement={
          <TouchableOpacity style={s.searchBtn} hitSlop={8}>
            <Search size={22} color={COLORS.primary} />
          </TouchableOpacity>
        }
      />
      <FlatList
        data={ayahs}
        keyExtractor={(it, i) => `${it.surahNumber ?? surahNumber}-${it.ayahNumber}-${i}`}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={s.bannerWrap}>
            <LinearGradient colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.banner}>
              <View style={s.blobLg} />
              <View style={s.blobSm} />
              <Text style={s.bannerTitle}>{displayTitle}</Text>
              {englishName ? <Text style={s.bannerEn}>{englishName}</Text> : null}
              {arabicName ? <Text style={s.bannerArabic}>{arabicName}</Text> : null}
              <Text style={s.bannerMeta}>{displayMeta}</Text>
              {mode === 'surah' && (
                <>
                  <View style={s.divider} />
                  <Text style={s.bismillah}>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</Text>
                </>
              )}
            </LinearGradient>
          </View>
        }
        ListEmptyComponent={
          <View style={s.center}>
            {loading
              ? <ActivityIndicator size="large" color={COLORS.primary} />
              : <Text style={s.emptyTxt}>No ayahs found</Text>
            }
          </View>
        }
        renderItem={renderItem}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: COLORS.background },
  searchBtn:   { padding: 8, borderRadius: 20 },
  list:        { paddingHorizontal: 20, paddingBottom: 100 },
  bannerWrap:  { marginBottom: 20, marginTop: 4 },
  banner:      { borderRadius: 28, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 26, alignItems: 'center', overflow: 'hidden', position: 'relative' },
  blobLg:      { position: 'absolute', top: -60, right: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.07)' },
  blobSm:      { position: 'absolute', bottom: -40, left: -30, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.05)' },
  bannerTitle: { fontSize: 28, fontWeight: '800', color: COLORS.white, letterSpacing: -0.5 },
  bannerEn:    { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4, fontWeight: '500' },
  bannerArabic:{ fontFamily: FONTS.quran, fontSize: 36, color: COLORS.white, marginTop: 8, textAlign: 'center', writingDirection: 'rtl' },
  bannerMeta:  { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1.6, marginTop: 10 },
  divider:     { width: 60, height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 18, marginBottom: 14 },
  bismillah:   { fontFamily: FONTS.quran, fontSize: 26, color: COLORS.white, textAlign: 'center', lineHeight: 52, writingDirection: 'rtl' },
  center:      { paddingTop: 60, alignItems: 'center' },
  emptyTxt:    { fontSize: 15, color: COLORS.gray400 },

  // Range-mode surah divider
  surahHeader:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingVertical: 14, marginTop: 8 },
  surahHeaderLbl: { fontSize: 9, fontWeight: '800', color: COLORS.gray400, letterSpacing: 1.4, textTransform: 'uppercase' },
  surahHeaderName:{ fontSize: 18, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.3, marginTop: 2 },
  surahHeaderAr:  { fontFamily: FONTS.quran, fontSize: 26, color: COLORS.primary },
});
