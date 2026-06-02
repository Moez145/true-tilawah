import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withSpring, Easing,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { COLORS, BRAND_GRADIENT } from '../constants';

const STARS = [
  { x: '15%', y: 30,  size: 4 },
  { x: '30%', y: 60,  size: 3 },
  { x: '55%', y: 25,  size: 5 },
  { x: '70%', y: 80,  size: 3 },
  { x: '85%', y: 45,  size: 4 },
  { x: '20%', y: 110, size: 3 },
  { x: '78%', y: 130, size: 4 },
];

function BookIllustration() {
  // Open Mushaf-style book on a stand — simple SVG to match the doc's flat illustration look.
  return (
    <Svg width={180} height={130} viewBox="0 0 180 130">
      {/* Pages */}
      <Path d="M 20 40 L 90 30 L 90 100 L 20 110 Z" fill="#F8F4E8" stroke="#E8DDC5" strokeWidth={1.5} />
      <Path d="M 90 30 L 160 40 L 160 110 L 90 100 Z" fill="#F8F4E8" stroke="#E8DDC5" strokeWidth={1.5} />
      {/* Page lines */}
      {[0,1,2,3].map(i => (
        <Path key={`l-${i}`} d={`M 30 ${52 + i*12} L 82 ${48 + i*12}`} stroke="#D6C7A0" strokeWidth={1} />
      ))}
      {[0,1,2,3].map(i => (
        <Path key={`r-${i}`} d={`M 98 ${48 + i*12} L 150 ${52 + i*12}`} stroke="#D6C7A0" strokeWidth={1} />
      ))}
      {/* Spine */}
      <Path d="M 90 30 L 90 100" stroke="#86B6A7" strokeWidth={2} />
      {/* Stand (rahl) */}
      <Path d="M 50 110 L 70 125 L 110 125 L 130 110 Z" fill="#8FA88F" stroke="#5C8E7F" strokeWidth={1} />
      {/* Decorative gold edge */}
      <Path d="M 20 40 L 20 110 M 160 40 L 160 110" stroke="#D4A95A" strokeWidth={2} />
    </Svg>
  );
}

export default function OnboardingScreen({ navigation }) {
  const floatY    = useSharedValue(0);
  const cardScale = useSharedValue(0.9);
  const cardOp    = useSharedValue(0);
  const twinkle   = useSharedValue(1);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0,   { duration: 2200, easing: Easing.inOut(Easing.ease) })
      ), -1, false
    );
    twinkle.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 1500 }),
        withTiming(1,   { duration: 1500 })
      ), -1, false
    );
    cardScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    cardOp.value    = withTiming(1, { duration: 700 });
  }, []);

  const bookStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: floatY.value }] }));
  const cardStyle    = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }], opacity: cardOp.value }));
  const twinkleStyle = useAnimatedStyle(() => ({ opacity: twinkle.value }));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Animated.View style={[styles.inner, cardStyle]}>
        <Text style={styles.title}>True Tilawah</Text>
        <Text style={styles.subtitle}>Memorize and recite{'\n'}Quran easily</Text>

        <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
          {/* Stars */}
          {STARS.map((star, i) => (
            <Animated.View key={i} style={[
              styles.star,
              { left: star.x, top: star.y, width: star.size, height: star.size, borderRadius: star.size / 2 },
              twinkleStyle,
            ]} />
          ))}

          {/* Clouds */}
          <View style={[styles.cloud, { top: 90, left: 30, width: 60, opacity: 0.18 }]} />
          <View style={[styles.cloud, { top: 70, right: 24, width: 80, opacity: 0.12 }]} />

          {/* Book */}
          <Animated.View style={[styles.book, bookStyle]}>
            <BookIllustration />
          </Animated.View>

          <Text style={styles.arabicVerse}>وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا</Text>
        </LinearGradient>

        <TouchableOpacity style={styles.cta} onPress={() => navigation.navigate('Auth')} activeOpacity={0.85}>
          <Text style={styles.ctaText}>Get Started</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: COLORS.white },
  inner:       { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  title:       { fontSize: 36, fontWeight: '700', color: COLORS.primary, marginBottom: 8, textAlign: 'center' },
  subtitle:    { fontSize: 16, color: COLORS.gray500, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  heroCard:    { width: '100%', aspectRatio: 0.78, borderRadius: 36, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 32, overflow: 'hidden', paddingBottom: 30 },
  star:        { position: 'absolute', backgroundColor: '#FEF08A' },
  cloud:       { position: 'absolute', height: 12, borderRadius: 8, backgroundColor: '#86B6A7' },
  book:        { marginBottom: 12 },
  arabicVerse: { fontSize: 22, color: COLORS.white, textAlign: 'center', lineHeight: 40, writingDirection: 'rtl' },
  cta:         { width: '70%', backgroundColor: COLORS.secondaryLight, paddingVertical: 16, borderRadius: 30, alignItems: 'center' },
  ctaText:     { fontSize: 16, fontWeight: '700', color: COLORS.primary },
});
