/**
 * PersonaAvatar v5.1 — 4D Sacred Geometry
 *
 * 4D model: three simultaneous rotation planes per ring (X, Y, W).
 *   scaleX      = cos(phaseX)          → Y-axis flip
 *   scaleY      = cos(phaseY)          → X-axis flip
 *   wScale      = 1 + cos(phaseW)·0.22 → W-axis near/far (0.78–1.22)
 *   wScaleGhost = 1 − cos(phaseW)·0.22 → opposite W position
 *   depthOp     = |sx|·0.30 + |sy|·0.30 + |sw|·0.40
 *
 * Periods use irrational ratios (φ, √2, √3, √5) so phases never align.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const SIZE = 200;
const C = SIZE / 2;

// ─── seeded scatter ───────────────────────────────────────────
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
function mkScatter(n: number, seed: number, dMin = 50, dMax = 88) {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => {
    const a = rng() * Math.PI * 2;
    const d = dMin + rng() * (dMax - dMin);
    return { sx: C + d * Math.cos(a), sy: C + d * Math.sin(a) };
  });
}

// ─── base hooks ───────────────────────────────────────────────
function useLoop(ms: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, [ms]);
  return v;
}

function usePulse(lo: number, hi: number, ms: number) {
  const v = useRef(new Animated.Value(lo)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: hi, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: lo, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, [lo, hi, ms]);
  return v;
}

// ─── avatar cycle ─────────────────────────────────────────────
function useAvatarCycle() {
  const cycle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(cycle, { toValue: 1, duration: 6500, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);
  const scatterProg = cycle.interpolate({
    inputRange:  [0,    0.31, 0.47, 0.72, 1.0],
    outputRange: [0,    0,    1,    1,    0  ],
  });
  return { cycle, scatterProg };
}

function useLit(cycle: Animated.Value) {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const id = cycle.addListener(({ value }) => {
      const next = value > 0.47 && value < 0.72;
      setLit(prev => prev !== next ? next : prev);
    });
    return () => cycle.removeListener(id);
  }, []);
  return lit;
}

// ─── 4D RING ROTATION ────────────────────────────────────────
function useRingRotation(periodXms: number, periodYms: number, periodWms: number, phaseOffset = 0) {
  const scaleX      = useRef(new Animated.Value(1)).current;
  const scaleY      = useRef(new Animated.Value(1)).current;
  const wScale      = useRef(new Animated.Value(1)).current;
  const wScaleGhost = useRef(new Animated.Value(1)).current;
  const depthOp     = useRef(new Animated.Value(1)).current;

  const phaseX = useRef(phaseOffset);
  const phaseY = useRef(phaseOffset * 1.618);
  const phaseW = useRef(phaseOffset * 2.414);
  const prevT  = useRef<number | null>(null);

  useEffect(() => {
    let raf: number;
    const tick = (now: number) => {
      if (prevT.current !== null) {
        const dt = now - prevT.current;
        phaseX.current += (2 * Math.PI * dt) / periodXms;
        phaseY.current += (2 * Math.PI * dt) / periodYms;
        phaseW.current += (2 * Math.PI * dt) / periodWms;
      }
      prevT.current = now;
      const sx = Math.cos(phaseX.current);
      const sy = Math.cos(phaseY.current);
      const sw = Math.cos(phaseW.current);
      scaleX.setValue(sx);
      scaleY.setValue(sy);
      wScale.setValue(1.0 + sw * 0.18);
      wScaleGhost.setValue(1.0 - sw * 0.18);
      // Multiplicative fade: element becomes invisible BEFORE it reaches edge-on,
      // so the zero-crossing (geometry collapse to a flat line) is never visible.
      // Power 0.55 makes the fade gradual at mid-angles but steep near zero.
      // W axis only brightens when already visible — never forces visibility alone.
      const xyFade  = Math.pow(Math.abs(sx), 0.55) * Math.pow(Math.abs(sy), 0.55);
      const wBright = 0.60 + Math.abs(sw) * 0.40;
      depthOp.setValue(Math.max(0.01, xyFade * wBright));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); prevT.current = null; };
  }, [periodXms, periodYms, periodWms]);

  return { scaleX, scaleY, wScale, wScaleGhost, depthOp };
}

// ─── CONTINUOUS Z-SPIN ────────────────────────────────────────
function useContinuousSpin(periodMs: number) {
  const t    = useRef(new Animated.Value(0)).current;
  const accT = useRef(0);
  const prevTs = useRef<number | null>(null);
  useEffect(() => {
    let raf: number;
    const tick = (now: number) => {
      if (prevTs.current !== null) accT.current += (now - prevTs.current) / periodMs;
      prevTs.current = now;
      t.setValue(accT.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); prevTs.current = null; };
  }, [periodMs]);
  const rotDeg = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'], extrapolate: 'extend' });
  return { rotDeg };
}

// ─── CONTINUOUS COLOR SHIFT ───────────────────────────────────
// rAF + Math.cos on an accumulated phase — never resets, no Animated.loop.
// backgroundColor is JS-thread only, so setValue() drives it directly.
function useColorShift(color1: string, color2: string, periodMs: number) {
  const t     = useRef(new Animated.Value(0)).current;
  const phase = useRef(0);
  const prevTs = useRef<number | null>(null);
  useEffect(() => {
    let raf: number;
    const tick = (now: number) => {
      if (prevTs.current !== null) {
        phase.current += (2 * Math.PI * (now - prevTs.current)) / periodMs;
      }
      prevTs.current = now;
      t.setValue((Math.cos(phase.current) + 1) / 2); // smooth 0→1→0
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); prevTs.current = null; };
  }, [periodMs]);
  const color = t.interpolate({ inputRange: [0, 1], outputRange: [color1, color2] });
  return { color };
}

function useContinuousSpinReverse(periodMs: number) {
  const t    = useRef(new Animated.Value(0)).current;
  const accT = useRef(0);
  const prevTs = useRef<number | null>(null);
  useEffect(() => {
    let raf: number;
    const tick = (now: number) => {
      if (prevTs.current !== null) accT.current += (now - prevTs.current) / periodMs;
      prevTs.current = now;
      t.setValue(accT.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); prevTs.current = null; };
  }, [periodMs]);
  const rotDeg = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'], extrapolate: 'extend' });
  return { rotDeg };
}

// ─── RIPPLE PULSE ─────────────────────────────────────────────
function useRipple(expandMs: number, dwellMs: number, initialDelayMs = 0) {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let stopped = false;
    const fadeDuration = expandMs * 0.8;
    const tailDelay    = expandMs - fadeDuration;
    const run = () => {
      if (stopped) return;
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 3.2, duration: expandMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0, duration: fadeDuration, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
            Animated.delay(tailDelay),
          ]),
        ]),
        Animated.timing(scale, { toValue: 1, duration: 1, useNativeDriver: true }),
        Animated.delay(dwellMs),
      ]).start(({ finished }) => { if (!stopped && finished) run(); });
    };
    if (initialDelayMs > 0) {
      const tid = setTimeout(run, initialDelayMs);
      return () => { stopped = true; clearTimeout(tid); };
    } else {
      run();
      return () => { stopped = true; };
    }
  }, [expandMs, dwellMs, initialDelayMs]);
  return { scale, opacity };
}

function useTumble(ms: number) {
  const t = useLoop(ms);
  const rotDeg = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scaleY = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [1, 0.65, 1, 0.65, 1] });
  return { rotDeg, scaleY };
}

// ─── SCATTER DOT ──────────────────────────────────────────────
type ScatterProg = Animated.AnimatedInterpolation<number>;
interface SDotProps { cx: number; cy: number; sx: number; sy: number; size: number; color: string; scatterProg: ScatterProg; }
function SDot({ cx, cy, sx, sy, size, color, scatterProg }: SDotProps) {
  const x  = (scatterProg as any).interpolate({ inputRange: [0, 1], outputRange: [cx, sx] });
  const y  = (scatterProg as any).interpolate({ inputRange: [0, 1], outputRange: [cy, sy] });
  const op = (scatterProg as any).interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 0.75, 0.4] });
  const half = size / 2;
  return (
    <Animated.View style={{
      position: 'absolute', left: -half, top: -half, width: size, height: size,
      borderRadius: size, backgroundColor: color, opacity: op,
      transform: [{ translateX: x }, { translateY: y }],
    }} />
  );
}

// ─── LINE ─────────────────────────────────────────────────────
function Line({ x1, y1, x2, y2, color, w = 1, op = 1 }: {
  x1: number; y1: number; x2: number; y2: number; color: string; w?: number; op?: number;
}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return null;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View style={{
      position: 'absolute', left: x1, top: y1, width: len, height: w,
      backgroundColor: color, opacity: op, transformOrigin: '0 0',
      transform: [{ rotate: `${ang}deg` }],
    }} />
  );
}

// ─── SACRED GRID ──────────────────────────────────────────────
function SacredGrid({ lit }: { lit: boolean }) {
  const basePulse = usePulse(0.02, 0.07, 5400);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: lit ? 0.28 : 0, duration: 900, useNativeDriver: true }).start();
  }, [lit]);

  const hexPts = (r: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return [C + r * Math.cos(a), C + r * Math.sin(a)] as [number, number];
    });

  const segs: [number, number, number, number][] = [];
  const radii = [22, 46, 70, 92];
  radii.forEach(r => {
    const pts = hexPts(r);
    pts.forEach((pt, j) => { const next = pts[(j + 1) % 6]; segs.push([pt[0], pt[1], next[0], next[1]]); });
  });
  for (let ri = 0; ri < radii.length - 1; ri++) {
    const inner = hexPts(radii[ri]), outer = hexPts(radii[ri + 1]);
    inner.forEach((pt, j) => { if (j % 2 === 0) segs.push([pt[0], pt[1], outer[j][0], outer[j][1]]); });
  }

  const renderSegs = (segs: [number,number,number,number][]) =>
    segs.map(([ax, ay, bx, by], i) => {
      const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx*dx+dy*dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      return <View key={i} style={{ position: 'absolute', left: ax, top: ay, width: len, height: 0.8, backgroundColor: '#ffffff', transformOrigin: '0 0', transform: [{ rotate: `${ang}deg` }] }} />;
    });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: basePulse }]}>{renderSegs(segs)}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>{renderSegs(segs.slice(0, 24))}</Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// PETE — Flower of Life (4D Emerald & Gold)
//
// BUG FIX: Spoke lines must live INSIDE the petalSpin group so they
// orbit with the petal circles. Previously they were in the outer ring
// (no petalSpin) → spokes pointed to empty space as petals orbited.
// ═══════════════════════════════════════════════════════════════

function mkFlowerDots() {
  const out: { cx: number; cy: number; layer: 'outer' | 'petal' | 'inner' }[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 / 10) * i;
    out.push({ cx: C + 11 * Math.cos(a), cy: C + 11 * Math.sin(a), layer: 'inner' });
  }
  for (let p = 0; p < 6; p++) {
    const pa = (Math.PI / 3) * p;
    const pcx = C + 24 * Math.cos(pa), pcy = C + 24 * Math.sin(pa);
    for (let i = 0; i < 7; i++) {
      const a = (Math.PI * 2 / 7) * i;
      out.push({ cx: pcx + 11 * Math.cos(a), cy: pcy + 11 * Math.sin(a), layer: 'petal' });
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 / 16) * i;
    out.push({ cx: C + 68 * Math.cos(a), cy: C + 68 * Math.sin(a), layer: 'outer' });
  }
  return out;
}
const FLOWER    = mkFlowerDots();
const FLOWER_SC = mkScatter(FLOWER.length, 0x1a2b3c);

function PeteAvatar({ speaking }: { speaking: boolean }) {
  const { cycle, scatterProg } = useAvatarCycle();
  const lit = useLit(cycle);

  // All periods × 1.5 vs v5 for slower, more observable motion
  const outerRing = useRingRotation(
    speaking ? 9300  : 16500,
    speaking ? 13350 : 23550,
    speaking ? 13200 : 23400,
    0
  );
  const petalRing = useRingRotation(
    speaking ? 7500  : 13200,
    speaking ? 11100 : 19800,
    speaking ? 18000 : 32100,
    1.0
  );
  const petalSpin = useContinuousSpin(speaking ? 16500 : 29400);
  const innerSpin = useContinuousSpin(speaking ? 5100  : 9150);

  const expandMs = speaking ? 4480 : 6720;
  const dwellMs  = speaking ? 600  : 1000;
  const ripple   = useRipple(expandMs, dwellMs, 0);
  const ripple2  = useRipple(expandMs, dwellMs, expandMs + dwellMs);

  const tumble   = useTumble(speaking ? 10500 : 19500);
  const breathe  = usePulse(0.92, 1.0, speaking ? 700 : 2200);
  const coreGlow  = usePulse(0.75, 1.0, speaking ? 500 : 1800);
  const pixelColor = useColorShift('#ffd700', '#00ff77', speaking ? 1400 : 2800);

  return (
    <View style={s.canvas}>
      <SacredGrid lit={lit} />

      {/* ── Outer ring: ghost (opposite W) ── */}
      <Animated.View style={[s.abs, {
        opacity: 0.32,
        transform: [{ scale: outerRing.wScaleGhost }, { scaleX: outerRing.scaleX }, { scaleY: outerRing.scaleY }],
      }]}>
        {/* Only the large circle border — spokes are in the petal group below */}
        <View style={{ position: 'absolute', left: C - 68, top: C - 68, width: 136, height: 136, borderRadius: 68, borderWidth: 0.6, borderColor: '#ffd70066' }} />
      </Animated.View>

      {/* ── Outer ring: main ── */}
      <Animated.View style={[s.abs, {
        opacity: outerRing.depthOp,
        transform: [{ scale: outerRing.wScale }, { scaleX: outerRing.scaleX }, { scaleY: outerRing.scaleY }],
      }]}>
        <View style={{ position: 'absolute', left: C - 68, top: C - 68, width: 136, height: 136, borderRadius: 68, borderWidth: 1, borderColor: '#ffd700' }} />
      </Animated.View>

      {/* ── Petal ring: ghost ── */}
      <Animated.View style={[s.abs, {
        opacity: 0.32,
        transform: [{ scale: petalRing.wScaleGhost }, { rotate: petalSpin.rotDeg }, { scaleX: petalRing.scaleX }, { scaleY: petalRing.scaleY }],
      }]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i;
          const px = C + 24 * Math.cos(a) - 24, py = C + 24 * Math.sin(a) - 24;
          return <View key={i} style={{ position: 'absolute', left: px, top: py, width: 48, height: 48, borderRadius: 24, borderWidth: 0.6, borderColor: '#00dd5566' }} />;
        })}
        {/* Spokes: petal center → outer ring — must be here so they orbit with petals */}
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i;
          return <Line key={`s${i}`} x1={C + 24 * Math.cos(a)} y1={C + 24 * Math.sin(a)} x2={C + 68 * Math.cos(a)} y2={C + 68 * Math.sin(a)} color="#ffd70044" w={0.6} op={0.5} />;
        })}
      </Animated.View>

      {/* ── Petal ring: main — circles self-rotate + orbit, spokes orbit with them ── */}
      <Animated.View style={[s.abs, {
        transform: [{ scale: petalRing.wScale }, { rotate: petalSpin.rotDeg }, { scaleX: petalRing.scaleX }, { scaleY: petalRing.scaleY }],
      }]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i;
          const px = C + 24 * Math.cos(a) - 24, py = C + 24 * Math.sin(a) - 24;
          return (
            <Animated.View key={i} style={{ position: 'absolute', left: px, top: py, width: 48, height: 48, transform: [{ rotate: petalSpin.rotDeg }] }}>
              <View style={{ position: 'absolute', left: 0, top: 0, width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#00dd55' }} />
              <View style={{ position: 'absolute', left: 23, top: 5, width: 1.5, height: 19, backgroundColor: '#00dd5599' }} />
            </Animated.View>
          );
        })}
        {/* Connecting arcs between adjacent petal centers */}
        {Array.from({ length: 6 }, (_, i) => {
          const a1 = (Math.PI / 3) * i, a2 = (Math.PI / 3) * ((i + 1) % 6);
          return <Line key={`l${i}`} x1={C + 24 * Math.cos(a1)} y1={C + 24 * Math.sin(a1)} x2={C + 24 * Math.cos(a2)} y2={C + 24 * Math.sin(a2)} color="#00dd55" w={0.8} op={0.6} />;
        })}
        {/* Spokes: orbit with petals so they always point from each circle to the outer ring */}
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i;
          return <Line key={`s${i}`} x1={C + 24 * Math.cos(a)} y1={C + 24 * Math.sin(a)} x2={C + 68 * Math.cos(a)} y2={C + 68 * Math.sin(a)} color="#ffd700" w={0.8} op={0.5} />;
        })}
      </Animated.View>

      {/* ── Inner ring ── */}
      <Animated.View style={[s.abs, { transform: [{ rotate: innerSpin.rotDeg }] }]}>
        <View style={{ position: 'absolute', left: C - 24, top: C - 24, width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: '#00ff77' }} />
        <View style={{ position: 'absolute', left: C - 13, top: C - 13, width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#ffd70077' }} />
      </Animated.View>

      {/* ── Ripple ── */}
      <Animated.View style={[s.center]}>
        <Animated.View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: '#00ff77', opacity: ripple.opacity, transform: [{ scale: ripple.scale }] }} />
      </Animated.View>
      <Animated.View style={[s.center]}>
        <Animated.View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#00dd55', opacity: ripple2.opacity, transform: [{ scale: ripple2.scale }] }} />
      </Animated.View>

      {/* ── Scatter ── */}
      <Animated.View style={[s.abs, { transform: [{ rotate: tumble.rotDeg }, { scaleY: tumble.scaleY }] }]}>
        <Animated.View style={[s.abs, { transform: [{ scale: breathe }] }]}>
          {FLOWER.map((d, i) => (
            <SDot key={i} cx={d.cx} cy={d.cy} sx={FLOWER_SC[i].sx} sy={FLOWER_SC[i].sy}
              size={d.layer === 'outer' ? 3.5 : d.layer === 'inner' ? 4.5 : i % 3 === 0 ? 4 : 2.8}
              color={d.layer === 'outer' ? '#ffd700' : d.layer === 'inner' ? '#00ff77' : i % 4 === 0 ? '#ffd700' : '#00cc55'}
              scatterProg={scatterProg}
            />
          ))}
        </Animated.View>
      </Animated.View>

      <Animated.View style={[s.center, { opacity: coreGlow }]}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#00cc44', shadowColor: '#00ff77', shadowRadius: 20, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }} />
        <View style={{ position: 'absolute', width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#ccffe0' }} />
      </Animated.View>

      {/* ── Color-shifting pixel: yellow ↔ green, rAF continuous, never resets ── */}
      <Animated.View style={[s.center]}>
        <Animated.View style={{
          width: 4, height: 4, borderRadius: 2,
          backgroundColor: pixelColor.color,
          shadowColor: '#ffffff', shadowRadius: 4, shadowOpacity: 0.9, shadowOffset: { width: 0, height: 0 },
        }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// ARCHITECT — Metatron's Cube (4D Cyan)
// ═══════════════════════════════════════════════════════════════

function mkMetatron() {
  const inner = Array.from({ length: 6 }, (_, i) => ({ x: C + 28 * Math.cos((Math.PI/3)*i), y: C + 28 * Math.sin((Math.PI/3)*i), tier: 1 as const }));
  const outer = Array.from({ length: 6 }, (_, i) => ({ x: C + 56 * Math.cos((Math.PI/3)*i+Math.PI/6), y: C + 56 * Math.sin((Math.PI/3)*i+Math.PI/6), tier: 2 as const }));
  return [{ x: C, y: C, tier: 0 as const }, ...inner, ...outer];
}
const META    = mkMetatron();
const META_SC = mkScatter(META.length, 0xdeadbeef, 45, 88);

const META_EDGES: [number, number, boolean][] = [
  ...[1,2,3,4,5,6].map(i => [0,i,false] as [number,number,boolean]),
  [1,2,false],[2,3,false],[3,4,false],[4,5,false],[5,6,false],[6,1,false],
  [1,7,false],[2,8,false],[3,9,false],[4,10,false],[5,11,false],[6,12,false],
  [7,8,false],[8,9,false],[9,10,false],[10,11,false],[11,12,false],[12,7,false],
  [1,9,true],[1,11,true],[2,10,true],[2,12,true],[3,11,true],[3,7,true],
  [4,12,true],[4,8,true],[5,7,true],[5,9,true],[6,8,true],[6,10,true],
];

function MetatronEdges({ color, crossOp = 0.28, mainOp = 0.82 }: { color: string; crossOp?: number; mainOp?: number }) {
  return <>{META_EDGES.map(([a, b, isCross], i) => <Line key={i} x1={META[a].x} y1={META[a].y} x2={META[b].x} y2={META[b].y} color={color} w={isCross ? 0.6 : 1.1} op={isCross ? crossOp : mainOp} />)}</>;
}

function ArchitectAvatar({ speaking }: { speaking: boolean }) {
  const { cycle, scatterProg } = useAvatarCycle();
  const lit = useLit(cycle);

  const outerRing = useRingRotation(speaking ? 10500 : 18750, speaking ? 15150 : 26700, speaking ? 18300 : 32550, 0);
  const innerRing = useRingRotation(speaking ? 7800  : 13950, speaking ? 11700 : 20850, speaking ? 16650 : 29550, 2.0);
  const centerSpin    = useContinuousSpin(speaking ? 5700  : 10200);
  const centerRevSpin = useContinuousSpinReverse(speaking ? 8400 : 14850);

  const tumble   = useTumble(speaking ? 12000 : 21000);
  const breathe  = usePulse(0.94, 1.02, speaking ? 600 : 2600);
  const coreGlow = usePulse(0, 1.0, speaking ? 900 : 3200);
  const skeletonProg = (scatterProg as any).interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] });

  return (
    <View style={s.canvas}>
      <SacredGrid lit={lit} />

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: outerRing.wScaleGhost }, { scaleX: outerRing.scaleX }, { scaleY: outerRing.scaleY }] }]}>
        <MetatronEdges color="#00ffff44" crossOp={0.1} mainOp={0.3} />
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: outerRing.depthOp, transform: [{ scale: outerRing.wScale }, { scaleX: outerRing.scaleX }, { scaleY: outerRing.scaleY }] }]}>
        <MetatronEdges color="#00ffff" />
      </Animated.View>

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: innerRing.wScaleGhost }, { scaleX: innerRing.scaleX }, { scaleY: innerRing.scaleY }] }]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI/3)*i;
          return <View key={i} style={{ position: 'absolute', left: C+28*Math.cos(a)-5, top: C+28*Math.sin(a)-5, width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: '#00ddee44' }} />;
        })}
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: innerRing.depthOp, transform: [{ scale: innerRing.wScale }, { scaleX: innerRing.scaleX }, { scaleY: innerRing.scaleY }] }]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI/3)*i;
          return <View key={i} style={{ position: 'absolute', left: C+28*Math.cos(a)-5, top: C+28*Math.sin(a)-5, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#00ddee' }} />;
        })}
        <View style={{ position: 'absolute', left: C-28, top: C-28, width: 56, height: 56, borderRadius: 28, borderWidth: 0.8, borderColor: '#00ffff44' }} />
      </Animated.View>

      <Animated.View style={[s.abs, { transform: [{ rotate: centerSpin.rotDeg }] }]}>
        <View style={{ position: 'absolute', left: C-56, top: C-56, width: 112, height: 112, borderRadius: 56, borderWidth: 0.6, borderColor: '#00ffff22' }} />
      </Animated.View>
      <Animated.View style={[s.abs, { transform: [{ rotate: centerRevSpin.rotDeg }] }]}>
        <View style={{ position: 'absolute', left: C-42, top: C-42, width: 84, height: 84, borderRadius: 42, borderWidth: 0.5, borderColor: '#00ffff18' }} />
      </Animated.View>

      <Animated.View style={[s.abs, { transform: [{ rotate: tumble.rotDeg }, { scaleY: tumble.scaleY }] }]}>
        <Animated.View style={[s.abs, { transform: [{ scale: breathe }] }]}>
          {META.map((n, i) => (
            <SDot key={i} cx={n.x} cy={n.y} sx={META_SC[i].sx} sy={META_SC[i].sy}
              size={n.tier === 0 ? 9 : n.tier === 1 ? 5.5 : 3.5}
              color={n.tier === 0 ? '#00ffff' : n.tier === 1 ? '#00dde8' : '#009baa'}
              scatterProg={n.tier < 2 ? skeletonProg : scatterProg}
            />
          ))}
        </Animated.View>
      </Animated.View>

      <Animated.View style={[s.center, { opacity: coreGlow }]}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#00ffff', shadowColor: '#00ffff', shadowRadius: 22, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// CRITIC — Fibonacci / Golden Spiral (4D Orange-Red)
