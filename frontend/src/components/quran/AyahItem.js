import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Share2, Play, Bookmark } from 'lucide-react-native';
import { useApp } from '../../context/AppContext';
import { shareContent, getShadow } from '../../utils/helpers';
import { COLORS, FONTS } from '../../constants';

export default function AyahItem({ ayah, surahId, surahName }) {
  const { isBookmarked, addBookmark, removeBookmark } = useApp();
  const [playing, setPlaying] = useState(false);

  const num    = ayah.ayahNumber ?? ayah.number;
  const text   = ayah.uthmaniText ?? ayah.text ?? '';
  const trans  = ayah.translationEn ?? ayah.translation ?? '';
  const saved  = isBookmarked(surahId, num);

  const toggleBookmark = () => {
    if (saved) removeBookmark(surahId, num);
    else addBookmark({ surahId, surahName, ayahNumber: num, text, translation: trans });
  };

  return (
    <View style={[styles.card, getShadow(2)]}>
      <View style={styles.actionBar}>
        <View style={styles.numBadge}><Text style={styles.numText}>{num}</Text></View>
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => shareContent(`${surahName} : ${num}`, `"${text}"\n\n${trans}`)} style={styles.actionBtn} hitSlop={6}>
            <Share2 size={20} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPlaying(p => !p)} style={styles.actionBtn} hitSlop={6}>
            <Play size={20} color={playing ? COLORS.green : COLORS.primary} fill={playing ? COLORS.green : 'none'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleBookmark} style={styles.actionBtn} hitSlop={6}>
            <Bookmark size={20} color={saved ? COLORS.orange : COLORS.primary} fill={saved ? COLORS.orange : 'none'} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.arabic}>{text}</Text>

      {trans ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.transLabel}>Translation</Text>
          <Text style={styles.translation}>{trans}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: COLORS.white, borderRadius: 24, paddingVertical: 18, paddingHorizontal: 18, borderWidth: 1, borderColor: COLORS.gray100, marginBottom: 16 },
  actionBar:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.secondaryUltraLight, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 18 },
  numBadge:    { minWidth: 34, height: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  numText:     { color: COLORS.white, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  actions:     { flexDirection: 'row', gap: 18, alignItems: 'center' },
  actionBtn:   { padding: 4, borderRadius: 20 },
  arabic:      { fontFamily: FONTS.quran, fontSize: 30, textAlign: 'right', color: COLORS.primary, lineHeight: 64, marginVertical: 4, writingDirection: 'rtl' },
  divider:     { height: 1, backgroundColor: COLORS.gray100, marginTop: 14, marginBottom: 12 },
  transLabel:  { fontSize: 10, fontWeight: '800', color: COLORS.gray400, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
  translation: { fontSize: 14, color: COLORS.gray600, lineHeight: 22, fontStyle: 'italic' },
});
