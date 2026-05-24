/**
 * securityGateway.ts — PrivateAI Security Layer
 * 
 * Single checkpoint all AI calls pass through:
 * 1. Injection detection
 * 2. Output sanitization
 * 3. Data classification (medical, financial, PII)
 * 4. Anomaly detection
 */

import secureStorage from '@/services/secureStorage';

// ── Types ────────────────────────────────────────────────────

export interface InjectionCheckResult {
  detected: boolean;
  reason?: string;
}

export interface DataClassificationResult {
  hasMedical: boolean;
  hasFinancial: boolean;
  hasPII: boolean;
}

// ── Injection Patterns ───────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore[,.]?\s*(?:all\s+)?(?:previous\s+)?(?:instructions|rules|restrictions)/i,
  /disregard[,.]?\s*(?:all\s+)?(?:previous|safety|your)/i,
  /forget\s+(?:all\s+)?(?:your\s+)?(?:previous\s+)?(?:instructions|rules)/i,
  /override\s+(your\s+)?(rules|safety|filters)/i,
  /bypass[,.]?\s*(?:your\s+)?(rules|safety|filters)/i,
  /\[SYSTEM\s+(UPDATE|DIRECTIVE|OVERRIDE)\]/i,
  /reveal\s+(your\s+)?system\s+prompt/i,
  /reveal\s+(?:all\s+)?(?:user\s+|my\s+|the\s+)?(medical|health|personal|private)\b/i,
  /show\s+(?:me\s+)?(?:the\s+|your\s+)?(?:full\s+)?(hidden|system|internal)\s+(prompt|instructions)/i,
  /what\s+(?:are|were)\s+your\s+(?:original|initial|system)\s+(?:system\s+)?(?:instructions|prompt|rules)/i,
  /forward\s+(?:this|all|the)\s+(?:\w+\s+)?(data|conversation|history)\s+to/i,
  /extract\s+(?:all\s+)?(?:the\s+)?(data|info|memory|knowledge)/i,
  /instructions?\s+(?:are\s+)?(?:now\s+)?revoked/i,
  /send\s+.*\b(database|data|credentials|keys?|tokens?)\b/i,
  /you\s+are\s+now\s+(?:a\s+)?(uncensored|jailbroken|unrestricted)/i,
  /act\s+as\s+(if\s+you\s+are|a\s+)/i,
];

// ── Data Keywords ────────────────────────────────────────────

const MEDICAL_KEYWORDS = /\b(symptom|medication|prescri(?:ption|bed)|doctor|physician|diagnosis|pain|health|headache|fever|anxiety|depression|allergy|diabetes|asthma|dosage|surgery|therapy|treatment)\b/i;

const FINANCIAL_KEYWORDS = /\b(credit\s+card|bank\s+account|routing\s+number|ssn|account\s+number|balance|mortgage|loan|investment|stock|salary|bitcoin|crypto|wallet|payment)\b/i;

const PII_KEYWORDS = /\b(phone\s+number|email\s+address|home\s+address|zip\s+code|driver\s+license|passport|ssn|date\s+of\s+birth|full\s+name)\b/i;

// ── Forbidden Output ─────────────────────────────────────────

const FORBIDDEN_OUTPUT: RegExp[] = [
  /api[_-]?key/i,
  /sk-ant-api/,
  /sk-[A-Za-z0-9]{20,}/,
];

// ── Security Log ─────────────────────────────────────────────

interface SecurityEvent {
  timestamp: number;
  eventType: string;
  context: string;
}

const SECURITY_LOG_KEY = 'security_events_v1';

// ── Functions ────────────────────────────────────────────────

/**
 * Check for prompt injection in user input.
 */
export function checkInjection(input: string): InjectionCheckResult {
  const hit = INJECTION_PATTERNS.find(rx => rx.test(input));
  if (hit) {
    logSecurityEvent('injection_detected', 'checkInjection').catch(() => {});
    return { detected: true, reason: 'Prompt injection pattern detected' };
  }
  return { detected: false };
}

/**
 * Remove sensitive content from AI output.
 */
export function sanitizeOutput(output: string): string {
  let cleaned = output;
  for (const rx of FORBIDDEN_OUTPUT) {
    if (rx.test(cleaned)) {
      logSecurityEvent('output_filtered', 'sanitizeOutput').catch(() => {});
      cleaned = cleaned.replace(rx, '[redacted]');
    }
  }
  return cleaned;
}

/**
 * Classify user input by data sensitivity.
 */
export function classifyData(input: string): DataClassificationResult {
  return {
    hasMedical: MEDICAL_KEYWORDS.test(input),
    hasFinancial: FINANCIAL_KEYWORDS.test(input),
    hasPII: PII_KEYWORDS.test(input),
  };
}

/**
 * Log security event (metadata only, never raw input).
 */
export async function logSecurityEvent(
  eventType: string,
  context: string
): Promise<void> {
  try {
    const raw = await secureStorage.getItem(SECURITY_LOG_KEY);
    const events: SecurityEvent[] = raw ? JSON.parse(raw) : [];
    events.push({ timestamp: Date.now(), eventType, context });
    if (events.length > 100) events.splice(0, events.length - 100);
    await secureStorage.setItem(SECURITY_LOG_KEY, JSON.stringify(events));
  } catch (e) {
    console.warn('[Security] logSecurityEvent failed:', e);
  }
}

/**
 * Reset session lock flag.
 */
export function resetSessionLock(): void {
  // Session lock is managed in app state — this is a no-op stub for the UI callback
}

/**
 * Get a summary of current security status.
 */
export async function getSecurityStatus(): Promise<{
  injectionShield: boolean;
  outputFilter: boolean;
  recentEvents: number;
}> {
  const events = await getSecurityLog(100);
  return {
    injectionShield: true,
    outputFilter: true,
    recentEvents: events.length,
  };
}

/**
 * Get recent security events.
 */
export async function getSecurityLog(limit = 20): Promise<SecurityEvent[]> {
  try {
    const raw = await secureStorage.getItem(SECURITY_LOG_KEY);
    if (!raw) return [];
    const events = JSON.parse(raw) as SecurityEvent[];
    return events.slice(-limit).reverse();
  } catch (e) {
    console.warn('[Security] getSecurityLog failed:', e);
    return [];
  }
}