//
// The golden spiral r = a·φ^(2θ/π) rendered as two counter-wound arms
// (like a nautilus shell or sunflower phyllotaxis), split into three
// independent 4D-rotating segments. No stars, no triangles — pure curve.
//
// Layers:
//   outer  — outermost arc of both spiral arms (large sweep, high θ)
//   middle — mid-section arcs + Fibonacci quarter-turn marker circles
//   inner  — tight central coils + Z-spin (innermost, lowest θ)
// ═══════════════════════════════════════════════════════════════

const GOLDEN_PHI = (1 + Math.sqrt(5)) / 2;

function mkGoldenSpiral() {
  const a = 3.2;          // starting radius (px at θ=0)
  const N = 90;           // segments per arm
  const maxTheta = 3.5 * Math.PI; // 1.75 full rotations → r_max ≈ 3.2·φ^7 ≈ 87px

  const arm1: { x: number; y: number }[] = [];
  const arm2: { x: number; y: number }[] = [];

  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * maxTheta;
    const r = a * Math.pow(GOLDEN_PHI, theta * 2 / Math.PI);
    // arm1 starts pointing up; arm2 is the mirror arm (offset by π)
    arm1.push({ x: C + r * Math.cos(theta - Math.PI / 2), y: C + r * Math.sin(theta - Math.PI / 2) });
    arm2.push({ x: C + r * Math.cos(theta + Math.PI / 2), y: C + r * Math.sin(theta + Math.PI / 2) });
  }

  // Fibonacci marker points at each quarter-turn (where φ-growth steps occur)
  const fibMarkers: { cx: number; cy: number; k: number }[] = [];
  for (let k = 0; k <= 7; k++) {
    const theta = k * Math.PI / 2;
    const r = a * Math.pow(GOLDEN_PHI, theta * 2 / Math.PI);
    fibMarkers.push({
      cx: C + r * Math.cos(theta - Math.PI / 2),
      cy: C + r * Math.sin(theta - Math.PI / 2),
      k,
    });
  }

  // Split both arms into 3 segments for independent 4D layers
  const c1 = Math.floor(N * 0.32); // inner cut
  const c2 = Math.floor(N * 0.64); // outer cut

  // Scatter particles sampled from both arms
  const particles: { cx: number; cy: number; ri: number }[] = [];
  [arm1, arm2].forEach(arm => {
    arm.forEach((p, i) => {
      if (i % 5 === 0) particles.push({ cx: p.x, cy: p.y, ri: i < c1 ? 2 : i < c2 ? 1 : 0 });
    });
  });
  fibMarkers.forEach(m => particles.push({ cx: m.cx, cy: m.cy, ri: m.k < 3 ? 2 : 0 }));

  return {
    inner:  { arm1: arm1.slice(0, c1 + 1), arm2: arm2.slice(0, c1 + 1), fibs: fibMarkers.filter(m => m.k <= 2) },
    middle: { arm1: arm1.slice(c1, c2 + 1), arm2: arm2.slice(c1, c2 + 1), fibs: fibMarkers.filter(m => m.k > 2 && m.k <= 5) },
    outer:  { arm1: arm1.slice(c2), arm2: arm2.slice(c2), fibs: fibMarkers.filter(m => m.k > 5) },
    particles,
  };
}
const SPIRAL    = mkGoldenSpiral();
const SPIRAL_SC = mkScatter(SPIRAL.particles.length, 0xfeedface, 48, 90);

