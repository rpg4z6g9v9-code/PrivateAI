/**
 * dashboard.tsx — PrivateAI Dashboard
 *
 * Scroll-tab hub with 4 tabs:
 *   VOICE    — Voice settings (speak toggle, rate, pitch, stability, similarity, style)
 *   SECURITY — Security proof summary (shield status, recent events, network calls)
 *   HEALTH   — Health timeline summary (recent entries, urgent items)
 *   KNOWLEDGE — Knowledge map summary (graph stats, top nodes)
 *
 * Same dark aesthetic as Control Room / Security Proof.
 */

import { Ionicons } from '@expo/vector-icons';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getSecurityLog,
  getSecurityStatus,
} from '@/services/securityGateway';
import {
  networkMonitor,
  type NetworkCallEntry,
  DEST_LABEL,
} from '@/services/networkMonitor';
import {
  getEntries,
  entryTypeLabel,
  entryTypeColor,
  entryRelativeDate,
  checkUrgent,
  type MedicalEntry,
} from '@/services/medicalMemory';
import {
  getGraphSummary,
  getTopInsights,
  type GraphSummary,
} from '@/services/knowledgeGraph';

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// ── Tab definitions ──────────────────────────────────────────

type Tab = 'voice' | 'security' | 'health' | 'knowledge';

const TABS: { id: Tab; label: string; icon: string; color: string }[] = [
  { id: 'voice',     label: 'VOICE',     icon: '♪', color: '#00ff00' },
  { id: 'security',  label: 'SECURITY',  icon: '✓', color: '#00ff88' },
  { id: 'health',    label: 'HEALTH',    icon: '♥', color: '#4db8a4' },
  { id: 'knowledge', label: 'KNOWLEDGE', icon: '◎', color: '#4db8ff' },
];

// ── Voice settings types & constants ─────────────────────────

const SETTINGS_KEY = 'voiceSettings_v4';

interface VoiceSettings {
  rate: number;
  pitch: number;
  isMuted: boolean;
  elStability: number;
  elSimilarity: number;
  elStyle: number;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  rate: 0.95, pitch: 1.0, isMuted: false,
  elStability: 0.4, elSimilarity: 0.78, elStyle: 0.15,
};

const RATE_OPTIONS = [
  { label: '0.75×', value: 0.75 },
  { label: '0.85×', value: 0.85 },
  { label: '0.95×', value: 0.95 },
  { label: '1.0×',  value: 1.0 },
  { label: '1.15×', value: 1.15 },
];
const PITCH_OPTIONS = [
  { label: 'low',    value: 0.8 },
  { label: 'normal', value: 1.0 },
  { label: 'high',   value: 1.2 },
];
const STABILITY_OPTIONS = [
  { label: 'variable', value: 0.2 },
  { label: 'balanced', value: 0.4 },
  { label: 'stable',   value: 0.65 },
  { label: 'monotone', value: 0.85 },
];
const SIMILARITY_OPTIONS = [
  { label: 'low',    value: 0.4 },
  { label: 'medium', value: 0.6 },
  { label: 'high',   value: 0.78 },
  { label: 'exact',  value: 0.95 },
];
const STYLE_OPTIONS = [
  { label: 'none',   value: 0 },
  { label: 'subtle', value: 0.15 },
  { label: 'medium', value: 0.35 },
  { label: 'strong', value: 0.55 },
];

// ── ElevenLabs constants ─────────────────────────────────────

const EL_BASE = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';
const EL_VOICE_KEY = 'elVoiceId_v1';
const PERSONA_VOICE_KEY = (id: string) => `personaVoice_v1_${id}`;
const RACHEL_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

interface ELVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url: string;
}

// ── Main screen ──────────────────────────────────────────────

