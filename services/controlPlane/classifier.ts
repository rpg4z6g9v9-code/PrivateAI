/**
 * Control Plane V1 — Classifier (M2)
 *
 * Extends the existing production classifyData + checkInjection with:
 * - payload-segment provenance (current_text, history, tool_context, search_query, summarize_transcript)
 * - protected-data detection (credential patterns + stored credential matching)
 * - payload-union classification across all outbound segments
 *
 * Uses M1 DataClass vocabulary: public, internal, medical, financial, pii, protected
 *
 * Does NOT import runtime modules except securityGateway (existing classifier).
 * Does NOT persist anything. Does NOT create authorization records.
 */

import { classifyData, checkInjection } from '@/services/securityGateway';
import type { DataClassificationResult, InjectionCheckResult } from '@/services/securityGateway';
import type { DataClass } from '@/services/controlPlane/types';
import type { ConversationMessage } from '@/services/claude';

// ── Payload Segments ────────────────────────────────────────────

export type PayloadSegmentType =
  | 'current_text'
  | 'history'
  | 'tool_context'
  | 'search_query'
  | 'summarize_transcript';

export interface ProtectedSpan {
  segment: PayloadSegmentType;
  index?: number;
  detector: string;
  offset: number;
  length: number;
}

export interface SegmentClassification {
  segment: PayloadSegmentType;
  index?: number;
  classes: DataClass[];
  protectedSpans: ProtectedSpan[];
}

export interface PayloadClassification {
  segments: SegmentClassification[];
  unionClasses: DataClass[];
  isSensitive: boolean;
  isProtected: boolean;
  protectedSpans: ProtectedSpan[];
}

// ── Protected Detection ─────────────────────────────────────────

const PROTECTED_PATTERNS: Array<{ pattern: RegExp; detector: string }> = [
  // API key prefixes
  { pattern: /sk-ant-api\w{2}-[A-Za-z0-9_-]{20,}/g, detector: 'anthropic_api_key' },
  { pattern: /sk-[A-Za-z0-9]{20,}/g, detector: 'openai_api_key' },
  { pattern: /sk_[a-f0-9]{40,}/g, detector: 'stripe_key' },
  { pattern: /tvly-[A-Za-z0-9_-]{20,}/g, detector: 'tavily_key' },
  { pattern: /BSA[A-Za-z0-9_-]{10,}/g, detector: 'brave_key' },
  { pattern: /ghp_[A-Za-z0-9]{36,}/g, detector: 'github_pat' },
  { pattern: /gho_[A-Za-z0-9]{36,}/g, detector: 'github_oauth' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, detector: 'github_fine_pat' },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/g, detector: 'bearer_token' },
  // Password assignments
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi, detector: 'password_assignment' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*[^\s'"]{8,}/gi, detector: 'password_value' },
  // NOTE: Private key blocks handled separately via scanPrivateKeys() due to complexity of overlapping BEGIN/END
];

// Stored credential keys the app uses (key names only, never values).
// Values are fetched at classification time and compared by equality.
const APP_CREDENTIAL_KEYS = [
  { storageType: 'async' as const, key: 'brave_search_api_key_v1', detector: 'app_brave_key' },
  { storageType: 'secure' as const, key: 'providerGatewayToken_v1', detector: 'app_gateway_token' },
];

export type CredentialFetcher = (storageType: 'async' | 'secure', key: string) => Promise<string | null>;

// Scan for private key blocks: well-formed complete blocks and incomplete/truncated markers
// Uses explicit parsing instead of regex to correctly handle overlapping BEGIN/END markers
function scanPrivateKeys(text: string, segment: PayloadSegmentType, index?: number): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  const beginRegex = /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g;

  let beginMatch: RegExpExecArray | null;
  while ((beginMatch = beginRegex.exec(text)) !== null) {
    const beginOffset = beginMatch.index;
    const beginLength = beginMatch[0].length;
    const keyType = beginMatch[1]; // Captured group: "RSA ", "EC ", etc., or undefined for plain PRIVATE KEY

    // Look for the matching END marker
    const searchStart = beginOffset + beginLength;
    const endPattern = new RegExp(`-----END ${keyType ?? ''}PRIVATE KEY-----`);
    const remainingFromBegin = text.substring(searchStart);

    // Find both the next END (of any type) and next BEGIN
    const nextEndMatch = remainingFromBegin.match(endPattern);
    const nextBeginMatch = remainingFromBegin.match(/-----BEGIN /);

    // Check if END found before BEGIN (well-formed complete block)
    const endIndex = nextEndMatch?.index ?? -1;
    const beginIndex = nextBeginMatch?.index ?? -1;

    if (endIndex >= 0 && (beginIndex < 0 || endIndex < beginIndex)) {
      // Found matching END before any new BEGIN — well-formed complete block
      const endOffset = searchStart + endIndex;
      const endLength = nextEndMatch![0].length;
      const spanLength = endOffset - beginOffset + endLength;

      spans.push({
        segment,
        index,
        detector: 'private_key_block',
        offset: beginOffset,
        length: spanLength,
      });
    } else {
      // No matching END before next BEGIN (or no END at all) — incomplete/truncated
      spans.push({
        segment,
        index,
        detector: 'private_key_incomplete',
        offset: beginOffset,
        length: beginLength,
      });
    }
  }

  return spans;
}

