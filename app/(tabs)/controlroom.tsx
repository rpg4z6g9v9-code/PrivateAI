/**
 * controlroom.tsx — PrivateAI Control Room
 *
 * Live visualization of the AI team operating:
 *   - 5 persona nodes in network layout with glow + pulse
 *   - Connector lines + animated dot traveling when active
 *   - Security status row
 *   - Memory/context insight panel
 *   - Scrollable thinking timeline
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Circle, Line, Svg } from 'react-native-svg';
import { controlRoomEvents, type ControlRoomEvent } from '@/services/controlRoom';
import { getSecurityStatus } from '@/services/securityGateway';
import { canAccessVault, lockVault, unlockVault } from '@/services/dataVault';
import { getLastCompressionMetrics } from '@/services/contextCompressor';
import {
  getGraphSummary, getGraphVisualizationData, deleteNode,
  type GraphSummary, type KGNode, type KGEdge,
} from '@/services/knowledgeGraph';
import KnowledgeGraphCanvas from '@/components/KnowledgeGraphCanvas';
import {
  runBenchmark, runSingleBatch, formatBenchmarkReport,
  type BenchmarkResult,
} from '@/services/benchmarkRunner';
import {
  pickAndStoreFiles, listFiles, deleteFile,
  type StoredFile,
} from '@/services/filesService';
import {
  listEntries, getFiles, removeFile, storeFile,
  type KnowledgeEntry, type FileMetadata,
} from '@/services/knowledgeBase';
import {
  getAllSummaries, updateSummary, deleteSummary, scrubSummaries,
  type ConversationSummary,
} from '@/services/conversationSummarizer';
import { getStorageMetrics, type CloudStorageMetrics } from '@/services/cloudSync';
import { generateMonthlyDigest, getLatestDigest, scrubDigests, type MonthlyDigest } from '@/services/agents/monthlyDigestAgent';
import { analyzePatterns, type PatternReport } from '@/services/agents/patternAnalysisAgent';

function formatCloudBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const { width: W, height: H } = Dimensions.get('window');

// ── Persona definitions ───────────────────────────────────────

// Colors must match PERSONAS array in index.tsx exactly
const NODES = [
  { id: 'pete', label: 'Atom', color: '#00ff00', role: 'orchestrator' },
] as const;

type NodeId = typeof NODES[number]['id'];

const CX = W / 2;
const CY = H * 0.38;

const NODE_POSITIONS: Record<NodeId, { x: number; y: number }> = {
  pete: { x: CX, y: CY },
};

// ── Sacred Geometry (same as index.tsx) ───────────────────────

const PAD = 120;

function SacredGeometryBg() {
  const rotA = useRef(new Animated.Value(0)).current;
  const rotB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.timing(rotA, { toValue: 1, duration: 60_000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.timing(rotB, { toValue: -1, duration: 90_000, easing: Easing.linear, useNativeDriver: true })).start();
  }, []);

  const spinA = rotA.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const spinB = rotB.interpolate({ inputRange: [-1, 0], outputRange: ['-360deg', '0deg'] });

  const cw = W + PAD * 2;
  const ch = H + PAD * 2;
  const vb = `-${PAD} -${PAD} ${cw} ${ch}`;
  const layerStyle = { position: 'absolute' as const, top: -PAD, left: -PAD, width: cw, height: ch };

  const R = Math.min(W, H) * 0.28;
  const cx = W / 2, cy = H / 2;

  const innerCircles = [
    { cx, cy },
    ...Array.from({ length: 6 }, (_, i) => ({
      cx: cx + R * Math.cos((i * Math.PI) / 3),
      cy: cy + R * Math.sin((i * Math.PI) / 3),
    })),
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[layerStyle, { opacity: 0.10, transform: [{ rotate: spinA }] }]}>
        <Svg width={cw} height={ch} viewBox={vb}>
          {innerCircles.map((c, i) => (
            <Circle key={i} cx={c.cx} cy={c.cy} r={R} stroke="#4db8a4" strokeWidth={1.0} fill="none" />
          ))}
        </Svg>
      </Animated.View>
      <Animated.View style={[layerStyle, { opacity: 0.06, transform: [{ rotate: spinB }] }]}>
        <Svg width={cw} height={ch} viewBox={vb}>
          {innerCircles.map((c, i) => (
            <Circle key={i} cx={c.cx} cy={c.cy} r={R * 1.73} stroke="#c9a84c" strokeWidth={1.0} fill="none" />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

// ── Persona Node ──────────────────────────────────────────────

type NodeStatus = 'idle' | 'thinking' | 'complete';

function PersonaNode({
  node, status, x, y,
}: {
  node: typeof NODES[number];
  status: NodeStatus;
  x: number; y: number;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const glowOpacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (status === 'thinking') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowOpacity, { toValue: 0.9, duration: 600, useNativeDriver: true }),
          Animated.timing(glowOpacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.stopAnimation();
      glowOpacity.stopAnimation();
      Animated.timing(pulse, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      Animated.timing(glowOpacity, { toValue: status === 'complete' ? 0.6 : 0.3, duration: 300, useNativeDriver: true }).start();
    }
  }, [status]);

  const NODE_R = node.id === 'pete' ? 36 : 30;

  const statusColor: Record<NodeStatus, string> = {
    idle: '#2a2a3a',
    thinking: node.color,
    complete: node.color + '88',
  };
  const statusLabel: Record<NodeStatus, string> = {
    idle: 'idle',
    thinking: 'thinking...',
    complete: 'done',
  };

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - NODE_R - 36,
        top: y - NODE_R - 28,
        width: (NODE_R + 36) * 2,
        alignItems: 'center',
        transform: [{ scale: pulse }],
      }}>
      {/* Glow ring */}
      <Animated.View style={{
        position: 'absolute',
        top: 6, left: 40,
        width: NODE_R * 2,
        height: NODE_R * 2,
        borderRadius: NODE_R,
        backgroundColor: node.color,
        opacity: glowOpacity,
        shadowColor: node.color,
        shadowOpacity: 1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 0 },
      }} />
      {/* Node circle */}
      <View style={{
        width: NODE_R * 2,
        height: NODE_R * 2,
        borderRadius: NODE_R,
        backgroundColor: '#0d0d1a',
        borderWidth: node.id === 'pete' ? 2.5 : 1.5,
        borderColor: node.color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Text style={{ fontFamily: FONT, fontSize: node.id === 'pete' ? 10 : 7, color: node.color, letterSpacing: 0.3 }} numberOfLines={1}>
          {node.label.toUpperCase()}
        </Text>
      </View>
      {/* Status label */}
      <Text style={{
        fontFamily: FONT, fontSize: 9, color: statusColor[status],
        marginTop: 5, letterSpacing: 1,
      }}>
        {statusLabel[status]}
      </Text>
      <Text style={{ fontFamily: FONT, fontSize: 8, color: '#2a2a3a', letterSpacing: 0.5, marginTop: 1 }}>
        {node.role}
      </Text>
    </Animated.View>
  );
}

