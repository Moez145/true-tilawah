import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, Image, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { Bell, BookOpen, Clock, Flame, Volume2, ArrowRight, Activity, ChevronRight } from 'lucide-react-native';
import Header from '../components/common/Header';
import { progressService } from '../services/progressService';
import { sessionService } from '../services/sessionService';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { getShadow } from '../utils/helpers';
import { COLORS, BRAND_GRADIENT } from '../constants';
import { SessionRow } from '../components/sessions/SessionRow';

const TAJWEED_DISPLAY = [
  { key: 'Ghunna',  label: 'Ghunnah (Nasalization)', sub: 'Frequency', bg: COLORS.blueLight,   iconKey: 'volume' },
  { key: 'Madd',    label: 'Madd (Elongation)',      sub: 'Frequency', bg: COLORS.orangeLight, iconKey: 'arrow'  },
  { key: 'Qalqala', label: 'Qalqalah (Echo)',        sub: 'Frequency', bg: COLORS.yellowLight, iconKey: 'pulse'  },
];

function frequencyFor(count) {
  if (count >= 10) return { label: 'High',   color: '#EF4444' };
  if (count >= 5)  return { label: 'Medium', color: '#F97316' };
  if (count >= 1)  return { label: 'Low',    color: '#EAB308' };
  return { label: 'None', color: COLORS.gray400 };
}

function PerformanceRing({ pct = 0 }) {
  const r = 36; const circ = 2 * Math.PI * r;
  return (
    <View style={s.ringWrap}>
      <Svg width={92} height={92} viewBox="0 0 92 92">
        <Circle cx="46" cy="46" r={r} fill="none" stroke={COLORS.gray100} strokeWidth={9} />
        <Circle cx="46" cy="46" r={r} fill="none" stroke={COLORS.primary} strokeWidth={9}
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - pct / 100)}
          strokeLinecap="round" transform="rotate(-90 46 46)" />
      </Svg>
      <View style={s.ringCenter}>
        <Text style={s.ringVal}>{Math.round(pct)}%</Text>
      </View>
    </View>
  );
}

function ErrorTypeCard({ icon, label, sub, freq, freqColor, bg }) {
  return (
    <View style={[s.errCard, { backgroundColor: bg }]}>
      <View style={s.errIcon}>{icon}</View>
      <View style={s.errInfo}>
        <Text style={s.errLabel}>{label}</Text>
        <Text style={s.errSub}>{sub}</Text>
      </View>
      <View style={[s.freqPill, { backgroundColor: freqColor }]}>
        <Text style={s.freqTxt}>{freq}</Text>
      </View>
    </View>
  );
}

function iconFor(key) {
  if (key === 'volume') return <Volume2    size={20} color={COLORS.white} />;
  if (key === 'arrow')  return <ArrowRight size={20} color={COLORS.white} />;
  return <Activity size={20} color={COLORS.white} />;
}