// Render a spiral arm as consecutive line segments
function SpiralArm({ pts, color, w, op = 1 }: { pts: { x: number; y: number }[]; color: string; w: number; op?: number }) {
  return <>
    {pts.slice(0, -1).map((v, i) => (
      <Line key={i} x1={v.x} y1={v.y} x2={pts[i + 1].x} y2={pts[i + 1].y} color={color} w={w} op={op} />
    ))}
  </>;
}

// Small circles at Fibonacci quarter-turn markers (show φ-growth rhythm)
function FibMarkers({ pts, color, op = 1 }: { pts: { cx: number; cy: number; k: number }[]; color: string; op?: number }) {
  return <>
    {pts.map((p, i) => {
      const d = 3 + p.k * 0.8; // markers grow with k (larger = further out)
      return <View key={i} style={{ position: 'absolute', left: p.cx - d, top: p.cy - d, width: d * 2, height: d * 2, borderRadius: d, borderWidth: 1, borderColor: color, opacity: op }} />;
    })}
  </>;
}

function CriticAvatar({ speaking }: { speaking: boolean }) {
  const { cycle, scatterProg } = useAvatarCycle();
  const lit = useLit(cycle);

  // Three independent 4D rotations — one per spiral segment
  const outerSeg  = useRingRotation(speaking ? 8250  : 15000, speaking ? 12300 : 21900, speaking ? 13650 : 24300, 0);
  const middleSeg = useRingRotation(speaking ? 6300  : 11400, speaking ? 9450  : 16800, speaking ? 16350 : 29100, 1.5);
  const innerSeg  = useRingRotation(speaking ? 14100 : 25050, speaking ? 10200 : 18000, speaking ? 19950 : 35400, 3.0);
  const innerSpin = useContinuousSpin(speaking ? 5600 : 10200);

  const tumble   = useTumble(speaking ? 9750  : 17250);
  const breathe  = usePulse(0.93, 1.05, speaking ? 500 : 1600);
  const coreGlow = usePulse(0, 1.0, speaking ? 700 : 2400);

  const { inner, middle, outer, particles } = SPIRAL;

  return (
    <View style={s.canvas}>
      <SacredGrid lit={lit} />

      {/* ── Outer spiral segment: 4D ghost ── */}
      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: outerSeg.wScaleGhost }, { scaleX: outerSeg.scaleX }, { scaleY: outerSeg.scaleY }] }]}>
        <SpiralArm pts={outer.arm1} color="#ff550033" w={0.8} />
        <SpiralArm pts={outer.arm2} color="#ff330033" w={0.8} />
        <FibMarkers pts={outer.fibs} color="#ff440033" />
      </Animated.View>

      {/* ── Outer spiral segment: main ── */}
      <Animated.View style={[s.abs, { opacity: outerSeg.depthOp, transform: [{ scale: outerSeg.wScale }, { scaleX: outerSeg.scaleX }, { scaleY: outerSeg.scaleY }] }]}>
        <SpiralArm pts={outer.arm1} color="#ff6600" w={1.3} />
        <SpiralArm pts={outer.arm2} color="#ff4400" w={1.0} op={0.75} />
        <FibMarkers pts={outer.fibs} color="#ff6600" />
      </Animated.View>

      {/* ── Middle spiral segment: 4D ghost ── */}
      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: middleSeg.wScaleGhost }, { scaleX: middleSeg.scaleX }, { scaleY: middleSeg.scaleY }] }]}>
        <SpiralArm pts={middle.arm1} color="#ff550033" w={0.8} />
        <SpiralArm pts={middle.arm2} color="#ff330033" w={0.8} />
        <FibMarkers pts={middle.fibs} color="#ff440033" />
      </Animated.View>

      {/* ── Middle spiral segment: main ── */}
      <Animated.View style={[s.abs, { opacity: middleSeg.depthOp, transform: [{ scale: middleSeg.wScale }, { scaleX: middleSeg.scaleX }, { scaleY: middleSeg.scaleY }] }]}>
        <SpiralArm pts={middle.arm1} color="#ff5500" w={1.1} />
        <SpiralArm pts={middle.arm2} color="#ff3300" w={0.9} op={0.75} />
        <FibMarkers pts={middle.fibs} color="#ff5500" />
      </Animated.View>

      {/* ── Inner spiral segment: Z-spin + 4D (ghost) ── */}
      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: innerSeg.wScaleGhost }, { rotate: innerSpin.rotDeg }, { scaleX: innerSeg.scaleX }, { scaleY: innerSeg.scaleY }] }]}>
        <SpiralArm pts={inner.arm1} color="#ff330033" w={0.7} />
        <SpiralArm pts={inner.arm2} color="#ff220033" w={0.7} />
        <FibMarkers pts={inner.fibs} color="#ff330033" />
      </Animated.View>

      {/* ── Inner spiral segment: Z-spin + 4D (main) ── */}
      <Animated.View style={[s.abs, { opacity: innerSeg.depthOp, transform: [{ scale: innerSeg.wScale }, { rotate: innerSpin.rotDeg }, { scaleX: innerSeg.scaleX }, { scaleY: innerSeg.scaleY }] }]}>
        <SpiralArm pts={inner.arm1} color="#ff4400" w={1.0} />
        <SpiralArm pts={inner.arm2} color="#ff2200" w={0.8} op={0.7} />
        <FibMarkers pts={inner.fibs} color="#ff4400" />
      </Animated.View>

      {/* ── Scatter ── */}
      <Animated.View style={[s.abs, { transform: [{ rotate: tumble.rotDeg }, { scaleY: tumble.scaleY }] }]}>
        <Animated.View style={[s.abs, { transform: [{ scale: breathe }] }]}>
          {particles.map((p, i) => (
            <SDot key={i} cx={p.cx} cy={p.cy} sx={SPIRAL_SC[i].sx} sy={SPIRAL_SC[i].sy}
              size={p.ri === 0 ? 5 : p.ri === 1 ? 3.5 : 2.5}
              color={p.ri === 0 ? '#ff6600' : p.ri === 1 ? '#ff4400' : '#ff2200'}
              scatterProg={scatterProg}
            />
          ))}
        </Animated.View>
      </Animated.View>

      <Animated.View style={[s.center, { opacity: coreGlow }]}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff4400', shadowColor: '#ff6600', shadowRadius: 16, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }} />
        <View style={{ position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#ffccaa' }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESEARCHER — DNA Double Helix (4D Purple-Violet)
// ═══════════════════════════════════════════════════════════════

function mkHelix() {
  const N = 26, H = 128, R = 30;
  const dots: { cx: number; cy: number; strand: 0|1; t: number }[] = [];
  const pairs: { cx: number; cy: number }[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const y = C - H/2 + t*H, a1 = t*Math.PI*4;
    dots.push({ cx: C + R*Math.cos(a1),           cy: y, strand: 0, t });
    dots.push({ cx: C + R*Math.cos(a1+Math.PI),   cy: y, strand: 1, t });
    if (i % 4 === 0) pairs.push({ cx: C, cy: y });
  }
  const neurons = [
    { cx: C-54, cy: C-28 }, { cx: C+54, cy: C-48 },
    { cx: C-60, cy: C+22 }, { cx: C+52, cy: C+36 },
    { cx: C-38, cy: C+62 }, { cx: C+46, cy: C-8  },
  ];
  return { dots, pairs, neurons };
}
const HELIX         = mkHelix();
const HELIX_DOT_SC  = mkScatter(HELIX.dots.length,    0x7a8b9cdd, 40, 86);
const HELIX_PAIR_SC = mkScatter(HELIX.pairs.length,   0xabcdef01, 36, 78);
const HELIX_NEU_SC  = mkScatter(HELIX.neurons.length, 0x11223344, 48, 85);

function ResearcherAvatar({ speaking }: { speaking: boolean }) {
  const { cycle, scatterProg } = useAvatarCycle();
  const lit = useLit(cycle);

  const strandA   = useRingRotation(speaking ? 8700  : 15750, speaking ? 12900 : 22950, speaking ? 14400 : 25500, 0);
  const strandB   = useRingRotation(speaking ? 6750  : 12300, speaking ? 10350 : 18450, speaking ? 14700 : 26100, 2.5);
  const basePairs = useRingRotation(speaking ? 15600 : 27750, speaking ? 10500 : 18000, speaking ? 16350 : 29100, 1.2);
  const baseSpin  = useContinuousSpin(speaking ? 10500 : 18000);

  const tumble  = useTumble(speaking ? 11250 : 20250);
  const breathe = usePulse(0.92, 1.0, speaking ? 650 : 2300);
  const travel  = useLoop(speaking ? 900 : 2000);

  const travelX = travel.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [C-30, C+30, C-30, C+30, C-30] });
  const travelY = travel.interpolate({ inputRange: [0, 1], outputRange: [C-64, C+64] });

  return (
    <View style={s.canvas}>
      <SacredGrid lit={lit} />

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: basePairs.wScaleGhost }, { rotate: baseSpin.rotDeg }, { scaleX: basePairs.scaleX }, { scaleY: basePairs.scaleY }] }]}>
        {HELIX.pairs.map((p, i) => { const t=i/HELIX.pairs.length, a=t*Math.PI*4; const x1=C+30*Math.cos(a), x2=C+30*Math.cos(a+Math.PI); return <Line key={i} x1={x1} y1={p.cy} x2={x2} y2={p.cy} color="#cc88ff44" w={0.7} op={0.5} />; })}
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: basePairs.depthOp, transform: [{ scale: basePairs.wScale }, { rotate: baseSpin.rotDeg }, { scaleX: basePairs.scaleX }, { scaleY: basePairs.scaleY }] }]}>
        {HELIX.pairs.map((p, i) => { const t=i/HELIX.pairs.length, a=t*Math.PI*4; const x1=C+30*Math.cos(a), x2=C+30*Math.cos(a+Math.PI); return <Line key={i} x1={x1} y1={p.cy} x2={x2} y2={p.cy} color="#cc88ff" w={0.9} op={0.65} />; })}
      </Animated.View>

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: strandA.wScaleGhost }, { scaleX: strandA.scaleX }, { scaleY: strandA.scaleY }] }]}>
        {HELIX.dots.filter(d => d.strand===0 && Math.floor(d.t*10)%2===0).map((d, i) => <View key={i} style={{ position: 'absolute', left: d.cx-8, top: d.cy-8, width: 16, height: 16, borderRadius: 8, borderWidth: 0.6, borderColor: '#cc88ff33' }} />)}
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: strandA.depthOp, transform: [{ scale: strandA.wScale }, { scaleX: strandA.scaleX }, { scaleY: strandA.scaleY }] }]}>
        {HELIX.dots.filter(d => d.strand===0 && Math.floor(d.t*10)%2===0).map((d, i) => <View key={i} style={{ position: 'absolute', left: d.cx-8, top: d.cy-8, width: 16, height: 16, borderRadius: 8, borderWidth: 0.8, borderColor: '#cc88ff55' }} />)}
      </Animated.View>

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: strandB.wScaleGhost }, { scaleX: strandB.scaleX }, { scaleY: strandB.scaleY }] }]}>
        {HELIX.dots.filter(d => d.strand===1 && Math.floor(d.t*10)%2===0).map((d, i) => <View key={i} style={{ position: 'absolute', left: d.cx-8, top: d.cy-8, width: 16, height: 16, borderRadius: 8, borderWidth: 0.6, borderColor: '#9955ff33' }} />)}
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: strandB.depthOp, transform: [{ scale: strandB.wScale }, { scaleX: strandB.scaleX }, { scaleY: strandB.scaleY }] }]}>
        {HELIX.dots.filter(d => d.strand===1 && Math.floor(d.t*10)%2===0).map((d, i) => <View key={i} style={{ position: 'absolute', left: d.cx-8, top: d.cy-8, width: 16, height: 16, borderRadius: 8, borderWidth: 0.8, borderColor: '#9955ff55' }} />)}
        {HELIX.neurons.map((n, i) => <Line key={`n${i}`} x1={C} y1={C} x2={n.cx} y2={n.cy} color="#7722cc" w={0.7} op={0.35} />)}
      </Animated.View>

      <Animated.View style={[s.abs, { transform: [{ rotate: tumble.rotDeg }, { scaleY: tumble.scaleY }] }]}>
        <Animated.View style={[s.abs, { transform: [{ scale: breathe }] }]}>
          {HELIX.dots.map((d, i) => <SDot key={`d${i}`} cx={d.cx} cy={d.cy} sx={HELIX_DOT_SC[i].sx} sy={HELIX_DOT_SC[i].sy} size={d.strand===0 ? 5 : 3.8} color={d.strand===0 ? '#cc88ff' : '#8844cc'} scatterProg={scatterProg} />)}
          {HELIX.pairs.map((p, i) => <SDot key={`p${i}`} cx={p.cx} cy={p.cy} sx={HELIX_PAIR_SC[i].sx} sy={HELIX_PAIR_SC[i].sy} size={3} color="#ee88ff" scatterProg={scatterProg} />)}
          {HELIX.neurons.map((n, i) => <SDot key={`n${i}`} cx={n.cx} cy={n.cy} sx={HELIX_NEU_SC[i].sx} sy={HELIX_NEU_SC[i].sy} size={7} color="#7722cc" scatterProg={scatterProg} />)}
        </Animated.View>
      </Animated.View>

      <Animated.View style={[s.abs, { opacity: (scatterProg as any).interpolate({ inputRange: [0,0.4,0.9,1], outputRange: [1,0,0,1] }) }]}>
        <Animated.View style={{ position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ffffff', shadowColor: '#cc88ff', shadowRadius: 10, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 }, transform: [{ translateX: travelX }, { translateY: travelY }] }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// BUILDER — Icosahedron (4D Amber-Gold)
// ═══════════════════════════════════════════════════════════════

function mkIcosahedron() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [[0,1,phi],[0,-1,phi],[0,1,-phi],[0,-1,-phi],[1,phi,0],[-1,phi,0],[1,-phi,0],[-1,-phi,0],[phi,0,1],[-phi,0,1],[phi,0,-1],[-phi,0,-1]];
  const sc = 54;
  const verts = raw.map(([x,y,z]) => { const len=Math.sqrt(x*x+y*y+z*z); return { cx: C+(x/len)*sc, cy: C+(y/len)*sc, z: z/len }; });
  const edges: [number,number][] = [[0,1],[0,4],[0,5],[0,8],[0,9],[1,6],[1,7],[1,8],[1,9],[2,3],[2,4],[2,5],[2,10],[2,11],[3,6],[3,7],[3,10],[3,11],[4,5],[4,8],[4,10],[5,9],[5,11],[6,7],[6,8],[6,10],[7,9],[7,11],[8,10],[9,11]];
  return { verts, edges };
}
const ICOSA    = mkIcosahedron();
const ICOSA_SC = mkScatter(ICOSA.verts.length, 0xcafe1234, 50, 90);

function BuilderAvatar({ speaking }: { speaking: boolean }) {
  const { cycle, scatterProg } = useAvatarCycle();
  const lit = useLit(cycle);

  const topTier    = useRingRotation(speaking ? 10200 : 18000, speaking ? 14550 : 25800, speaking ? 22650 : 40200, 0);
  const midTier    = useRingRotation(speaking ? 11400 : 20250, speaking ? 7650  : 13500, speaking ? 12300 : 21900, 1.8);
  const midSpin    = useContinuousSpin(speaking ? 7650 : 13500);
  const bottomTier = useRingRotation(speaking ? 6000  : 10800, speaking ? 9300  : 16650, speaking ? 9750  : 17400, 3.6);

  const tumble   = useTumble(speaking ? 10800 : 19500);
  const breathe  = usePulse(0.92, 1.02, speaking ? 600 : 2000);
  const coreGlow = usePulse(0, 1.0, speaking ? 900 : 3000);
  const edgeOp   = (scatterProg as any).interpolate({ inputRange: [0,0.5,1], outputRange: [0.72,0.06,0.72] });

  const renderEdges = (edges: [number,number][], color: string) =>
    edges.map(([a,b], i) => {
      const va=ICOSA.verts[a], vb=ICOSA.verts[b], bright=((va.z+vb.z)/2+1)/2;
      return <Line key={i} x1={va.cx} y1={va.cy} x2={vb.cx} y2={vb.cy} color={color} w={0.8+bright*0.8} op={0.3+bright*0.65} />;
    });

  const top10    = ICOSA.edges.slice(0, 10)  as [number,number][];
  const mid10    = ICOSA.edges.slice(10, 20) as [number,number][];
  const bottom   = ICOSA.edges.slice(20)     as [number,number][];

  return (
    <View style={s.canvas}>
      <SacredGrid lit={lit} />

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: topTier.wScaleGhost }, { scaleX: topTier.scaleX }, { scaleY: topTier.scaleY }] }]}>
        <Animated.View style={[s.abs, { opacity: edgeOp }]}>{renderEdges(top10, '#ffaa0044')}</Animated.View>
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: topTier.depthOp, transform: [{ scale: topTier.wScale }, { scaleX: topTier.scaleX }, { scaleY: topTier.scaleY }] }]}>
        <Animated.View style={[s.abs, { opacity: edgeOp }]}>{renderEdges(top10, '#ffaa00')}</Animated.View>
      </Animated.View>

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: midTier.wScaleGhost }, { rotate: midSpin.rotDeg }, { scaleX: midTier.scaleX }, { scaleY: midTier.scaleY }] }]}>
        <Animated.View style={[s.abs, { opacity: edgeOp }]}>{renderEdges(mid10, '#ffcc4444')}</Animated.View>
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: midTier.depthOp, transform: [{ scale: midTier.wScale }, { rotate: midSpin.rotDeg }, { scaleX: midTier.scaleX }, { scaleY: midTier.scaleY }] }]}>
        <Animated.View style={[s.abs, { opacity: edgeOp }]}>{renderEdges(mid10, '#ffcc44')}</Animated.View>
      </Animated.View>

      <Animated.View style={[s.abs, { opacity: 0.32, transform: [{ scale: bottomTier.wScaleGhost }, { scaleX: bottomTier.scaleX }, { scaleY: bottomTier.scaleY }] }]}>
        <Animated.View style={[s.abs, { opacity: edgeOp }]}>{renderEdges(bottom, '#ff880044')}</Animated.View>
      </Animated.View>
      <Animated.View style={[s.abs, { opacity: bottomTier.depthOp, transform: [{ scale: bottomTier.wScale }, { scaleX: bottomTier.scaleX }, { scaleY: bottomTier.scaleY }] }]}>
        <Animated.View style={[s.abs, { opacity: edgeOp }]}>{renderEdges(bottom, '#ff8800')}</Animated.View>
      </Animated.View>

      <Animated.View style={[s.abs, { transform: [{ rotate: tumble.rotDeg }, { scaleY: tumble.scaleY }] }]}>
        <Animated.View style={[s.abs, { transform: [{ scale: breathe }] }]}>
          {ICOSA.verts.map((v, i) => (
            <SDot key={i} cx={v.cx} cy={v.cy} sx={ICOSA_SC[i].sx} sy={ICOSA_SC[i].sy}
              size={4+(v.z+1)*3.5}
              color={i%3===0 ? '#ffdd44' : i%3===1 ? '#ffaa00' : '#cc7700'}
              scatterProg={scatterProg}
            />
          ))}
        </Animated.View>
      </Animated.View>

      <Animated.View style={[s.center, { opacity: coreGlow }]}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffcc44', shadowColor: '#ffaa00', shadowRadius: 22, shadowOpacity: 1, shadowOffset: { width: 0, height: 0 } }} />
        <View style={{ position: 'absolute', width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff8e0' }} />
      </Animated.View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

interface Props { personaId: string; speaking: boolean; size?: number; }

export default function PersonaAvatar({ personaId, speaking, size = SIZE }: Props) {
  if (size === SIZE) {
    return (
      <View style={s.wrapper}>
        <View style={s.bg} />
        {personaId === 'pete'       && <PeteAvatar speaking={speaking} />}
        {personaId === 'architect'  && <ArchitectAvatar speaking={speaking} />}
        {personaId === 'critic'     && <CriticAvatar speaking={speaking} />}
        {personaId === 'researcher' && <ResearcherAvatar speaking={speaking} />}
        {personaId === 'builder'    && <BuilderAvatar speaking={speaking} />}
      </View>
    );
  }

  // Scaled-down render: transform the full-size canvas into a small circle
  const scale = size / SIZE;
  const offset = (SIZE - size) / 2;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <View style={{ width: SIZE, height: SIZE, transform: [{ scale }], marginTop: -offset, marginLeft: -offset }}>
        <View style={[s.bg, { borderRadius: SIZE / 2 }]} />
        {personaId === 'pete'       && <PeteAvatar speaking={speaking} />}
        {personaId === 'architect'  && <ArchitectAvatar speaking={speaking} />}
        {personaId === 'critic'     && <CriticAvatar speaking={speaking} />}
        {personaId === 'researcher' && <ResearcherAvatar speaking={speaking} />}
        {personaId === 'builder'    && <BuilderAvatar speaking={speaking} />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: { width: SIZE, height: SIZE, alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  bg:      { ...StyleSheet.absoluteFillObject, borderRadius: SIZE / 2, backgroundColor: '#03050e' },
  canvas:  { width: SIZE, height: SIZE },
  abs:     { position: 'absolute', width: SIZE, height: SIZE, top: 0, left: 0 },
  center:  { position: 'absolute', width: SIZE, height: SIZE, top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