function detectProtectedPatterns(text: string, segment: PayloadSegmentType, index?: number): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];

  // Scan for private keys using explicit parser (handles overlapping BEGIN/END)
  spans.push(...scanPrivateKeys(text, segment, index));

  // Scan for other patterns using regex
  for (const { pattern, detector } of PROTECTED_PATTERNS) {
    // Reset regex state for global patterns
    const rx = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      spans.push({ segment, index, detector, offset: match.index, length: match[0].length });
    }
  }

  return spans;
}

async function detectStoredCredentials(
  text: string,
  segment: PayloadSegmentType,
  fetchCredential: CredentialFetcher,
  index?: number,
): Promise<ProtectedSpan[]> {
  const spans: ProtectedSpan[] = [];
  for (const { storageType, key, detector } of APP_CREDENTIAL_KEYS) {
    const value = await fetchCredential(storageType, key);
    if (value && value.length > 0 && text.includes(value)) {
      // Literal repeated indexOf: find ALL occurrences without regex interpretation
      let start = 0;
      while (true) {
        const idx = text.indexOf(value, start);
        if (idx < 0) break;
        spans.push({ segment, index, detector, offset: idx, length: value.length });
        start = idx + value.length;
      }
    }
  }
  return spans;
}

// ── Segment Classification ──────────────────────────────────────

function classifySegmentSync(
  text: string,
  segment: PayloadSegmentType,
  index?: number,
): SegmentClassification {
  const existing = classifyData(text);
  const classes: DataClass[] = [];

  if (existing.hasMedical) classes.push('medical');
  if (existing.hasFinancial) classes.push('financial');
  if (existing.hasPII) classes.push('pii');

  const protectedSpans = detectProtectedPatterns(text, segment, index);
  if (protectedSpans.length > 0) classes.push('protected');

  if (classes.length === 0) classes.push('public');

  return { segment, index, classes, protectedSpans };
}

async function classifySegment(
  text: string,
  segment: PayloadSegmentType,
  fetchCredential: CredentialFetcher,
  index?: number,
): Promise<SegmentClassification> {
  const result = classifySegmentSync(text, segment, index);

  const storedSpans = await detectStoredCredentials(text, segment, fetchCredential, index);
  if (storedSpans.length > 0) {
    result.protectedSpans.push(...storedSpans);
    if (!result.classes.includes('protected')) {
      result.classes.push('protected');
    }
  }

  return result;
}

// ── Payload Union Classification ────────────────────────────────

export interface ClassifyPayloadParams {
  currentText: string;
  messages: ConversationMessage[];
  toolContext?: string;
  searchQuery?: string;
  summarizeTranscript?: string;
  fetchCredential: CredentialFetcher;
}

export async function classifyPayload(params: ClassifyPayloadParams): Promise<PayloadClassification> {
  const { currentText, messages, toolContext, searchQuery, summarizeTranscript, fetchCredential } = params;

  const segments: SegmentClassification[] = [];

  // Current text
  segments.push(await classifySegment(currentText, 'current_text', fetchCredential));

  // History entries actually in the outbound payload
  for (let i = 0; i < messages.length; i++) {
    segments.push(await classifySegment(messages[i].content, 'history', fetchCredential, i));
  }

  // Tool context
  if (toolContext) {
    segments.push(await classifySegment(toolContext, 'tool_context', fetchCredential));
  }

  // Search query
  if (searchQuery) {
    segments.push(await classifySegment(searchQuery, 'search_query', fetchCredential));
  }

  // Summarize transcript
  if (summarizeTranscript) {
    segments.push(await classifySegment(summarizeTranscript, 'summarize_transcript', fetchCredential));
  }

  // Union
  const allClasses = new Set<DataClass>();
  const allProtected: ProtectedSpan[] = [];
  for (const seg of segments) {
    for (const c of seg.classes) allClasses.add(c);
    allProtected.push(...seg.protectedSpans);
  }

  const unionClasses = [...allClasses];
  const isSensitive = allClasses.has('medical') || allClasses.has('financial') || allClasses.has('pii');
  const isProtected = allClasses.has('protected');

  return { segments, unionClasses, isSensitive, isProtected, protectedSpans: allProtected };
}

// ── Current-text parity helper ──────────────────────────────────

/**
 * Parity function: returns the same result as the existing production
 * classifyData for current-text-only classification.
 * Used by parity tests to prove M2 doesn't alter existing behavior.
 */
export function classifyCurrentTextParity(text: string): DataClassificationResult {
  return classifyData(text);
}

// Re-export for orchestration use
export { classifyData, checkInjection };
export type { DataClassificationResult, InjectionCheckResult };
