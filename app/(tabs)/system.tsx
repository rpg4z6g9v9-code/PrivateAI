/**
 * system.tsx — Operational Visibility Panel
 *
 * Exposes system state: route, model, node health, memory stats,
 * tool execution history, and version.
 *
 * Doctrine: visibility must precede capability.
 * Informational first. Controls only where necessary for infrastructure config.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { checkPrivateNode, PrivateNodeStatus } from '@/services/localAI';
import { getConversationStats } from '@/services/conversationDB';
import { initToolDB, getRecentToolCalls, ToolCall } from '@/services/toolDB';
import {
  webSearch, getBraveApiKey, setBraveApiKey, clearBraveApiKey,
  getWebSearchStatus, type WebSearchStatus, type SearchResult,
} from '@/services/tools/webSearch';

const FONT = 'SpaceMono-Regular';
const VERSION_TAG = 'stable-memory-workspace-v1';
const CLOUD_MODEL = 'claude-sonnet-4-6';
const LOCAL_MODEL = 'phi4-mini';

type ConvStats = { total: number; lastActive: number | null };

function reltime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Tool call entry ────────────────────────────────────────────

function ToolEntry({ call }: { call: ToolCall }) {
  const statusColor =
    call.status === 'completed' ? '#00ff88' :
    call.status === 'failed'    ? '#ff4444' : '#ff9500';

  return (
    <View style={s.toolEntry}>
      <Text style={s.toolName}>{call.tool_name}</Text>
      <Text style={s.toolDetail}>→ {call.input_summary}</Text>
      <Text style={[s.toolDetail, { color: statusColor }]}>→ {call.status}</Text>
      {call.duration_ms != null && (
        <Text style={s.toolDetail}>→ {call.duration_ms}ms</Text>
      )}
      {call.result_summary != null && (
        <Text style={s.toolResult} numberOfLines={1}>
          {call.result_summary}
        </Text>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────

export default function SystemScreen() {
  const [nodeStatus, setNodeStatus]   = useState<PrivateNodeStatus | null>(null);
  const [convStats, setConvStats]     = useState<ConvStats | null>(null);
  const [toolCalls, setToolCalls]     = useState<ToolCall[]>([]);
  const [checkedAt, setCheckedAt]     = useState<number | null>(null);
  const [loading, setLoading]         = useState(true);

  // Search state
  const [searchDraft, setSearchDraft]       = useState('');
  const [searching, setSearching]           = useState(false);
  const [searchResults, setSearchResults]   = useState<SearchResult[] | null>(null);
  const [searchError, setSearchError]       = useState<string | null>(null);

  // API key config
  const [keyDraft, setKeyDraft]       = useState('');
  const [keySaved, setKeySaved]       = useState(false);
  const [webSearchStatus, setWebSearchStatus] = useState<WebSearchStatus>('unavailable');

  const refresh = useCallback(async () => {
    setLoading(true);
    await initToolDB();
    const [node, stats, calls] = await Promise.all([
      checkPrivateNode(),
      getConversationStats(),
      getRecentToolCalls(8),
    ]);
    setNodeStatus(node);
    setConvStats(stats);
    setToolCalls(calls);
    setCheckedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    getBraveApiKey().then(k => {
      setKeyDraft(k ? '••••••••' : '');
      setWebSearchStatus(k ? 'configured' : 'unavailable');
    });
  }, [refresh]);

  const doSearch = useCallback(async () => {
    const q = searchDraft.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchResults(null);
    setSearchError(null);

    const res = await webSearch(q);
    setSearching(false);

    if (res.error) {
      setSearchError(res.error);
    } else {
      setSearchResults(res.results);
    }
    // Sync web.search status and refresh tool history
    setWebSearchStatus(getWebSearchStatus());
    const calls = await getRecentToolCalls(8);
    setToolCalls(calls);
  }, [searchDraft, searching]);

  const saveKey = useCallback(async () => {
    const k = keyDraft.trim();
    if (!k || k === '••••••••') return;
    await setBraveApiKey(k);
    setKeyDraft('••••••••');
    setWebSearchStatus(getWebSearchStatus());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  }, [keyDraft]);

  const clearKey = useCallback(async () => {
    await clearBraveApiKey();
    setKeyDraft('');
    setWebSearchStatus('unavailable');
  }, []);

  const route     = nodeStatus?.online ? 'local' : 'cloud';
  const model     = nodeStatus?.online ? LOCAL_MODEL : CLOUD_MODEL;
  const latency   = nodeStatus?.latency != null ? `${nodeStatus.latency}ms` : '—';
  const nodeLabel = nodeStatus == null ? 'checking...' : nodeStatus.online ? 'online' : 'offline';

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backText}>‹ back</Text>
        </TouchableOpacity>
        <Text style={s.title}>// system</Text>
        <TouchableOpacity onPress={refresh} style={s.refreshBtn} disabled={loading}>
          <Text style={[s.refreshText, loading && s.dim]}>refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Section index — signals scrollable content below the fold */}
      <View style={s.sectionIndex}>
        {['system', 'memory', 'operations', 'recovery', 'configuration'].map((label, i) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {i > 0 && <Text style={s.sectionIndexDot}>·</Text>}
            <Text style={s.sectionIndexLabel}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#333" />}
      >
        {/* System */}
        <Text style={s.sectionLabel}>// system</Text>
        <View style={s.card}>
          <Row label="route"   value={route}      valueColor={nodeStatus?.online ? '#00ff88' : '#4db8ff'} />
          <Row label="model"   value={model} />
          <Row label="node"    value={nodeLabel}   valueColor={nodeStatus?.online ? '#00ff88' : '#ff4444'} />
          <Row label="latency" value={latency} />
          <Row label="host"    value={nodeStatus?.host ?? '—'} />
          {checkedAt && <Row label="checked" value={reltime(checkedAt)} />}
        </View>

        {/* Memory */}
        <Text style={s.sectionLabel}>// memory</Text>
        <View style={s.card}>
          <Row label="conversations" value={convStats != null ? String(convStats.total) : '—'} />
          <Row label="last active"   value={convStats?.lastActive ? reltime(convStats.lastActive) : '—'} />
          <Row label="storage"       value="SQLite · WAL" valueColor="#555" />
          <Row label="db"            value="privateai_v1.db" valueColor="#555" />
        </View>

        {/* Operations */}
        <Text style={s.sectionLabel}>// operations</Text>
        <View style={s.card}>
          <Row
            label="web.search"
            value={webSearchStatus}
            valueColor={
              webSearchStatus === 'operational'  ? '#00ff88' :
              webSearchStatus === 'configured'   ? '#ff9500' :
              webSearchStatus === 'degraded'     ? '#ff4444' :
              webSearchStatus === 'auth_failed'  ? '#cc4488' : '#333'
            }
          />
        </View>

        {/* Search input */}
        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            value={searchDraft}
            onChangeText={setSearchDraft}
            placeholder="web search query"
            placeholderTextColor="#333"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={doSearch}
          />
          <TouchableOpacity
            onPress={doSearch}
            style={[s.searchBtn, (searching || !searchDraft.trim()) && s.searchBtnDim]}
            disabled={searching || !searchDraft.trim()}
          >
            {searching
              ? <ActivityIndicator size="small" color="#555" />
              : <Text style={s.searchBtnText}>search</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Search error */}
        {searchError != null && (
          <View style={s.searchErrorBox}>
            <Text style={s.searchErrorText}>{searchError}</Text>
          </View>
        )}

        {/* Search results */}
        {searchResults != null && searchResults.length > 0 && (
          <View style={s.resultsCard}>
            {searchResults.map((r, i) => (
              <View key={i} style={s.resultEntry}>
                <Text style={s.resultTitle} numberOfLines={1}>{r.title}</Text>
                <Text style={s.resultUrl}   numberOfLines={1}>{r.url}</Text>
                <Text style={s.resultDesc}  numberOfLines={2}>{r.description}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Tool history */}
        <View style={s.card}>
          {toolCalls.length === 0 ? (
            <Row label="tool history" value="no calls yet" valueColor="#333" />
          ) : (
            toolCalls.map(call => <ToolEntry key={call.id} call={call} />)
          )}
        </View>

        {/* Recovery */}
        <Text style={s.sectionLabel}>// recovery</Text>
        <View style={s.card}>
          <Row label="last backup" value="—" valueColor="#333" />
          <Row label="last sync"   value="—" valueColor="#333" />
          <Row label="version"     value={VERSION_TAG} valueColor="#4db8ff" />
        </View>

        {/* Configuration */}
        <Text style={s.sectionLabel}>// configuration</Text>
        <View style={s.card}>
          <View style={s.configRow}>
            <Text style={s.label}>brave api key</Text>
            <View style={s.configInputRow}>
              <TextInput
                style={s.configInput}
                value={keyDraft}
                onChangeText={t => setKeyDraft(t)}
                placeholder="not set"
                placeholderTextColor="#2a2a2a"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <TouchableOpacity onPress={saveKey} style={s.configSaveBtn}>
                <Text style={[s.configSaveText, keySaved && { color: '#00ff88' }]}>
                  {keySaved ? 'saved' : 'save'}
                </Text>
              </TouchableOpacity>
              {(webSearchStatus !== 'unavailable') && (
                <TouchableOpacity onPress={clearKey} style={[
                  s.configClearBtn,
                  webSearchStatus === 'auth_failed' && { borderColor: '#660033' },
                ]}>
                  <Text style={[
                    s.configClearText,
                    webSearchStatus === 'auth_failed' && { color: '#cc4488' },
                  ]}>clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {checkedAt && (
          <Text style={s.timestamp}>last refreshed {fmtTime(checkedAt)}</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Row component ─────────────────────────────────────────────

function Row({
  label,
  value,
  valueColor = '#00ff88',
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080808' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backBtn:     { width: 60 },
  backText:    { fontFamily: FONT, fontSize: 13, color: '#555' },
  title:       { fontFamily: FONT, fontSize: 14, color: '#888', letterSpacing: 2 },
  refreshBtn:  { width: 60, alignItems: 'flex-end' },
  refreshText: { fontFamily: FONT, fontSize: 11, color: '#555', letterSpacing: 1 },
  dim:         { color: '#2a2a2a' },
  scroll:      { flex: 1 },
  content:     { paddingBottom: 60 },

  sectionIndex: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 4,
  },
  sectionIndexLabel: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#2a2a2a',
    letterSpacing: 1.5,
  },
  sectionIndexDot: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#1a1a1a',
    marginRight: 4,
  },

  sectionLabel: {
    fontFamily: FONT,
    fontSize: 10,
    color: '#444',
    letterSpacing: 2,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 10,
  },

  card: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 6,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  label: { fontFamily: FONT, fontSize: 12, color: '#444' },
  value: { fontFamily: FONT, fontSize: 12 },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 6,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderLeftWidth: 1,
    borderLeftColor: '#1a1a1a',
    minWidth: 60,
    alignItems: 'center',
  },
  searchBtnDim: { opacity: 0.4 },
  searchBtnText: { fontFamily: FONT, fontSize: 11, color: '#555', letterSpacing: 1 },

  searchErrorBox: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#330000',
    borderRadius: 6,
  },
  searchErrorText: { fontFamily: FONT, fontSize: 11, color: '#ff4444', lineHeight: 16 },

  resultsCard: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 6,
    overflow: 'hidden',
  },
  resultEntry: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 2,
  },
  resultTitle: { fontFamily: FONT, fontSize: 12, color: '#888' },
  resultUrl:   { fontFamily: FONT, fontSize: 9,  color: '#444', letterSpacing: 0.5 },
  resultDesc:  { fontFamily: FONT, fontSize: 10, color: '#555', lineHeight: 15, marginTop: 2 },

  // Tool history
  toolEntry: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 2,
  },
  toolName:   { fontFamily: FONT, fontSize: 12, color: '#888' },
  toolDetail: { fontFamily: FONT, fontSize: 11, color: '#444' },
  toolResult: { fontFamily: FONT, fontSize: 9,  color: '#333', marginTop: 2, letterSpacing: 0.5 },

  // Configuration
  configRow: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 8,
  },
  configInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  configInput: {
    flex: 1,
    fontFamily: FONT,
    fontSize: 12,
    color: '#666',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  configSaveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 4,
  },
  configSaveText: { fontFamily: FONT, fontSize: 11, color: '#555', letterSpacing: 1 },
  configClearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#330000',
    borderRadius: 4,
  },
  configClearText: { fontFamily: FONT, fontSize: 11, color: '#662222', letterSpacing: 1 },

  timestamp: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#2a2a2a',
    textAlign: 'center',
    marginTop: 32,
    letterSpacing: 1,
  },
});
