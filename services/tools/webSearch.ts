/**
 * webSearch.ts — web.search tool executor
 *
 * Tier 0: read-only, auto-approved.
 * Uses Brave Search API. Requires an API key stored in AsyncStorage.
 * Every call is logged to toolDB regardless of outcome.
 *
 * Failure modes handled:
 *   - No API key configured → unavailable, fails gracefully
 *   - 401/403 HTTP            → auth_failed (key invalid or revoked)
 *   - 429 HTTP                → degraded (quota exceeded, temporary)
 *   - Other HTTP error        → degraded (server/network, temporary)
 *   - Network timeout (10s)   → degraded
 *   - Parse error             → degraded
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { initToolDB, logToolStart, logToolComplete, logToolFail } from '../toolDB';

const API_KEY_STORAGE = 'brave_search_api_key_v1';
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const TIMEOUT_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────

export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  duration_ms: number;
  callId: string;
  error?: string;
};

/**
 * WebSearchStatus — single source of truth for web.search capability.
 *
 * unavailable:  no Brave key stored
 * configured:   key stored, not yet tested this session
 * operational:  last search succeeded
 * degraded:     last search failed (network/timeout/server — temporary, retryable)
 * auth_failed:  last search returned 401/403 (key invalid or revoked — needs reconfiguration)
 */
export type WebSearchStatus = 'unavailable' | 'configured' | 'operational' | 'degraded' | 'auth_failed';

// Session-level status. Persists in memory for the lifetime of the app process.
let _sessionStatus: WebSearchStatus = 'unavailable';

export function getWebSearchStatus(): WebSearchStatus {
  return _sessionStatus;
}

export function updateWebSearchStatus(status: WebSearchStatus): void {
  _sessionStatus = status;
}

// ── API key management ────────────────────────────────────────

export async function getBraveApiKey(): Promise<string> {
  return (await AsyncStorage.getItem(API_KEY_STORAGE)) ?? '';
}

export async function setBraveApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(API_KEY_STORAGE, key.trim());
  _sessionStatus = key.trim().length > 0 ? 'configured' : 'unavailable';
}

export async function clearBraveApiKey(): Promise<void> {
  await AsyncStorage.removeItem(API_KEY_STORAGE);
  _sessionStatus = 'unavailable';
}

// ── Executor ──────────────────────────────────────────────────

export async function webSearch(
  query: string,
  opts: {
    conversationId?: string | null;
    model?: string | null;
    route?: string | null;
  } = {}
): Promise<SearchResponse> {
  await initToolDB();

  const callId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const inputSummary = `query: "${query.trim()}"`;
  const start = Date.now();

  await logToolStart({
    id: callId,
    tool_name: 'web.search',
    input_summary: inputSummary,
    conversation_id: opts.conversationId ?? null,
    model: opts.model ?? null,
    route: opts.route ?? null,
  });

  const apiKey = await getBraveApiKey();
  if (!apiKey) {
    _sessionStatus = 'unavailable';
    const msg = 'no API key configured';
    await logToolFail(callId, msg);
    return {
      query,
      results: [],
      duration_ms: Date.now() - start,
      callId,
      error: 'web.search: no API key — add Brave Search key in System > configuration',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query.trim())}&count=5`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const isAuth = response.status === 401 || response.status === 403;
      const label = isAuth
        ? `auth_failed (HTTP ${response.status})`
        : `HTTP ${response.status}`;
      console.error('[web.search] Request failed:', label, body.slice(0, 200));
      await logToolFail(callId, label);
      _sessionStatus = isAuth ? 'auth_failed' : 'degraded';
      return {
        query, results: [], duration_ms: Date.now() - start, callId,
        error: isAuth
          ? `web.search: key invalid or revoked (HTTP ${response.status}) — check System > configuration`
          : `web.search: ${label}`,
      };
    }

    const json = await response.json();
    const results: SearchResult[] = (json.web?.results ?? [])
      .slice(0, 5)
      .map((r: Record<string, unknown>) => ({
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        description: String(r.description ?? ''),
      }));

    const resultSummary = `${results.length} result${results.length !== 1 ? 's' : ''} · "${query.trim()}"`;
    await logToolComplete(callId, resultSummary);
    _sessionStatus = 'operational';

    return { query, results, duration_ms: Date.now() - start, callId };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes('abort');
    const label = isTimeout ? 'timeout' : `network error: ${msg}`;
    console.error('[web.search] Execution error:', label);
    await logToolFail(callId, label);
    _sessionStatus = 'degraded';
    return {
      query,
      results: [],
      duration_ms: Date.now() - start,
      callId,
      error: `web.search: ${label}`,
    };
  }
}
