import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { BookOpen } from 'lucide-react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence,
  Easing,
} from 'react-native-reanimated';
import { COLORS, BRAND_GRADIENT } from '../constants';

const { width: W, height: H } = Dimensions.get('window');

function StarOutline({ size = 110, color = '#FFE9A8', strokeWidth = 1.6 }) {
  const cx = size / 2, cy = size / 2;
  const outer = size * 0.46, inner = size * 0.34, spikes = 8;
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={outer + 2} fill="none" stroke={color} strokeWidth={0.6} opacity={0.35} />
      <Polygon points={pts.join(' ')} fill="none" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

export default function SplashScreen() {
  const pulse  = useSharedValue(1);
  const rotate = useSharedValue(0);
  const fade   = useSharedValue(0);

  useEffect(() => {
    fade.value  = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        withTiming(1,    { duration: 1400, easing: Easing.inOut(Easing.quad) }),
      ),
      -1, false,
    );
    rotate.value = withRepeat(
      withTiming(360, { duration: 24000, easing: Easing.linear }),
      -1, false,
    );
  }, []);

  const emblemStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: fade.value,
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }],
  }));
  const textStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <View style={s.root}>
      <LinearGradient
        colors={BRAND_GRADIENT}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[s.blob, s.blobTopRight]} />
      <View style={[s.blob, s.blobBottomLeft]} />
      <View style={[s.blob, s.blobCenter]} />

      <View style={s.center}>
        <Animated.View style={[s.emblem, emblemStyle]}>
          <View style={s.haloOuter} />
          <View style={s.haloInner} />
          <Animated.View style={[s.ringWrap, ringStyle]}>
            <StarOutline size={170} color="rgba(255,233,168,0.55)" strokeWidth={1} />
          </Animated.View>
          <View style={s.star}>
            <StarOutline size={120} color="#FFE9A8" strokeWidth={1.8} />
          </View>
          <View style={s.iconCircle}>
            <BookOpen size={34} color={COLORS.primary} strokeWidth={2.2} />
          </View>
        </Animated.View>

        <Animated.View style={[s.textBlock, textStyle]}>
          <Text style={s.brand}>True Tilawah</Text>
          <View style={s.divider} />
          <Text style={s.tagline}>RECITE  ·  MEMORIZE  ·  TRACK</Text>
        </Animated.View>
      </View>

      <Animated.View style={[s.footer, textStyle]}>
        <Text style={s.footerTxt}>In the name of Allah, the Most Gracious, the Most Merciful</Text>
        <View style={s.dotsRow}>
          <View style={[s.dot, s.dotA]} />
          <View style={[s.dot, s.dotB]} />
          <View style={[s.dot, s.dotC]} />
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: COLORS.primary, overflow: 'hidden' },

  blob:           { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' },
  blobTopRight:   { top: -W * 0.35, right: -W * 0.35, width: W * 0.9, height: W * 0.9 },
  blobBottomLeft: { bottom: -W * 0.4, left: -W * 0.35, width: W * 0.85, height: W * 0.85, backgroundColor: 'rgba(255,255,255,0.04)' },
  blobCenter:     { top: H * 0.55, right: -W * 0.2, width: W * 0.55, height: W * 0.55, backgroundColor: 'rgba(255,255,255,0.05)' },

  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  emblem:         { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: 44 },
  haloOuter:      { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.06)' },
  haloInner:      { position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' },
  ringWrap:       { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  star:           { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  iconCircle:     { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFE9A8', alignItems: 'center', justifyContent: 'center', shadowColor: '#FFE9A8', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 18, elevation: 10 },

  textBlock:      { alignItems: 'center' },
  brand:          { fontSize: 38, fontWeight: '800', color: COLORS.white, letterSpacing: -0.8 },
  divider:        { width: 50, height: 2, backgroundColor: '#FFE9A8', borderRadius: 1, marginVertical: 14, opacity: 0.7 },
  tagline:        { fontSize: 11, fontWeight: '800', color: 'rgba(255,233,168,0.85)', letterSpacing: 3 },

  footer:         { position: 'absolute', bottom: 50, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 40 },
  footerTxt:      { fontSize: 12, color: 'rgba(255,255,255,0.65)', textAlign: 'center', fontWeight: '500', letterSpacing: 0.3, marginBottom: 16, fontStyle: 'italic' },
  dotsRow:        { flexDirection: 'row', gap: 8 },
  dot:            { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFE9A8' },
  dotA:           { opacity: 0.9 },
  dotB:           { opacity: 0.55 },
  dotC:           { opacity: 0.25 },
});