// ── Traveling dot along a connector line ─────────────────────

function TravelingDot({
  fromX, fromY, toX, toY, active, color,
}: {
  fromX: number; fromY: number; toX: number; toY: number;
  active: boolean; color: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      progress.setValue(0);
      Animated.loop(
        Animated.timing(progress, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: false })
      ).start();
    } else {
      progress.stopAnimation();
      progress.setValue(0);
    }
  }, [active]);

  const dotX = progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, toX] });
  const dotY = progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, toY] });

  if (!active) return null;

  return (
    <Animated.View style={{
      position: 'absolute',
      width: 7, height: 7, borderRadius: 3.5,
      backgroundColor: color,
      shadowColor: color, shadowOpacity: 1, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
      transform: [{ translateX: Animated.subtract(dotX, 3.5) as any }, { translateY: Animated.subtract(dotY, 3.5) as any }],
    }} />
  );
}

// ── Timeline step ─────────────────────────────────────────────

interface TimelineStep {
  id: string;
  label: string;
  personaId?: string;
  ts: number;
}

// ── Main screen ───────────────────────────────────────────────

export default function ControlRoomScreen() {
  const [statuses, setStatuses] = useState<Record<NodeId, NodeStatus>>({
    pete: 'idle',
  });
  const [activeLines, setActiveLines] = useState<Set<NodeId>>(new Set());
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(canAccessVault());
  const [kgStats, setKgStats] = useState<GraphSummary>({ nodeCount: 0, topicCount: 0, preferenceCount: 0, milestoneCount: 0, confirmedCount: 0 });
  const [kgNodes, setKgNodes] = useState<KGNode[]>([]);
  const [kgEdges, setKgEdges] = useState<KGEdge[]>([]);
  const [kgExpanded, setKgExpanded] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState('');
  const [benchmarkReport, setBenchmarkReport] = useState('');
  // Files section
  const [crFiles, setCrFiles] = useState<StoredFile[]>([]);
  const [crKbEntries, setCrKbEntries] = useState<KnowledgeEntry[]>([]);
  const [crKbFiles, setCrKbFiles] = useState<FileMetadata[]>([]);
  const [crFilePicking, setCrFilePicking] = useState(false);
  const [crFileError, setCrFileError] = useState('');
  // Summaries section
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [summariesExpanded, setSummariesExpanded] = useState(false);
  const [cloudMetrics, setCloudMetrics] = useState<CloudStorageMetrics | null>(null);
  const [digest, setDigest] = useState<MonthlyDigest | null>(null);
  const [patterns, setPatterns] = useState<PatternReport | null>(null);
  const [intelligenceExpanded, setIntelligenceExpanded] = useState(false);
  const secStatus = getSecurityStatus();

  const addStep = useCallback((label: string, personaId?: string) => {
    setTimeline(prev => [
      ...prev,
      { id: `${Date.now()}_${Math.random()}`, label, personaId, ts: Date.now() },
    ]);
    // Timeline is in the main ScrollView — auto-scrolls with content
  }, []);

  // Apply a single event to local state (used by both hydration and live handler)
  const applyEvent = useCallback((event: ControlRoomEvent) => {
    const pid = event.personaId as NodeId | undefined;

    if (event.name === 'persona_start' && pid) {
      setStatuses(prev => ({ ...prev, [pid]: 'thinking' }));
      if (pid !== 'pete') setActiveLines(prev => new Set([...prev, pid]));
    }

    if (event.name === 'persona_complete' && pid) {
      setStatuses(prev => ({ ...prev, [pid]: 'complete' }));
      setActiveLines(prev => { const s = new Set(prev); s.delete(pid); return s; });
      setTimeout(() => setStatuses(prev => {
        if (prev[pid] === 'complete') return { ...prev, [pid]: 'idle' };
        return prev;
      }), 3000);
    }

    if (event.name === 'search_start') setSearchActive(true);
    if (event.name === 'search_complete') setSearchActive(false);
  }, []);

  useEffect(() => {
    console.log('[ControlRoom] screen mounted, subscribing to events');

    // ── Hydrate from buffer (events fired before this screen mounted) ──
    const snapshot = controlRoomEvents.getCurrentStatuses();
    const knownIds = NODES.map(n => n.id);
    const hydratedStatuses: Record<NodeId, NodeStatus> = {
      pete: 'idle',
    };
    for (const id of knownIds) {
      if (snapshot[id]) hydratedStatuses[id as NodeId] = snapshot[id] as NodeStatus;
    }
    setStatuses(hydratedStatuses);
    setSearchActive(controlRoomEvents.isSearchActive());

    // Replay recent events into the timeline
    const recent = controlRoomEvents.getRecentEvents(50);
    const hydratedTimeline: TimelineStep[] = [];
    for (let i = 0; i < recent.length; i++) {
      const event = recent[i];
      const pid = event.personaId as NodeId | undefined;
      const key = `h_${i}_${event.ts}`;
      if (event.name === 'persona_start' && pid) {
        hydratedTimeline.push({ id: key, label: `${NODES.find(n => n.id === pid)?.label ?? pid} started`, personaId: pid, ts: event.ts });
      }
      if (event.name === 'persona_complete' && pid) {
        hydratedTimeline.push({ id: key, label: `${NODES.find(n => n.id === pid)?.label ?? pid} complete`, personaId: pid, ts: event.ts });
      }
      if (event.name === 'step_added' && event.step) {
        hydratedTimeline.push({ id: key, label: event.step, personaId: pid, ts: event.ts });
      }
      if (event.name === 'search_start') {
        hydratedTimeline.push({ id: key, label: 'web search started', ts: event.ts });
      }
      if (event.name === 'search_complete') {
        hydratedTimeline.push({ id: key, label: event.success ? 'web search complete' : 'web search failed', ts: event.ts });
      }
    }
    if (hydratedTimeline.length > 0) {
      setTimeline(hydratedTimeline);
      // Timeline is in the main ScrollView
    }

    // ── Subscribe to live events ──────────────────────────────
    const handler = (event: ControlRoomEvent) => {
      const pid = event.personaId as NodeId | undefined;
      applyEvent(event);

      // Timeline entries for live events
      if (event.name === 'persona_start' && pid) {
        addStep(`${NODES.find(n => n.id === pid)?.label ?? pid} started`, pid);
      }
      if (event.name === 'persona_complete' && pid) {
        addStep(`${NODES.find(n => n.id === pid)?.label ?? pid} complete`, pid);
      }
      if (event.name === 'step_added' && event.step) {
        addStep(event.step, pid);
      }
      if (event.name === 'search_start') addStep('web search started');
      if (event.name === 'search_complete') {
        addStep(event.success ? 'web search complete' : 'web search failed');
      }

      // Refresh KG stats + graph data after any AI activity
      if (event.name === 'persona_complete') {
        getGraphSummary().then(setKgStats);
        getGraphVisualizationData().then(d => { setKgNodes(d.nodes); setKgEdges(d.edges); });
        getAllSummaries().then(setSummaries);
      }
    };

    // Initial KG stats + graph data load
    getGraphSummary().then(setKgStats);
    getGraphVisualizationData().then(d => { setKgNodes(d.nodes); setKgEdges(d.edges); });

    // Load files for the files section
    listFiles().then(setCrFiles);
    listEntries('pete').then(setCrKbEntries);
    getFiles().then(setCrKbFiles);
    
    // Scrub sensitive data, then load summaries + intelligence
    const SCRUB_PHRASES = ['survived an overdose'];
    scrubSummaries(SCRUB_PHRASES).then(() => getAllSummaries().then(setSummaries));
    scrubDigests(SCRUB_PHRASES).then(() => getLatestDigest().then(setDigest));
    getStorageMetrics().then(setCloudMetrics);
    analyzePatterns().then(setPatterns).catch(e => console.error('[Phase3] Pattern analysis error:', e));

    controlRoomEvents.on(handler);
    return () => controlRoomEvents.off(handler);
  }, [addStep, applyEvent]);

  const guestIds: NodeId[] = [];
  const adamPos = NODE_POSITIONS['pete'];

  // Persona network canvas height — shrink when KG graph is expanded
  const CANVAS_H = kgExpanded ? H * 0.30 : H * 0.42;

  return (
    <View style={styles.root}>
      <SacredGeometryBg />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#4db8a4" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>// control room</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

        {/* Security status row */}
        <View style={styles.secRow}>
          <View style={styles.secBadge}>
            <View style={[styles.secDot, { backgroundColor: '#00ff88' }]} />
            <Text style={styles.secLabel}>shield</Text>
          </View>
          <View style={styles.secBadge}>
            <View style={[styles.secDot, { backgroundColor: '#00ff88' }]} />
            <Text style={styles.secLabel}>output filter</Text>
          </View>
          <View style={styles.secBadge}>
            <View style={[styles.secDot, { backgroundColor: '#4db8a4' }]} />
            <Text style={styles.secLabel}>medical: local</Text>
          </View>
          <View style={styles.secBadge}>
            <View style={[styles.secDot, { backgroundColor: searchActive ? '#f59e0b' : '#2a2a3a' }]} />
            <Text style={[styles.secLabel, searchActive && { color: '#f59e0b' }]}>
              {searchActive ? 'searching...' : 'web'}
            </Text>
          </View>
          <View style={styles.secBadge}>
            <View style={[styles.secDot, {
              backgroundColor: secStatus.sessionState === 'locked' ? '#ef4444' : '#00ff88',
            }]} />
            <Text style={styles.secLabel}>
              {secStatus.sessionState === 'locked' ? 'locked' : 'session ok'}
            </Text>
          </View>
          <View style={styles.secBadge}>
            <View style={[styles.secDot, {
              backgroundColor: vaultUnlocked ? '#00ff88' : '#ef4444',
            }]} />
            <Text style={styles.secLabel}>
              {vaultUnlocked ? 'vault open' : 'vault locked'}
            </Text>
          </View>
        </View>

        {/* Compact control row: vault + KG side by side */}
        <View style={styles.controlRow}>
          <View style={styles.vaultPanel}>
            <Text style={styles.vaultTitle}>Data Vault</Text>
            <Text style={[styles.vaultStatus, { color: vaultUnlocked ? '#00ff88' : '#ef4444' }]}>
              {vaultUnlocked ? 'Unlocked' : 'Locked'}
            </Text>
            <View style={styles.vaultBtnRow}>
              <TouchableOpacity
                style={styles.vaultBtn}
                onPress={() => { lockVault(); setVaultUnlocked(false); }}>
                <Text style={styles.vaultBtnText}>Lock</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.vaultBtn}
                onPress={async () => {
                  const ok = await unlockVault();
                  setVaultUnlocked(ok);
                }}>
                <Text style={styles.vaultBtnText}>Unlock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Knowledge Graph */}
        <View style={styles.kgPanel}>
          <TouchableOpacity
            style={styles.kgHeader}
            onPress={() => setKgExpanded(v => !v)}>
            <Text style={styles.kgTitle}>
              {kgExpanded ? '▼' : '▶'} Knowledge Graph
            </Text>
            <Text style={styles.kgStatInline}>
              {kgStats.nodeCount} nodes · {kgStats.topicCount} topics · {kgStats.confirmedCount} confirmed
            </Text>
          </TouchableOpacity>
          {kgExpanded && (
            <View style={styles.kgCanvasWrap}>
              <KnowledgeGraphCanvas
                nodes={kgNodes}
                edges={kgEdges}
                width={W - 34}
                height={300}
                onDeleteNode={async (nodeId) => {
                  await deleteNode(nodeId);
                  const data = await getGraphVisualizationData();
                  setKgNodes(data.nodes);
                  setKgEdges(data.edges);
                  const stats = await getGraphSummary();
                  setKgStats(stats);
                }}
              />
            </View>
          )}
        </View>

        {/* ── Conversation Summaries ──────────────────────── */}
        <View style={styles.summariesSection}>
          <TouchableOpacity
            style={styles.summariesHeader}
            onPress={() => setSummariesExpanded(v => !v)}>
            <Text style={styles.summariesTitle}>
              {summariesExpanded ? '▼' : '▶'} // conversation summaries
            </Text>
            <Text style={styles.summariesCount}>
              {summaries.length} conversations
            </Text>
          </TouchableOpacity>

          {summariesExpanded && (
            <View style={{ paddingHorizontal: 8, paddingTop: 4 }}>
              {summaries.length === 0 ? (
                <Text style={styles.summariesEmpty}>no summaries yet</Text>
              ) : (
                summaries.slice(0, 10).map((summary, idx) => {
                  const dateStr = new Date(summary.date).toLocaleDateString();
                  const timeStr = new Date(summary.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <View key={summary.id} style={styles.summaryCard}>
                      {/* Header: Subject + Date */}
                      <View style={styles.summaryCardHeader}>
                        <Text style={styles.summarySubject}>{summary.subject}</Text>
                        <Text style={styles.summaryDate}>{dateStr} {timeStr}</Text>
                      </View>

                      {/* Highlights */}
                      {summary.highlights.length > 0 && (
                        <View style={styles.summarySection}>
                          <Text style={styles.summarySectionLabel}>Highlights</Text>
                          {summary.highlights.slice(0, 2).map((h, i) => (
                            <Text key={i} style={styles.summaryBullet}>
                              • {h}
                            </Text>
                          ))}
                        </View>
                      )}

                      {/* Hard-stick Notes */}
                      {summary.hardStickNotes.length > 0 && (
                        <View style={styles.summarySection}>
                          <Text style={[styles.summarySectionLabel, { color: '#f59e0b' }]}>🚩 Hard-stick Notes</Text>
                          {summary.hardStickNotes.slice(0, 1).map((n, i) => (
                            <Text key={i} style={[styles.summaryBullet, { color: '#f59e0b' }]}>
                              • {n}
                            </Text>
                          ))}
                        </View>
                      )}

                      {/* Action Items */}
                      {summary.actionItems.length > 0 && (
                        <View style={styles.summarySection}>
                          <Text style={styles.summarySectionLabel}>Action Items</Text>
                          {summary.actionItems.slice(0, 2).map((item, i) => (
                            <View key={i} style={styles.actionItemRow}>
                              <Text style={[
                                styles.actionItemStatus,
                                {
                                  color: item.status === 'done' ? '#00ff88' : item.status === 'pending' ? '#f59e0b' : '#ef4444',
                                }
                              ]}>
                                {item.status === 'done' ? '✓' : item.status === 'pending' ? '○' : '✗'}
                              </Text>
                              <Text style={styles.actionItemText} numberOfLines={2}>
                                {item.task}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Stats row */}
                      <View style={styles.summaryStatsRow}>
                        <Text style={styles.summaryStat}>
                          {summary.messageCount} messages
                        </Text>
                        <Text style={styles.summaryStat}>
                          {summary.estimatedTimeSpent}m
                        </Text>
                        {summary.pinnedForReview && (
                          <Text style={[styles.summaryStat, { color: '#f59e0b' }]}>📌 pinned</Text>
                        )}
                      </View>

                      {/* Actions */}
                      <View style={styles.summaryActionsRow}>
                        <TouchableOpacity
                          style={styles.summaryActionBtn}
                          onPress={() => {
                            updateSummary(summary.id, { pinnedForReview: !summary.pinnedForReview })
                              .then(() => getAllSummaries().then(setSummaries))
                              .catch(e => console.error('[Summaries] Pin failed:', e));
                          }}>
                          <Text style={styles.summaryActionBtnText}>
                            {summary.pinnedForReview ? 'unpinned' : 'pin for review'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.summaryActionBtn, { backgroundColor: '#2a1a1a' }]}
                          onPress={() => {
                            Alert.alert('Delete Summary?', `${summary.subject} - ${new Date(summary.date).toLocaleDateString()}`, [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete', style: 'destructive',
                                onPress: () => {
                                  deleteSummary(summary.id)
                                    .then(() => getAllSummaries().then(setSummaries))
                                    .catch(e => console.error('[Summaries] Delete failed:', e));
                                },
                              },
                            ]);
                          }}>
                          <Text style={[styles.summaryActionBtnText, { color: '#ef4444' }]}>delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>

        {/* ── Cloud Sync Status ──────────────────────────── */}
        <View style={styles.cloudSyncPanel}>
          <View style={styles.cloudSyncHeader}>
            <Text style={styles.cloudSyncTitle}>☁️ CLOUD SYNC</Text>
            <Text style={styles.cloudSyncSubtitle}>
              {cloudMetrics ? `${cloudMetrics.hotItemCount}H ${cloudMetrics.warmItemCount}W ${cloudMetrics.coldItemCount}C` : 'not synced'}
            </Text>
          </View>

          {cloudMetrics && (
            <View style={styles.cloudSyncContent}>
              <View style={styles.cloudTierRow}>
                <Text style={styles.cloudTierLabel}>HOT (0-7d)</Text>
                <Text style={styles.cloudTierValue}>
                  {cloudMetrics.hotItemCount} items · {formatCloudBytes(cloudMetrics.hotTierSize)}
                </Text>
              </View>
              <View style={styles.cloudTierRow}>
                <Text style={styles.cloudTierLabel}>WARM (7-30d)</Text>
                <Text style={styles.cloudTierValue}>
                  {cloudMetrics.warmItemCount} items · {formatCloudBytes(cloudMetrics.warmTierSize)}
                </Text>
              </View>
              <View style={styles.cloudTierRow}>
                <Text style={styles.cloudTierLabel}>COLD (30+d)</Text>
                <Text style={styles.cloudTierValue}>
                  {cloudMetrics.coldItemCount} items · {formatCloudBytes(cloudMetrics.coldTierSize)}
                </Text>
              </View>

              <View style={styles.cloudTotalRow}>
                <Text style={styles.cloudTotalLabel}>TOTAL</Text>
                <Text style={styles.cloudTotalValue}>{formatCloudBytes(cloudMetrics.hotTierSize + cloudMetrics.warmTierSize + cloudMetrics.coldTierSize)}</Text>
              </View>

              {cloudMetrics.lastSyncTime && (
                <Text style={styles.cloudSyncTime}>
                  Last sync: {new Date(cloudMetrics.lastSyncTime).toLocaleString()}
                </Text>
              )}

              <TouchableOpacity
                style={styles.cloudSyncBtn}
                onPress={async () => {
                  try {
                    const { triggerManualSync } = require('@/services/agents/cloudSyncAgent');
                    await triggerManualSync();
                    const { getStorageMetrics } = require('@/services/cloudSync');
                    const metrics = await getStorageMetrics();
                    setCloudMetrics(metrics);
                  } catch (e) {
                    console.error('[CloudSync] Manual sync failed:', e);
                  }
                }}>
                <Text style={styles.cloudSyncBtnText}>sync now</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Intelligence Layer (Phase 3) ─────────────────── */}
        <View style={styles.cloudSyncPanel}>
          <TouchableOpacity
            style={styles.cloudSyncHeader}
            onPress={() => setIntelligenceExpanded(!intelligenceExpanded)}>
            <Text style={styles.cloudSyncTitle}>
              {intelligenceExpanded ? '▼' : '▶'} 🧠 INTELLIGENCE
            </Text>
            <Text style={styles.cloudSyncSubtitle}>
              {patterns ? `${patterns.conversationsAnalyzed} analyzed` : 'loading...'}
            </Text>
          </TouchableOpacity>

          {intelligenceExpanded && patterns && (
            <View style={{ gap: 8, marginTop: 8 }}>
              {/* Insights */}
              {patterns.insights.length > 0 && (
                <View>
                  <Text style={[styles.cloudTierLabel, { color: '#ffaa00', marginBottom: 4 }]}>
                    INSIGHTS
                  </Text>
                  {patterns.insights.map((insight, i) => (
                    <Text key={i} style={{ fontFamily: FONT, fontSize: 10, color: '#ccccee', marginBottom: 3 }}>
                      • {insight}
                    </Text>
                  ))}
                </View>
              )}

              {/* Top Topics */}
              {patterns.topTopics.length > 0 && (
                <View>
                  <Text style={[styles.cloudTierLabel, { color: '#66ff66', marginBottom: 4 }]}>
                    TOP TOPICS
                  </Text>
                  {patterns.topTopics.slice(0, 5).map((t, i) => (
                    <View key={i} style={styles.cloudTierRow}>
                      <Text style={styles.cloudTierLabel}>{t.subject}</Text>
                      <Text style={styles.cloudTierValue}>{t.count}x ({t.percentage}%)</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Time Pattern */}
              {patterns.peakDay && (
                <View style={styles.cloudTierRow}>
                  <Text style={styles.cloudTierLabel}>Peak activity</Text>
                  <Text style={styles.cloudTierValue}>{patterns.peakDay} {patterns.peakHour}:00</Text>
                </View>
              )}

              {/* Action Health */}
              <View style={styles.cloudTierRow}>
                <Text style={styles.cloudTierLabel}>Action completion</Text>
                <Text style={[styles.cloudTierValue, {
                  color: patterns.completionRate >= 0.7 ? '#66ff66' :
                    patterns.completionRate >= 0.4 ? '#ffaa00' : '#ff4444'
                }]}>
                  {Math.round(patterns.completionRate * 100)}%
                </Text>
              </View>

              {/* Stalled Actions */}
              {patterns.stalledActions.length > 0 && (
                <View>
                  <Text style={[styles.cloudTierLabel, { color: '#ff6644', marginBottom: 4 }]}>
                    STALLED ({patterns.stalledActions.length})
                  </Text>
                  {patterns.stalledActions.slice(0, 3).map((a, i) => (
                    <Text key={i} style={{ fontFamily: FONT, fontSize: 9, color: '#aa6644', marginBottom: 2 }}>
                      {a.age}d: {a.task.slice(0, 50)}{a.task.length > 50 ? '...' : ''}
                    </Text>
                  ))}
                </View>
              )}

              {/* Digest */}
              {digest && (
                <View style={{ borderTopWidth: 1, borderTopColor: '#1a1a3a', paddingTop: 6, marginTop: 4 }}>
                  <Text style={[styles.cloudTierLabel, { color: '#6699ff', marginBottom: 4 }]}>
                    MONTHLY DIGEST — {digest.month}
                  </Text>
                  <View style={styles.cloudTierRow}>
                    <Text style={styles.cloudTierLabel}>Conversations</Text>
                    <Text style={styles.cloudTierValue}>{digest.totalConversations}</Text>
                  </View>
                  <View style={styles.cloudTierRow}>
                    <Text style={styles.cloudTierLabel}>Messages</Text>
                    <Text style={styles.cloudTierValue}>{digest.totalMessages}</Text>
                  </View>
                  <View style={styles.cloudTierRow}>
                    <Text style={styles.cloudTierLabel}>Time spent</Text>
                    <Text style={styles.cloudTierValue}>{digest.totalMinutes}m</Text>
                  </View>
                  {digest.keyDecisions.length > 0 && (
                    <View style={{ marginTop: 4 }}>
                      <Text style={[styles.cloudTierLabel, { color: '#ffaa00' }]}>Key decisions:</Text>
                      {digest.keyDecisions.slice(0, 3).map((d, i) => (
                        <Text key={i} style={{ fontFamily: FONT, fontSize: 9, color: '#ccaa66', marginTop: 2 }}>
                          • {d.slice(0, 60)}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Generate Digest Button */}
              <TouchableOpacity
                style={styles.cloudSyncBtn}
                onPress={async () => {
                  try {
                    const d = await generateMonthlyDigest();
                    setDigest(d);
                    const p = await analyzePatterns();
                    setPatterns(p);
                  } catch (e) {
                    console.error('[Phase3] Digest generation error:', e);
                  }
                }}>
                <Text style={styles.cloudSyncBtnText}>generate digest</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Knowledge Base - Files ──────────────────────── */}
        <View style={styles.filesSection}>
          <Text style={styles.filesSectionTitle}>// knowledge base - files</Text>

          <View style={{ paddingLeft: 8, marginTop: 4 }}>
            <Text style={styles.filesCount}>
              {crFiles.length + crKbEntries.length + crKbFiles.length} files indexed
            </Text>

            {/* Add files via hamburger menu knowledge base */}

            {/* File cards */}
            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
              {crFiles.map(f => {
                const sizeStr = f.size < 1024
                  ? `${f.size}B`
                  : f.size < 1048576
                    ? `${(f.size / 1024).toFixed(1)}KB`
                    : `${(f.size / 1048576).toFixed(1)}MB`;
                const dateStr = new Date(f.addedAt).toLocaleDateString();
                return (
                  <View key={f.id} style={styles.fileCard}>
                    <Text style={styles.fileCardName} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.fileCardMeta}>{sizeStr} · {dateStr}</Text>
                    <TouchableOpacity
                      style={{ marginTop: 4 }}
                      onPress={() => {
                        Alert.alert('Remove File?', f.name, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove', style: 'destructive',
                            onPress: async () => {
                              await deleteFile(f.id);
                              listFiles().then(setCrFiles);
                            },
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.fileCardRemove}>remove</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              {crKbEntries.map(e => {
                const sizeStr = e.content.length < 1024
                  ? `${e.content.length}B`
                  : `${Math.round(e.content.length / 1024)}KB`;
                const dateStr = new Date(e.dateAdded).toLocaleDateString();
                return (
                  <View key={e.id} style={[styles.fileCard, { borderLeftColor: '#4db8ff' }]}>
                    <Text style={[styles.fileCardName, { color: '#4db8ff' }]} numberOfLines={1}>{e.title}</Text>
                    <Text style={styles.fileCardMeta}>{sizeStr} · {dateStr} · {e.personaId}</Text>
                  </View>
                );
              })}
              {crKbFiles.map(f => {
                const sizeStr = f.size < 1024
                  ? `${f.size}B`
                  : f.size < 1048576
                    ? `${(f.size / 1024).toFixed(1)}KB`
                    : `${(f.size / 1048576).toFixed(1)}MB`;
                const dateStr = new Date(f.dateAdded).toLocaleDateString();
                return (
                  <View key={f.id} style={[styles.fileCard, { borderLeftColor: '#f59e0b' }]}>
                    <Text style={[styles.fileCardName, { color: '#f59e0b' }]} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.fileCardMeta}>{sizeStr} · {dateStr} · kb</Text>
                    <TouchableOpacity
                      style={{ marginTop: 4 }}
                      onPress={() => {
                        Alert.alert('Remove File?', f.name, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove', style: 'destructive',
                            onPress: async () => {
                              await removeFile(f.name);
                              getFiles().then(setCrKbFiles);
                            },
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.fileCardRemove}>remove</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>

            {crFiles.length === 0 && crKbEntries.length === 0 && crKbFiles.length === 0 && (
              <Text style={styles.filesEmpty}>no files indexed yet</Text>
            )}
          </View>
        </View>

        {/* Network canvas */}
        <View style={[styles.canvas, { height: CANVAS_H }]}>
          {/* SVG connector lines */}
          <Svg style={StyleSheet.absoluteFill}>
            {guestIds.map(id => {
              const gPos = NODE_POSITIONS[id];
              const node = NODES.find(n => n.id === id)!;
              const isActive = activeLines.has(id);
              return (
                <Line
                  key={id}
                  x1={adamPos.x} y1={adamPos.y}
                  x2={gPos.x} y2={gPos.y}
                  stroke={isActive ? node.color : '#1a1a2a'}
                  strokeWidth={isActive ? 1.5 : 1}
                  strokeDasharray={isActive ? undefined : '4 6'}
                  opacity={isActive ? 0.8 : 0.4}
                />
              );
            })}
          </Svg>

          {/* Traveling dots */}
          {guestIds.map(id => {
            const gPos = NODE_POSITIONS[id];
            const node = NODES.find(n => n.id === id)!;
            return (
              <TravelingDot
                key={id}
                fromX={adamPos.x} fromY={adamPos.y}
                toX={gPos.x} toY={gPos.y}
                active={activeLines.has(id)}
                color={node.color}
              />
            );
          })}

          {/* Persona nodes */}
          {NODES.map(node => {
            const pos = NODE_POSITIONS[node.id];
            return (
              <PersonaNode
                key={node.id}
                node={node}
                status={statuses[node.id]}
                x={pos.x}
                y={pos.y}
              />
            );
          })}
        </View>

        {/* Memory insight toggle */}
        <TouchableOpacity
          style={styles.memoryToggle}
          onPress={() => setMemoryOpen(v => !v)}>
          <Text style={styles.memoryToggleText}>
            {memoryOpen ? '▼' : '▶'} // context insight
          </Text>
        </TouchableOpacity>

        {memoryOpen && (
          <View style={styles.memoryPanel}>
            <Text style={styles.memoryRow}>
              <Text style={styles.memoryKey}>persona   </Text>
              <Text style={styles.memoryVal}>Atom active</Text>
            </Text>
            <Text style={styles.memoryRow}>
              <Text style={styles.memoryKey}>kernel    </Text>
              <Text style={styles.memoryVal}>routing enabled</Text>
            </Text>
            <Text style={styles.memoryRow}>
              <Text style={styles.memoryKey}>security  </Text>
              <Text style={styles.memoryVal}>injection shield · output filter</Text>
            </Text>
            <Text style={styles.memoryRow}>
              <Text style={styles.memoryKey}>data vault</Text>
              <Text style={[styles.memoryVal, { color: vaultUnlocked ? '#00ff88' : '#ef4444' }]}>
                {vaultUnlocked ? 'unlocked · 5 min TTL' : 'locked · biometric required'}
              </Text>
            </Text>
            {(() => {
              const cm = getLastCompressionMetrics();
              return (
                <Text style={styles.memoryRow}>
                  <Text style={styles.memoryKey}>compress </Text>
                  <Text style={[styles.memoryVal, { color: cm.active ? '#f59e0b' : '#4a4a6a' }]}>
                    {cm.active
                      ? `${cm.originalTokens} → ${cm.compressedTokens} tok · -${cm.reductionPct}%`
                      : 'standby'}
                  </Text>
                </Text>
              );
            })()}
            <Text style={styles.memoryRow}>
              <Text style={styles.memoryKey}>web search</Text>
              <Text style={[styles.memoryVal, searchActive && { color: '#f59e0b' }]}>
                {searchActive ? 'active' : 'standby'}
              </Text>
            </Text>
          </View>
        )}

        {/* Thinking timeline */}
        <View style={styles.timelineSection}>
          <Text style={styles.timelineHeader}>// thinking timeline</Text>
          {timeline.length === 0 ? (
            <Text style={styles.timelineEmpty}>waiting for activity...</Text>
          ) : (
            timeline.map((step, i) => {
              const node = NODES.find(n => n.id === step.personaId);
              const color = node?.color ?? '#3a3a5a';
              const isLast = i === timeline.length - 1;
              return (
                <View key={step.id} style={styles.timelineStep}>
                  <View style={[styles.timelineDot, { backgroundColor: color }]} />
                  {!isLast && <View style={[styles.timelineLine, { backgroundColor: color + '33' }]} />}
                  <View style={styles.timelineContent}>
                    <Text style={[styles.timelineLabel, { color: isLast ? '#c0c0d0' : '#4a4a6a' }]}>
                      {step.label}
                    </Text>
                    <Text style={styles.timelineTs}>
                      {new Date(step.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </View>

        {/* ── Benchmark Runner ──────────────────────────────── */}
        <View style={styles.benchSection}>
          <Text style={styles.benchTitle}>// benchmark</Text>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={[styles.benchBtn, benchmarkRunning && { opacity: 0.4 }]}
              disabled={benchmarkRunning}
              onPress={async () => {
                setBenchmarkRunning(true);
                setBenchmarkReport('');
                setBenchmarkProgress('Starting...');
                try {
                  const result = await runBenchmark((batch, total, category) => {
                    setBenchmarkProgress(`Batch ${batch}/${total}: ${category}`);
                  });
                  setBenchmarkReport(formatBenchmarkReport(result));
                } catch (err: any) {
                  setBenchmarkReport(`ERROR: ${err?.message ?? err}`);
                } finally {
                  setBenchmarkRunning(false);
                  setBenchmarkProgress('');
                }
              }}
            >
              <Ionicons name="play" size={14} color="#000" />
              <Text style={styles.benchBtnText}>Run All (60Q)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.benchBtn, { backgroundColor: '#334155' }, benchmarkRunning && { opacity: 0.4 }]}
              disabled={benchmarkRunning}
              onPress={async () => {
                setBenchmarkRunning(true);
                setBenchmarkReport('');
                setBenchmarkProgress('Running Batch 2: Pattern Recognition...');
                try {
                  const result = await runSingleBatch(1);
                  const lines = result.questions.map(q =>
                    `Q${q.id}: ${q.answer.slice(0, 100)}${q.answer.length > 100 ? '...' : ''}`
                  );
                  setBenchmarkReport(`Batch 2: ${result.category}\n${result.questions.length}/10 answered\n\n${lines.join('\n')}`);
                } catch (err: any) {
                  setBenchmarkReport(`ERROR: ${err?.message ?? err}`);
                } finally {
                  setBenchmarkRunning(false);
                  setBenchmarkProgress('');
                }
              }}
            >
              <Ionicons name="flask" size={14} color="#94a3b8" />
              <Text style={[styles.benchBtnText, { color: '#94a3b8' }]}>Test Q11-20</Text>
            </TouchableOpacity>
          </View>

          {benchmarkProgress ? (
            <Text style={styles.benchProgress}>{benchmarkProgress}</Text>
          ) : null}

          {benchmarkReport ? (
            <ScrollView style={styles.benchReport} nestedScrollEnabled>
              <Text style={styles.benchReportText}>{benchmarkReport}</Text>
            </ScrollView>
          ) : null}
        </View>

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontFamily: FONT, fontSize: 14, color: '#4db8a4', letterSpacing: 2 },

  secRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#0f1a14',
  },
  secBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secDot: { width: 6, height: 6, borderRadius: 3 },
  secLabel: { fontFamily: FONT, fontSize: 9, color: '#3a4a3a', letterSpacing: 1 },

  controlRow: {
    flexDirection: 'row', paddingHorizontal: 16, marginTop: 6, gap: 8,
  },
  vaultPanel: {
    flex: 1, padding: 10,
    borderRadius: 8, backgroundColor: '#0d1a0d',
    borderWidth: 1, borderColor: '#1a3a1a',
  },
  vaultTitle: {
    fontFamily: FONT, fontSize: 10, color: '#00ff88',
    letterSpacing: 2, marginBottom: 4,
  },
  vaultStatus: {
    fontFamily: FONT, fontSize: 12, fontWeight: '600', marginBottom: 6,
  },
  vaultBtnRow: {
    flexDirection: 'row', gap: 6,
  },
  vaultBtn: {
    flex: 1, paddingVertical: 6, paddingHorizontal: 8,
    backgroundColor: '#1a2a1a', borderRadius: 4,
    borderWidth: 1, borderColor: '#2a4a2a', alignItems: 'center',
  },
  vaultBtnText: { fontFamily: FONT, fontSize: 10, color: '#c0c0c0', letterSpacing: 1 },

  kgPanel: {
    marginHorizontal: 16, marginTop: 6,
  },
  kgHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 10, borderRadius: 8, backgroundColor: '#0d0d1a',
    borderWidth: 1, borderColor: '#1a1a3a',
  },
  kgTitle: {
    fontFamily: FONT, fontSize: 11, color: '#4db8ff',
    letterSpacing: 2,
  },
  kgStatInline: {
    fontFamily: FONT, fontSize: 9, color: '#3a3a5a', letterSpacing: 0.5,
  },
  kgCanvasWrap: {
    marginTop: 4,
  },

  canvas: {
    // height is set dynamically via style prop
  },

  memoryToggle: {
    paddingHorizontal: 20, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#0a0a18',
  },
  memoryToggleText: { fontFamily: FONT, fontSize: 10, color: '#3a3a5a', letterSpacing: 1 },

  memoryPanel: {
    paddingHorizontal: 20, paddingVertical: 6, gap: 3,
    borderBottomWidth: 1, borderBottomColor: '#0a0a18',
  },
  memoryRow: { fontFamily: FONT, fontSize: 11 },
  memoryKey: { color: '#2a2a4a' },
  memoryVal: { color: '#5a5a8a' },

  timelineSection: {
    paddingHorizontal: 20, paddingBottom: 8,
  },
  timelineHeader: {
    fontFamily: FONT, fontSize: 10, color: '#2a2a4a', letterSpacing: 2,
    paddingTop: 10, paddingBottom: 6,
  },
  timelineEmpty: { fontFamily: FONT, fontSize: 11, color: '#1a1a2a', paddingVertical: 8 },

  timelineStep: {
    flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2,
  },
  timelineDot: {
    width: 6, height: 6, borderRadius: 3, marginTop: 5, marginRight: 10, flexShrink: 0,
  },
  timelineLine: {
    position: 'absolute', left: 2.5, top: 11, width: 1, height: 18,
  },
  timelineContent: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 14 },
  timelineLabel: { fontFamily: FONT, fontSize: 11, flex: 1 },
  timelineTs: { fontFamily: FONT, fontSize: 9, color: '#2a2a3a', marginLeft: 8 },

  // ── Benchmark styles ──────────────────────────────────
  benchSection: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 24,
    padding: 12, backgroundColor: '#0d0d1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1a1a2e',
  },
  benchTitle: {
    fontFamily: FONT, fontSize: 12, color: '#4db8a4', fontWeight: '600',
  },
  benchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4db8a4', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 6,
  },
  benchBtnText: {
    fontFamily: FONT, fontSize: 11, color: '#000', fontWeight: '600',
  },
  benchProgress: {
    fontFamily: FONT, fontSize: 11, color: '#f59e0b', marginTop: 8,
  },
  benchReport: {
    marginTop: 8, maxHeight: 300,
    backgroundColor: '#0a0a14', borderRadius: 6, padding: 8,
  },
  benchReportText: {
    fontFamily: FONT, fontSize: 10, color: '#8a8aaa', lineHeight: 16,
  },

  // ── Summaries section styles ──────────────────────────
  summariesSection: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
    paddingTop: 8,
  },
  summariesHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 8, borderRadius: 6, backgroundColor: '#0d0d1a',
    borderWidth: 1, borderColor: '#1a1a3a',
  },
  summariesTitle: {
    fontFamily: FONT, fontSize: 11, color: '#4db8ff',
    letterSpacing: 2, fontWeight: '600',
  },
  summariesCount: {
    fontFamily: FONT, fontSize: 9, color: '#3a3a5a', letterSpacing: 0.5,
  },
  summariesEmpty: {
    fontFamily: FONT, fontSize: 10, color: '#2a2a4a',
    paddingVertical: 12, paddingHorizontal: 8,
  },

  // Summary card
  summaryCard: {
    marginBottom: 8, padding: 10, borderRadius: 6,
    backgroundColor: '#0a0a14', borderLeftWidth: 3,
    borderLeftColor: '#4db8ff', borderTopWidth: 1,
    borderTopColor: '#1a1a2e', borderRightWidth: 1,
    borderRightColor: '#1a1a2e', borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  summaryCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  summarySubject: {
    fontFamily: FONT, fontSize: 10, fontWeight: '600',
    color: '#4db8ff', letterSpacing: 1,
  },
  summaryDate: {
    fontFamily: FONT, fontSize: 8, color: '#2a2a4a',
  },

  // Summary section (highlights, notes, etc.)
  summarySection: {
    marginVertical: 6, paddingVertical: 4,
  },
  summarySectionLabel: {
    fontFamily: FONT, fontSize: 9, color: '#3a3a5a',
    letterSpacing: 1, marginBottom: 3,
  },
  summaryBullet: {
    fontFamily: FONT, fontSize: 9, color: '#4a4a6a',
    lineHeight: 14, marginBottom: 2,
  },

  // Action items
  actionItemRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginBottom: 3,
  },
  actionItemStatus: {
    fontFamily: FONT, fontSize: 10, fontWeight: '700',
    minWidth: 14,
  },
  actionItemText: {
    fontFamily: FONT, fontSize: 9, color: '#4a4a6a',
    flex: 1, lineHeight: 13,
  },

  // Stats row
  summaryStatsRow: {
    flexDirection: 'row', gap: 12, marginVertical: 6,
    paddingVertical: 4, borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  summaryStat: {
    fontFamily: FONT, fontSize: 8, color: '#2a2a4a',
    letterSpacing: 0.5,
  },

  // Actions row (buttons)
  summaryActionsRow: {
    flexDirection: 'row', gap: 6, marginTop: 6,
  },
  summaryActionBtn: {
    flex: 1, paddingVertical: 5, paddingHorizontal: 8,
    backgroundColor: '#1a1a3a', borderRadius: 4,
    borderWidth: 1, borderColor: '#2a2a5a',
    alignItems: 'center',
  },
  summaryActionBtnText: {
    fontFamily: FONT, fontSize: 8, color: '#4db8ff',
    letterSpacing: 0.5, fontWeight: '500',
  },

  // ── Files section styles ──────────────────────────────
  filesSection: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
    paddingTop: 8,
  },
  filesSectionTitle: {
    fontFamily: FONT, fontSize: 12, color: '#00ff00', marginBottom: 4,
  },
  filesCount: {
    fontFamily: FONT, fontSize: 10, color: '#4a4a6a', marginBottom: 6,
  },
  filesAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: '#111', borderRadius: 4,
    borderWidth: 1, borderColor: '#1a3a1a',
    alignSelf: 'flex-start', marginBottom: 8,
  },
  filesAddText: {
    fontFamily: FONT, fontSize: 10, color: '#00ff00',
  },
  filesError: {
    fontFamily: FONT, fontSize: 9, color: '#f59e0b', marginBottom: 4,
  },
  filesEmpty: {
    fontFamily: FONT, fontSize: 10, color: '#2a2a3a', fontStyle: 'italic',
    marginTop: 4,
  },
  fileCard: {
    backgroundColor: '#111',
    borderLeftWidth: 2,
    borderLeftColor: '#00ff00',
    padding: 8,
    marginVertical: 3,
    borderRadius: 4,
  },
  fileCardName: {
    fontFamily: FONT, fontSize: 11, color: '#00ff00', fontWeight: '600',
  },
  fileCardMeta: {
    fontFamily: FONT, fontSize: 9, color: '#4a4a6a', marginTop: 2,
  },
  fileCardRemove: {
    fontFamily: FONT, fontSize: 9, color: '#ef4444',
  },
  // Cloud Sync styles
  cloudSyncPanel: {
    marginTop: 12, padding: 10, backgroundColor: '#0a0a14', borderRadius: 6,
    borderWidth: 1, borderColor: '#1a1a3a',
  },
  cloudSyncHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  cloudSyncTitle: {
    fontFamily: FONT, fontSize: 11, color: '#6699ff', fontWeight: '700',
  },
  cloudSyncSubtitle: {
    fontFamily: FONT, fontSize: 9, color: '#4a4a6a',
  },
  cloudSyncContent: {
    gap: 4,
  },
  cloudTierRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2,
  },
  cloudTierLabel: {
    fontFamily: FONT, fontSize: 10, color: '#7a7a9a',
  },
  cloudTierValue: {
    fontFamily: FONT, fontSize: 10, color: '#aaaacc',
  },
  cloudTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6,
    marginTop: 4, borderTopWidth: 1, borderTopColor: '#1a1a3a',
  },
  cloudTotalLabel: {
    fontFamily: FONT, fontSize: 10, color: '#6699ff', fontWeight: '600',
  },
  cloudTotalValue: {
    fontFamily: FONT, fontSize: 10, color: '#6699ff', fontWeight: '600',
  },
  cloudSyncTime: {
    fontFamily: FONT, fontSize: 9, color: '#4a4a6a', marginTop: 6,
  },
  cloudSyncBtn: {
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: '#1a1a3a', borderRadius: 4, alignSelf: 'flex-start',
  },
  cloudSyncBtnText: {
    fontFamily: FONT, fontSize: 10, color: '#6699ff',
  },
});
