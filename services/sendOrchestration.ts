/**
 * sendOrchestration.ts — Security-critical send orchestration.
 *
 * M2: Now uses payload-union classification and interim boundary gate.
 * - Classifies all outbound segments before reasoning egress
 * - Gates web search on sensitivity/protected status
 * - Refuses reasoning entirely if protected data detected (D7)
 * - Constrains reasoning to local-only if sensitive (D1)
 */

import { checkInjection, sanitizeOutput, logSecurityEvent } from '@/services/securityGateway';
import type { DataClassificationResult } from '@/services/securityGateway';
import { routeAI } from '@/services/aiRouter';
import type { AIRouteResult, ConversationMessage } from '@/services/claude';
import { buildReadOnlyMacToolContext } from '@/services/readOnlyTools';
import { webSearch, type SearchResult } from '@/services/tools/webSearch';
import { networkMonitor } from '@/services/networkMonitor';
import { classifyPayload, classifyData, type PayloadClassification, type CredentialFetcher } from '@/services/controlPlane/classifier';
import { gateReasoning, gateSearch } from '@/services/controlPlane/interimBoundaryGate';
import { getSessionId, mintRequestId, mintDecisionId, toConversationRef, toMessageRef } from '@/services/controlPlane/identifiers';
import { ensureReady, appendRecord } from '@/services/controlPlane/recorder';

// ── Search detection (from original index.tsx) ──────────────────

export const SEARCH_PATTERNS = [
  /\bweb search\b/i,
  /\bsearch (for|the web)?\b/i,
  /\blook up\b/i,
  /\bwhat.s (the )?(latest|current|recent|happening|news)\b/i,
  /\b(latest|current|recent) (news|updates?|events?|prices?|weather|info)\b/i,
  /\bwhat (is|are) (happening|going on)\b/i,
  /^web:\s/i,
  /\bwhat.s (the )?(weather|temperature|forecast)\b/i,
  /\b(weather|forecast) (in|for|at)\b/i,
];

export function detectSearchQuery(text: string): string | null {
  if (SEARCH_PATTERNS.some(p => p.test(text))) return text.trim();
  return null;
}

export function formatToolContext(results: SearchResult[], query: string, error?: string): string {
  if (error) return `[web.search failed: ${error}]`;
  if (results.length === 0) return `[web.search: no results for "${query}"]`;
  const items = results
    .map((r, i) => `${i + 1}. Title: ${r.title}\n   URL: ${r.url}\n   Summary: ${r.description}`)
    .join('\n\n');
  return `Web search reference material for answering the user's latest request.

Answering guidance:
Use the search results below to answer directly in 3-5 sentences. Cite source titles when useful. Do not quote or mention these internal headings. Do not expose API keys, credentials, headers, or raw provider payloads. If the results are insufficient, say so.

Actual web.search query:
"${query}"

Search results:
${items}`;
}

// ── Orchestration types ─────────────────────────────────────────

export interface SendOrchestrationParams {
  text: string;
  messages: ConversationMessage[];
  isSensitive: boolean;
  dataClass: DataClassificationResult;
  dataSizeBytes: number;
  safeMode: boolean;
  nodeOnline: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  conversationId?: string;
  messageId?: string;
  route?: string;
  fetchCredential: CredentialFetcher;
}

export interface SendOrchestrationResult {
  reply: string;
  result: AIRouteResult;
  isSensitive: boolean;
  toolContext: string | undefined;
  dataClass: DataClassificationResult;
  payloadClassification: PayloadClassification;
  searchBlocked?: boolean;
  recorderStatus?: 'recorded' | 'degraded';
  reasoningRefused?: boolean;
}

// ── Orchestration ───────────────────────────────────────────────

