import React from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { Search, ArrowRight, BookOpen, Layers, Mic } from 'lucide-react-native';
import { COLORS } from '../../constants';

const TYPE_STYLE = {
  surah: { bg: '#ECFDF5', color: '#059669' },
  para:  { bg: '#EFF6FF', color: '#3B82F6' },
  page:  { bg: '#FFF7ED', color: '#F97316' },
  hizb:  { bg: '#FAF5FF', color: '#7C3AED' },
  ayah:  { bg: '#FFF7ED', color: '#F97316' },
};

function Icon({ type }) {
  if (type === 'surah') return <BookOpen size={18} color={TYPE_STYLE.surah.color} />;
  if (type === 'para')  return <Layers   size={18} color={TYPE_STYLE.para.color}  />;
  return <Mic size={18} color={TYPE_STYLE.ayah.color} />;
}

export default function SearchBar({ visible, searchQuery, searchResults, placeholder, onQueryChange, onResultClick }) {
  if (!visible) return null;
  return (
    <View style={styles.wrapper}>
      <View style={styles.inputRow}>
        <Search size={20} color={COLORS.gray400} />
        <TextInput
          style={styles.input}
          placeholder={placeholder || 'Search Surah, Para, Ayah...'}
          placeholderTextColor={COLORS.gray400}
          value={searchQuery}
          onChangeText={onQueryChange}
          autoFocus
          returnKeyType="search"
        />
      </View>

      {searchResults.length > 0 && (
        <View style={styles.results}>
          <FlatList
            data={searchResults}
            keyExtractor={(_, i) => String(i)}
            scrollEnabled={false}
            renderItem={({ item }) => {
              const ts = TYPE_STYLE[item.type] || TYPE_STYLE.ayah;
              return (
                <TouchableOpacity style={styles.row} onPress={() => onResultClick(item)} activeOpacity={0.7}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.rowIcon, { backgroundColor: ts.bg }]}>
                      <Icon type={item.type} />
                    </View>
                    <View>
                      <Text style={styles.rowLabel}>{item.label}</Text>
                      <Text style={styles.rowSub}>{item.sub}</Text>
                    </View>
                  </View>
                  <ArrowRight size={16} color={COLORS.gray300} />
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:  { marginHorizontal: 24, marginBottom: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray200, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13 },
  input:    { flex: 1, fontSize: 15, color: COLORS.primary },
  results:  { marginTop: 6, backgroundColor: COLORS.white, borderRadius: 20, borderWidth: 1, borderColor: COLORS.gray100, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.10, shadowRadius: 20, elevation: 8 },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  rowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon:  { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  rowSub:   { fontSize: 10, color: COLORS.gray400, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
});
