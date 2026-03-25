/**
 * SacredGeometryBackground — Animated Flower of Life + Golden Spiral overlay.
 * Extracted from app/(tabs)/index.tsx.
 */

import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';

const { width: _W, height: _H } = Dimensions.get('window');

// Build a Flower of Life circle set: center + 6 petals at radius R
function flowerCircles(cx: number, cy: number, R: number) {
  return [
    { x: cx, y: cy },
    ...Array.from({ length: 6 }, (_, i) => ({
      x: cx + R * Math.cos((i * Math.PI) / 3),
      y: cy + R * Math.sin((i * Math.PI) / 3),
    })),
  ];
}

// Second ring: 6 circles at √3·R (offset 30°) + 6 at 2·R
function outerFlowerCircles(cx: number, cy: number, R: number) {
  return [
    ...Array.from({ length: 6 }, (_, i) => ({
      x: cx + Math.sqrt(3) * R * Math.cos((i * Math.PI) / 3 + Math.PI / 6),
      y: cy + Math.sqrt(3) * R * Math.sin((i * Math.PI) / 3 + Math.PI / 6),
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      x: cx + 2 * R * Math.cos((i * Math.PI) / 3),
      y: cy + 2 * R * Math.sin((i * Math.PI) / 3),
    })),
  ];
}

// Golden spiral: 4 turns, 120 segments, starting small and growing to maxR
function goldenSpiralPath(cx: number, cy: number, maxR: number): string {
  const b = Math.log(1.6180339887) / (Math.PI / 2);
  const turns = 4;
  const steps = 120;
  const rAtEnd = Math.exp(b * turns * 2 * Math.PI);
  const scale  = maxR / rAtEnd;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns * 2 * Math.PI;
    const r = scale * Math.exp(b * t);
    const x = (cx + r * Math.cos(t - Math.PI)).toFixed(1);
    const y = (cy + r * Math.sin(t - Math.PI)).toFixed(1);
    d += i === 0 ? `M${x} ${y}` : ` L${x} ${y}`;
  }
  return d;
}

export default function SacredGeometryBackground({ isSpeaking }: { isSpeaking: boolean }) {
  const W  = _W;
  const H  = _H;
  const cx = W / 2;
  const cy = H / 2;
  const R  = Math.min(W, H) * 0.28;

  const rotA = useRef(new Animated.Value(0)).current;
  const rotB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.loop(Animated.timing(rotA, {
        toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: true,
      })),
      Animated.loop(Animated.timing(rotB, {
        toValue: 1, duration: 90000, easing: Easing.linear, useNativeDriver: true,
      })),
    ]);
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rotateCW  = rotA.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotateCCW = rotB.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  const inner  = flowerCircles(cx, cy, R);
  const outer  = outerFlowerCircles(cx, cy, R);
  const spiral = goldenSpiralPath(cx, cy, R * 2.2);

  const TEAL = '#4db8a4';
  const GOLD = '#c9a84c';
  const SW   = 0.9;

  const PAD = 200;
  const CW  = W + PAD * 2;
  const CH  = H + PAD * 2;
  const VB  = `-${PAD} -${PAD} ${CW} ${CH}`;
  const layerStyle = {
    position: 'absolute' as const,
    top: -PAD, left: -PAD,
    width: CW, height: CH,
  };

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: W, height: H }}>
      {/* Layer 1: Inner Flower of Life — teal, rotates CW 60s */}
      <Animated.View style={[layerStyle, {
        opacity: isSpeaking ? 0.18 : 0.12, transform: [{ rotate: rotateCW }],
      }]}>
        <Svg width={CW} height={CH} viewBox={VB}>
          {inner.map((c, i) => (
            <Circle key={i} cx={c.x} cy={c.y} r={R} fill="none" stroke={TEAL} strokeWidth={SW} />
          ))}
          <Circle cx={cx} cy={cy} r={R * 1.73} fill="none" stroke={TEAL} strokeWidth={SW * 0.5} />
        </Svg>
      </Animated.View>

      {/* Layer 2: Outer ring — gold, rotates CCW 90s */}
      <Animated.View style={[layerStyle, {
        opacity: isSpeaking ? 0.12 : 0.08, transform: [{ rotate: rotateCCW }],
      }]}>
        <Svg width={CW} height={CH} viewBox={VB}>
          {outer.map((c, i) => (
            <Circle key={i} cx={c.x} cy={c.y} r={R} fill="none" stroke={GOLD} strokeWidth={SW} />
          ))}
          <Circle cx={cx} cy={cy} r={R * 2}   fill="none" stroke={GOLD} strokeWidth={SW * 0.6} />
          <Circle cx={cx} cy={cy} r={R * 2.8} fill="none" stroke={GOLD} strokeWidth={SW * 0.4} />
        </Svg>
      </Animated.View>

      {/* Layer 3: Golden spiral */}
      <Animated.View style={[layerStyle, {
        opacity: isSpeaking ? 0.38 : 0.25, transform: [{ rotate: rotateCCW }],
      }]}>
        <Svg width={CW} height={CH} viewBox={VB}>
          <Path d={spiral} fill="none" stroke={GOLD} strokeWidth={1.5} />
        </Svg>
      </Animated.View>
    </View>
  );
}
