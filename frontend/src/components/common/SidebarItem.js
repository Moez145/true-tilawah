import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS } from '../../constants';

export default function SidebarItem({ icon, label, onPress, danger = false }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.container} activeOpacity={0.7}>
      {icon}
      <Text style={[styles.label, danger && styles.dangerText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container:  { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16 },
  label:      { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  dangerText: { color: COLORS.red },
});
