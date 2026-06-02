import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft, Search, Menu } from 'lucide-react-native';
import { COLORS } from '../../constants';

export default function Header({ title, onBack, onMenuClick, showSearch = true, onSearchClick, rightElement }) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.left}>
          {onBack
            ? <TouchableOpacity onPress={onBack} style={styles.iconBtn} hitSlop={10}>
                <ChevronLeft size={24} color={COLORS.primary} />
              </TouchableOpacity>
            : <TouchableOpacity onPress={onMenuClick} style={styles.iconBtn} hitSlop={10}>
                <Menu size={24} color={COLORS.primary} />
              </TouchableOpacity>
          }
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
        <View style={styles.right}>
          {showSearch && onSearchClick && (
            <TouchableOpacity onPress={onSearchClick} style={styles.iconBtn} hitSlop={10}>
              <Search size={24} color={COLORS.primary} />
            </TouchableOpacity>
          )}
          {rightElement}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12,
  },
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  left:  { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { padding: 8, borderRadius: 20 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.primary, flex: 1 },
});
