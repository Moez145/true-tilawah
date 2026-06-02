import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { ArrowLeft, Layers, Shuffle, ChevronDown } from 'lucide-react-native';
import Header from '../components/common/Header';
import { COLORS } from '../constants';

function ResultRow({ icon, label, value, valueColor, small }) {
  return (
    <View style={s.resultRow}>
      <View style={s.resultLeft}>
        <View style={s.resultIcon}>
          {typeof icon === 'string'
            ? <Text style={s.resultIconTxt}>{icon}</Text>
            : icon
          }
        </View>
        <Text style={s.resultLabel}>{label}</Text>
      </View>
      <Text style={[s.resultValue, { color: valueColor }, small && s.resultValueSmall]}>{value}</Text>
    </View>
  );
}

// Multi-color gauge — red → orange → yellow → green segments with a needle at `score` (0..100).
function Gauge({ score = 0 }) {
  const W = 240, H = 140;
  const cx = 120, cy = 110, R = 95;
  const angle = (score / 100) * Math.PI;          // 0 → π
  const needleAngle = Math.PI - angle;            // sweep from left (180°) to right (0°)
  const nx = cx + (R - 18) * Math.cos(needleAngle);
  const ny = cy - (R - 18) * Math.sin(needleAngle);

  // 4 colored arcs spanning 180°
  const arc = (startDeg, endDeg, color) => {
    const a1 = (Math.PI * startDeg) / 180;
    const a2 = (Math.PI * endDeg)   / 180;
    const x1 = cx + R * Math.cos(Math.PI - a1);
    const y1 = cy - R * Math.sin(Math.PI - a1);
    const x2 = cx + R * Math.cos(Math.PI - a2);
    const y2 = cy - R * Math.sin(Math.PI - a2);
    return <Path d={`M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`} stroke={color} strokeWidth={20} fill="none" strokeLinecap="butt" />;
  };

  return (
    <View style={s.gaugeWrap}>
      <Svg width={W} height={H + 10} viewBox={`0 0 ${W} ${H + 10}`}>
        {arc(0,    45,  '#EF4444')}
        {arc(45,   90,  '#F97316')}
        {arc(90,   135, '#FBBF24')}
        {arc(135,  180, '#22C55E')}
        {/* Needle */}
        <Line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#374151" strokeWidth={3} strokeLinecap="round" />
        <Circle cx={cx} cy={cy} r={10} fill="#9CA3AF" />
      </Svg>
      <Text style={s.scoreText}>{score}%</Text>
      <View style={s.scaleRow}>
        <Text style={s.scaleTxt}>POOR</Text>
        <Text style={s.scaleTxt}>GOOD</Text>
      </View>
    </View>
  );
}

// Count letter-level mistakes (TAJWEED_VIOLATION + MISPRONUNCIATION).
function countLetterMistakes(mistakes) {
  let n = 0;
  for (const m of mistakes) {
    if (m?.type === 'TAJWEED_VIOLATION' || m?.type === 'MISPRONUNCIATION') n++;
  }
  return n;
}

// Count word-level mistakes (MISPRONUNCIATION + OMITTED_WORD + ADDED_WORD).
function countWordMistakes(mistakes) {
  let n = 0;
  for (const m of mistakes) {
    if (m?.type === 'MISPRONUNCIATION' || m?.type === 'OMITTED_WORD' || m?.type === 'ADDED_WORD') n++;
  }
  return n;
}

const ERROR_LABEL = {
  MISPRONUNCIATION:   'Mispronunciation',
  OMITTED_WORD:       'Omitted words',
  ADDED_WORD:         'Added words',
  TAJWEED_VIOLATION:  'Tajweed violations',
};

// Pick a friendly congrats line from the score so the screen still feels alive
// when the metrics aren't great.
function congratsFor(score) {
  if (score >= 90) return 'Bingoooo.. You are almost there !';
  if (score >= 75) return 'Great job — keep polishing those verses!';
  if (score >= 50) return 'Solid attempt — review the highlighted words.';
  return 'Don’t give up — try again with the starting verse on.';
}

