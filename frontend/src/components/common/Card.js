import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { COLORS, BRAND_GRADIENT } from '../../constants';
import { getShadow } from '../../utils/helpers';

const AnimTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function Card({ children, onPress, variant = 'default', style }) {
  const scale      = useSharedValue(1);
  const translateY = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  const onIn  = () => { if (onPress) { scale.value = withSpring(0.98, { damping: 15, stiffness: 300 }); translateY.value = withSpring(-2, { damping: 15, stiffness: 300 }); } };
  const onOut = () => { scale.value = withSpring(1, { damping: 15, stiffness: 300 }); translateY.value = withSpring(0, { damping: 15, stiffness: 300 }); };

  if (variant === 'gradient') {
    const Wrap = onPress ? AnimTouchable : Animated.View;
    const wrapProps = onPress ? { onPress, onPressIn: onIn, onPressOut: onOut, activeOpacity: 0.9 } : {};
    return (
      <Wrap style={[styles.gradientOuter, style, animStyle]} {...wrapProps}>
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {children}
        </LinearGradient>
      </Wrap>
    );
  }

  const baseStyle = [
    styles.base,
    variant === 'default' && [styles.default, getShadow(2)],
    variant === 'outline' && styles.outline,
    style,
  ];

  if (onPress) {
    return (
      <AnimTouchable onPress={onPress} onPressIn={onIn} onPressOut={onOut}
        activeOpacity={0.9} style={[baseStyle, animStyle]}>
        {children}
      </AnimTouchable>
    );
  }
  return <View style={baseStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  base:         { borderRadius: 24, padding: 24 },
  default:      { backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray100 },
  outline:      { borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.gray200 },
  gradientOuter: { borderRadius: 24, overflow: 'hidden' },
  gradient:     { padding: 24, borderRadius: 24 },
});
