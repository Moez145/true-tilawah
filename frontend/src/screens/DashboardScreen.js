import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  Image, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BookOpen, Mic, RotateCcw, BarChart3, ArrowRight } from 'lucide-react-native';
import Header              from '../components/common/Header';
import DashboardCard       from '../components/dashboard/DashboardCard';
import SearchBar           from '../components/dashboard/SearchBar';
import SearchActionModal   from '../components/layout/SearchActionModal';
import { useAuth }         from '../context/AuthContext';
import { useApp }          from '../context/AppContext';
import { quranService }    from '../services/quranService';
import { COLORS, BRAND_GRADIENT, FEATURE_CARDS } from '../constants';

const CARDS = [
  { title: 'Memorize', subtitle: 'Learn Quran',  icon: BookOpen,  bgColor: FEATURE_CARDS.memorize.bg, textColor: FEATURE_CARDS.memorize.fg, tab: 'QuranList' },
  { title: 'Recite',   subtitle: 'Voice Check',  icon: Mic,       bgColor: FEATURE_CARDS.recite.bg,   textColor: FEATURE_CARDS.recite.fg,   tab: 'Recite' },
  { title: 'Retain',   subtitle: 'Memory Test',  icon: RotateCcw, bgColor: FEATURE_CARDS.retain.bg,   textColor: FEATURE_CARDS.retain.fg,   tab: 'Retain' },
  { title: 'Track',    subtitle: 'Insights',     icon: BarChart3, bgColor: FEATURE_CARDS.track.bg,    textColor: FEATURE_CARDS.track.fg,    tab: 'Track' },
];

export default function DashboardScreen({ navigation }) {
  const { user }                                = useAuth();
  const { surahs, surahsLoaded, setSurahData, localAvatarUri }  = useApp();
  const [refreshing,    setRefreshing]    = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [modalVisible,  setModalVisible]  = useState(false);
  const [pending,       setPending]       = useState(null);

  const searchResults = useMemo(() => {
    if (searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return surahs
      .filter(s => s.surahName?.toLowerCase().includes(q) || s.surahNameAr?.includes(searchQuery))
      .slice(0, 8)
      .map(s => ({ type: 'surah', data: s, label: s.surahName, sub: `${s.surahType} • ${s.totalAyahs} verses` }));
  }, [searchQuery, surahs]);

  const load = useCallback(async () => {
    if (surahsLoaded) return;
    try {
      const data = await quranService.getAllSurahs();
      setSurahData(data);
    } catch {}
  }, [surahsLoaded]);

  useEffect(() => { load(); }, []);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const onSearchResult = (r) => {
    setSearchQuery('');
    setSearchVisible(false);
    setPending(r);
    setModalVisible(true);
  };

  const goTab = (tab) => navigation.navigate('Main', { screen: 'MainTabs', params: { screen: tab } });

  const handleMemorize = () => {
    setModalVisible(false);
    if (pending?.data?.surahNumber) {
      navigation.navigate('Detail', {
        surahNumber: pending.data.surahNumber,
        title:       pending.data.surahName,
        arabicName:  pending.data.surahNameAr,
        meta:        `${pending.data.surahType} • ${pending.data.totalAyahs} VERSES`,
      });
    }
  };

  const handleRecite = () => { setModalVisible(false); goTab('Recite'); };

  const firstName = (user?.fullName || 'User').split(' ')[0];

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="True Tilawah" onMenuClick={() => navigation.openDrawer()} onSearchClick={() => setSearchVisible(p => !p)} />

      <SearchBar visible={searchVisible} searchQuery={searchQuery} searchResults={searchResults}
        onQueryChange={setSearchQuery} onResultClick={onSearchResult} />
      <SearchActionModal visible={modalVisible} onClose={() => setModalVisible(false)}
        onMemorize={handleMemorize} onRecite={handleRecite} />

      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}>

        {/* Hero / Welcome card */}
        <View style={s.section}>
          <View style={s.heroWrap}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.hero}
            >
              <View style={s.blobLg} />
              <View style={s.blobSm} />

              <View style={s.heroRow}>
                <View style={s.heroLeft}>
                  <View style={s.salamBadge}>
                    <Text style={s.salamTxt}>Assalamu Alaikum</Text>
                  </View>
                  <Text style={s.heroName} numberOfLines={1}>{firstName}</Text>
                  <Text style={s.heroSub}>Ready to continue your journey?</Text>
                  <TouchableOpacity style={s.trackBtn} onPress={() => goTab('Track')} activeOpacity={0.85}>
                    <Text style={s.trackTxt}>Track Progress</Text>
                    <ArrowRight size={14} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>

                <View style={s.avatarOuter}>
                  <View style={s.avatarRing}>
                    <Image
                      source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
                      style={s.avatar} />
                  </View>
                </View>
              </View>
            </LinearGradient>
          </View>
        </View>

        {/* Quick actions */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Quick Actions</Text>
          <View style={s.grid}>
            {CARDS.map((c) => {
              const Ico = c.icon;
              return (
                <View key={c.title} style={s.gridCell}>
                  <DashboardCard title={c.title} subtitle={c.subtitle} icon={<Ico size={40} color={c.textColor} />}
                    bgColor={c.bgColor} textColor={c.textColor} onPress={() => goTab(c.tab)} />
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: COLORS.background },
  scroll:        { flex: 1 },
  content:       { paddingBottom: 24 },
  section:       { paddingHorizontal: 24, marginTop: 18 },

  // Hero / welcome card
  heroWrap:      { borderRadius: 28, overflow: 'hidden', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 8 },
  hero:          { paddingVertical: 22, paddingHorizontal: 22, borderRadius: 28, position: 'relative' },
  blobLg:        { position: 'absolute', top: -50, right: -50, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.07)' },
  blobSm:        { position: 'absolute', bottom: -30, left: -30, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.05)' },
  heroRow:       { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroLeft:      { flex: 1 },
  salamBadge:    { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 8 },
  salamTxt:      { color: '#FFE9A8', fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroName:      { color: COLORS.white, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  heroSub:       { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 14 },
  trackBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.white, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, alignSelf: 'flex-start' },
  trackTxt:      { color: COLORS.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  avatarOuter:   { padding: 3, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.18)' },
  avatarRing:    { padding: 3, borderRadius: 50, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  avatar:        { width: 76, height: 76, borderRadius: 38 },

  // Quick actions
  sectionTitle:  { fontSize: 11, fontWeight: '800', color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 12, marginLeft: 4 },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridCell:      { width: '47%' },
});