export default function TrackScreen({ navigation, route }) {
  const { user } = useAuth();
  const { surahs, localAvatarUri } = useApp();
  const [progress,       setProgress]       = useState(null);
  const [tajweed,        setTajweed]        = useState([]);
  const [recentSessions, setRecentSessions] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);

  const tajweedCounts = {};
  for (const v of tajweed || []) {
    const name = v?.rule?.ruleName;
    if (name) tajweedCounts[name] = (tajweedCounts[name] || 0) + (v.count || 0);
  }

  const load = async (showLoader = false) => {
    if (showLoader) setLoading(true);
    const [progRes, tajRes, sessRes] = await Promise.allSettled([
      progressService.getProgress(),
      progressService.getTajweedViolations(),
      sessionService.getSessions({ page: 1, limit: 5, status: 'COMPLETED' }),
    ]);

    if (progRes.status === 'fulfilled') setProgress(progRes.value);
    else console.warn('Track:getProgress', progRes.reason?.message);

    if (tajRes.status === 'fulfilled') setTajweed(tajRes.value || []);
    else setTajweed([]);

    if (sessRes.status === 'fulfilled') {
      setRecentSessions(sessRes.value?.sessions || []);
    } else {
      setRecentSessions([]);
      console.warn('Track:getSessions', sessRes.reason?.message);
    }

    setLoading(false);
  };

  // Initial load
  useEffect(() => { load(true); }, []);

  // Refresh when navigated to with a newSession param (from ReciteScreen or RetainScreen)
  useEffect(() => {
    const newSession = route?.params?.newSession;
    if (newSession) {
      console.log('[Track] New session received — refreshing');
      load(false);
      navigation.setParams({ newSession: undefined });
    }
  }, [route?.params?.newSession]);

  // Also refresh every time the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  };

  const openDrawer = () => {
    let p = navigation;
    while (p && !p.openDrawer) p = p.getParent?.();
    p?.openDrawer?.();
  };

  if (loading) return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="True Tilawah" onMenuClick={openDrawer} onSearchClick={() => {}} />
      <View style={s.loader}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    </SafeAreaView>
  );

  const acc      = progress?.averageAccuracy ?? 0;
  const streak   = progress?.dailyStreak     ?? 0;
  const totalMin = progress?.totalTimeMin    ?? 0;
  const hours    = Math.floor(totalMin / 60);
  const mins     = totalMin % 60;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="True Tilawah" onMenuClick={openDrawer} onSearchClick={() => {}} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <TouchableOpacity style={s.bellBtn} hitSlop={8}>
            <Bell size={20} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={s.heroTitle}>My Progress</Text>
          <View style={s.heroBottom}>
            <Image
              source={{ uri: localAvatarUri || user?.avatarUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop' }}
              style={s.heroAvatar}
            />
            <View style={s.heroInfo}>
              <Text style={s.heroName}>{user?.fullName || 'User'}</Text>
              <View style={s.heroBadge}>
                <Text style={s.heroBadgeTxt}>Level: Beginner Student</Text>
              </View>
            </View>
            <BookOpen size={56} color="rgba(255,255,255,0.25)" />
          </View>
        </LinearGradient>

        {/* Overall Performance */}
        <View style={[s.perfCard, getShadow(1), { marginBottom: 18 }]}>
          <Text style={s.cardLbl}>Overall Performance</Text>
          <View style={s.perfBody}>
            <PerformanceRing pct={acc} />
            <View style={s.perfStats}>
              <View style={s.miniStat}>
                <Flame size={14} color={COLORS.orange} />
                <Text style={s.miniStatTxt}>
                  <Text style={s.miniStatNum}>{streak}</Text> day streak
                </Text>
              </View>
              <View style={s.miniStat}>
                <Clock size={14} color={COLORS.blue} />
                <Text style={s.miniStatTxt}>
                  <Text style={s.miniStatNum}>{hours}h {mins}min</Text>
                </Text>
              </View>
              <View style={s.miniStat}>
                <Activity size={14} color={COLORS.primary} />
                <Text style={s.miniStatTxt}>
                  <Text style={s.miniStatNum}>{progress?.totalSessions ?? 0}</Text> sessions
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Recent Sessions */}
        <View style={[s.sessionsCard, getShadow(1)]}>
          <View style={s.sessionsHeader}>
            <Text style={s.chartTitle}>Recent Sessions</Text>
            {recentSessions.length > 0 && (
              <TouchableOpacity
                onPress={() => navigation.navigate('Sessions')}
                style={s.seeAllBtn}
                activeOpacity={0.7}
              >
                <Text style={s.seeAllTxt}>See all</Text>
                <ChevronRight size={14} color={COLORS.primary} />
              </TouchableOpacity>
            )}
          </View>
          {recentSessions.length === 0 ? (
            <View style={s.emptySessions}>
              <BookOpen size={32} color={COLORS.gray300} />
              <Text style={s.emptySessionsTxt}>
                No sessions yet — tap the mic on Recite to start.
              </Text>
            </View>
          ) : (
            <View>
              {recentSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  surahs={surahs}
                  onPress={() => navigation.navigate('SessionDetail', { sessionId: session.id, session })}
                />
              ))}
            </View>
          )}
        </View>

        {/* Error Types */}
        <Text style={s.sectionLbl}>Error Types</Text>
        <View style={s.errSection}>
          {TAJWEED_DISPLAY.map((t) => {
            const count = tajweedCounts[t.key] || 0;
            const f = frequencyFor(count);
            return (
              <ErrorTypeCard
                key={t.key}
                icon={iconFor(t.iconKey)}
                label={t.label}
                sub={t.sub}
                freq={f.label}
                freqColor={f.color}
                bg={t.bg}
              />
            );
          })}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:          { flex: 1, backgroundColor: COLORS.backgroundLight },
  scroll:          { flex: 1 },
  content:         { padding: 24 },
  loader:          { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero:            { borderRadius: 28, padding: 20, marginBottom: 18, overflow: 'hidden', position: 'relative' },
  bellBtn:         { position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroTitle:       { fontSize: 20, fontWeight: '700', color: COLORS.white, marginBottom: 18 },
  heroBottom:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroAvatar:      { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  heroInfo:        { flex: 1 },
  heroName:        { fontSize: 18, fontWeight: '700', color: COLORS.white, marginBottom: 6 },
  heroBadge:       { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  heroBadgeTxt:    { fontSize: 10, fontWeight: '700', color: COLORS.white },
  perfCard:        { backgroundColor: COLORS.white, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: COLORS.gray100, gap: 12 },
  cardLbl:         { fontSize: 11, fontWeight: '700', color: COLORS.gray500, alignSelf: 'flex-start', marginBottom: 6 },
  perfBody:        { flexDirection: 'row', alignItems: 'center', gap: 16 },
  perfStats:       { flex: 1, gap: 8 },
  ringWrap:        { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  ringCenter:      { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ringVal:         { fontSize: 18, fontWeight: '700', color: COLORS.primary },
  miniStat:        { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: COLORS.gray100, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  miniStatTxt:     { fontSize: 10, fontWeight: '600', color: COLORS.gray600 },
  miniStatNum:     { fontWeight: '700', color: COLORS.primary },
  chartTitle:      { fontSize: 12, fontWeight: '700', color: COLORS.gray600, marginBottom: 14 },
  sessionsCard:    { backgroundColor: COLORS.white, borderRadius: 22, padding: 18, marginBottom: 22, borderWidth: 1, borderColor: COLORS.gray100 },
  sessionsHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  seeAllBtn:       { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingHorizontal: 6 },
  seeAllTxt:       { fontSize: 11, fontWeight: '700', color: COLORS.primary, letterSpacing: 0.3 },
  emptySessions:   { paddingVertical: 24, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptySessionsTxt:{ fontSize: 12, color: COLORS.gray400, textAlign: 'center', maxWidth: 220 },
  sectionLbl:      { fontSize: 13, fontWeight: '700', color: COLORS.primary, marginBottom: 12 },
  errSection:      { gap: 10 },
  errCard:         { borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  errIcon:         { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  errInfo:         { flex: 1 },
  errLabel:        { fontSize: 13, fontWeight: '700', color: COLORS.primary },
  errSub:          { fontSize: 9, fontWeight: '600', color: COLORS.gray500, marginTop: 2 },
  freqPill:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  freqTxt:         { fontSize: 9, fontWeight: '700', color: COLORS.white, textTransform: 'uppercase', letterSpacing: 0.5 },
});