export default function DashboardScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('voice');

  // Voice settings
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);

  // Security
  const [secEvents, setSecEvents] = useState<any[]>([]);
  const [netCalls, setNetCalls] = useState<NetworkCallEntry[]>([]);

  // Health
  const [medEntries, setMedEntries] = useState<MedicalEntry[]>([]);
  const [urgentItems, setUrgentItems] = useState<MedicalEntry[]>([]);

  // Knowledge
  const [kgStats, setKgStats] = useState<GraphSummary>({
    nodeCount: 0, topicCount: 0, preferenceCount: 0,
    milestoneCount: 0, confirmedCount: 0,
  });
  const [topInsights, setTopInsights] = useState<string[]>([]);

  // ElevenLabs
  const [elVoices, setElVoices] = useState<ELVoice[]>([]);
  const [elVoiceId, setElVoiceId] = useState<string>(RACHEL_VOICE_ID);
  const [elLoading, setElLoading] = useState(false);
  const [elError, setElError] = useState('');
  const soundRef = useRef<AudioPlayer | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Load voice settings
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY).then(raw => {
      if (raw) {
        try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }); } catch (e) { console.warn('[UI] parse voice settings:', e); }
      }
    });
  }, []);

  const saveSettings = async (s: VoiceSettings) => {
    setSettings(s);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  };
  const updateSettings = (patch: Partial<VoiceSettings>) => {
    saveSettings({ ...settings, ...patch });
  };

  const selectElVoice = (id: string) => {
    setElVoiceId(id);
    try { AsyncStorage.setItem(PERSONA_VOICE_KEY('pete'), id); } catch (e) { console.warn('[UI] save voice selection:', e); }
  };

  const fetchElVoices = async () => {
    if (elVoices.length > 0) return;
    if (!ELEVENLABS_KEY) { setElError('ElevenLabs API key not set'); return; }
    setElLoading(true);
    setElError('');
    try {
      const res = await fetch(`${EL_BASE}/voices`, {
        headers: { 'xi-api-key': ELEVENLABS_KEY },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const premade = (data.voices ?? []).filter((v: ELVoice) => v.category === 'premade');
      setElVoices(premade);
      const savedId = await AsyncStorage.getItem(EL_VOICE_KEY);
      const validIds = new Set(premade.map((v: ELVoice) => v.voice_id));
      if (savedId && !validIds.has(savedId)) selectElVoice(RACHEL_VOICE_ID);
    } catch (e: any) {
      setElError(`failed to load voices: ${e.message}`);
    }
    setElLoading(false);
  };

  const previewVoice = (voice: ELVoice) => {
    if (previewing || !voice.preview_url) return;
    setPreviewing(true);
    try {
      if (soundRef.current) { soundRef.current.pause(); soundRef.current.remove(); soundRef.current = null; }
      const player = createAudioPlayer({ uri: voice.preview_url });
      soundRef.current = player;
      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        if (status.didJustFinish) {
          sub.remove();
          player.remove();
          soundRef.current = null;
          setPreviewing(false);
        }
      });
      player.play();
    } catch (e) {
      console.warn('[UI] preview voice playback:', e);
      setPreviewing(false);
    }
  };

  // Load saved voice ID + fetch EL voices on mount
  useEffect(() => {
    AsyncStorage.getItem(PERSONA_VOICE_KEY('pete'))
      .then(saved => { if (saved) setElVoiceId(saved); })
      .catch(() => {});
    fetchElVoices();
  }, []);

  // Load data when tab focused
  useFocusEffect(
    useCallback(() => {
      // Security data
      getSecurityLog().then(events => setSecEvents(events.slice(0, 20)));
      setNetCalls(networkMonitor.getCalls(15));

      // Health data
      getEntries().then(entries => {
        setMedEntries(entries.slice(0, 10));
        setUrgentItems(entries.filter(e => checkUrgent(e.rawInput)));
      });

      // Knowledge data
      getGraphSummary().then(setKgStats);
      getTopInsights(5).then(text => {
        if (text) setTopInsights(text.split('\n').filter(l => l.trim()));
        else setTopInsights([]);
      });
    }, [])
  );

  const secStatus = getSecurityStatus();

  // ElevenLabs computed
  const selectedVoiceName = elVoiceId
    ? (elVoices.find(v => v.voice_id === elVoiceId)?.name ?? elVoiceId)
    : 'System Default';
  const elGrouped: Record<string, ELVoice[]> = {};
  for (const v of elVoices) {
    const cat = v.labels?.accent ?? v.category ?? 'other';
    if (!elGrouped[cat]) elGrouped[cat] = [];
    elGrouped[cat].push(v);
  }
  const elCategories = Object.keys(elGrouped).sort();

  // ── Render tab content ─────────────────────────────────────

  function renderVoice() {
    return (
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>// voice output</Text>

        <View style={styles.settingRow}>
          <Text style={styles.settingKey}>speak responses</Text>
          <Switch
            value={!settings.isMuted}
            onValueChange={v => updateSettings({ isMuted: !v })}
            trackColor={{ false: '#222', true: '#004400' }}
            thumbColor={!settings.isMuted ? '#00ff00' : '#444'}
          />
        </View>

        <Text style={styles.settingKey}>rate</Text>
        <View style={styles.chipRow}>
          {RATE_OPTIONS.map(o => (
            <TouchableOpacity key={o.label} onPress={() => updateSettings({ rate: o.value })}
              style={[styles.chip, settings.rate === o.value && styles.chipActive]}>
              <Text style={[styles.chipText, settings.rate === o.value && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.settingKey}>pitch</Text>
        <View style={styles.chipRow}>
          {PITCH_OPTIONS.map(o => (
            <TouchableOpacity key={o.label} onPress={() => updateSettings({ pitch: o.value })}
              style={[styles.chip, settings.pitch === o.value && styles.chipActive]}>
              <Text style={[styles.chipText, settings.pitch === o.value && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.settingKey}>stability</Text>
        <View style={styles.chipRow}>
          {STABILITY_OPTIONS.map(o => (
            <TouchableOpacity key={o.label} onPress={() => updateSettings({ elStability: o.value })}
              style={[styles.chip, settings.elStability === o.value && styles.chipActive]}>
              <Text style={[styles.chipText, settings.elStability === o.value && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.settingKey}>similarity</Text>
        <View style={styles.chipRow}>
          {SIMILARITY_OPTIONS.map(o => (
            <TouchableOpacity key={o.label} onPress={() => updateSettings({ elSimilarity: o.value })}
              style={[styles.chip, settings.elSimilarity === o.value && styles.chipActive]}>
              <Text style={[styles.chipText, settings.elSimilarity === o.value && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.settingKey}>style</Text>
        <View style={styles.chipRow}>
          {STYLE_OPTIONS.map(o => (
            <TouchableOpacity key={o.label} onPress={() => updateSettings({ elStyle: o.value })}
              style={[styles.chip, settings.elStyle === o.value && styles.chipActive]}>
              <Text style={[styles.chipText, settings.elStyle === o.value && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── ElevenLabs Voices ── */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>// elevenlabs voices</Text>
        <Text style={styles.settingKey}>
          current: <Text style={{ color: '#00ff00' }}>{selectedVoiceName}</Text>
        </Text>

        {elLoading && <Text style={styles.emptyText}>loading voices...</Text>}
        {elError !== '' && <Text style={[styles.emptyText, { color: '#f59e0b' }]}>{elError}</Text>}

        {/* System default */}
        <TouchableOpacity
          style={[styles.voiceRow, !elVoiceId && styles.voiceRowActive]}
          onPress={() => selectElVoice('')}>
          <Text style={[styles.voiceName, !elVoiceId && { color: '#00ff00' }]}>System Default</Text>
          <Text style={styles.voiceSub}>expo-speech</Text>
        </TouchableOpacity>

        {elCategories.map(cat => (
          <View key={cat}>
            <Text style={styles.voiceCatLabel}>{cat}</Text>
            {elGrouped[cat].map(v => {
              const sel = elVoiceId === v.voice_id;
              const gender = v.labels?.gender ?? '';
              return (
                <View key={v.voice_id} style={[styles.voiceRow, sel && styles.voiceRowActive]}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => selectElVoice(v.voice_id)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[styles.voiceName, sel && { color: '#00ff00' }]} numberOfLines={1}>{v.name}</Text>
                      {gender !== '' && (
                        <View style={[styles.genderBadge, {
                          borderColor: gender === 'male' ? '#334466' : '#442233',
                        }]}>
                          <Text style={[styles.genderBadgeText, {
                            color: gender === 'male' ? '#6699ff' : '#ff99cc',
                          }]}>
                            {gender === 'male' ? 'm' : 'f'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => previewVoice(v)} style={styles.previewBtn}>
                    <Ionicons name="play" size={11} color={previewing ? '#333' : '#555'} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  function renderSecurity() {
    return (
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>// shield status</Text>

        <View style={styles.statusRow}>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: '#00ff88' }]} />
            <Text style={styles.statusLabel}>injection shield</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: '#00ff88' }]} />
            <Text style={styles.statusLabel}>output filter</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, {
              backgroundColor: secStatus.sessionState === 'locked' ? '#ef4444' : '#00ff88',
            }]} />
            <Text style={styles.statusLabel}>
              {secStatus.sessionState === 'locked' ? 'locked' : 'session ok'}
            </Text>
          </View>
        </View>

        {/* Recent security events */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>// recent events</Text>
        {secEvents.length === 0 ? (
          <Text style={styles.emptyText}>no security events recorded</Text>
        ) : (
          secEvents.slice(0, 10).map((evt, i) => (
            <View key={i} style={styles.eventRow}>
              <Text style={[styles.eventType, {
                color: evt.event_type?.includes('injection') ? '#ef4444' :
                  evt.event_type?.includes('medical') ? '#4db8a4' : '#00ff88',
              }]}>
                {(evt.event_type ?? 'event').replace(/_/g, ' ')}
              </Text>
              <Text style={styles.eventTime}>
                {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString('en-US', {
                  hour12: false, hour: '2-digit', minute: '2-digit',
                }) : ''}
              </Text>
            </View>
          ))
        )}

        {/* Recent network calls */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>// network calls</Text>
        {netCalls.length === 0 ? (
          <Text style={styles.emptyText}>no network calls logged</Text>
        ) : (
          netCalls.slice(0, 8).map((call, i) => (
            <View key={i} style={styles.netRow}>
              <View style={[styles.statusDot, {
                backgroundColor: call.safety === 'safe' ? '#00ff88' : '#ef4444',
              }]} />
              <Text style={styles.netDest} numberOfLines={1}>
                {DEST_LABEL[call.destination] ?? call.destination}
              </Text>
              <Text style={styles.netSize}>
                {call.dataSizeBytes < 1024 ? `${call.dataSizeBytes}B` : `${(call.dataSizeBytes / 1024).toFixed(1)}K`}
              </Text>
            </View>
          ))
        )}

        {/* Deep dive link */}
        <TouchableOpacity
          style={styles.deepLink}
          onPress={() => router.push('/(tabs)/security')}>
          <Text style={styles.deepLinkText}>open full security proof</Text>
          <Ionicons name="chevron-forward" size={12} color="#00ff88" />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  function renderHealth() {
    return (
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>// health timeline</Text>

        {/* Urgent items */}
        {urgentItems.length > 0 && (
          <View style={styles.urgentBox}>
            <Text style={styles.urgentTitle}>URGENT</Text>
            {urgentItems.slice(0, 3).map(item => (
              <Text key={item.id} style={styles.urgentItem} numberOfLines={2}>
                {entryTypeLabel(item.type)} — {item.structured.what.slice(0, 80)}
              </Text>
            ))}
          </View>
        )}

        {/* Recent entries */}
        {medEntries.length === 0 ? (
          <Text style={styles.emptyText}>no health entries yet</Text>
        ) : (
          medEntries.map(entry => (
            <View key={entry.id} style={[styles.healthCard, {
              borderLeftColor: entryTypeColor(entry.type),
            }]}>
              <View style={styles.healthCardHeader}>
                <Text style={[styles.healthType, { color: entryTypeColor(entry.type) }]}>
                  {entryTypeLabel(entry.type)}
                </Text>
                <Text style={styles.healthDate}>{entryRelativeDate(entry.timestamp)}</Text>
              </View>
              <Text style={styles.healthText} numberOfLines={3}>{entry.structured.what}</Text>
              {entry.tags && entry.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {entry.tags.slice(0, 3).map((tag, i) => (
                    <View key={i} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))
        )}

        {/* Deep dive link */}
        <TouchableOpacity
          style={styles.deepLink}
          onPress={() => router.push('/(tabs)/medical')}>
          <Text style={[styles.deepLinkText, { color: '#4db8a4' }]}>open full health timeline</Text>
          <Ionicons name="chevron-forward" size={12} color="#4db8a4" />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  function renderKnowledge() {
    return (
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>// knowledge graph</Text>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{kgStats.nodeCount}</Text>
            <Text style={styles.statLabel}>nodes</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{kgStats.topicCount}</Text>
            <Text style={styles.statLabel}>topics</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{kgStats.preferenceCount}</Text>
            <Text style={styles.statLabel}>preferences</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{kgStats.milestoneCount}</Text>
            <Text style={styles.statLabel}>milestones</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{kgStats.confirmedCount}</Text>
            <Text style={styles.statLabel}>confirmed</Text>
          </View>
        </View>

        {/* Top insights */}
        {topInsights.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.sectionTitle, { marginTop: 0 }]}>// top insights</Text>
            {topInsights.map((insight, i) => (
              <Text key={i} style={styles.insightText}>
                {insight}
              </Text>
            ))}
          </View>
        )}

        {/* Deep dive link */}
        <TouchableOpacity
          style={styles.deepLink}
          onPress={() => router.push('/(tabs)/map')}>
          <Text style={[styles.deepLinkText, { color: '#4db8ff' }]}>open full knowledge map</Text>
          <Ionicons name="chevron-forward" size={12} color="#4db8ff" />
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    );
  }

  // ── Layout ─────────────────────────────────────────────────

  const activeColor = TABS.find(t => t.id === activeTab)?.color ?? '#00ff00';

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#4db8a4" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>// dashboard</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Tab bar — horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.tabBtn, isActive && { borderBottomColor: tab.color, borderBottomWidth: 2 }]}>
              <Text style={[styles.tabIcon, { color: isActive ? tab.color : '#2a3a2a' }]}>
                {tab.icon}
              </Text>
              <Text style={[styles.tabLabel, { color: isActive ? tab.color : '#2a3a2a' }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Tab content */}
      {activeTab === 'voice'     && renderVoice()}
      {activeTab === 'security'  && renderSecurity()}
      {activeTab === 'health'    && renderHealth()}
      {activeTab === 'knowledge' && renderKnowledge()}
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

  // ── Tab bar ─────────────────────────────────────────────
  tabBar: {
    borderBottomWidth: 1, borderBottomColor: '#0d1a14',
    maxHeight: 48,
  },
  tabBarContent: {
    flexDirection: 'row', paddingHorizontal: 8,
  },
  tabBtn: {
    paddingVertical: 10, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabIcon: {
    fontFamily: FONT, fontSize: 12,
  },
  tabLabel: {
    fontFamily: FONT, fontSize: 9, letterSpacing: 1.5,
  },

  // ── Tab content ─────────────────────────────────────────
  tabContent: {
    flex: 1, paddingHorizontal: 16, paddingTop: 12,
  },

  // ── Section ─────────────────────────────────────────────
  sectionTitle: {
    fontFamily: FONT, fontSize: 11, color: '#3a3a5a',
    letterSpacing: 2, marginBottom: 10,
  },

  // ── Voice settings ──────────────────────────────────────
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, marginBottom: 4,
  },
  settingKey: {
    fontFamily: FONT, fontSize: 10, color: '#5a5a7a',
    letterSpacing: 1, marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14,
  },
  chip: {
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: '#111', borderRadius: 4,
    borderWidth: 1, borderColor: '#1a2a1a',
  },
  chipActive: {
    backgroundColor: '#0a2a0a', borderColor: '#00ff00',
  },
  chipText: {
    fontFamily: FONT, fontSize: 10, color: '#3a4a3a',
  },
  chipTextActive: {
    color: '#00ff00',
  },

  // ── Security ────────────────────────────────────────────
  statusRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3,
  },
  statusLabel: {
    fontFamily: FONT, fontSize: 9, color: '#3a4a3a', letterSpacing: 1,
  },
  eventRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#0d1a14',
  },
  eventType: {
    fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, flex: 1,
  },
  eventTime: {
    fontFamily: FONT, fontSize: 8, color: '#2a3a2a',
  },
  netRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#0d1a14',
  },
  netDest: {
    fontFamily: FONT, fontSize: 9, color: '#5a5a7a', flex: 1,
  },
  netSize: {
    fontFamily: FONT, fontSize: 8, color: '#2a3a2a',
  },

  // ── Health ──────────────────────────────────────────────
  urgentBox: {
    padding: 10, marginBottom: 12, borderRadius: 6,
    backgroundColor: '#1a0a0a', borderWidth: 1, borderColor: '#3a1a1a',
  },
  urgentTitle: {
    fontFamily: FONT, fontSize: 10, color: '#ef4444',
    letterSpacing: 2, marginBottom: 6, fontWeight: '700',
  },
  urgentItem: {
    fontFamily: FONT, fontSize: 9, color: '#cc6666',
    marginBottom: 4, lineHeight: 14,
  },
  healthCard: {
    padding: 10, marginBottom: 8, borderRadius: 6,
    backgroundColor: '#0a0a14', borderLeftWidth: 3,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
    borderRightWidth: 1, borderRightColor: '#1a1a2e',
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  healthCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  healthType: {
    fontFamily: FONT, fontSize: 9, fontWeight: '600', letterSpacing: 1,
  },
  healthDate: {
    fontFamily: FONT, fontSize: 8, color: '#2a2a4a',
  },
  healthText: {
    fontFamily: FONT, fontSize: 9, color: '#5a5a7a', lineHeight: 14,
  },
  tagRow: {
    flexDirection: 'row', gap: 4, marginTop: 6,
  },
  tag: {
    paddingVertical: 2, paddingHorizontal: 6,
    backgroundColor: '#111', borderRadius: 3,
    borderWidth: 1, borderColor: '#1a2a2a',
  },
  tagText: {
    fontFamily: FONT, fontSize: 7, color: '#4a5a5a', letterSpacing: 0.5,
  },

  // ── Knowledge ───────────────────────────────────────────
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  statBox: {
    width: '30%', padding: 10,
    backgroundColor: '#0a0a14', borderRadius: 6,
    borderWidth: 1, borderColor: '#1a1a3a',
    alignItems: 'center',
  },
  statValue: {
    fontFamily: FONT, fontSize: 18, color: '#4db8ff', fontWeight: '700',
  },
  statLabel: {
    fontFamily: FONT, fontSize: 8, color: '#3a3a5a',
    letterSpacing: 1, marginTop: 2,
  },
  insightText: {
    fontFamily: FONT, fontSize: 9, color: '#5a5a7a',
    lineHeight: 14, marginBottom: 6, paddingLeft: 8,
    borderLeftWidth: 2, borderLeftColor: '#4db8ff',
  },

  // ── Deep link ───────────────────────────────────────────
  deepLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, marginTop: 16,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
  },
  deepLinkText: {
    fontFamily: FONT, fontSize: 10, color: '#00ff88', letterSpacing: 1,
  },

  // ── Voice rows ───────────────────────────────────────────
  voiceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: '#0d1a14',
  },
  voiceRowActive: {
    backgroundColor: '#0a1a0a',
  },
  voiceName: {
    fontFamily: FONT, fontSize: 10, color: '#5a5a7a',
  },
  voiceSub: {
    fontFamily: FONT, fontSize: 8, color: '#2a3a2a',
  },
  voiceCatLabel: {
    fontFamily: FONT, fontSize: 9, color: '#3a3a5a',
    letterSpacing: 1, marginTop: 10, marginBottom: 4,
    textTransform: 'uppercase',
  },
  genderBadge: {
    paddingHorizontal: 4, paddingVertical: 1,
    borderWidth: 1, borderRadius: 3,
  },
  genderBadgeText: {
    fontFamily: FONT, fontSize: 7, fontWeight: '600',
  },
  previewBtn: {
    padding: 6,
  },

  // ── Common ──────────────────────────────────────────────
  emptyText: {
    fontFamily: FONT, fontSize: 10, color: '#2a2a4a',
    paddingVertical: 12, fontStyle: 'italic',
  },
});
