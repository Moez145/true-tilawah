import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, RotateCcw, Trash2, Star, Minus, Plus, AlertCircle, Check } from 'lucide-react-native';
import Header from '../components/common/Header';
import { StatusPill } from '../components/sessions/SessionRow';
import { sessionService } from '../services/sessionService';
import { feedbackService } from '../services/feedbackService';
import { useApp } from '../context/AppContext';
import {
  formatSessionDate,
  resolveSurahName,
  resolveSurahNameAr,
  resolveTotalAyahs,
} from '../utils/sessionFormat';
import { COLORS, FONTS, BRAND_GRADIENT } from '../constants';

const TYPE_LABELS = {
  MISPRONUNCIATION:  'Mispronunciation',
  OMITTED_WORD:      'Omitted Word',
  ADDED_WORD:        'Extra Word',
  TAJWEED_VIOLATION: 'Tajweed',
};

function MistakeIcon({ type }) {
  switch (type) {
    case 'OMITTED_WORD':     return <Minus size={16} color={COLORS.gray500} />;
    case 'ADDED_WORD':       return <Plus size={16} color={COLORS.orange} />;
    case 'TAJWEED_VIOLATION':return <Star size={16} color={COLORS.yellow} />;
    case 'MISPRONUNCIATION':
    default:                 return <AlertCircle size={16} color={COLORS.red} />;
  }
}

// Format the full session date — e.g. "May 18, 2026" — for the metadata card.
function fullDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(d);
  } catch {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
}