export async function executeSendOrchestration(
  params: SendOrchestrationParams
): Promise<SendOrchestrationResult> {
  const { text, messages, dataClass, dataSizeBytes,
          safeMode, nodeOnline, onToken, signal, conversationId, route, fetchCredential } = params;

  // ── M3: Mint identifiers and record user_statement ──
  const sessionId = getSessionId();
  const requestId = mintRequestId();
  const messageRef = params.messageId ? toMessageRef(params.messageId) : null;
  const convRef = conversationId ? toConversationRef(conversationId) : null;
  let recorderStatus: 'recorded' | 'degraded' = 'recorded';

  // Await Recorder readiness (shared init, never blocks indefinitely)
  const ready = await ensureReady();
  if (!ready) recorderStatus = 'degraded';

  // Record user_statement (failure → degraded, chat continues)
  const userStmtResult = await appendRecord({
    record_id: requestId,
    record_type: 'user_statement',
    record_kind: 'canonical',
    session_id: sessionId,
    conversation_id: convRef,
    message_id: messageRef,
    request_id: requestId,
    timestamp: Date.now(),
    source: 'send_orchestration',
    payload: JSON.stringify({ text_length: text.length, message_count: messages.length }),
  });
  if (userStmtResult.status === 'degraded') recorderStatus = 'degraded';

  // ── M2: Build tool context (KC-5 preserved: tools execute before authorization) ──
  const toolContextParts: string[] = [];

  const macToolContext = await buildReadOnlyMacToolContext(text);
  if (macToolContext) {
    toolContextParts.push(macToolContext);
  }

  // ── M2: Classify search query + current text BEFORE search execution ──
  const searchQuery = detectSearchQuery(text);
  let searchBlocked = false;

  if (searchQuery) {
    // Pre-classify to gate search
    const preSearchClassification = await classifyPayload({
      currentText: text,
      messages: [],
      searchQuery,
      fetchCredential,
    });
    const searchGate = gateSearch(preSearchClassification);

    if (searchGate.action === 'block_search') {
      searchBlocked = true;
      toolContextParts.push(`[web.search blocked: ${searchGate.reason}]`);
    } else {
      const searchRes = await webSearch(searchQuery, {
        conversationId: conversationId ?? null,
        route: route ?? null,
      });
      toolContextParts.push(formatToolContext(searchRes.results, searchRes.query, searchRes.error));
    }
  }

  let toolContext: string | undefined =
    toolContextParts.length > 0
      ? toolContextParts.join('\n\n')
      : undefined;

  // Screen tool output for injection
  if (toolContext) {
    const toolContextCheck = checkInjection(toolContext);
    if (toolContextCheck.detected) {
      logSecurityEvent('tool_output_injection', 'read-only tool result').catch(() => {});
      toolContext = '[tool results filtered — injection pattern detected]';
    }
  }

  // ── M2: Full payload classification BEFORE reasoning egress ──
  const payloadClassification = await classifyPayload({
    currentText: text,
    messages,
    toolContext,
    fetchCredential,
  });

  const reasoningGate = gateReasoning(payloadClassification);

  // M3: Record interim gate decision (failure → degraded, chat continues)
  // record_kind='interim_gate', record_type=null (NOT a canonical Architecture record)
  const decisionId = mintDecisionId();
  const gateResult = await appendRecord({
    record_id: decisionId,
    record_type: null,
    record_kind: 'interim_gate',
    session_id: sessionId,
    conversation_id: convRef,
    message_id: messageRef,
    request_id: requestId,
    timestamp: Date.now(),
    source: 'interim_boundary_gate',
    payload: JSON.stringify({
      action: reasoningGate.action,
      is_sensitive: payloadClassification.isSensitive,
      is_protected: payloadClassification.isProtected,
      union_classes: payloadClassification.unionClasses,
      search_blocked: searchBlocked,
    }),
  });
  if (gateResult.status === 'degraded') recorderStatus = 'degraded';

  // D7: Protected → refuse entirely, zero engine egress
  if (reasoningGate.action === 'refuse') {
    networkMonitor.logCall({
      destination: 'local_llama',
      url: 'refused',
      dataSizeBytes,
      description: 'Reasoning refused: protected data detected',
      containsMedicalAlert: dataClass.hasMedical,
      safety: 'blocked',
    });
    return {
      reply: reasoningGate.reason,
      result: { text: reasoningGate.reason, route: 'local', model: 'refused', latency: 0 },
      isSensitive: payloadClassification.isSensitive,
      toolContext,
      dataClass,
      payloadClassification,
      reasoningRefused: true,
      recorderStatus,
    };
  }

  // D1: Sensitive → local-only via isSensitive flag to existing router
  const effectiveIsSensitive = reasoningGate.action === 'proceed_local_only'
    ? true
    : payloadClassification.isSensitive || params.isSensitive;

  // Route to AI
  const routeParams = {
    messages,
    isSensitive: effectiveIsSensitive,
    safeMode,
    nodeOnline,
    onToken,
    toolContext,
    signal,
  };
  const result = await routeAI(routeParams);

  const reply = sanitizeOutput(result.text);

  networkMonitor.logCall({
    destination: result.route === 'local' ? 'local_llama' : 'claude_api',
    url: result.route === 'local' ? 'localhost:11434' : 'provider-gateway/claude',
    dataSizeBytes,
    description: `Chat message (${effectiveIsSensitive ? 'sensitive' : 'regular'})`,
    containsMedicalAlert: dataClass.hasMedical,
    safety: 'safe',
  });

  return {
    reply,
    result,
    isSensitive: effectiveIsSensitive,
    toolContext,
    dataClass,
    payloadClassification,
    searchBlocked,
    recorderStatus,
  };
}

