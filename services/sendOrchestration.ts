/**
 * sendOrchestration.ts — VERBATIM extraction of the security-critical
 * send orchestration from app/(tabs)/index.tsx sendMessageWithText.
 *
 * Extracted for M0 testability. Preserves exact call ordering including
 * known conflicts (KC-1 through KC-5). No semantic changes.
 */

import { checkInjection, sanitizeOutput, logSecurityEvent } from '@/services/securityGateway';
import type { DataClassificationResult } from '@/services/securityGateway';
import { routeAI } from '@/services/aiRouter';
import type { AIRouteResult, ConversationMessage } from '@/services/claude';
import { buildReadOnlyMacToolContext } from '@/services/readOnlyTools';
import { webSearch, type SearchResult } from '@/services/tools/webSearch';
import { networkMonitor } from '@/services/networkMonitor';

// ── VERBATIM from app/(tabs)/index.tsx lines 77–112 ─────────────

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

/** Returns query string if message contains search intent, null otherwise. */
export function detectSearchQuery(text: string): string | null {
  if (SEARCH_PATTERNS.some(p => p.test(text))) return text.trim();
  return null;
}

/** Format search results as a structured context block for the system prompt. */
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
  route?: string;
}

export interface SendOrchestrationResult {
  reply: string;
  result: AIRouteResult;
  isSensitive: boolean;
  toolContext: string | undefined;
  dataClass: DataClassificationResult;
}

// ── VERBATIM orchestration from sendMessageWithText ──────────────

export async function executeSendOrchestration(
  params: SendOrchestrationParams
): Promise<SendOrchestrationResult> {
  const { text, messages, isSensitive, dataClass, dataSizeBytes,
          safeMode, nodeOnline, onToken, signal, conversationId, route } = params;

  // Deterministic Tier-0 read-only Mac tools.
  const toolContextParts: string[] = [];

  const macToolContext = await buildReadOnlyMacToolContext(text);
  if (macToolContext) {
    toolContextParts.push(macToolContext);
  }

  // Web search remains separate and read-only.
  const searchQuery = detectSearchQuery(text);
  if (searchQuery) {
    const searchRes = await webSearch(searchQuery, {
      conversationId: conversationId ?? null,
      route: route ?? null,
    });

    toolContextParts.push(
      formatToolContext(
        searchRes.results,
        searchRes.query,
        searchRes.error
      )
    );
  }

  let toolContext: string | undefined =
    toolContextParts.length > 0
      ? toolContextParts.join('\n\n')
      : undefined;

  // Screen all tool output before it enters the model prompt.
  if (toolContext) {
    const toolContextCheck = checkInjection(toolContext);

    if (toolContextCheck.detected) {
      logSecurityEvent(
        'tool_output_injection',
        'read-only tool result'
      ).catch(() => {});

      toolContext =
        '[tool results filtered — injection pattern detected]';
    }
  }

  // Route to AI
  const routeParams = {
    messages,
    isSensitive,
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
    description: `Chat message (${isSensitive ? 'sensitive' : 'regular'})`,
    containsMedicalAlert: dataClass.hasMedical,
    safety: 'safe',
  });

  return {
    reply,
    result,
    isSensitive,
    toolContext,
    dataClass,
  };
}
