import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants';
import {
  STATUS_STYLE,
  formatSessionDate,
  resolveSurahName,
  resolveSurahNameAr,
} from '../../utils/sessionFormat';

// Status pill chip — one of Complete / Incomplete / In progress.
export function StatusPill({ status }) {
  const v = STATUS_STYLE[status] || STATUS_STYLE.ACTIVE;
  return (
    <View style={[s.statusPill, { backgroundColor: v.bg }]}>
      <Text style={[s.statusPillTxt, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

// One tap-through row on the Track + Sessions screens.
// Props:
//   session: { id, surahId, ayahStart, ayahEnd, status, accuracyScore, startTime }
//   surahs:  optional array from AppContext for name resolution; falls back gracefully
//   onPress: callback fired when row is tapped
export function SessionRow({ session, surahs, onPress }) {
  const name = resolveSurahName(session.surahId, surahs);
  const ar   = resolveSurahNameAr(session.surahId, surahs);
  const acc  = Math.round(session.accuracyScore ?? 0);
  return (
    <TouchableOpacity onPress={onPress} style={s.row} activeOpacity={0.7}>
      <View style={s.iconBadge}>
        <Text style={s.iconBadgeTxt}>{session.surahId}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.titleRow}>
          <Text style={s.title} numberOfLines={1}>{name}</Text>
          {ar ? <Text style={s.titleAr} numberOfLines={1}>{ar}</Text> : null}
        </View>
        <Text style={s.meta} numberOfLines={1}>
          Ayahs {session.ayahStart}–{session.ayahEnd} · {formatSessionDate(session.startTime)}
        </Text>
      </View>
      <View style={s.right}>
        <StatusPill status={session.status} />
        <Text style={s.score}>{acc}%</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  iconBadge:     { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.secondaryUltraLight, alignItems: 'center', justifyContent: 'center' },
  iconBadgeTxt:  { fontSize: 13, fontWeight: '800', color: COLORS.primary, letterSpacing: 0.3 },
  titleRow:      { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title:         { fontSize: 14, fontWeight: '700', color: COLORS.primary, flexShrink: 1 },
  titleAr:       { fontFamily: FONTS.quran, fontSize: 14, color: COLORS.primary, opacity: 0.7 },
  meta:          { fontSize: 11, color: COLORS.gray500, fontWeight: '600', marginTop: 2 },
  right:         { alignItems: 'flex-end', gap: 4 },
  score:         { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  statusPill:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusPillTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
});
