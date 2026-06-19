import { quranAudioService } from '../services/quranAudioService';
import { audioStreamService } from '../services/audioStreamService';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, Switch, Alert,
  StyleSheet, Modal, FlatList, Pressable, Dimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence,
  withTiming, cancelAnimation, Easing,
} from 'react-native-reanimated';
import {
  BookOpen, Mic, ChevronDown, X, Check,
  AlertCircle, Minus, Plus, Star, ChevronLeft, ChevronRight,
} from 'lucide-react-native';
import Header  from '../components/common/Header';
import Button  from '../components/common/Button';
import { sessionService }     from '../services/sessionService';
import { quranService }       from '../services/quranService';
import { useApp }             from '../context/AppContext';
import { COLORS, FONTS, BRAND_GRADIENT, MUTED_GRADIENT } from '../constants';

// ─── Optional TTS ──────────────────────────────────────────────────────────────
let Speech = null;
try { Speech = require('expo-speech'); } catch { Speech = null; }
function rawSpeak(text, opts) {
  if (!text || !Speech?.speak) return;
  try { Speech.speak(String(text), { language: 'ar', rate: 0.85, ...opts }); } catch {}
}

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W   = Math.min(SCREEN_W - 72, 340);
const CARD_GAP = 14;
const SNAP     = CARD_W + CARD_GAP;
const SIDE_PAD = (SCREEN_W - CARD_W) / 2;

const DEFAULT_SCOPE = {
  surahId:    1,
  surahName:  'Al-Fatihah',
  arabicName: 'الفاتحة',
  totalAyahs: 7,
  ayahStart:  1,
  ayahEnd:    7,
};
const MAX_AYAH_RANGE = 30;

async function fetchScopeAyahs(surahId, start, end) {
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

function MistakeIcon({ type }) {
  switch (type) {
    case 'OMITTED_WORD':      return <Minus size={16} color={COLORS.gray500} />;
    case 'ADDED_WORD':        return <Plus size={16} color={COLORS.orange} />;
    case 'TAJWEED_VIOLATION': return <Star size={16} color={COLORS.yellow} />;
    default:                  return <AlertCircle size={16} color={COLORS.red} />;
  }
}

const TYPE_LABELS = {
  MISPRONUNCIATION:  'Mispronunciation',
  OMITTED_WORD:      'Omitted Word',
  ADDED_WORD:        'Extra Word',
  TAJWEED_VIOLATION: 'Tajweed',
};

function clamp(n, lo, hi) {
  n = Number.isFinite(+n) ? +n : lo;
  return Math.min(Math.max(n, lo), hi);
}

function showStreamError(err) {
  const msg = err?.message || '';
  let title = 'Something went wrong';
  let body  = 'Please try again. If it keeps happening, restart the app.';
  if (msg.toLowerCase().includes('permission')) {
    title = 'Microphone access needed';
    body  = 'Please allow microphone access in your phone Settings, then try again.';
  } else if (msg.toLowerCase().includes('timeout')) {
    title = "Can't reach the recitation service";
    body  = 'Make sure your internet connection is working, then try again.';
  } else if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('ws')) {
    title = 'Connection failed';
    body  = 'Check your internet connection and try again.';
  }
  Alert.alert(title, body);
}

