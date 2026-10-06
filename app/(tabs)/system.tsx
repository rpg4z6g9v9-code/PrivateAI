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
import { checkPrivateNode, PrivateNodeStatus, getSelectedModel, setSelectedModel, DEFAULT_LOCAL_MODEL, getResponseMode, setResponseMode, DEFAULT_RESPONSE_MODE, type ResponseMode, getOllamaHost, setOllamaHost, DEFAULT_OLLAMA_HOST } from '@/services/localAI';
import { getConversationStats } from '@/services/conversationDB';
import { initToolDB, getRecentToolCalls, ToolCall } from '@/services/toolDB';
import {
  webSearch, getBraveApiKey, setBraveApiKey, clearBraveApiKey,
  getWebSearchStatus, type WebSearchStatus, type SearchResult,
} from '@/services/tools/webSearch';
import {
  getProviderGatewayBase,
  setProviderGatewayBase,
  getProviderGatewayToken,
  setProviderGatewayToken,
  clearProviderGatewayToken,
} from '@/services/providerGateway';
import { migrateBraveKey } from '@/services/controlPlane/braveKeyMigration';
import {
  getTrustedHosts,
  declareTrustedHost,
  revokeTrustedHost,
} from '@/services/controlPlane/trustedHosts';
import type { TrustedHostConfig } from '@/services/controlPlane/types';
import { classifyPayload, type CredentialFetcher } from '@/services/controlPlane/classifier';
import { gateSearch } from '@/services/controlPlane/interimBoundaryGate';
import { mintRequestId } from '@/services/controlPlane/identifiers';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FONT = 'SpaceMono-Regular';
const VERSION_TAG = 'stable-websearch-gateway-v2';
const CLOUD_MODEL = 'claude-sonnet-4-6';

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
      <Text style={s.toolDetail}>→ {call.input_summary.length > 80 ? call.input_summary.slice(0, 80) + '…' : call.input_summary}</Text>
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

  // Model selection
  const [selectedModel, setSelectedModelState] = useState(DEFAULT_LOCAL_MODEL);

  // Response mode
  const [responseMode, setResponseModeState] = useState<ResponseMode>(DEFAULT_RESPONSE_MODE);

  // Ollama host config
  const [hostDraft, setHostDraft] = useState('');
  const [hostSaved, setHostSaved] = useState(false);

  // Provider gateway config
  const [gatewayBaseDraft, setGatewayBaseDraft] = useState('');
  const [gatewayBaseSaved, setGatewayBaseSaved] = useState(false);
  const [gatewayTokenDraft, setGatewayTokenDraft] = useState('');
  const [gatewayTokenSaved, setGatewayTokenSaved] = useState(false);
  const [gatewayTokenConfigured, setGatewayTokenConfigured] = useState(false);

  // D5: Trusted-host configuration state
  const [trustedHosts, setTrustedHosts] = useState<TrustedHostConfig[]>([]);
  const [trustedHostDeclared, setTrustedHostDeclared] = useState(false);

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
      const live = getWebSearchStatus();
      setWebSearchStatus(live !== 'unavailable' ? live : k ? 'configured' : 'unavailable');
    });
    getSelectedModel().then(setSelectedModelState);
    getResponseMode().then(setResponseModeState);
    getOllamaHost().then(setHostDraft);

    getProviderGatewayBase().then(setGatewayBaseDraft);
    getProviderGatewayToken().then(token => {
      setGatewayTokenConfigured(token.length > 0);
    });

    // D4: Run Brave key migration on Settings open (idempotent)
    migrateBraveKey().catch(() => {});

    // D5: Load trusted-host declarations
    getTrustedHosts().then(setTrustedHosts);
  }, [refresh]);

  const doSearch = useCallback(async () => {
    const q = searchDraft.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchResults(null);
    setSearchError(null);

    // L6: mint requestId at the diagnostic-search user-action boundary.
    const requestId = mintRequestId();
    const fetchCred: CredentialFetcher = async (storageType, key) => {
      if (storageType === 'async') return AsyncStorage.getItem(key);
      const secureStorage = (await import('@/services/secureStorage')).default;
      return secureStorage.getItem(key);
    };
    // L2: classify actual search text via M2; never default to ['public'].
    const classification = await classifyPayload({ currentText: q, messages: [], fetchCredential: fetchCred });

    // M2: gate search on sensitivity/protected status — use existing M2 interim boundary gate.
    const searchGate = gateSearch(classification);
    setSearching(false);

    if (searchGate.action === 'block_search') {
      setSearchError(searchGate.reason);
      return;
    }

    const res = await webSearch(q, { requestId, dataClasses: classification.unionClasses });

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
    const result = await setBraveApiKey(k);
    setWebSearchStatus(getWebSearchStatus());
    if (result.stored) {
      // Key is securely stored — safe to mask the entered draft
      setKeyDraft('••••••••');
      if (result.legacyRemoved) {
        // Full success: key written and legacy cleaned up
        setKeySaved(true);
        setTimeout(() => setKeySaved(false), 2000);
      }
      // stored=true, legacyRemoved=false: key usable, cleanup incomplete — no full-success flash
    }
    // stored=false: write failed — leave draft visible for retry, no success indication
    // status already reflects actual availability (old key if present, or unavailable)
  }, [keyDraft]);

  const clearKey = useCallback(async () => {
    const result = await clearBraveApiKey();
    setWebSearchStatus(getWebSearchStatus());
    if (result.secureCleared && result.legacyCleared) {
      setKeyDraft('');
    }
    // Partial clear: credential may remain — status already reflects actual availability
  }, []);

  const saveHost = useCallback(async () => {
    const trimmed = hostDraft.trim();
    if (!trimmed) {
      // Don't persist an empty value — fall back to whatever's already
      // effective (a previously saved host, or the default).
      const current = await getOllamaHost();
      setHostDraft(current);
      return;
    }
    await setOllamaHost(trimmed);
    setHostDraft(trimmed);
    setHostSaved(true);
    setTimeout(() => setHostSaved(false), 2000);

    // Refresh status immediately rather than waiting for the next natural check.
    setLoading(true);
    const node = await checkPrivateNode();
    setNodeStatus(node);
    setCheckedAt(Date.now());
    setLoading(false);
  }, [hostDraft]);

  const saveGatewayBase = useCallback(async () => {
    const trimmed = gatewayBaseDraft.trim();

    if (!trimmed) {
      const current = await getProviderGatewayBase();
      setGatewayBaseDraft(current);
      return;
    }

    try {
      await setProviderGatewayBase(trimmed);
      const normalized = await getProviderGatewayBase();
      setGatewayBaseDraft(normalized);
      setGatewayBaseSaved(true);
      setTimeout(() => setGatewayBaseSaved(false), 2000);
    } catch (error) {
      console.warn('[Gateway] save URL failed:', error);
    }
  }, [gatewayBaseDraft]);

  const saveGatewayToken = useCallback(async () => {
    const trimmed = gatewayTokenDraft.trim();
    if (!trimmed) return;

    await setProviderGatewayToken(trimmed);
    setGatewayTokenDraft('');
    setGatewayTokenConfigured(true);
    setGatewayTokenSaved(true);
    setTimeout(() => setGatewayTokenSaved(false), 2000);
  }, [gatewayTokenDraft]);

  const clearGatewayToken = useCallback(async () => {
    await clearProviderGatewayToken();
    setGatewayTokenDraft('');
    setGatewayTokenConfigured(false);
    setGatewayTokenSaved(false);
  }, []);

  // D5: Declare configured gateway base as PRIVATE_LAN
  const declareGatewayPrivateLan = useCallback(async () => {
    const host = gatewayBaseDraft.trim();
    if (!host) return;
    // Strip protocol for the host record
    const bare = host.replace(/^https?:\/\//, '');
    await declareTrustedHost(
      bare,
      'User declared this provider gateway host as a PRIVATE_LAN boundary. This declares the network boundary only — it does not authorize capability use.',
    );
    const updated = await getTrustedHosts();
    setTrustedHosts(updated);
    setTrustedHostDeclared(true);
    setTimeout(() => setTrustedHostDeclared(false), 2500);
  }, [gatewayBaseDraft]);

  const revokeHost = useCallback(async (id: string) => {
    await revokeTrustedHost(id);
    setTrustedHosts(await getTrustedHosts());
  }, []);

  const route          = nodeStatus?.online ? 'local' : 'cloud';
  const activeModel    = nodeStatus?.online ? selectedModel.replace(/:latest$/, '') : CLOUD_MODEL;
  const latency        = nodeStatus?.latency != null ? `${nodeStatus.latency}ms` : '—';
  const nodeLabel      = nodeStatus == null ? 'checking...' : nodeStatus.online ? 'online' : 'offline';
  const availableModels = (nodeStatus?.models ?? []).filter(m => !m.includes('embed'));
  const modelMissing   = nodeStatus?.online && availableModels.length > 0 && !availableModels.includes(selectedModel);

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
          <Row label="model"   value={activeModel} valueColor={modelMissing ? '#ff9500' : '#00ff88'} />
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
          {/* Model picker */}
          <View style={s.configRow}>
            <Text style={s.label}>local model</Text>
            {modelMissing && (
              <Text style={s.modelWarning}>selected model not available on node — using fallback</Text>
            )}
            {availableModels.length === 0 ? (
              <Text style={[s.value, { color: '#333' }]}>node offline</Text>
            ) : (
              <View style={s.modelList}>
                {availableModels.map(m => {
                  const isSelected = m === selectedModel;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[s.modelItem, isSelected && s.modelItemSelected]}
                      onPress={async () => {
                        await setSelectedModel(m);
                        setSelectedModelState(m);
                      }}
                    >
                      <Text style={[s.modelItemText, isSelected && s.modelItemTextSelected]}>
                        {m.replace(/:latest$/, '')}
                      </Text>
                      {isSelected && <Text style={s.modelItemCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
          {/* Response mode picker */}
          <View style={s.configRow}>
            <Text style={s.label}>response mode</Text>
            <View style={s.modelList}>
              {(['concise', 'balanced', 'deep'] as ResponseMode[]).map(mode => {
                const isSelected = mode === responseMode;
                const desc = mode === 'concise' ? '1–3 sentences' : mode === 'deep' ? 'full detail' : 'default';
                return (
                  <TouchableOpacity
                    key={mode}
                    style={[s.modelItem, isSelected && s.modelItemSelected]}
                    onPress={async () => {
                      await setResponseMode(mode);
                      setResponseModeState(mode);
                    }}
                  >
                    <Text style={[s.modelItemText, isSelected && s.modelItemTextSelected]}>
                      {mode}
                      <Text style={[s.modelItemText, { color: '#333' }]}>  {desc}</Text>
                    </Text>
                    {isSelected && <Text style={s.modelItemCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View style={s.configRow}>
            <Text style={s.label}>ollama host</Text>
            <View style={s.configInputRow}>
              <TextInput
                style={s.configInput}
                value={hostDraft}
                onChangeText={setHostDraft}
                placeholder={DEFAULT_OLLAMA_HOST}
                placeholderTextColor="#2a2a2a"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={saveHost}
              />
              <TouchableOpacity onPress={saveHost} style={s.configSaveBtn}>
                <Text style={[s.configSaveText, hostSaved && { color: '#00ff88' }]}>
                  {hostSaved ? 'saved' : 'save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={s.configRow}>
            <Text style={s.label}>gateway url</Text>
            <View style={s.configInputRow}>
              <TextInput
                style={s.configInput}
                value={gatewayBaseDraft}
                onChangeText={setGatewayBaseDraft}
                placeholder="http://127.0.0.1:8787"
                placeholderTextColor="#2a2a2a"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={saveGatewayBase}
              />
              <TouchableOpacity
                onPress={saveGatewayBase}
                style={s.configSaveBtn}
              >
                <Text
                  style={[
                    s.configSaveText,
                    gatewayBaseSaved && { color: '#00ff88' },
                  ]}
                >
                  {gatewayBaseSaved ? 'saved' : 'save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.configRow}>
            <Text style={s.label}>gateway token</Text>
            <View style={s.configInputRow}>
              <TextInput
                style={s.configInput}
                value={gatewayTokenDraft}
                onChangeText={setGatewayTokenDraft}
                placeholder={
                  gatewayTokenConfigured
                    ? 'stored securely'
                    : 'not set'
                }
                placeholderTextColor="#2a2a2a"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={saveGatewayToken}
              />
              <TouchableOpacity
                onPress={saveGatewayToken}
                style={s.configSaveBtn}
              >
                <Text
                  style={[
                    s.configSaveText,
                    gatewayTokenSaved && { color: '#00ff88' },
                  ]}
                >
                  {gatewayTokenSaved ? 'saved' : 'save'}
                </Text>
              </TouchableOpacity>

              {gatewayTokenConfigured && (
                <TouchableOpacity
                  onPress={clearGatewayToken}
                  style={s.configClearBtn}
                >
                  <Text style={s.configClearText}>clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

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

        {/* D5: Trusted-Host Boundary Declarations */}
        <Text style={s.sectionLabel}>// boundary declarations (D5)</Text>
        <View style={s.card}>
          <View style={s.configRow}>
            <Text style={s.label}>
              Declare the network boundary for a host. This states the boundary only — it does not authorize capability use.
              {'\n'}192.168.4.0/24 is automatically PRIVATE_LAN (architecture rule).
            </Text>
          </View>

          {trustedHosts.map(th => (
            <View key={th.id} style={s.configRow}>
              <Text style={s.label}>{th.host}</Text>
              <View style={s.configInputRow}>
                <Text style={[s.label, { color: '#00ff88', flex: 1 }]}>
                  {th.declared_boundary} (user declaration)
                </Text>
                <TouchableOpacity onPress={() => revokeHost(th.id)} style={s.configClearBtn}>
                  <Text style={s.configClearText}>revoke</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View style={s.configRow}>
            <Text style={s.label}>declare gateway host as PRIVATE_LAN</Text>
            <View style={s.configInputRow}>
              <Text style={[s.label, { flex: 1, color: '#888' }]} numberOfLines={1}>
                {gatewayBaseDraft.replace(/^https?:\/\//, '') || '(set gateway base above)'}
              </Text>
              <TouchableOpacity onPress={declareGatewayPrivateLan} style={s.configSaveBtn}>
                <Text style={[s.configSaveText, trustedHostDeclared && { color: '#00ff88' }]}>
                  {trustedHostDeclared ? 'declared' : 'declare'}
                </Text>
              </TouchableOpacity>
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

  modelWarning: { fontFamily: FONT, fontSize: 10, color: '#ff9500', marginBottom: 6, lineHeight: 15 },
  modelList: { gap: 4 },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 4,
  },
  modelItemSelected: { borderColor: '#00ff88', backgroundColor: 'rgba(0,255,136,0.04)' },
  modelItemText:         { fontFamily: FONT, fontSize: 12, color: '#444' },
  modelItemTextSelected: { color: '#00ff88' },
  modelItemCheck:        { fontFamily: FONT, fontSize: 11, color: '#00ff88' },

  timestamp: {
    fontFamily: FONT,
    fontSize: 9,
    color: '#2a2a2a',
    textAlign: 'center',
    marginTop: 32,
    letterSpacing: 1,
  },
});