export default function RetainResultsScreen({ navigation, route }) {
  const params = route?.params || {};
  const score          = params.accuracyScore ?? 0;
  const surahNameAr    = params.surahNameAr || '—';
  const verseRange     = params.verseRange || [1, 1];
  const mostCommonError = params.mostCommonError;
  const mistakes       = Array.isArray(params.mistakes) ? params.mistakes : [];
  const totalWords     = Number.isFinite(params.totalWords)   ? params.totalWords   : null;
  const totalLetters   = Number.isFinite(params.totalLetters) ? params.totalLetters : null;
  const [a, b] = verseRange;

  const letterMistakeCount = countLetterMistakes(mistakes);
  const wordMistakeCount   = countWordMistakes(mistakes);
  const alphabetsValue = totalLetters != null
    ? `${letterMistakeCount} / ${totalLetters}`
    : `${letterMistakeCount}`;
  const wordsValue = totalWords != null
    ? `${wordMistakeCount} / ${totalWords}`
    : `${wordMistakeCount}`;
  const mostCommonLabel = mostCommonError && ERROR_LABEL[mostCommonError]
    ? ERROR_LABEL[mostCommonError]
    : (mistakes.length > 0 ? 'Mixed' : 'No mistakes');

  // Green when there are no/few mistakes, amber once the count grows.
  const fewMistakes = (n) => (n === 0 || n < 5) ? '#22C55E' : '#F97316';

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <Header title="True Tilawah" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.subTitle}>Retain Quran: Random Test</Text>

        {/* Surah selector (mirrors RetainScreen) */}
        <View style={s.surahSel}>
          <View style={s.shuffleBtn}><Shuffle size={22} color={COLORS.primary} /></View>
          <View style={s.surahNameRow}>
            <Text style={s.surahAr}>{surahNameAr}</Text>
            <ChevronDown size={20} color={COLORS.gray400} />
          </View>
          <View style={s.verseBadge}><Text style={s.verseBadgeTxt}>Verses {a} – {b}</Text></View>
        </View>

        <Text style={s.congrats}>{congratsFor(score)}</Text>

        <Gauge score={score} />

        {/* Results — all three rows are real per-session data */}
        <View style={s.results}>
          <ResultRow icon="ظ"  label="Alphabets mistakes"
            value={alphabetsValue} valueColor={fewMistakes(letterMistakeCount)} />
          <ResultRow icon={<Layers size={18} color={COLORS.gray600} />}
            label="Words mistakes"
            value={wordsValue} valueColor={fewMistakes(wordMistakeCount)} />
          <ResultRow icon={<Layers size={18} color={COLORS.gray600} />}
            label="Most common error"
            value={mostCommonLabel}
            valueColor={mistakes.length > 0 ? COLORS.orange : '#22C55E'} small />
        </View>

        <TouchableOpacity style={s.saveBtn}
          onPress={() => navigation.navigate('Main', { screen: 'MainTabs', params: { screen: 'Retain' } })}
          activeOpacity={0.85}>
          <ArrowLeft size={20} color={COLORS.primary} />
          <Text style={s.saveTxt}>Back to Retain</Text>
        </TouchableOpacity>
        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: COLORS.white },
  content:          { padding: 24 },
  subTitle:         { fontSize: 16, fontWeight: '700', color: COLORS.primary, textAlign: 'center', marginBottom: 18 },
  surahSel:         { alignItems: 'center', gap: 12, marginBottom: 14 },
  shuffleBtn:       { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.gray100, alignItems: 'center', justifyContent: 'center' },
  surahNameRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  surahAr:          { fontSize: 28, color: COLORS.primary },
  verseBadge:       { backgroundColor: COLORS.secondaryUltraLight, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  verseBadgeTxt:    { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  congrats:         { fontSize: 14, fontWeight: '600', color: COLORS.gray600, textAlign: 'center', marginBottom: 18 },
  gaugeWrap:        { alignItems: 'center', marginBottom: 22 },
  scoreText:        { fontSize: 34, fontWeight: '700', color: COLORS.primary, textAlign: 'center', marginTop: -6 },
  scaleRow:         { flexDirection: 'row', justifyContent: 'space-between', width: 220, paddingHorizontal: 8, marginTop: 4 },
  scaleTxt:         { fontSize: 9, fontWeight: '700', color: COLORS.gray400, textTransform: 'uppercase', letterSpacing: 0.5 },
  results:          { gap: 14, marginBottom: 28 },
  resultRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  resultLeft:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultIcon:       { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.gray100, alignItems: 'center', justifyContent: 'center' },
  resultIconTxt:    { fontSize: 16, color: COLORS.gray600 },
  resultLabel:      { fontSize: 12, fontWeight: '700', color: COLORS.gray600 },
  resultValue:      { fontSize: 12, fontWeight: '700' },
  resultValueSmall: { fontSize: 10, maxWidth: 130, textAlign: 'right' },
  saveBtn:          { backgroundColor: COLORS.secondaryLight, borderRadius: 26, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  saveTxt:          { fontSize: 15, fontWeight: '700', color: COLORS.primary },
});