export default function ReciteScreen({ navigation, route }) {
  const { surahs, surahsLoaded, setSurahData } = useApp();

  const [scope,            setScope]            = useState(DEFAULT_SCOPE);
  const [hasSelectedScope, setHasSelectedScope] = useState(false);
  const [pickerOpen,       setPickerOpen]       = useState(false);
  const [pickerStep,       setPickerStep]       = useState('surah');
  const [draftSurah,       setDraftSurah]       = useState(DEFAULT_SCOPE);
  const [draftStart,       setDraftStart]       = useState(DEFAULT_SCOPE.ayahStart);
  const [draftEnd,         setDraftEnd]         = useState(DEFAULT_SCOPE.ayahEnd);

  const [scopeAyahs,   setScopeAyahs]   = useState([]);
  const [ayahsLoading, setAyahsLoading] = useState(false);
  const [currentIdx,   setCurrentIdx]   = useState(0);
  const carouselRef = useRef(null);

  const [isRecording,    setIsRecording]    = useState(false);
  const [isConnected,    setIsConnected]    = useState(false);
  const [demoMode,       setDemoMode]       = useState(false);
  const [mistakes,       setMistakes]       = useState([]);
  const [showVerses,     setShowVerses]     = useState(true);
  const [isSaved,        setIsSaved]        = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [speakingWord,   setSpeakingWord]   = useState(null);

  // ✅ NEW: tracks the last "correct recitation" confirmation from the AI service
  const [lastResult, setLastResult] = useState(null);

  const speakingTimerRef  = useRef(null);
  const isRecordingRef    = useRef(false);
  const currentSessionRef = useRef(null);
  const lastResultTimerRef = useRef(null);

  // ✅ FIX: scopeRef always holds the latest scope so callbacks never
  // capture a stale closure (e.g. Al-Fatihah when user picked Al-Baqarah).
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  // Keep other refs in sync
  isRecordingRef.current    = isRecording;
  currentSessionRef.current = currentSession;

  // ─── speakWord: pause mic → play only the mispronounced ayah → resume ────────
  // ✅ FIX: uses scopeRef.current instead of scope so it always reflects the
  // currently selected surah, not the stale closure value.
  const speakWord = useCallback(async (correctWord, ayahNumber) => {
    if (!correctWord) return;

    audioStreamService.pauseStreaming?.();
    setSpeakingWord(correctWord === 'recite correct' ? 'Playing correct ayah…' : correctWord);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);

    speakingTimerRef.current = setTimeout(() => {
      setSpeakingWord(null);
      quranAudioService.stop?.();
      audioStreamService.resumeStreaming?.();
    }, 10000);

    try {
      if (ayahNumber && scopeRef.current?.surahId) {
        // ✅ scopeRef.current.surahId — always the correct selected surah
        await quranAudioService.playAyah(scopeRef.current.surahId, ayahNumber);
      } else {
        await new Promise((resolve) => {
          rawSpeak(correctWord, {
            onDone:    resolve,
            onStopped: resolve,
            onError:   resolve,
          });
          setTimeout(resolve, 5000);
        });
      }
    } catch (e) {
      console.log('[speakWord] error:', e.message);
    }

    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    setSpeakingWord(null);
    setTimeout(() => audioStreamService.resumeStreaming?.(), 500);
  }, []); // ✅ safe with empty deps because scopeRef.current is always fresh

  const mistakesByAyah = useMemo(() => {
    const m = new Map();
    for (const x of mistakes) {
      if (x.ayah == null) continue;
      const arr = m.get(x.ayah) || [];
      arr.push(x);
      m.set(x.ayah, arr);
    }
    return m;
  }, [mistakes]);

  // ─── Animations ──────────────────────────────────────────────────────────────
  const pulseScale = useSharedValue(1);
  const ring1      = useSharedValue(0.85);
  const ring2      = useSharedValue(0.85);

  const startAnims = () => {
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1,    { duration: 900, easing: Easing.inOut(Easing.ease) })
      ), -1, false);
    ring1.value = withRepeat(withTiming(1.55, { duration: 2000 }), -1, false);
    ring2.value = withRepeat(withSequence(
      withTiming(0.85, { duration: 0 }),
      withTiming(1.85, { duration: 2200 })
    ), -1, false);
  };

  const stopAnims = () => {
    cancelAnimation(pulseScale); cancelAnimation(ring1); cancelAnimation(ring2);
    pulseScale.value = withTiming(1);
    ring1.value      = withTiming(0.85);
    ring2.value      = withTiming(0.85);
  };

  const micCircleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    backgroundColor: isRecording ? COLORS.primary : '#F9FAFB',
  }));
  const ring1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring1.value }],
    opacity: isRecording ? Math.max(0, (1.55 - ring1.value) * 0.6) : 0,
  }));
  const ring2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ring2.value }],
    opacity: isRecording ? Math.max(0, (1.85 - ring2.value) * 0.35) : 0,
  }));

  // ─── Load surahs ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!surahsLoaded) {
      quranService.getAllSurahs()
        .then((list) => Array.isArray(list) && setSurahData(list))
        .catch(() => {});
    }
  }, [surahsLoaded, setSurahData]);

  // ─── Load ayahs when scope changes ───────────────────────────────────────────
  useEffect(() => {
    if (!hasSelectedScope) { setScopeAyahs([]); return; }
    let cancelled = false;
    setAyahsLoading(true);
    (async () => {
      const ayahs = await fetchScopeAyahs(scope.surahId, scope.ayahStart, scope.ayahEnd);
      if (!cancelled) {
        setScopeAyahs(ayahs);
        setCurrentIdx(0);
        setAyahsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hasSelectedScope, scope.surahId, scope.ayahStart, scope.ayahEnd]);

  // ─── Stream callbacks ─────────────────────────────────────────────────────────
  // ✅ FIX: All references to scope inside this effect now use scopeRef.current
  // so they always reflect the user's current selection, not the stale initial value.
  useEffect(() => {
    audioStreamService.setCallbacks(
      (msg) => {
        if (!msg || typeof msg !== 'object') return;

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
          setLastResult(null); // clear any "correct" banner — a mistake just came in

          if (msg.play_audio) {
            speakWord(stamped[0]?.correct || '', msg.ayah);
          }

        } else if (msg.type === 'unclear') {
          setMistakes((prev) => [{
            type: 'MISPRONUNCIATION', incorrect: '', correct: '',
            tajweedRule: null, severity: null,
            tip: 'Could not hear clearly — please speak louder and try again.',
            ayah: msg.ayah ?? null, ts: Date.now(),
          }, ...prev].slice(0, 20));

        } else if (msg.type === 'out_of_scope') {
          // ✅ FIX: use scopeRef.current so the alert always shows the
          // currently selected surah/ayah range, not the stale Al-Fatihah default.
          const currentScope = scopeRef.current;
          const correctAyah  = currentScope.ayahStart;

          setMistakes((prev) => [{
            type: 'MISPRONUNCIATION',
            incorrect: msg.you_recited || '',
            correct: '',
            tajweedRule: null,
            severity: 'high',
            tip: `Wrong ayah. Please recite Ayah ${currentScope.ayahStart}–${currentScope.ayahEnd} of ${currentScope.surahName}.`,
            ayah: correctAyah,
            ts: Date.now(),
          }, ...prev].slice(0, 20));
          setLastResult(null);
          speakWord('recite correct', correctAyah);

        } else if (msg.type === 'ok') {
          // ✅ NEW: explicit confirmation that the recited ayah matched correctly
          if (lastResultTimerRef.current) clearTimeout(lastResultTimerRef.current);
          setLastResult({ ayah: msg.ayah, correct: true, ts: Date.now() });
          lastResultTimerRef.current = setTimeout(() => {
            setLastResult(null);
          }, 3000);

        } else if (msg.type === 'error') {
          Alert.alert(
            'Analysis problem',
            msg.message || 'The recitation engine had a problem. Tap the mic to retry.',
          );
        }
      },
      (connected) => setIsConnected(connected),
      () => {}
    );

    return () => {
      audioStreamService.stopStreaming().catch(() => {});
      audioStreamService.stopDemoMode();
      cancelAnimation(pulseScale);
      cancelAnimation(ring1);
      cancelAnimation(ring2);
      if (lastResultTimerRef.current) clearTimeout(lastResultTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Prefilled scope from navigation ─────────────────────────────────────────
  useEffect(() => {
    const pre = route?.params?.prefilledScope;
    if (!pre) return;
    setScope({
      surahId:    pre.surahId,
      surahName:  pre.surahName   || `Surah ${pre.surahId}`,
      arabicName: pre.surahNameAr || '',
      totalAyahs: pre.totalAyahs  || pre.ayahEnd,
      ayahStart:  pre.ayahStart,
      ayahEnd:    pre.ayahEnd,
    });
    setHasSelectedScope(true);
    navigation.setParams({ prefilledScope: undefined });
  }, [route?.params?.prefilledScope]);

  // ─── Cleanup on blur ─────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (isRecordingRef.current) {
          audioStreamService.stopStreaming().catch(() => {});
          audioStreamService.stopDemoMode();
          stopAnims();
          if (currentSessionRef.current) {
            sessionService.abandonSession(currentSessionRef.current.id).catch(() => {});
          }
          setIsRecording(false);
          setIsConnected(false);
          setDemoMode(false);
          setCurrentSession(null);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  // ─── Picker ───────────────────────────────────────────────────────────────────
  const openPicker = () => {
    if (isRecording) return;
    setDraftSurah({
      surahId:    scope.surahId,
      surahName:  scope.surahName,
      arabicName: scope.arabicName,
      totalAyahs: scope.totalAyahs,
    });
    setDraftStart(scope.ayahStart);
    setDraftEnd(scope.ayahEnd);
    setPickerStep('surah');
    setPickerOpen(true);
  };

  const pickSurah = (s) => {
    const total = s.totalAyahs ?? s.ayahCount ?? s.numberOfAyahs ?? 7;
    setDraftSurah({
      surahId:    s.surahNumber ?? s.id ?? s.number ?? s.surahId,
      surahName:  s.surahName ?? s.englishName ?? s.name ?? 'Surah',
      arabicName: s.surahNameAr ?? s.arabicName ?? s.name_ar ?? '',
      totalAyahs: total,
    });
    setDraftStart(1);
    setDraftEnd(Math.min(total, MAX_AYAH_RANGE));
    setPickerStep('range');
  };

  const confirmRange = () => {
    const total  = draftSurah.totalAyahs || 1;
    const start  = clamp(draftStart, 1, total);
    const maxEnd = Math.min(total, start + MAX_AYAH_RANGE - 1);
    const end    = clamp(draftEnd, start, maxEnd);
    setScope({
      surahId:    draftSurah.surahId,
      surahName:  draftSurah.surahName,
      arabicName: draftSurah.arabicName,
      totalAyahs: total,
      ayahStart:  start,
      ayahEnd:    end,
    });
    setHasSelectedScope(true);
    setPickerOpen(false);
  };

  const goToIdx = (idx) => {
    const i = clamp(idx, 0, Math.max(0, scopeAyahs.length - 1));
    setCurrentIdx(i);
    carouselRef.current?.scrollToOffset({ offset: i * SNAP, animated: true });
  };

  // ─── Start / Stop recording ───────────────────────────────────────────────────
  // ✅ FIX: removed leftover handleSave code (setIsSaved(true), setCurrentSession(null)
  // immediately, and a setTimeout that referenced an undefined `score` variable and
  // a `currentSession` that had just been nulled out). That block ran unconditionally
  // 1.5s after every tap of the mic — regardless of whether the user had recited
  // anything — and was the source of both the crash and the bogus "feedback".
  const handleToggle = async () => {
    if (!hasSelectedScope) {
      Alert.alert('Select ayah range first', 'Tap "Select Ayah Range" above to choose what to recite.');
      return;
    }

    if (isRecording) {
      await audioStreamService.stopStreaming().catch(() => {});
      audioStreamService.stopDemoMode();
      stopAnims();
      setIsRecording(false);
      setIsConnected(false);
      setDemoMode(false);
      return;
    }

    setMistakes([]);
    setLastResult(null);
    setCurrentSession(null);

    let session;
    try {
      session = await sessionService.createSession({
        surahId:   scope.surahId,
        ayahStart: scope.ayahStart,
        ayahEnd:   scope.ayahEnd,
      });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        Alert.alert('Please sign in again', 'Your session has expired.');
      } else if (status === 0 || err?.message?.toLowerCase().includes('network')) {
        Alert.alert("Can't reach the server", 'Check your internet connection and try again.');
      } else {
        Alert.alert("Couldn't start recitation", 'Please try again.');
      }
      return;
    }

    if (!session || !session.id) {
      Alert.alert('Error', 'Failed to create session. Please try again.');
      return;
    }

    setCurrentSession(session);

    try {
      await audioStreamService.startStreaming({
        sessionId:  session.id,
        surahId:    scope.surahId,
        ayahStart:  scope.ayahStart,
        ayahEnd:    scope.ayahEnd,
      });
      setDemoMode(false);
    } catch (err) {
      console.error('[ReciteScreen] startStreaming failed:', err?.message);
      showStreamError(err);
      sessionService.abandonSession(session.id).catch(() => {});
      setCurrentSession(null);
      setIsRecording(false);
      setIsConnected(false);
      setDemoMode(false);
      stopAnims();
      return;
    }

    startAnims();
    setIsRecording(true);
  };

  // ─── Save session ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!currentSession) { Alert.alert('Info', 'Start recording first'); return; }
    setSaving(true);

    const sessionToSave   = currentSession;
    const scopeToSave     = { ...scope };
    const mistakesToSave  = [...mistakes];
    const score           = clamp(Math.round(100 - mistakesToSave.length * 5), 0, 100);

    try {
      await audioStreamService.stopStreaming().catch(() => {});
      audioStreamService.stopDemoMode();
      stopAnims();
      setIsRecording(false);
      setIsConnected(false);
      setDemoMode(false);

      await sessionService.completeSession(sessionToSave.id, {
        transcript:    '',
        accuracyScore: score,
      });

      setIsSaved(true);
      setCurrentSession(null);
      setTimeout(() => {
        setIsSaved(false);
        navigation.navigate('Track', {
          newSession: {
            id:            sessionToSave.id,
            surahId:       scopeToSave.surahId,
            surahName:     scopeToSave.surahName,
            arabicName:    scopeToSave.arabicName,
            ayahStart:     scopeToSave.ayahStart,
            ayahEnd:       scopeToSave.ayahEnd,
            accuracyScore: score,
            mistakesCount: mistakesToSave.length,
            wrongAyahs:    [...new Set(mistakesToSave.map(m => m.ayah).filter(Boolean))],
            mistakes:      mistakesToSave,
            completedAt:   new Date().toISOString(),
          }
        });
      }, 1500);

    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to save session');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    await audioStreamService.stopStreaming().catch(() => {});
    audioStreamService.stopDemoMode();
    stopAnims();
    setIsRecording(false);
    setIsConnected(false);
    setDemoMode(false);
    setMistakes([]);
    setLastResult(null);
    if (currentSession) {
      sessionService.abandonSession(currentSession.id).catch(() => {});
      setCurrentSession(null);
    }
  };

  const visibleMistakes = mistakes.slice(0, 3);
  const micDisabled = !hasSelectedScope;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="Recite Quran" onBack={() => navigation.goBack()} showSearch={false} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Surah Banner */}
        <View style={s.sec}>
          <LinearGradient
            colors={hasSelectedScope ? BRAND_GRADIENT : MUTED_GRADIENT}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={s.banner}
          >
            <View style={s.blobLg} />
            <View style={s.blobSm} />
            <View style={{ flex: 1 }}>
              <View style={s.bannerMeta}>
                <BookOpen size={14} color="rgba(255,255,255,0.9)" />
                <Text style={s.bannerMetaTxt}>
                  {hasSelectedScope ? 'Selected Recitation' : 'No selection'}
                </Text>
              </View>
              <Text style={s.bannerSurah}>{hasSelectedScope ? scope.surahName : 'Choose ayah range'}</Text>
              <Text style={s.bannerAyah}>
                {hasSelectedScope ? `Ayah ${scope.ayahStart}–${scope.ayahEnd}` : 'Tap below to begin'}
              </Text>
            </View>
            {scope.arabicName && hasSelectedScope
              ? <Text style={s.bannerArabic}>{scope.arabicName}</Text>
              : <BookOpen size={48} color="rgba(255,255,255,0.18)" />}
          </LinearGradient>
        </View>

        {/* Range selector */}
        <View style={[s.sec, { marginTop: 12 }]}>
          <TouchableOpacity
            onPress={openPicker}
            disabled={isRecording}
            activeOpacity={0.85}
            style={[s.selectorBtn, isRecording && s.selectorBtnDisabled]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.selectorLbl}>
                {hasSelectedScope ? 'Selected Range' : 'Select Ayah Range'}
              </Text>
              <Text style={s.selectorVal}>
                {hasSelectedScope
                  ? `${scope.surahName} · ${scope.ayahStart}–${scope.ayahEnd}`
                  : 'Tap to choose Surah and Ayah'}
              </Text>
            </View>
            <ChevronDown size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        {/* Toggles */}
        <View style={s.toggleRow}>
          <View style={s.toggleItem}>
            <Text style={s.toggleLbl}>Show verses</Text>
            <Switch
              value={showVerses}
              onValueChange={setShowVerses}
              trackColor={{ false: COLORS.gray200, true: COLORS.primary }}
              thumbColor={COLORS.white}
            />
          </View>
          <View style={s.toggleItem}>
            <Text style={s.toggleLbl}>
              {demoMode ? 'Demo' : isConnected ? 'Live' : 'Offline'}
            </Text>
            <View style={[
              s.statusDot,
              { backgroundColor: demoMode ? COLORS.orange : isConnected ? '#22C55E' : COLORS.gray300 },
            ]} />
          </View>
        </View>

        {/* Ayah carousel */}
        {showVerses && (
          <View style={s.carouselWrap}>
            {!hasSelectedScope ? (
              <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
                <BookOpen size={36} color={COLORS.gray300} />
                <Text style={s.placeholderTitle}>No ayahs selected</Text>
                <Text style={s.placeholderSub}>Choose a Surah and ayah range to start.</Text>
              </View>
            ) : ayahsLoading ? (
              <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={s.placeholderSub}>Loading verses…</Text>
              </View>
            ) : scopeAyahs.length === 0 ? (
              <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
                <Text style={s.placeholderTitle}>Couldn't load verses</Text>
                <Text style={s.placeholderSub}>Try a different range.</Text>
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
                    const isActive  = index === currentIdx;
                    const errors    = mistakesByAyah.get(item.ayahNumber) || [];
                    const hasErrors = errors.length > 0;
                    return (
                      <View style={[s.cardOuter, { width: CARD_W, marginHorizontal: CARD_GAP / 2 }]}>
                        <View style={[
                          s.ayahCard,
                          !isActive && s.ayahCardFaded,
                          hasErrors && s.ayahCardError,
                        ]}>
                          <View style={s.ayahCardHeader}>
                            <View style={[s.ayahNumPill, hasErrors && s.ayahNumPillError]}>
                              <Text style={[s.ayahNumTxt, hasErrors && s.ayahNumTxtError]}>
                                Ayah {item.ayahNumber}
                              </Text>
                            </View>
                            {hasErrors ? (
                              <View style={s.errorBadge}>
                                <View style={s.errorBadgeDot} />
                                <Text style={s.errorBadgeTxt}>
                                  {errors.length} mistake{errors.length === 1 ? '' : 's'}
                                </Text>
                              </View>
                            ) : (
                              <Text style={s.ayahCount}>{index + 1} / {scopeAyahs.length}</Text>
                            )}
                          </View>
                          <Text style={s.ayahArabic} numberOfLines={6}>
                            {item.uthmaniText || item.text || ''}
                          </Text>
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

        {/* Microphone */}
        <View style={s.micWrap}>
          <Animated.View style={[s.ring, ring2Style]} />
          <Animated.View style={[s.ring, ring1Style]} />
          <View style={[s.outerCircle, micDisabled && s.outerCircleDis]}>
            <Animated.View style={[s.micCircle, micCircleStyle, micDisabled && s.micCircleDis]}>
              <TouchableOpacity
                onPress={handleToggle}
                style={[s.micBtn, isRecording && s.micBtnActive, micDisabled && s.micBtnDis]}
                activeOpacity={micDisabled ? 1 : 0.85}
              >
                <Mic size={40} color={micDisabled ? COLORS.gray300 : isRecording ? COLORS.primary : COLORS.white} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* Status */}
        <View style={s.statusSec}>
          {micDisabled
            ? <Text style={s.idleTxt}>Select an ayah range to enable recitation</Text>
            : isRecording
              ? (
                <View style={s.recordingRow}>
                  <View style={s.recDot} />
                  <Text style={s.recTxt}>
                    {demoMode ? 'Recording (Demo Mode)…' : 'Recording Started…'}
                  </Text>
                </View>
              )
              : <Text style={s.idleTxt}>Tap the microphone to start reciting</Text>
          }

          {speakingWord ? (
            <View style={s.speakingBar}>
              <View style={s.speakingDot} />
              <Text style={s.speakingLbl}>SPEAKING</Text>
              <Text style={s.speakingWord} numberOfLines={1}>{speakingWord}</Text>
            </View>
          ) : null}

          {/* ✅ NEW: Correct recitation confirmation banner */}
          {lastResult?.correct ? (
            <View style={s.correctBanner}>
              <Check size={14} color={COLORS.white} />
              <Text style={s.correctBannerTxt}>
                Correct{lastResult.ayah ? ` — Ayah ${lastResult.ayah}` : ''}
              </Text>
            </View>
          ) : null}

          {/* Mistake panel */}
          <View style={s.mistakePanel}>
            <View style={s.mistakeHeader}>
              <View style={s.mistakeDot} />
              <Text style={s.mistakeLbl}>Mistake Detection</Text>
              {mistakes.length > 0 && (
                <Text style={s.mistakeCount}>{mistakes.length}</Text>
              )}
            </View>

            {visibleMistakes.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.listeningTxt}>
                  {isRecording ? 'Listening for recitation errors…' : 'Mistakes will appear here.'}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {visibleMistakes.map((m, i) => (
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
                        {m.correct
                          ? <Pressable hitSlop={8} onPress={() => speakWord(m.correct, m.ayah)}>
                              <Text style={s.mPlay}>▶</Text>
                            </Pressable>
                          : null}
                      </View>
                      {m.correct ? <Text style={s.mArabic}>{m.correct}</Text> : null}
                      {m.tip     ? <Text style={s.mTip}>{m.tip}</Text>        : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* Buttons */}
        <View style={s.btnRow}>
          <Button onPress={handleReset} variant="outline" size="md" style={s.btn}>Reset</Button>
          <Button onPress={handleSave} variant="secondary" size="md" loading={saving} style={s.btn}>
            {isSaved ? '✓ Saved!' : 'Save Session'}
          </Button>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ─── Picker Modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            <View style={s.modalGrip} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                {pickerStep === 'surah' ? 'Choose Surah' : 'Ayah Range'}
              </Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={10} style={s.modalCloseBtn}>
                <X size={20} color={COLORS.gray500} />
              </TouchableOpacity>
            </View>

            {pickerStep === 'surah' ? (
              <FlatList
                data={(surahs && surahs.length) ? surahs : []}
                keyExtractor={(item, idx) => String(item.surahNumber ?? item.id ?? idx)}
                ItemSeparatorComponent={() => <View style={s.sep} />}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const id       = item.surahNumber ?? item.id ?? item.number;
                  const name     = item.surahName ?? item.englishName ?? item.name;
                  const arab     = item.surahNameAr ?? item.arabicName ?? '';
                  const total    = item.totalAyahs ?? item.ayahCount ?? item.numberOfAyahs ?? 0;
                  const type     = item.surahType ?? '';
                  const selected = id === draftSurah.surahId;
                  return (
                    <TouchableOpacity
                      onPress={() => pickSurah(item)}
                      activeOpacity={0.7}
                      style={[s.surahRow, selected && s.surahRowSel]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.surahName}>{name}</Text>
                        <View style={s.surahMetaRow}>
                          {type ? (
                            <View style={[s.tag, type === 'Makki' ? s.tagMakki : s.tagMadni]}>
                              <Text style={[s.tagTxt, type === 'Makki' ? s.tagMakkiTxt : s.tagMadniTxt]}>
                                {type}
                              </Text>
                            </View>
                          ) : null}
                          <Text style={s.surahMeta}>{total} verses</Text>
                        </View>
                      </View>
                      {arab ? <Text style={s.surahArabic}>{arab}</Text> : null}
                      {selected ? <Check size={18} color={COLORS.primary} /> : null}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={() => (
                  <Text style={s.emptyListTxt}>Loading surahs…</Text>
                )}
              />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
                <View style={s.rangeHeader}>
                  <Text style={s.rangeSurahName}>{draftSurah.surahName}</Text>
                  <Text style={s.rangeSurahMeta}>
                    {draftSurah.totalAyahs} verses · max {MAX_AYAH_RANGE} per session
                  </Text>
                </View>
                <RangeStepper
                  label="Start ayah"
                  value={draftStart}
                  min={1}
                  max={draftSurah.totalAyahs}
                  onChange={(v) => {
                    setDraftStart(v);
                    if (draftEnd < v) setDraftEnd(v);
                    if (draftEnd > v + MAX_AYAH_RANGE - 1) setDraftEnd(v + MAX_AYAH_RANGE - 1);
                  }}
                />
                <View style={s.stepperDivider} />
                <RangeStepper
                  label="End ayah"
                  value={draftEnd}
                  min={draftStart}
                  max={Math.min(draftSurah.totalAyahs, draftStart + MAX_AYAH_RANGE - 1)}
                  onChange={setDraftEnd}
                />
                <View style={s.rangeBadgeRow}>
                  <View style={s.rangeBadge}>
                    <Text style={s.rangeBadgeTxt}>{draftStart} → {draftEnd}</Text>
                    <Text style={s.rangeBadgeSub}>
                      {draftEnd - draftStart + 1} verse{draftEnd === draftStart ? '' : 's'}
                    </Text>
                  </View>
                </View>
                <View style={s.rangeBtnRow}>
                  <Button onPress={() => setPickerStep('surah')} variant="outline" size="md" style={{ flex: 1 }}>
                    Back
                  </Button>
                  <Button onPress={confirmRange} variant="primary" size="md" style={{ flex: 1 }}>
                    Use {draftStart}–{draftEnd}
                  </Button>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────
function RangeStepper({ label, value, min, max, onChange }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onChange(clamp(n, min, max));
    else setText(String(value));
  };
  const dec   = () => onChange(clamp(value - 1, min, max));
  const inc   = () => onChange(clamp(value + 1, min, max));
  return (
    <View style={s.stepperRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.stepperLbl}>{label}</Text>
        <Text style={s.stepperRange}>{min}–{max}</Text>
      </View>
      <View style={s.stepperCtrl}>
        <TouchableOpacity onPress={dec} disabled={value <= min} style={[s.stepBtn, value <= min && s.stepBtnDis]} activeOpacity={0.7}>
          <Minus size={18} color={value <= min ? COLORS.gray300 : COLORS.primary} />
        </TouchableOpacity>
        <TextInput
          value={text}
          onChangeText={(t) => setText(t.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          maxLength={4}
          selectTextOnFocus
          style={s.stepInput}
          returnKeyType="done"
        />
        <TouchableOpacity onPress={inc} disabled={value >= max} style={[s.stepBtn, value >= max && s.stepBtnDis]} activeOpacity={0.7}>
          <Plus size={18} color={value >= max ? COLORS.gray300 : COLORS.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: COLORS.white },
  content:       { paddingBottom: 32 },
  sec:           { paddingHorizontal: 24, marginTop: 14 },
  banner:        { borderRadius: 26, padding: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden', position: 'relative' },
  blobLg:        { position: 'absolute', top: -50, right: -50, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.06)' },
  blobSm:        { position: 'absolute', bottom: -30, left: -30, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.05)' },
  bannerMeta:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  bannerMetaTxt: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: 1 },
  bannerSurah:   { fontSize: 22, fontWeight: '800', color: COLORS.white, letterSpacing: -0.3 },
  bannerAyah:    { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2, fontWeight: '600' },
  bannerArabic:  { fontFamily: FONTS.quran, fontSize: 30, color: COLORS.white, opacity: 0.95 },
  selectorBtn:         { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gray100, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderWidth: 1, borderColor: COLORS.gray100 },
  selectorBtnDisabled: { opacity: 0.5 },
  selectorLbl:         { fontSize: 10, fontWeight: '800', color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 0.8 },
  selectorVal:         { fontSize: 14, fontWeight: '700', color: COLORS.primary, marginTop: 3 },
  toggleRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 14 },
  toggleItem:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleLbl:     { fontSize: 10, fontWeight: '800', color: COLORS.gray400, textTransform: 'uppercase', letterSpacing: 0.8 },
  statusDot:     { width: 8, height: 8, borderRadius: 4 },
  carouselWrap:  { marginTop: 10, marginBottom: 0 },
  cardOuter:     {},
  ayahCard:      { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray100, borderRadius: 22, padding: 18, minHeight: 200, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 4 },
  ayahCardFaded: { opacity: 0.32, transform: [{ scale: 0.94 }] },
  ayahCardError: { borderColor: COLORS.red, borderWidth: 2, backgroundColor: COLORS.redLight, shadowColor: COLORS.red, shadowOpacity: 0.18 },
  ayahCardHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  ayahNumPill:      { backgroundColor: COLORS.secondaryUltraLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  ayahNumPillError: { backgroundColor: COLORS.red },
  ayahNumTxt:       { fontSize: 11, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.4 },
  ayahNumTxtError:  { color: COLORS.white },
  errorBadge:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.red },
  errorBadgeDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.red },
  errorBadgeTxt:    { fontSize: 9, fontWeight: '800', color: COLORS.red, letterSpacing: 0.6, textTransform: 'uppercase' },
  ayahCount:        { fontSize: 10, fontWeight: '700', color: COLORS.gray400, letterSpacing: 0.6 },
  ayahArabic:       { fontFamily: FONTS.quran, fontSize: 26, lineHeight: 54, textAlign: 'right', color: COLORS.primary, writingDirection: 'rtl' },
  placeholderCard:  { backgroundColor: COLORS.white, borderRadius: 22, borderWidth: 1, borderColor: COLORS.gray100, borderStyle: 'dashed', padding: 24, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  placeholderTitle: { fontSize: 14, fontWeight: '700', color: COLORS.gray500 },
  placeholderSub:   { fontSize: 12, color: COLORS.gray400, textAlign: 'center' },
  navRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 4 },
  navBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
  navBtnDis: { backgroundColor: COLORS.gray100 },
  navTxt:    { fontSize: 12, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.6, textTransform: 'uppercase', minWidth: 80, textAlign: 'center' },
  micWrap:       { alignItems: 'center', justifyContent: 'center', height: 200, marginTop: 4 },
  ring:          { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 2, borderColor: `${COLORS.primary}28` },
  outerCircle:   { width: 160, height: 160, borderRadius: 80, borderWidth: 2, borderStyle: 'dashed', borderColor: COLORS.gray200, alignItems: 'center', justifyContent: 'center' },
  outerCircleDis:{ borderColor: COLORS.gray100 },
  micCircle:     { width: 130, height: 130, borderRadius: 65, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 22, elevation: 10 },
  micCircleDis:  { shadowOpacity: 0.04 },
  micBtn:        { width: 82, height: 82, borderRadius: 41, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  micBtnActive:  { backgroundColor: COLORS.white },
  micBtnDis:     { backgroundColor: COLORS.gray200 },
  statusSec:    { paddingHorizontal: 24, alignItems: 'center', gap: 14 },
  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recDot:       { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.red },
  recTxt:       { fontSize: 12, fontWeight: '800', color: COLORS.primary, textTransform: 'uppercase', letterSpacing: 1.5 },
  idleTxt:      { fontSize: 13, color: COLORS.gray400, textAlign: 'center' },
  speakingBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.red, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  speakingDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.white },
  speakingLbl:  { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 1, textTransform: 'uppercase' },
  speakingWord: { fontFamily: FONTS.quran, fontSize: 18, color: COLORS.white, marginLeft: 4, maxWidth: 200 },
  // ✅ NEW: green "correct recitation" confirmation banner
  correctBanner:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#16A34A', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  correctBannerTxt: { fontSize: 12, fontWeight: '800', color: COLORS.white, letterSpacing: 0.4 },
  mistakePanel:  { width: '100%', maxWidth: 360 },
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
  btnRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 24, marginTop: 22 },
  btn:    { flex: 1, borderRadius: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: COLORS.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 28, maxHeight: '88%' },
  modalGrip:     { width: 38, height: 4, borderRadius: 2, backgroundColor: COLORS.gray200, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  modalTitle:    { fontSize: 17, fontWeight: '800', color: COLORS.primary },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.gray100, alignItems: 'center', justifyContent: 'center' },
  sep:          { height: 1, backgroundColor: COLORS.gray100, marginHorizontal: 20 },
  surahRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  surahRowSel:  { backgroundColor: COLORS.secondaryUltraLight },
  surahName:    { fontSize: 15, fontWeight: '700', color: COLORS.primary, letterSpacing: -0.2 },
  surahMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  surahMeta:    { fontSize: 11, color: COLORS.gray500, fontWeight: '600' },
  surahArabic:  { fontFamily: FONTS.quran, fontSize: 22, color: COLORS.primary, marginRight: 6 },
  tag:          { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  tagMakki:     { backgroundColor: '#FFF7ED' },
  tagMakkiTxt:  { color: '#C2410C' },
  tagMadni:     { backgroundColor: '#EFF6FF' },
  tagMadniTxt:  { color: '#1D4ED8' },
  tagTxt:       { fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  emptyListTxt: { textAlign: 'center', color: COLORS.gray400, fontSize: 13, paddingVertical: 32 },
  rangeHeader:    { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  rangeSurahName: { fontSize: 18, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.3 },
  rangeSurahMeta: { fontSize: 11, fontWeight: '600', color: COLORS.gray500, marginTop: 2 },
  stepperRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  stepperLbl:     { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  stepperRange:   { fontSize: 10, fontWeight: '700', color: COLORS.gray400, marginTop: 2, letterSpacing: 0.4 },
  stepperCtrl:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn:        { width: 36, height: 36, borderRadius: 12, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
  stepBtnDis:     { backgroundColor: COLORS.gray100 },
  stepInput:      { width: 66, height: 40, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gray200, textAlign: 'center', fontSize: 16, fontWeight: '800', color: COLORS.primary, paddingVertical: 0, backgroundColor: COLORS.white },
  stepperDivider: { height: 1, backgroundColor: COLORS.gray100, marginHorizontal: 20 },
  rangeBadgeRow:  { paddingHorizontal: 20, paddingTop: 16, alignItems: 'center' },
  rangeBadge:     { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center' },
  rangeBadgeTxt:  { fontSize: 22, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.3 },
  rangeBadgeSub:  { fontSize: 10, fontWeight: '700', color: COLORS.gray500, marginTop: 2, letterSpacing: 0.6, textTransform: 'uppercase' },
  rangeBtnRow:    { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 18 },
});