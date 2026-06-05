import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Switch, StyleSheet,
  Alert, FlatList, Dimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence,
  withTiming, cancelAnimation, Easing,
} from 'react-native-reanimated';
import {
  Shuffle, ChevronDown, Mic, ChevronLeft, ChevronRight,
  BookOpen, AlertCircle, Minus, Plus, Star,
} from 'lucide-react-native';
import Header from '../components/common/Header';
import { quranService } from '../services/quranService';
import { sessionService } from '../services/sessionService';
import { audioStreamService } from '../services/audioStreamService';
import { quranAudioService } from '../services/quranAudioService';
import { useApp } from '../context/AppContext';
import { COLORS, FONTS } from '../constants';
import { fetchScopeAyahs, countWords, countLetters } from '../utils/scopeAyahs';

// Optional TTS — gracefully degrades if expo-speech isn't installed
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

function clamp(n, lo, hi) {
  n = Number.isFinite(+n) ? +n : lo;
  return Math.min(Math.max(n, lo), hi);
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

function countByType(mistakes) {
  const counts = {};
  for (const m of mistakes) {
    const t = m?.type;
    if (!t) continue;
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

function pickMostCommon(counts) {
  let max = 0, winner = null;
  for (const t of ['MISPRONUNCIATION', 'OMITTED_WORD', 'ADDED_WORD', 'TAJWEED_VIOLATION']) {
    if ((counts[t] || 0) > max) { max = counts[t]; winner = t; }
  }
  return winner;
}

// Simple word display without external store dependency
function AyahText({ item }) {
  const words = (item.uthmaniText || item.text || '').split(/\s+/).filter(Boolean);
  return (
    <View style={s.ayahArabicWrap}>
      {words.map((w, wi) => (
        <Text key={`${item.ayahNumber}-${wi}`} style={s.ayahArabicWord}>{w}</Text>
      ))}
    </View>
  );
}

export default function RetainScreen({ navigation }) {
  const { surahs, surahsLoaded, setSurahData } = useApp();

  const [showVerses,     setShowVerses]     = useState(true);
  const [isRecording,    setIsRecording]    = useState(false);
  const [surah,          setSurah]          = useState(null);
  const [verseRange,     setVerseRange]     = useState([1, 7]);
  const [isDemo,         setIsDemo]         = useState(false);
  const [scopeAyahs,     setScopeAyahs]     = useState([]);
  const [ayahsLoading,   setAyahsLoading]   = useState(false);
  const [currentIdx,     setCurrentIdx]     = useState(0);
  const [mistakes,       setMistakes]       = useState([]);
  const [speakingWord,   setSpeakingWord]   = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  const sessionRef       = useRef(null);
  const carouselRef      = useRef(null);
  const speakingTimerRef = useRef(null);
  const isDemoRef        = useRef(false);
  const isRecordingRef   = useRef(false);
  const mistakeCountsRef = useRef({});

  // ✅ FIX: surahRef always holds the latest surah so speakWord and
  // wireCallbacks never capture a stale closure value.
  const surahRef = useRef(surah);
  useEffect(() => { surahRef.current = surah; }, [surah]);

  // Also keep verseRange fresh in a ref for callbacks
  const verseRangeRef = useRef(verseRange);
  useEffect(() => { verseRangeRef.current = verseRange; }, [verseRange]);

  const pulse = useSharedValue(1);
  const ring  = useSharedValue(0.85);

  // ── Load surahs ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!surahsLoaded) {
      quranService.getAllSurahs().then(setSurahData).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (surahs.length && !surah) pickRandom();
  }, [surahs]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(ring);
      if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
      if (isRecordingRef.current) {
        cleanupRecording({ abandon: true }).catch(() => {});
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (isRecordingRef.current) {
          cleanupRecording({ abandon: true }).catch(() => {});
        }
      };
    }, [])
  );

  // ── Pick random surah ────────────────────────────────────────────────────────
  const pickRandom = async () => {
    if (!surahs.length) return;
    const random = surahs[Math.floor(Math.random() * surahs.length)];
    setSurah(random);
    const total = random.totalAyahs || 7;
    const start = Math.max(1, Math.min(total - 5, Math.floor(Math.random() * total) + 1));
    const end   = Math.min(total, start + Math.min(20, total - start));
    setVerseRange([start, end]);
    setCurrentIdx(0);
    setAyahsLoading(true);
    try {
      const ayahs = await fetchScopeAyahs(random.surahNumber, start, end);
      setScopeAyahs(ayahs);
    } catch {
      setScopeAyahs([]);
    } finally {
      setAyahsLoading(false);
    }
  };

  // ── Carousel navigation ──────────────────────────────────────────────────────
  const goToIdx = (idx) => {
    const i = clamp(idx, 0, Math.max(0, scopeAyahs.length - 1));
    setCurrentIdx(i);
    carouselRef.current?.scrollToOffset({ offset: i * SNAP, animated: true });
  };

  // ── Animations ───────────────────────────────────────────────────────────────
  const startAnims = () => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1,    { duration: 900, easing: Easing.inOut(Easing.ease) })
      ), -1, false
    );
    ring.value = withRepeat(withTiming(1.55, { duration: 2000 }), -1, false);
  };

  const stopAnims = () => {
    cancelAnimation(pulse); cancelAnimation(ring);
    pulse.value = withTiming(1); ring.value = withTiming(0.85);
  };

  // ── TTS / Audio feedback ─────────────────────────────────────────────────────
  // ✅ FIX: uses surahRef.current instead of closing over `surah` state,
  // so this never plays audio for the wrong surah even if the callback
  // was registered before a surah change.
  const speakWord = useCallback(async (text, ayahNumber) => {
    if (!text) return;
    setSpeakingWord(text);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);

    // Safety: always clear after 10s
    speakingTimerRef.current = setTimeout(() => setSpeakingWord(null), 10000);

    try {
      // ✅ Always reads the latest surah via surahRef.current
      if (ayahNumber && surahRef.current?.surahNumber) {
        await quranAudioService.playAyah(surahRef.current.surahNumber, ayahNumber);
      } else {
        await new Promise((resolve) => {
          rawSpeak(text, {
            onDone:    resolve,
            onStopped: resolve,
            onError:   resolve,
          });
          setTimeout(resolve, 5000);
        });
      }
    } catch (e) {
      console.log('[RetainScreen] speakWord error:', e.message);
    }

    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    setSpeakingWord(null);
  }, []); // ✅ safe with empty deps because we use surahRef.current

  // ── Wire stream callbacks ────────────────────────────────────────────────────
  // ✅ FIX: empty deps [] is now safe because speakWord uses surahRef.current
  // and out_of_scope uses verseRangeRef.current — both always fresh.
  const wireCallbacks = useCallback(() => {
    mistakeCountsRef.current = {}; // reset counts for new session

    audioStreamService.setCallbacks(
      async (msg) => {
        if (!msg || typeof msg !== 'object') return;
        console.log('[RetainScreen] stream msg:', msg);

        // ── mistake event ──
        if (msg.type === 'mistake' && Array.isArray(msg.mistakes)) {
          for (const m of msg.mistakes) {
            const t = m?.type;
            if (!t) continue;
            mistakeCountsRef.current[t] = (mistakeCountsRef.current[t] || 0) + 1;
          }

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

          if (msg.play_audio && msg.ayah) {
            speakWord(stamped[0]?.correct || '', msg.ayah);
          }
          return;
        }

        // ── out_of_scope ──
        // ✅ FIX: uses verseRangeRef.current and surahRef.current so the
        // alert always shows the correct currently-selected range.
        if (msg.type === 'out_of_scope') {
          const currentRange = verseRangeRef.current;
          const currentSurah = surahRef.current;
          Alert.alert(
            'Wrong Ayah',
            `You recited outside the selected range (Ayah ${currentRange[0]}–${currentRange[1]}). Please recite the correct ayah.`,
            [{ text: 'OK' }]
          );
          setMistakes((prev) => [{
            type:        'MISPRONUNCIATION',
            incorrect:   msg.you_recited || '',
            correct:     '',
            tajweedRule: null,
            severity:    'high',
            tip: `Wrong ayah. Please recite Ayah ${currentRange[0]}–${currentRange[1]} of ${currentSurah?.surahName || 'the selected surah'}.`,
            ayah: currentRange[0],
            ts:  Date.now(),
          }, ...prev].slice(0, 20));
          speakWord('recite correct', currentRange[0]);
          return;
        }

        // ── unclear ──
        if (msg.type === 'unclear') {
          setMistakes((prev) => [{
            type:        'MISPRONUNCIATION',
            incorrect:   '',
            correct:     '',
            tajweedRule: null,
            severity:    null,
            tip:         msg.message || 'Could not hear clearly — please speak louder and try again.',
            ayah:        msg.ayah ?? null,
            ts:          Date.now(),
          }, ...prev].slice(0, 20));
          return;
        }

        // ── error ──
        if (msg.type === 'error') {
          Alert.alert(
            'Analysis problem',
            msg.message || 'The recitation engine had a problem. Tap the mic to retry.',
          );
        }
      },
      (_connected) => {},
      (_finalReport) => {},
    );
  }, []); // ✅ safe with empty deps — all values read via refs

  // ── Cleanup recording ────────────────────────────────────────────────────────
  const cleanupRecording = async ({ abandon = false } = {}) => {
    isRecordingRef.current = false;

    if (isDemoRef.current) {
      try { audioStreamService.stopDemoMode(); } catch {}
      isDemoRef.current = false;
    } else {
      try { await audioStreamService.stopStreaming(); } catch {}
    }

    const session = sessionRef.current;
    sessionRef.current = null;

    if (abandon && session?.id) {
      try { await sessionService.abandonSession(session.id); } catch {}
    }

    return session;
  };

  // ── Start recording ──────────────────────────────────────────────────────────
  const onStart = async () => {
    if (!surahRef.current?.surahNumber) {
      Alert.alert('Pick a surah', 'No surah selected.');
      return;
    }

    setMistakes([]);
    setSessionStarted(false);
    sessionRef.current   = null;
    isDemoRef.current    = false;
    setIsDemo(false);
    mistakeCountsRef.current = {};

    let session;
    try {
      session = await sessionService.createSession({
        surahId:   surahRef.current.surahNumber,
        ayahStart: verseRangeRef.current[0],
        ayahEnd:   verseRangeRef.current[1],
      });
    } catch (e) {
      Alert.alert('Could not start', e?.response?.data?.message || e?.message || 'Failed to create session.');
      return;
    }

    if (!session || !session.id) {
      Alert.alert('Error', 'Failed to create session. Please try again.');
      return;
    }

    sessionRef.current = session;
    wireCallbacks();

    try {
      await audioStreamService.startStreaming({
        sessionId:  session.id,
        surahId:    surahRef.current.surahNumber,
        ayahStart:  verseRangeRef.current[0],
        ayahEnd:    verseRangeRef.current[1],
      });
    } catch {
      // Fall back to demo mode if streaming fails
      try { audioStreamService.startDemoMode(); } catch {}
      isDemoRef.current = true;
      setIsDemo(true);
    }

    isRecordingRef.current = true;
    setIsRecording(true);
    setSessionStarted(true);
    startAnims();
  };

  // ── Stop recording ───────────────────────────────────────────────────────────
  const onStop = async () => {
    stopAnims();
    setIsRecording(false);
    await new Promise((r) => setTimeout(r, 600));
    await cleanupRecording({ abandon: false });
  };

  const onMicPress = () => {
    if (isRecording) onStop();
    else             onStart();
  };

  // ── Save session ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!sessionStarted && mistakes.length === 0) {
      Alert.alert('Info', 'Start recording first');
      return;
    }
    setSaving(true);
    try {
      if (isRecordingRef.current) {
        stopAnims();
        setIsRecording(false);
        await new Promise((r) => setTimeout(r, 600));
        await cleanupRecording({ abandon: false });
      }

      const session         = sessionRef.current;
      const counts          = countByType(mistakes);
      const totalMistakes   = mistakes.length;
      const accuracyScore   = clamp(Math.round(100 - totalMistakes * 4), 0, 100);
      const mostCommonError = pickMostCommon(counts);

      if (session?.id) {
        try {
          await sessionService.completeSession(session.id, {
            transcript:    '',
            accuracyScore,
          });
        } catch {
          // Navigate even if completion call fails
        }
      }

      const totalWords   = countWords(scopeAyahs);
      const totalLetters = countLetters(scopeAyahs);

      sessionRef.current = null;
      setSessionStarted(false);

      navigation.navigate('RetainResults', {
        sessionId:      session?.id,
        surahId:        surahRef.current?.surahNumber,
        surahName:      surahRef.current?.surahName,
        surahNameAr:    surahRef.current?.surahNameAr,
        verseRange:     verseRangeRef.current,
        accuracyScore,
        mistakes,
        mistakeCounts:  counts,
        mostCommonError,
        totalWords,
        totalLetters,
      });
    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to save session');
    } finally {
      setSaving(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    if (isRecordingRef.current) {
      stopAnims();
      setIsRecording(false);
      await cleanupRecording({ abandon: true });
    }
    setMistakes([]);
    setSessionStarted(false);
    mistakeCountsRef.current = {};
    setSpeakingWord(null);
  };

  // ── Animated styles ──────────────────────────────────────────────────────────
  const micCircleStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const ringStyle      = useAnimatedStyle(() => ({
    transform: [{ scale: ring.value }],
    opacity:    isRecording ? Math.max(0, (1.55 - ring.value) * 0.6) : 0,
  }));

  const openDrawer = () => {
    let p = navigation;
    while (p && !p.openDrawer) p = p.getParent?.();
    p?.openDrawer?.();
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Header title="True Tilawah" onMenuClick={openDrawer} onSearchClick={() => {}} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.subTitle}>Retain Quran: Random Test</Text>

        {/* ── Surah selector ── */}
        <View style={s.surahSel}>
          <TouchableOpacity
            style={[s.shuffleBtn, (isRecording || mistakes.length > 0) && s.shuffleBtnDis]}
            onPress={pickRandom}
            activeOpacity={0.8}
            disabled={isRecording || mistakes.length > 0}
          >
            <Shuffle size={22} color={COLORS.primary} />
          </TouchableOpacity>
          <View style={s.surahNameRow}>
            <Text style={s.surahAr}>{surah?.surahNameAr || '—'}</Text>
            <ChevronDown size={20} color={COLORS.gray400} />
          </View>
          <View style={s.verseBadge}>
            <Text style={s.verseBadgeTxt}>Verses {verseRange[0]} – {verseRange[1]}</Text>
          </View>
        </View>

        {/* ── Show verses toggle ── */}
        <View style={s.toggleRow}>
          <View style={s.toggleItem}>
            <Text style={s.toggleLbl}>Show verses</Text>
            <Switch
              value={showVerses}
              onValueChange={setShowVerses}
              trackColor={{ false: COLORS.gray200, true: COLORS.secondary }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        {/* ── Ayah carousel ── */}
        {showVerses && (
          <View style={s.carouselWrap}>
            {!surah ? (
              <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
                <BookOpen size={36} color={COLORS.gray300} />
                <Text style={s.placeholderTitle}>No surah selected</Text>
                <Text style={s.placeholderSub}>Tap the shuffle button to pick one.</Text>
              </View>
            ) : ayahsLoading ? (
              <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={s.placeholderSub}>Loading verses…</Text>
              </View>
            ) : scopeAyahs.length === 0 ? (
              <View style={[s.placeholderCard, { width: CARD_W, marginHorizontal: SIDE_PAD }]}>
                <Text style={s.placeholderTitle}>Couldn't load verses</Text>
                <Text style={s.placeholderSub}>Try a different surah.</Text>
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
                    const isActive = index === currentIdx;
                    return (
                      <View style={[s.cardOuter, { width: CARD_W, marginHorizontal: CARD_GAP / 2 }]}>
                        <View style={[s.ayahCard, !isActive && s.ayahCardFaded]}>
                          <View style={s.ayahCardHeader}>
                            <View style={s.ayahNumPill}>
                              <Text style={s.ayahNumTxt}>Ayah {item.ayahNumber}</Text>
                            </View>
                            <Text style={s.ayahCount}>{index + 1} / {scopeAyahs.length}</Text>
                          </View>
                          <AyahText item={item} />
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

        {/* ── Mic button ── */}
        <View style={s.micWrap}>
          {!isRecording && <Text style={s.micHint}>Click to start retaining</Text>}
          {isRecording && isDemo && <Text style={s.demoHint}>Offline (demo)</Text>}
          <Animated.View style={[s.ring, ringStyle]} />
          <View style={s.outerCircle}>
            <Animated.View style={[s.micCircle, micCircleStyle, isRecording && s.micCircleActive]}>
              <TouchableOpacity onPress={onMicPress} style={s.micBtn} activeOpacity={0.85}>
                <Mic size={42} color={isRecording ? COLORS.primary : COLORS.white} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* ── Speaking indicator ── */}
        {speakingWord ? (
          <View style={s.speakingBar}>
            <View style={s.speakingDot} />
            <Text style={s.speakingLbl}>SPEAKING</Text>
            <Text style={s.speakingWord} numberOfLines={1}>{speakingWord}</Text>
          </View>
        ) : null}

        {/* ── Mistake panel ── */}
        {(isRecording || sessionStarted || mistakes.length > 0) && (
          <View style={s.mistakePanel}>
            <View style={s.mistakeHeader}>
              <View style={s.mistakeDot} />
              <Text style={s.mistakeLbl}>Mistake Detection</Text>
              {mistakes.length > 0 && (
                <Text style={s.mistakeCount}>{mistakes.length}</Text>
              )}
            </View>
            {mistakes.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.listeningTxt}>
                  {isRecording ? 'Listening for recitation errors…' : 'Mistakes will appear here.'}
                </Text>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {mistakes.slice(0, 3).map((m, i) => (
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
                        {m.correct ? (
                          <TouchableOpacity hitSlop={8} onPress={() => speakWord(m.correct, m.ayah)}>
                            <Text style={s.mPlay}>▶</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      {m.correct ? <Text style={s.mArabic}>{m.correct}</Text> : null}
                      {m.tip     ? <Text style={s.mTip}>{m.tip}</Text>       : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── Reset / Save buttons ── */}
        {(mistakes.length > 0 || isRecording || sessionStarted) && (
          <View style={s.btnRow}>
            <TouchableOpacity onPress={handleReset} style={[s.btn, s.btnOutline]} activeOpacity={0.85}>
              <Text style={s.btnOutlineTxt}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              style={[s.btn, s.btnPrimary, saving && s.btnDisabled]}
              activeOpacity={0.85}
              disabled={saving}
            >
              <Text style={s.btnPrimaryTxt}>{saving ? 'Saving…' : 'Save Session'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: COLORS.white },
  content:          { padding: 24 },
  subTitle:         { fontSize: 16, fontWeight: '700', color: COLORS.primary, textAlign: 'center', marginBottom: 18 },
  surahSel:         { alignItems: 'center', gap: 12, marginBottom: 22 },
  shuffleBtn:       { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.gray100, alignItems: 'center', justifyContent: 'center' },
  shuffleBtnDis:    { opacity: 0.4 },
  surahNameRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  surahAr:          { fontSize: 28, color: COLORS.primary },
  verseBadge:       { backgroundColor: COLORS.secondaryUltraLight, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  verseBadgeTxt:    { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  carouselWrap:     { marginTop: 4, marginBottom: 16, marginHorizontal: -24 },
  cardOuter:        {},
  ayahCard:         { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray100, borderRadius: 22, padding: 18, minHeight: 200, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 4 },
  ayahCardFaded:    { opacity: 0.32, transform: [{ scale: 0.94 }] },
  ayahCardHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  ayahNumPill:      { backgroundColor: COLORS.secondaryUltraLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  ayahNumTxt:       { fontSize: 11, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.4 },
  ayahCount:        { fontSize: 10, fontWeight: '700', color: COLORS.gray400, letterSpacing: 0.6 },
  ayahArabicWrap:   { flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' },
  ayahArabicWord:   { fontFamily: FONTS.quran, fontSize: 26, lineHeight: 54, marginHorizontal: 4, writingDirection: 'rtl', color: COLORS.primary },
  placeholderCard:  { backgroundColor: COLORS.white, borderRadius: 22, borderWidth: 1, borderColor: COLORS.gray100, borderStyle: 'dashed', padding: 24, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  placeholderTitle: { fontSize: 14, fontWeight: '700', color: COLORS.gray500 },
  placeholderSub:   { fontSize: 12, color: COLORS.gray400, textAlign: 'center' },
  navRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 4 },
  navBtn:           { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
  navBtnDis:        { backgroundColor: COLORS.gray100 },
  navTxt:           { fontSize: 12, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.6, textTransform: 'uppercase', minWidth: 80, textAlign: 'center' },
  toggleRow:        { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 22 },
  toggleItem:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleLbl:        { fontSize: 10, fontWeight: '700', color: COLORS.gray400, textTransform: 'uppercase', letterSpacing: 0.5 },
  micWrap:          { alignItems: 'center', justifyContent: 'center', minHeight: 280, marginTop: 4 },
  micHint:          { fontSize: 13, color: COLORS.gray400, marginBottom: 18 },
  demoHint:         { fontSize: 11, fontWeight: '700', color: COLORS.orange, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  ring:             { position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 2, borderColor: `${COLORS.primary}28` },
  outerCircle:      { width: 200, height: 200, borderRadius: 100, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
  micCircle:        { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 10 },
  micCircleActive:  { backgroundColor: COLORS.white },
  micBtn:           { width: '100%', height: '100%', borderRadius: 75, alignItems: 'center', justifyContent: 'center' },
  speakingBar:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.red, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, alignSelf: 'center', marginTop: 12 },
  speakingDot:      { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.white },
  speakingLbl:      { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 1, textTransform: 'uppercase' },
  speakingWord:     { fontFamily: FONTS.quran, fontSize: 18, color: COLORS.white, marginLeft: 4, maxWidth: 200 },
  mistakePanel:     { width: '100%', maxWidth: 360, alignSelf: 'center', marginTop: 16 },
  mistakeHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  mistakeDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.red },
  mistakeLbl:       { fontSize: 10, fontWeight: '800', color: COLORS.red, textTransform: 'uppercase', letterSpacing: 1, flex: 1 },
  mistakeCount:     { fontSize: 10, fontWeight: '800', color: COLORS.white, backgroundColor: COLORS.red, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  emptyBox:         { backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FEE2E2', borderRadius: 18, padding: 16, minHeight: 76, justifyContent: 'center' },
  listeningTxt:     { fontSize: 11, color: COLORS.gray400, textAlign: 'center', fontStyle: 'italic' },
  mCard:            { flexDirection: 'row', gap: 10, backgroundColor: COLORS.redLight, borderLeftWidth: 4, borderLeftColor: COLORS.red, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  mIconWrap:        { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.red, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 2 },
  mRow:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  mType:            { fontSize: 11, fontWeight: '800', color: COLORS.red, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 },
  mPlay:            { fontSize: 14, color: COLORS.red, fontWeight: '800' },
  mArabic:          { fontFamily: FONTS.quran, fontSize: 24, color: COLORS.primary, textAlign: 'right', writingDirection: 'rtl', marginTop: 6, marginBottom: 4 },
  mTip:             { fontSize: 12, color: '#991B1B', lineHeight: 17, fontWeight: '500' },
  btnRow:           { flexDirection: 'row', gap: 14, paddingHorizontal: 8, marginTop: 22, marginBottom: 8 },
  btn:              { flex: 1, borderRadius: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnOutline:       { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: 'transparent' },
  btnOutlineTxt:    { fontSize: 14, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.4 },
  btnPrimary:       { backgroundColor: COLORS.secondary },
  btnPrimaryTxt:    { fontSize: 14, fontWeight: '800', color: COLORS.white, letterSpacing: 0.4 },
  btnDisabled:      { opacity: 0.6 },
});