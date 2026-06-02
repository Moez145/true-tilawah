import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

const AnimTouch = Animated.createAnimatedComponent(TouchableOpacity);

export default function DashboardCard({ title, subtitle, icon, bgColor, textColor, onPress }) {
  const scale = useSharedValue(1);
  const ty    = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { translateY: ty.value }] }));

  return (
    <AnimTouch
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(1.04, { damping: 14, stiffness: 300 }); ty.value = withSpring(-4, { damping: 14, stiffness: 300 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 14, stiffness: 300 }); ty.value = withSpring(0, { damping: 14, stiffness: 300 }); }}
      activeOpacity={0.9}
      style={[styles.card, { backgroundColor: bgColor }, animStyle]}
    >
      {/* Ghost BG icon */}
      <View style={styles.ghostIcon}>{React.cloneElement(icon, { size: 70, color: textColor, opacity: 0.07 })}</View>
      {/* Icon badge */}
      <View style={styles.badge}>
        <View style={styles.badgeInner}>{React.cloneElement(icon, { size: 26, color: textColor })}</View>
      </View>
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
      <Text style={[styles.sub,   { color: textColor }]}>{subtitle}</Text>
    </AnimTouch>
  );
}

const styles = StyleSheet.create({
  card:      { flex: 1, padding: 20, borderRadius: 28, overflow: 'hidden', position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 3 },
  ghostIcon: { position: 'absolute', top: -8, right: -8 },
  badge:     { marginBottom: 14 },
  badgeInner:{ width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  sub:       { fontSize: 10, fontWeight: '700', opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.8 },
});
