/**
 * KnowledgeGraphCanvas — Interactive Force-Directed Graph (Native Canvas)
 *
 * Uses react-native-svg + gesture handler for a fully native graph:
 *   - Live force simulation with idle breathing
 *   - Drag nodes — graph reacts in real time
 *   - Tap node to focus — smooth dim of unconnected nodes, info panel
 *   - Tap background to reset focus
 *   - Pinch to zoom + pan, double-tap reset
 *   - Node size scales with frequency, edge width with strength
 *   - "Forget this" with confirmation + actual SQLite delete
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Circle, Line, Svg, Text as SvgText } from 'react-native-svg';
import type { KGNode, KGEdge } from '@/services/knowledgeGraph';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const TYPE_COLORS: Record<string, string> = {
  topic:      '#4db8ff',
  preference: '#00ff88',
  project:    '#ffcc00',
  interest:   '#cc99ff',
  insight:    '#ff6688',
  milestone:  '#ff8800',
};
const DEFAULT_COLOR = '#5a8a9a';
const CANVAS_MULT = 1; // 1x — backgrounds match so zoom-out looks seamless

// ── Layout types ─────────────────────────────────────────────

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  label: string;
  type: string;
  frequency: number;
  confirmed: boolean;
  description: string;
}

interface LayoutEdge {
  from: string;
  to: string;
  strength: number;
}

interface Props {
  nodes: KGNode[];
  edges: KGEdge[];
  width: number;
  height: number;
  onDeleteNode?: (nodeId: string) => void;
}

interface FocusedNodeInfo {
  id: string;
  label: string;
  type: string;
  frequency: number;
  confirmed: boolean;
  description: string;
  connectedLabels: string[];
}

// ── Component ────────────────────────────────────────────────

export default function KnowledgeGraphCanvas({ nodes, edges, width, height, onDeleteNode }: Props) {
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [layoutEdges, setLayoutEdges] = useState<LayoutEdge[]>([]);
  const [focusedNode, setFocusedNode] = useState<FocusedNodeInfo | null>(null);
  const [tick, setTick] = useState(0);

  const nodesRef = useRef<LayoutNode[]>([]);
  const edgesRef = useRef<LayoutEdge[]>([]);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const alphaRef = useRef(1.0);
  const dragNodeRef = useRef<string | null>(null);
  const focusIdRef = useRef<string | null>(null);
  const animFrameRef = useRef<number>(0);
  const containerRef = useRef<View>(null);
  const containerOffsetRef = useRef({ x: 0, y: 0 });

  // ── Gesture state ─────────────────────────────────────────
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const canvasW = width * CANVAS_MULT;
  const canvasH = height * CANVAS_MULT;
  // Initial translate to center the 3x canvas in the viewport
  const initTx = -width * (CANVAS_MULT - 1) / 2;
  const initTy = -height * (CANVAS_MULT - 1) / 2;

  // ── Initialize layout ─────────────────────────────────────
  useEffect(() => {
    if (nodes.length === 0) return;

    // Center graph in the large canvas
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const maxFreq = Math.max(1, ...nodes.map(n => n.frequency ?? 1));

    const lNodes: LayoutNode[] = nodes.map((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 * 3;
      const dist = 30 + (i / nodes.length) * Math.min(width, height) * 0.35;
      const freq = n.frequency ?? 1;
      return {
        id: n.id,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        r: 6 + (freq / maxFreq) * 18,
        color: TYPE_COLORS[n.type] ?? DEFAULT_COLOR,
        label: n.label,
        type: n.type,
        frequency: freq,
        confirmed: n.confirmed === 1,
        description: n.description ?? '',
      };
    });

    const nodeIndex = new Map<string, number>();
    lNodes.forEach((n, i) => nodeIndex.set(n.id, i));

    const lEdges: LayoutEdge[] = edges
      .filter(e => nodeIndex.has(e.fromId) && nodeIndex.has(e.toId))
      .map(e => ({ from: e.fromId, to: e.toId, strength: e.strength ?? 0.5 }));

    // Build adjacency
    const adj = new Map<string, Set<string>>();
    lNodes.forEach(n => adj.set(n.id, new Set()));
    lEdges.forEach(e => {
      adj.get(e.from)?.add(e.to);
      adj.get(e.to)?.add(e.from);
    });

    nodesRef.current = lNodes;
    edgesRef.current = lEdges;
    adjacencyRef.current = adj;
    alphaRef.current = 1.0;

    // Center the viewport on the graph
    translateX.value = initTx;
    translateY.value = initTy;
    savedTranslateX.value = initTx;
    savedTranslateY.value = initTy;
    scale.value = 1;
    savedScale.value = 1;

    setLayoutNodes([...lNodes]);
    setLayoutEdges(lEdges);
  }, [nodes, edges, width, height]);

  // ── Physics loop (stops when settled, restarts on interaction) ──
  const simulatingRef = useRef(false);

  const startSimulation = useCallback(() => {
    if (simulatingRef.current) return;
    simulatingRef.current = true;

    const REPULSION = 2500;
    const ATTRACTION = 0.006;
    const GRAVITY = 0.001;
    const DAMPING = 0.88;
    const ALPHA_DECAY = 0.004;
    const ALPHA_MIN = 0.002;
    const cx = width * CANVAS_MULT / 2;
    const cy = height * CANVAS_MULT / 2;
    let frameCount = 0;
    let settledFrames = 0;

    function simulate() {
      const ns = nodesRef.current;
      const es = edgesRef.current;
      let alpha = alphaRef.current;

      if (ns.length === 0 || alpha < ALPHA_MIN) {
        // Stop loop when fully settled
        settledFrames++;
        if (settledFrames > 30) {
          simulatingRef.current = false;
          // One final render
          setLayoutNodes([...ns]);
          return;
        }
      } else {
        settledFrames = 0;
      }

      if (alpha >= ALPHA_MIN) {
        // Repulsion
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const dist2 = dx * dx + dy * dy + 1;
            const force = REPULSION * alpha / dist2;
            const dist = Math.sqrt(dist2);
            const fx = (dx / dist) * force, fy = (dy / dist) * force;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
          }
        }

        // Attraction
        const nodeMap = new Map<string, LayoutNode>();
        ns.forEach(n => nodeMap.set(n.id, n));
        for (const e of es) {
          const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const force = dist * ATTRACTION * e.strength * alpha;
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }

        // Gentle gravity toward canvas center
        for (const n of ns) {
          n.vx += (cx - n.x) * GRAVITY * alpha;
          n.vy += (cy - n.y) * GRAVITY * alpha;
        }

        // Integrate — no bounds clamping
        for (const n of ns) {
          n.vx *= DAMPING;
          n.vy *= DAMPING;
          n.x += n.vx;
          n.y += n.vy;
        }

        alpha = Math.max(ALPHA_MIN, alpha - ALPHA_DECAY);
      }

      alphaRef.current = alpha;

      // Render every 5th frame (~12fps visual updates)
      frameCount++;
      if (frameCount % 5 === 0) {
        setLayoutNodes([...ns]);
        setTick(t => t + 1);
      }

      animFrameRef.current = requestAnimationFrame(simulate);
    }

    animFrameRef.current = requestAnimationFrame(simulate);
  }, [width, height]);

  // Kick off simulation when layout changes
  useEffect(() => {
    if (nodesRef.current.length > 0) {
      simulatingRef.current = false; // reset so startSimulation works
      startSimulation();
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [startSimulation]);

  // ── Node position lookup ──────────────────────────────────
  const nodePos = useMemo(() => {
    const map = new Map<string, LayoutNode>();
    layoutNodes.forEach(n => map.set(n.id, n));
    return map;
  }, [layoutNodes, tick]);

  // ── Focus helpers ─────────────────────────────────────────
  const isConnected = useCallback((nodeId: string) => {
    if (!focusIdRef.current) return true;
    if (nodeId === focusIdRef.current) return true;
    return adjacencyRef.current.get(focusIdRef.current)?.has(nodeId) ?? false;
  }, []);

  const isEdgeHighlighted = useCallback((from: string, to: string) => {
    if (!focusIdRef.current) return false;
    return from === focusIdRef.current || to === focusIdRef.current;
  }, []);

  const handleNodeTap = useCallback((node: LayoutNode) => {
    if (focusIdRef.current === node.id) {
      // Unfocus
      focusIdRef.current = null;
      setFocusedNode(null);
    } else {
      // Focus
      focusIdRef.current = node.id;
      const connected = [...(adjacencyRef.current.get(node.id) ?? [])];
      const connectedLabels = connected
        .map(id => nodesRef.current.find(n => n.id === id)?.label)
        .filter(Boolean) as string[];
      setFocusedNode({
        id: node.id,
        label: node.label,
        type: node.type,
        frequency: node.frequency,
        confirmed: node.confirmed,
        description: node.description,
        connectedLabels,
      });
    }
    alphaRef.current = Math.max(alphaRef.current, 0.3);
    startSimulation(); // Wake up physics
  }, [startSimulation]);

  // ── Measure container offset for tap coordinate mapping ──
  const measureContainer = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      containerOffsetRef.current = { x: x ?? 0, y: y ?? 0 };
    });
  }, []);

  // ── Tap hit-test (runs on JS thread) ─────────────────────
  const handleTapAtPosition = useCallback((canvasX: number, canvasY: number) => {
    const ns = nodesRef.current;
    let closest: LayoutNode | null = null;
    let closestDist = Infinity;
    for (const n of ns) {
      const dx = n.x - canvasX;
      const dy = n.y - canvasY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < n.r + 20 && dist < closestDist) {
        closest = n;
        closestDist = dist;
      }
    }
    if (closest) {
      handleNodeTap(closest);
    } else if (focusIdRef.current) {
      focusIdRef.current = null;
      setFocusedNode(null);
      alphaRef.current = Math.max(alphaRef.current, 0.3);
      startSimulation();
    }
  }, [handleNodeTap, startSimulation]);

  // ── Gestures ──────────────────────────────────────────────
  const pinchGesture = Gesture.Pinch()
    .onStart(() => { savedScale.value = scale.value; })
    .onUpdate(e => {
      scale.value = Math.min(6, Math.max(0.1, savedScale.value * e.scale));
    });

  const panGesture = Gesture.Pan()
    .minPointers(2)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate(e => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onStart(() => {
      scale.value = withTiming(1, { duration: 300 });
      translateX.value = withTiming(initTx, { duration: 300 });
      translateY.value = withTiming(initTy, { duration: 300 });
    });

  // Single tap — hit-test nodes via canvas coordinates
  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .onStart((e) => {
      // e.x/e.y are relative to the gesture handler view (the Animated.View)
      // Since the Animated.View has transforms, e.x/e.y are in its local coords
      // which already are canvas coordinates
      runOnJS(handleTapAtPosition)(e.x, e.y);
    });

  const composedGesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    Gesture.Exclusive(doubleTapGesture, singleTapGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // ── Forget handler ────────────────────────────────────────
  const handleForget = useCallback(() => {
    if (!focusedNode) return;
    const { id, label } = focusedNode;
    Alert.alert(
      'Forget this?',
      `Remove "${label}" from your knowledge graph? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            onDeleteNode?.(id);
            setFocusedNode(null);
            focusIdRef.current = null;
          },
        },
      ],
    );
  }, [focusedNode, onDeleteNode]);

  // ── Empty state ───────────────────────────────────────────
  if (nodes.length === 0) {
    return (
      <View style={[styles.container, { width, height }]}>
        <Text style={styles.emptyText}>no nodes yet — start chatting to build the graph</Text>
      </View>
    );
  }

  const focusId = focusIdRef.current;
  const connSet = focusId ? adjacencyRef.current.get(focusId) : null;
  const panelHeight = focusedNode ? (focusedNode.description ? 110 : 80) : 0;

  return (
    <View ref={containerRef} onLayout={measureContainer} style={[styles.container, { width, height: height + panelHeight }]}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[{ width: canvasW, height: canvasH }, animatedStyle]}>
          <Svg width={canvasW} height={canvasH}>
            {/* Edges — solid color, no gradients */}
            {layoutEdges.map((e, i) => {
              const from = nodePos.get(e.from);
              const to = nodePos.get(e.to);
              if (!from || !to) return null;
              const highlighted = isEdgeHighlighted(e.from, e.to);
              const dimmed = focusId && !highlighted;
              return (
                <Line
                  key={`e-${i}`}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke={highlighted ? from.color : '#3a4a5a'}
                  strokeWidth={highlighted ? 2 + e.strength * 2 : 1 + e.strength * 1.5}
                  opacity={dimmed ? 0.06 : highlighted ? 0.85 : 0.25}
                  strokeLinecap="round"
                />
              );
            })}

            {/* Node glows — skip when >30 nodes for performance */}
            {layoutNodes.length <= 30 && layoutNodes.map(n => {
              const active = !focusId || n.id === focusId || connSet?.has(n.id);
              return (
                <Circle
                  key={`glow-${n.id}`}
                  cx={n.x} cy={n.y}
                  r={n.r + 6}
                  fill={n.color}
                  opacity={active ? (n.id === focusId ? 0.35 : 0.12) : 0.03}
                />
              );
            })}

            {/* Node cores — bright ring on focus when glows are skipped */}
            {layoutNodes.map(n => {
              const active = !focusId || n.id === focusId || connSet?.has(n.id);
              const isFocused = n.id === focusId;
              const skipGlows = layoutNodes.length > 30;
              return (
                <Circle
                  key={`core-${n.id}`}
                  cx={n.x} cy={n.y}
                  r={n.r}
                  fill="#0a0e18"
                  stroke={n.color}
                  strokeWidth={isFocused && skipGlows ? 3.5 : n.confirmed ? 2.5 : 1.2}
                  opacity={active ? 0.95 : 0.1}
                />
              );
            })}

            {/* Confirmed dots */}
            {layoutNodes.filter(n => n.confirmed).map(n => {
              const active = !focusId || n.id === focusId || connSet?.has(n.id);
              return (
                <Circle
                  key={`conf-${n.id}`}
                  cx={n.x} cy={n.y}
                  r={3}
                  fill={n.color}
                  opacity={active ? 0.8 : 0.08}
                />
              );
            })}

            {/* Labels */}
            {layoutNodes.map(n => {
              const active = !focusId || n.id === focusId || connSet?.has(n.id);
              return (
                <SvgText
                  key={`lbl-${n.id}`}
                  x={n.x} y={n.y + n.r + 12}
                  fill={n.color}
                  fontSize={n.id === focusId ? 10 : 9}
                  fontFamily={FONT}
                  fontWeight={n.id === focusId ? 'bold' : 'normal'}
                  textAnchor="middle"
                  opacity={active ? 0.85 : 0.08}
                >
                  {n.label.length > 16 ? n.label.slice(0, 14) + '..' : n.label}
                </SvgText>
              );
            })}
          </Svg>
        </Animated.View>
      </GestureDetector>

      {/* ── Info panel ─────────────────────────────────────── */}
      {focusedNode && (
        <View style={styles.infoPanel}>
          <View style={styles.infoPanelRow}>
            <View style={styles.infoPanelLeft}>
              <View style={[styles.typeDot, { backgroundColor: TYPE_COLORS[focusedNode.type] ?? DEFAULT_COLOR }]} />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.infoPanelTitle, { color: TYPE_COLORS[focusedNode.type] ?? DEFAULT_COLOR }]}
                  numberOfLines={1}
                >
                  {focusedNode.label}
                </Text>
                <Text style={styles.infoPanelMeta}>
                  {focusedNode.type} · {focusedNode.frequency} conversation{focusedNode.frequency !== 1 ? 's' : ''}
                  {focusedNode.confirmed ? ' · confirmed' : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.forgetBtn} onPress={handleForget}>
              <Text style={styles.forgetBtnText}>forget</Text>
            </TouchableOpacity>
          </View>

          {focusedNode.description ? (
            <Text style={styles.infoPanelDesc} numberOfLines={2}>{focusedNode.description}</Text>
          ) : null}

          {focusedNode.connectedLabels.length > 0 && (
            <View style={styles.connectionsRow}>
              <Text style={styles.connectionsLabel}>linked:</Text>
              {focusedNode.connectedLabels.slice(0, 4).map((label, i) => (
                <View key={i} style={styles.connectionChip}>
                  <Text style={styles.connectionChipText}>{label}</Text>
                </View>
              ))}
              {focusedNode.connectedLabels.length > 4 && (
                <Text style={styles.connectionsMore}>+{focusedNode.connectedLabels.length - 4}</Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── Hint ───────────────────────────────────────────── */}
      {!focusedNode && (
        <View style={styles.zoomHint}>
          <Text style={styles.zoomText}>tap node to focus · pinch zoom · double-tap reset</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#080d14',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a3a',
  },
  emptyText: {
    fontFamily: FONT,
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginTop: 40,
    letterSpacing: 0.5,
  },
  zoomHint: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  zoomText: {
    fontFamily: FONT,
    fontSize: 8,
    color: '#555',
    letterSpacing: 1,
  },
  infoPanel: {
    backgroundColor: '#0a0f18',
    borderTopWidth: 1,
    borderTopColor: '#1a2a3a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  infoPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoPanelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
    marginRight: 10,
  },
  typeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  infoPanelTitle: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  infoPanelMeta: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#888',
    marginTop: 1,
    letterSpacing: 0.3,
  },
  infoPanelDesc: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#aaa',
    lineHeight: 15,
    paddingLeft: 18,
  },
  connectionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingLeft: 18,
  },
  connectionsLabel: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#666',
    letterSpacing: 0.3,
    marginRight: 2,
  },
  connectionChip: {
    borderWidth: 1,
    borderColor: '#1a2a3a',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#0d1220',
  },
  connectionChipText: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#7799bb',
    letterSpacing: 0.2,
  },
  connectionsMore: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#555',
  },
  forgetBtn: {
    borderWidth: 1,
    borderColor: '#331111',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1a0808',
  },
  forgetBtnText: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#ff4444',
    letterSpacing: 0.5,
  },
});