export default function SessionDetailScreen({ navigation, route }) {
  const { surahs } = useApp();
  const params = route?.params || {};
  const sessionId = params.sessionId;

  // We optionally get the full session object from the list-screen tap.
  const [session, setSession] = useState(params.session || null);
  const [sessionLoading, setSessionLoading] = useState(!params.session);
  const [feedbacks, setFeedbacks] = useState([]);
  const [feedbacksLoading, setFeedbacksLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // Fetch session metadata if we didn't get it via route params.
  useEffect(() => {
    if (session || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await sessionService.getSession(sessionId);
        if (!cancelled) setSession(data);
      } catch (e) {
        console.warn('SessionDetail:getSession', e?.message);
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, session]);

  // Always fetch feedbacks — even if session metadata was preloaded.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await feedbackService.getSessionFeedback(sessionId);
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data?.feedbacks || data?.items || []);
        setFeedbacks(list);
      } catch (e) {
        console.warn('SessionDetail:getSessionFeedback', e?.message);
        if (!cancelled) setFeedbacks([]);
      } finally {
        if (!cancelled) setFeedbacksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleReciteAgain = useCallback(() => {
    if (!session) return;
    navigation.navigate('Main', {
      screen: 'MainTabs',
      params: {
        screen: 'Recite',
        params: {
          prefilledScope: {
            surahId:     session.surahId,
            surahName:   resolveSurahName(session.surahId, surahs),
            surahNameAr: resolveSurahNameAr(session.surahId, surahs),
            totalAyahs:  resolveTotalAyahs(session.surahId, surahs) || session.ayahEnd,
            ayahStart:   session.ayahStart,
            ayahEnd:     session.ayahEnd,
          },
        },
      },
    });
  }, [session, surahs, navigation]);

  const handleDelete = useCallback(() => {
    if (!sessionId) return;
    Alert.alert(
      'Delete this session?',
      'This will permanently remove the session and all its mistakes from your progress.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await sessionService.deleteSession(sessionId);
              navigation.goBack();
            } catch (e) {
              Alert.alert("Couldn't delete", e?.message || 'Please try again.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [sessionId, navigation]);

  if (sessionLoading) {
    return (
      <SafeAreaView style={s.screen} edges={['top']}>
        <Header title="Session" onBack={() => navigation.goBack()} showSearch={false} />
        <View style={s.loader}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={s.screen} edges={['top']}>
        <Header title="Session" onBack={() => navigation.goBack()} showSearch={false} />
        <View style={s.loader}><Text style={s.muted}>Session not found.</Text></View>
      </SafeAreaView>
    );
  }

  const surahName   = resolveSurahName(session.surahId, surahs);
  const surahNameAr = resolveSurahNameAr(session.surahId, surahs);
  const score       = Math.round(session.accuracyScore ?? 0);
  const dateLine    = fullDate(session.startTime) || formatSessionDate(session.startTime);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title={surahName} onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Metadata card */}
        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.metaCard}>
          {surahNameAr ? <Text style={s.metaArabic}>{surahNameAr}</Text> : null}
          <Text style={s.metaRange}>Ayahs {session.ayahStart}–{session.ayahEnd}</Text>
          <View style={s.metaDateRow}>
            <Text style={s.metaDate}>{dateLine}</Text>
            <StatusPill status={session.status} />
          </View>
          <View style={s.metaScoreRow}>
            <Text style={s.metaScoreLbl}>Accuracy</Text>
            <Text style={s.metaScoreVal}>{score}%</Text>
          </View>
        </LinearGradient>

        {/* Errors section */}
        <Text style={s.sectionLbl}>Mistakes</Text>
        {feedbacksLoading ? (
          <View style={s.feedbackLoader}><ActivityIndicator color={COLORS.primary} /></View>
        ) : feedbacks.length === 0 ? (
          <View style={s.perfectCard}>
            <View style={s.perfectIcon}><Check size={24} color="#15803D" /></View>
            <Text style={s.perfectTitle}>Perfect recitation</Text>
            <Text style={s.perfectSub}>No mistakes were detected in this session.</Text>
          </View>
        ) : (
          <View style={s.mistakesList}>
            {feedbacks.map((m, i) => {
              const type      = m.errorType || m.type || 'MISPRONUNCIATION';
              const correct   = m.expectedText || m.correct || '';
              const tip       = m.tip || '';
              const ayahNum   = m.ayahNumber ?? m.ayah ?? null;
              const ruleName  = m.tajweedRule?.ruleName || m.tajweedRule || '';
              return (
                <View key={m.id || i} style={s.mCard}>
                  <View style={s.mIconWrap}><MistakeIcon type={type} /></View>
                  <View style={{ flex: 1 }}>
                    <View style={s.mRow}>
                      <Text style={s.mType}>
                        {TYPE_LABELS[type] || 'Mistake'}
                        {ayahNum ? ` · Ayah ${ayahNum}` : ''}
                        {ruleName ? ` · ${ruleName}` : ''}
                      </Text>
                    </View>
                    {correct ? <Text style={s.mArabic}>{correct}</Text> : null}
                    {tip ? <Text style={s.mTip}>{tip}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Bottom button row */}
        <View style={s.btnRow}>
          <TouchableOpacity
            onPress={handleDelete}
            style={[s.btn, s.btnDanger, deleting && s.btnDis]}
            activeOpacity={0.85}
            disabled={deleting}
          >
            <Trash2 size={16} color={COLORS.red} />
            <Text style={s.btnDangerTxt}>{deleting ? 'Deleting…' : 'Delete'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleReciteAgain}
            style={[s.btn, s.btnPrimary]}
            activeOpacity={0.85}
          >
            <RotateCcw size={16} color={COLORS.white} />
            <Text style={s.btnPrimaryTxt}>Recite Again</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: COLORS.white },
  loader:           { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted:            { color: COLORS.gray500, fontSize: 14 },
  content:          { padding: 20, paddingBottom: 40 },

  // Metadata gradient card
  metaCard:         { borderRadius: 26, padding: 22, marginBottom: 22, gap: 4, overflow: 'hidden' },
  metaArabic:       { fontFamily: FONTS.quran, fontSize: 30, color: COLORS.white, textAlign: 'right', writingDirection: 'rtl', marginBottom: 2 },
  metaRange:        { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5 },
  metaDateRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  metaDate:         { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
  metaScoreRow:     { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  metaScoreLbl:     { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 1 },
  metaScoreVal:     { fontSize: 32, fontWeight: '800', color: COLORS.white },

  sectionLbl:       { fontSize: 13, fontWeight: '700', color: COLORS.primary, marginBottom: 12 },

  // Feedback list
  feedbackLoader:   { paddingVertical: 24, alignItems: 'center' },
  mistakesList:     { gap: 10, marginBottom: 20 },
  mCard:            { flexDirection: 'row', gap: 10, backgroundColor: COLORS.redLight, borderLeftWidth: 4, borderLeftColor: COLORS.red, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  mIconWrap:        { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  mRow:             { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mType:            { fontSize: 11, fontWeight: '800', color: COLORS.red, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 },
  mArabic:          { fontFamily: FONTS.quran, fontSize: 24, color: COLORS.primary, textAlign: 'right', writingDirection: 'rtl', marginTop: 6, marginBottom: 4 },
  mTip:             { fontSize: 12, color: '#991B1B', lineHeight: 17, fontWeight: '500' },

  // Perfect-recitation empty state
  perfectCard:      { backgroundColor: '#DCFCE7', borderRadius: 18, padding: 22, alignItems: 'center', gap: 6, marginBottom: 20 },
  perfectIcon:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#BBF7D0', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  perfectTitle:     { fontSize: 16, fontWeight: '800', color: '#15803D' },
  perfectSub:       { fontSize: 12, color: '#166534', textAlign: 'center', maxWidth: 240 },

  // Buttons
  btnRow:           { flexDirection: 'row', gap: 12 },
  btn:              { flex: 1, borderRadius: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  btnPrimary:       { backgroundColor: COLORS.primary },
  btnPrimaryTxt:    { fontSize: 14, fontWeight: '800', color: COLORS.white, letterSpacing: 0.3 },
  btnDanger:        { borderWidth: 1.5, borderColor: COLORS.red, backgroundColor: 'transparent' },
  btnDangerTxt:     { fontSize: 14, fontWeight: '800', color: COLORS.red, letterSpacing: 0.3 },
  btnDis:           { opacity: 0.5 },
});