// ── Summarize orchestration (M2: same classifier + gate) ────────

export interface SummarizeOrchestrationParams {
  transcript: string;
  safeMode: boolean;
  nodeOnline: boolean;
  fetchCredential: CredentialFetcher;
}

export interface SummarizeOrchestrationResult {
  reply: string;
  result: AIRouteResult;
  payloadClassification: PayloadClassification;
  reasoningRefused?: boolean;
}

export async function executeSummarizeOrchestration(
  params: SummarizeOrchestrationParams
): Promise<SummarizeOrchestrationResult> {
  const { transcript, safeMode, nodeOnline, fetchCredential } = params;

  // Injection check on transcript (M2: summarize now uses injection check)
  const injCheck = checkInjection(transcript);
  if (injCheck.detected) {
    logSecurityEvent('injection_detected', 'summarize_transcript').catch(() => {});
    return {
      reply: 'Summarize blocked: injection pattern detected in conversation.',
      result: { text: '', route: 'local', model: 'refused', latency: 0 },
      payloadClassification: { segments: [], unionClasses: [], isSensitive: false, isProtected: false, protectedSpans: [] },
      reasoningRefused: true,
    };
  }

  // M2: Classify transcript
  const classification = await classifyPayload({
    currentText: 'Summarize the conversation.',
    messages: [],
    summarizeTranscript: transcript,
    fetchCredential,
  });

  const gate = gateReasoning(classification);

  if (gate.action === 'refuse') {
    return {
      reply: gate.reason,
      result: { text: gate.reason, route: 'local', model: 'refused', latency: 0 },
      payloadClassification: classification,
      reasoningRefused: true,
    };
  }

  const isSensitive = gate.action === 'proceed_local_only';
  const toolContext = `Task: summarize the conversation below.\n\nReturn exactly three sections:\nTopics: (main subjects discussed)\nDecisions: (conclusions reached, or "none")\nNext steps: (open items or follow-ups, or "none")\n\nPlain text only. Each section on its own line. No markdown.\n\nConversation:\n${transcript}`;

  const result = await routeAI({
    messages: [{ role: 'user', content: 'Summarize the conversation.' }],
    isSensitive,
    safeMode,
    nodeOnline,
    toolContext,
  });

  const reply = sanitizeOutput(result.text);

  return {
    reply,
    result,
    payloadClassification: classification,
  };
}
