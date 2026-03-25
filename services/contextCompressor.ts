/**
 * contextCompressor.ts — PrivateAI Context Compression
 *
 * Reduces Claude token usage on long conversations by:
 *   1. Keeping only the last N messages verbatim (recent context)
 *   2. Summarising everything before that into a compact string
 *      which is injected into the system prompt (not as a message)
 *
 * The summary is injected into the system prompt rather than as a
 * fake message object to avoid breaking Claude's user/assistant
 * role alternation requirement.
 *
 * Compression only activates when history length exceeds
 * MIN_MESSAGES_TO_COMPRESS (configured in aiRouter.ts).
 */

import type { ConversationMessage } from './claude';

// ── Types ─────────────────────────────────────────────────────

export interface CompressionResult {
  /** Compact text summary of the older conversation. Empty if no compression. */
  summary: string;
  /** The recent N messages to send verbatim to Claude. */
  compressedMessages: ConversationMessage[];
  /** Estimated token count of original history. */
  totalOriginalTokens: number;
  /** Estimated token count after compression. */
  compressedTokens: number;
}

export interface CompressionMetrics {
  originalTokens:   number;
  compressedTokens: number;
  reductionPct:     number;
  messagesDropped:  number;
  active:           boolean; // false if conversation was too short to compress
}

// ── Module-level metrics (read by Control Room) ────────────────

let _lastMetrics: CompressionMetrics = {
  originalTokens:   0,
  compressedTokens: 0,
  reductionPct:     0,
  messagesDropped:  0,
  active:           false,
};

/** Returns the metrics from the most recent compress call. */
export function getLastCompressionMetrics(): CompressionMetrics {
  return _lastMetrics;
}

// ── Main API ──────────────────────────────────────────────────

/**
 * Compress conversation history.
 * Pass `options.history` (without the current user message) from aiRouter.
 *
 * @param messages   Past messages — do NOT include the current user turn.
 * @param keepRecent Number of recent messages to keep verbatim (default 6).
 */
export async function compressConversationHistory(
  messages: ConversationMessage[],
  keepRecent = 6,
): Promise<CompressionResult> {
  const totalOriginalTokens = estimateTokens(messages);

  // Not enough history to compress
  if (messages.length <= keepRecent + 2) {
    _lastMetrics = {
      originalTokens:   totalOriginalTokens,
      compressedTokens: totalOriginalTokens,
      reductionPct:     0,
      messagesDropped:  0,
      active:           false,
    };
    return {
      summary: '',
      compressedMessages: messages,
      totalOriginalTokens,
      compressedTokens: totalOriginalTokens,
    };
  }

  const recentMessages = messages.slice(-keepRecent);
  const oldMessages    = messages.slice(0, -keepRecent);

  const summary = buildSummary(oldMessages);

  // Token estimate for compressed output: recent messages + summary text
  const compressedTokens =
    estimateTokens(recentMessages) + Math.ceil(summary.length / 4);

  _lastMetrics = {
    originalTokens:   totalOriginalTokens,
    compressedTokens,
    reductionPct:     totalOriginalTokens > 0
      ? Math.round((1 - compressedTokens / totalOriginalTokens) * 100)
      : 0,
    messagesDropped:  oldMessages.length,
    active:           true,
  };

  console.log('[contextCompressor]', {
    originalTokens:  totalOriginalTokens,
    compressedTokens,
    reduction:       `${_lastMetrics.reductionPct}%`,
    dropped:         oldMessages.length,
    kept:            recentMessages.length,
  });

  return {
    summary,
    compressedMessages: recentMessages,
    totalOriginalTokens,
    compressedTokens,
  };
}

// ── Summary builder ───────────────────────────────────────────

function buildSummary(messages: ConversationMessage[]): string {
  const topics    = extractTopics(messages);
  const decisions = extractDecisions(messages);
  const context   = extractLastAssistantSnippet(messages);

  const parts: string[] = [];
  if (topics.length > 0)    parts.push(`Topics: ${topics.join(', ')}`);
  if (decisions.length > 0) parts.push(`Key decisions: ${decisions.join('; ')}`);
  if (context)              parts.push(`Last context: ${context}`);

  return parts.join('. ');
}

// ── Extraction helpers ────────────────────────────────────────

const TOPIC_KEYWORDS = [
  'router', 'architecture', 'design', 'memory', 'vault', 'privacy',
  'performance', 'optimization', 'security', 'PrivateAI', 'claude',
  'llama', 'compression', 'knowledge', 'persona', 'tool', 'api',
  'search', 'medical', 'data', 'sprint',
];

function extractTopics(messages: ConversationMessage[]): string[] {
  const allText = messages.map(m => m.content).join(' ').toLowerCase();
  return TOPIC_KEYWORDS.filter(kw => allText.includes(kw.toLowerCase()));
}

const DECISION_MARKERS = ['decided', 'will ', 'should ', 'chosen', 'moving to', "let's use"];

function extractDecisions(messages: ConversationMessage[]): string[] {
  const decisions: string[] = [];

  for (const msg of messages) {
    for (const marker of DECISION_MARKERS) {
      if (!msg.content.toLowerCase().includes(marker)) continue;
      const sentences = msg.content.split('.');
      const hit = sentences.find(s => s.toLowerCase().includes(marker));
      if (hit) {
        const trimmed = hit.trim().slice(0, 120);
        if (trimmed && !decisions.includes(trimmed)) decisions.push(trimmed);
      }
    }
    if (decisions.length >= 3) break;
  }

  return decisions.slice(0, 3);
}

function extractLastAssistantSnippet(messages: ConversationMessage[]): string {
  const last = [...messages].reverse().find(m => m.role === 'assistant');
  if (!last) return '';
  return last.content.slice(0, 150).trimEnd() + (last.content.length > 150 ? '…' : '');
}

// ── Token estimator ───────────────────────────────────────────

function estimateTokens(messages: ConversationMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}
