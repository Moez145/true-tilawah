import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { COLORS } from '../../constants';

const AnimTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const VARIANTS = {
  primary:   { bg: COLORS.primary,            text: COLORS.white },
  secondary: { bg: COLORS.secondaryLight,     text: COLORS.primary },
  outline:   { bg: 'transparent',             text: COLORS.primary, border: COLORS.gray200 },
  ghost:     { bg: 'transparent',             text: COLORS.gray500 },
  danger:    { bg: '#FEE2E2',                 text: '#DC2626' },
};

const SIZES = {
  sm:   { px: 14, py: 8,  radius: 10, font: 13 },
  md:   { px: 22, py: 13, radius: 12, font: 15 },
  lg:   { px: 30, py: 16, radius: 14, font: 16 },
  full: { px: 0,  py: 16, radius: 14, font: 16, width: '100%' },
};

export default function Button({
  children, onPress, variant = 'primary', size = 'md',
  disabled = false, loading = false, style, textStyle,
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size]       || SIZES.md;

  return (
    <AnimTouchable
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.96, { damping: 15, stiffness: 350 }); }}
      onPressOut={() => { scale.value = withSpring(1,    { damping: 15, stiffness: 350 }); }}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          paddingHorizontal: s.px,
          paddingVertical: s.py,
          borderRadius: s.radius,
          width: s.width || undefined,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border || 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
        animStyle,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={v.text} size="small" />
        : <Text style={[styles.text, { color: v.text, fontSize: s.font }, textStyle]}>{children}</Text>
      }
    </AnimTouchable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { fontWeight: '700' },
});
