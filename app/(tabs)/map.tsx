/**
 * map.tsx — PrivateAI Knowledge Graph
 *
 * Visualises all memory patterns across personas as a force-directed
 * network graph rendered with react-native-svg. Nodes = memory topics,
 * edges = shared keywords. Node size = mention frequency.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { loadMemory, mergeExtractedPatterns, MemoryEntry } from '@/services/memory';

const __DEV__ = process.env.NODE_ENV !== 'production';

// ─── Constants ────────────────────────────────────────────────

const FONT        = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const { width: SW, height: SH } = Dimensions.get('window');
const CANVAS_W    = SW  * 2.4;
const CANVAS_H    = SH  * 2.2;
const BASE_R      = 14;
const MAX_R       = 38;

const PERSONA_IDS    = ['pete', 'architect', 'critic', 'researcher', 'builder'];
const PERSONA_COLORS: Record<string, string> = {
  pete:       '#00ff00',
  architect:  '#00ffff',
  critic:     '#ff6600',
  researcher: '#cc99ff',
  builder:    '#ffff00',
};
const PERSONA_LABELS: Record<string, string> = {
  pete:       'Atom',
  architect:  'Architect',
  critic:     'Critic',
  researcher: 'Researcher',
  builder:    'Builder',
};

// ─── Types ────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  topic: string;
  summary: string;
  keywords: string[];
  frequency: number;
  personaId: string;
  exampleQuotes: string[];
  lastSeen: string;
}

interface GraphEdge {
  id: string;
  src: string;
  tgt: string;
  weight: number; // shared keyword count
}

// ─── Helpers ──────────────────────────────────────────────────

function nodeRadius(freq: number): number {
  return Math.min(BASE_R + freq * 2.8, MAX_R);
}

function relDate(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

// ─── Force-directed layout ────────────────────────────────────

function buildLayout(
  entries: MemoryEntry[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (entries.length === 0) return { nodes: [], edges: [] };

  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const spreadR = Math.min(CANVAS_W, CANVAS_H) * 0.32;

  // Seed positions in a rough circle with per-topic deterministic jitter
  // so layout is stable across re-renders when data hasn't changed.
  function seededOffset(seed: string, axis: 'x' | 'y'): number {
    let h = 0;
    const s = seed + axis;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return ((h & 0xffff) / 0xffff - 0.5) * 60; // ±30 px jitter
  }

  const nodes: GraphNode[] = entries.map((e, i) => {
    const angle = (i / entries.length) * Math.PI * 2;
    return {
      id:           `${e.personaId}__${i}__${e.topic}`,
      x:            cx + spreadR * Math.cos(angle) + seededOffset(e.topic, 'x'),
      y:            cy + spreadR * Math.sin(angle) + seededOffset(e.topic, 'y'),
      r:            nodeRadius(e.frequency),
      color:        PERSONA_COLORS[e.personaId] ?? '#888',
      topic:        e.topic,
      summary:      e.summary,
      keywords:     e.keywords,
      frequency:    e.frequency,
      personaId:    e.personaId,
      exampleQuotes: e.exampleQuotes,
      lastSeen:     e.lastSeen,
    };
  });

  // Edges: nodes sharing at least one keyword
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const aKw = new Set(nodes[i].keywords.map(k => k.toLowerCase()));
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[j].keywords.filter(k => aKw.has(k.toLowerCase())).length;
      if (shared > 0) {
        edges.push({
          id:     `${nodes[i].id}__${nodes[j].id}`,
          src:    nodes[i].id,
          tgt:    nodes[j].id,
          weight: shared,
        });
      }
    }
  }

  // O(1) index lookup for force loop
  const idx = new Map<string, number>();
  nodes.forEach((n, i) => idx.set(n.id, i));

  // ── Velocity arrays ──
  const vx = new Float64Array(nodes.length);
  const vy = new Float64Array(nodes.length);

  const ITER        = 140;
  const REPULSION   = 9000;
  const IDEAL_DIST  = 150;
  const K_SPRING    = 0.018;
  const K_GRAVITY   = 0.0018;
  const DAMPING     = 0.86;
  const PAD         = 60;

  for (let iter = 0; iter < ITER; iter++) {
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);

    // Node–node repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx  = nodes[j].x - nodes[i].x;
        const dy  = nodes[j].y - nodes[i].y;
        const d2  = dx * dx + dy * dy;
        const d   = Math.sqrt(d2) || 0.01;
        const f   = REPULSION / d2;
        const ux  = dx / d;
        const uy  = dy / d;
        fx[i] -= ux * f;
        fy[i] -= uy * f;
        fx[j] += ux * f;
        fy[j] += uy * f;
      }
    }

    // Edge spring attraction
    for (const e of edges) {
      const i = idx.get(e.src) ?? -1;
      const j = idx.get(e.tgt) ?? -1;
      if (i < 0 || j < 0) continue;
      const dx  = nodes[j].x - nodes[i].x;
      const dy  = nodes[j].y - nodes[i].y;
      const d   = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f   = K_SPRING * (d - IDEAL_DIST);
      const ux  = dx / d;
      const uy  = dy / d;
      fx[i] += ux * f;
      fy[i] += uy * f;
      fx[j] -= ux * f;
      fy[j] -= uy * f;
    }

    // Weak gravity toward center
    for (let i = 0; i < nodes.length; i++) {
      fx[i] += (cx - nodes[i].x) * K_GRAVITY;
      fy[i] += (cy - nodes[i].y) * K_GRAVITY;
    }

    // Integrate with damping + boundary clamp
    for (let i = 0; i < nodes.length; i++) {
      vx[i] = (vx[i] + fx[i]) * DAMPING;
      vy[i] = (vy[i] + fy[i]) * DAMPING;
      nodes[i].x = Math.max(nodes[i].r + PAD,
        Math.min(CANVAS_W - nodes[i].r - PAD, nodes[i].x + vx[i]));
      nodes[i].y = Math.max(nodes[i].r + PAD,
        Math.min(CANVAS_H - nodes[i].r - PAD, nodes[i].y + vy[i]));
    }
  }

  return { nodes, edges };
}

// ─── Screen ───────────────────────────────────────────────────

export default function MapScreen() {
  const [allEntries, setAllEntries] = useState<MemoryEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<GraphNode | null>(null);

  const loadAll = async () => {
    setLoading(true);
    const all: MemoryEntry[] = [];
    for (const pid of PERSONA_IDS) {
      const entries = await loadMemory(pid);
      all.push(...entries);
    }
    setAllEntries(all);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadAll(); }, []));

  const seedTestData = async () => {
    const seeds: { personaId: string; topic: string; summary: string; keywords: string[]; quote: string }[] = [
      { personaId: 'pete', topic: 'PrivateAI architecture',     summary: 'Pete is building a privacy-first multi-persona AI OS for iPhone and Vision Pro.',       keywords: ['react native', 'expo', 'architecture', 'privacy'],  quote: 'how should I structure the persona handoff system?' },
      { personaId: 'pete', topic: 'on-device AI',               summary: 'Strong interest in running LLMs locally to keep data off the cloud.',                    keywords: ['llama', 'local AI', 'on-device', 'privacy'],        quote: 'what models can run on iPhone 15 Pro?' },
      { personaId: 'pete', topic: 'memory systems',             summary: 'Wants long-term AI memory that builds context over time across sessions.',               keywords: ['memory', 'context', 'long-term', 'patterns'],       quote: 'the AI should remember what I keep coming back to' },
      { personaId: 'architect', topic: 'system design',         summary: 'Recurring focus on scalable system design and tradeoff analysis.',                       keywords: ['architecture', 'tradeoffs', 'scalability', 'design'], quote: 'what are the tradeoffs between local and cloud inference?' },
      { personaId: 'architect', topic: 'data privacy',          summary: 'Data privacy and zero-trust architecture as a first-class design constraint.',          keywords: ['privacy', 'security', 'on-device', 'zero-trust'],   quote: 'all sensitive data should stay on device' },
      { personaId: 'critic', topic: 'product risks',            summary: 'Identifies gaps in user experience and launch readiness for PrivateAI.',                keywords: ['risk', 'ux', 'product', 'launch'],                  quote: 'what are the biggest risks before shipping?' },
      { personaId: 'researcher', topic: 'LLM benchmarks',       summary: 'Investigating which small models balance quality vs. speed on mobile hardware.',        keywords: ['llama', 'benchmarks', 'quantization', 'mobile'],    quote: 'which 3B model performs best on iPhone?' },
      { personaId: 'builder', topic: 'React Native performance', summary: 'Optimising render performance and bundle size in a large Expo project.',               keywords: ['react native', 'performance', 'expo', 'bundle'],    quote: 'how do I reduce re-renders in the message list?' },
    ];

    for (const seed of seeds) {
      const patterns = Array.from({ length: seed.topic === 'PrivateAI architecture' || seed.topic === 'memory systems' ? 3 : seed.topic === 'on-device AI' || seed.topic === 'system design' ? 2 : 1 }, () => ({
        topic: seed.topic,
        summary: seed.summary,
        keywords: seed.keywords,
      }));
      for (let i = 0; i < patterns.length; i++) {
        await mergeExtractedPatterns(seed.personaId, [patterns[i]], seed.quote);
      }
    }
    await loadAll();
  };

  const { nodes, edges } = useMemo(() => buildLayout(allEntries), [allEntries]);

  // O(1) node lookup for edge rendering
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const legendPersonas = PERSONA_IDS.filter(pid =>
    allEntries.some(e => e.personaId === pid),
  );

  return (
    <View style={s.root}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={16} color="#444" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>// knowledge map</Text>
        {__DEV__ && (
          <TouchableOpacity onPress={seedTestData} style={s.seedBtn}>
            <Text style={s.seedBtnText}>[seed]</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={loadAll} style={s.refreshBtn}>
          <Ionicons name="refresh" size={14} color="#444" />
        </TouchableOpacity>
      </View>

      {/* ── Legend ── */}
      {legendPersonas.length > 0 && (
        <View style={s.legend}>
          {legendPersonas.map(pid => (
            <View key={pid} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: PERSONA_COLORS[pid] }]} />
              <Text style={[s.legendLabel, { color: PERSONA_COLORS[pid] }]}>
                {PERSONA_LABELS[pid]}
              </Text>
            </View>
          ))}
          <Text style={s.legendHint}>tap a node to explore</Text>
        </View>
      )}

      {/* ── Graph canvas ── */}
      {loading ? (
        <View style={s.center}>
          <Text style={s.dimText}>loading memory...</Text>
        </View>
      ) : nodes.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyPrompt}>{'>'}</Text>
          <Text style={s.emptyTitle}>// no patterns detected yet</Text>
          <Text style={s.emptyBody}>
            {'have more conversations and your\nknowledge map will grow here'}
          </Text>
          <Text style={s.emptyHint}>
            {'each topic you revisit becomes a node\nshared keywords draw connections between them'}
          </Text>
          {__DEV__ && (
            <TouchableOpacity style={s.emptySeeedBtn} onPress={seedTestData}>
              <Text style={s.emptySeedText}>[seed test data]</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* 2-axis pan: horizontal outer, vertical inner */
        <ScrollView
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}>
          <ScrollView
            bounces={false}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ width: CANVAS_W, height: CANVAS_H }}>
            <Svg width={CANVAS_W} height={CANVAS_H}>

              {/* Edges */}
              {edges.map((e, ei) => {
                const src = nodeById.get(e.src);
                const tgt = nodeById.get(e.tgt);
                if (!src || !tgt) return null;
                const dimmed = selected !== null
                  && selected.id !== src.id
                  && selected.id !== tgt.id;
                return (
                  <Line
                    key={`edge-${ei}`}
                    x1={src.x} y1={src.y}
                    x2={tgt.x} y2={tgt.y}
                    stroke="#1e3020"
                    strokeWidth={Math.min(e.weight * 0.7 + 0.5, 2.5)}
                    strokeOpacity={dimmed ? 0.12 : 0.55}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map((n, ni) => {
                const dimmed  = selected !== null && selected.id !== n.id;
                const isSel   = selected?.id === n.id;
                const label   = n.topic.length > 18
                  ? n.topic.slice(0, 17) + '…'
                  : n.topic;

                return (
                  <G key={`node-${ni}-${n.topic}`} onPress={() => setSelected(isSel ? null : n)}>
                    {/* Selection ring */}
                    {isSel && (
                      <Circle
                        cx={n.x} cy={n.y}
                        r={n.r + 6}
                        fill="none"
                        stroke={n.color}
                        strokeWidth={1.5}
                        strokeOpacity={0.45}
                      />
                    )}
                    {/* Main circle */}
                    <Circle
                      cx={n.x} cy={n.y}
                      r={n.r}
                      fill={n.color}
                      fillOpacity={dimmed ? 0.18 : 0.82}
                    />
                    {/* Frequency count inside node */}
                    <SvgText
                      x={n.x} y={n.y + 4}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily={FONT}
                      fontWeight="bold"
                      fill="#000"
                      fillOpacity={dimmed ? 0.2 : 0.65}
                    >
                      {n.frequency}
                    </SvgText>
                    {/* Topic label below circle */}
                    <SvgText
                      x={n.x} y={n.y + n.r + 13}
                      textAnchor="middle"
                      fontSize={8}
                      fontFamily={FONT}
                      fill={n.color}
                      fillOpacity={dimmed ? 0.2 : 0.7}
                    >
                      {label}
                    </SvgText>
                  </G>
                );
              })}

            </Svg>
          </ScrollView>
        </ScrollView>
      )}

      {/* ── Node detail panel ── */}
      {selected && (
        <View style={s.detail}>
          <View style={s.detailHeader}>
            <View style={[s.detailDot, { backgroundColor: selected.color }]} />
            <Text
              style={[s.detailTopic, { color: selected.color }]}
              numberOfLines={1}>
              {selected.topic}
            </Text>
            <TouchableOpacity onPress={() => setSelected(null)} style={s.closeBtn}>
              <Text style={s.closeBtnText}>[x]</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.detailMeta}>
            {PERSONA_LABELS[selected.personaId] ?? selected.personaId}
            {' · '}mentioned {selected.frequency}×
            {' · '}last seen {relDate(selected.lastSeen)}
          </Text>

          <Text style={s.detailSummary}>{selected.summary}</Text>

          {selected.keywords.length > 0 && (
            <Text style={s.detailKeywords}>
              {selected.keywords.slice(0, 7).join(' · ')}
            </Text>
          )}

          {selected.exampleQuotes.length > 0 && (
            <ScrollView style={s.quotesScroll} nestedScrollEnabled>
              {selected.exampleQuotes.map((q, i) => (
                <Text key={`quote-${i}`} style={s.detailQuote}>"{q}"</Text>
              ))}
            </ScrollView>
          )}
        </View>
      )}

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#070707' },

  header:       { flexDirection: 'row', alignItems: 'center',
                  paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
                  borderBottomWidth: 1, borderBottomColor: '#111' },
  backBtn:      { paddingRight: 14, paddingVertical: 4 },
  headerTitle:  { fontFamily: FONT, fontSize: 13, color: '#00ff00',
                  letterSpacing: 1, flex: 1 },
  refreshBtn:   { paddingLeft: 10, paddingVertical: 4 },
  seedBtn:      { paddingHorizontal: 8, paddingVertical: 4 },
  seedBtnText:  { fontFamily: FONT, fontSize: 10, color: '#2a4a2a', letterSpacing: 1 },

  legend:       { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
                  gap: 12, paddingHorizontal: 16, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: '#111' },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:    { width: 7, height: 7, borderRadius: 4 },
  legendLabel:  { fontFamily: FONT, fontSize: 9, letterSpacing: 1 },
  legendHint:   { fontFamily: FONT, fontSize: 8, color: '#222',
                  letterSpacing: 1, marginLeft: 'auto' },

  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  dimText:        { fontFamily: FONT, fontSize: 12, color: '#333' },
  emptyPrompt:    { fontFamily: FONT, fontSize: 20, color: '#00ff00', opacity: 0.4 },
  emptyTitle:     { fontFamily: FONT, fontSize: 13, color: '#00ff00', letterSpacing: 1 },
  emptyBody:      { fontFamily: FONT, fontSize: 11, color: '#2a2a2a',
                    textAlign: 'center', lineHeight: 18, marginTop: 4 },
  emptyHint:      { fontFamily: FONT, fontSize: 9, color: '#1e1e1e',
                    textAlign: 'center', lineHeight: 15, letterSpacing: 0.5, marginTop: 8 },
  emptySeeedBtn:  { marginTop: 20, paddingVertical: 8, paddingHorizontal: 16,
                    borderWidth: 1, borderColor: '#1a3a1a', borderRadius: 4 },
  emptySeedText:  { fontFamily: FONT, fontSize: 11, color: '#2a6a2a', letterSpacing: 1 },

  // Node detail panel
  detail:       { position: 'absolute', bottom: 0, left: 0, right: 0,
                  backgroundColor: '#0c0c0c',
                  borderTopWidth: 1, borderTopColor: '#1a1a1a',
                  paddingHorizontal: 18, paddingTop: 16, paddingBottom: 30,
                  maxHeight: '45%' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 5 },
  detailDot:    { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  detailTopic:  { fontFamily: FONT, fontSize: 15, fontWeight: '600', flex: 1 },
  closeBtn:     { paddingLeft: 8 },
  closeBtnText: { fontFamily: FONT, fontSize: 12, color: '#333' },
  detailMeta:   { fontFamily: FONT, fontSize: 9, color: '#3a3a3a',
                  letterSpacing: 1, marginBottom: 9 },
  detailSummary:{ fontFamily: FONT, fontSize: 12, color: '#666',
                  lineHeight: 18, marginBottom: 9 },
  detailKeywords:{ fontFamily: FONT, fontSize: 9, color: '#2a2a2a',
                   letterSpacing: 1, marginBottom: 10 },
  quotesScroll: { maxHeight: 80 },
  detailQuote:  { fontFamily: FONT, fontSize: 10, color: '#444',
                  fontStyle: 'italic', lineHeight: 16, marginBottom: 4 },
});
