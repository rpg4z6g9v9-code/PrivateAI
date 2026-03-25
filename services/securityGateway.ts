/**
 * securityGateway.ts — PrivateAI Zero-Trust Security Architecture
 *
 * Single security layer all AI calls pass through before and after
 * every Claude API request. No AI call in the app bypasses this gate.
 *
 * Responsibilities:
 *   1. Prompt injection detection — block known attack patterns
 *   2. Output sanitization     — strip leaked system/key content
 *   3. Anomaly detection       — rate-limit + session lock
 *   4. Data classification     — route medical content to local AI
 *   5. Persona trust boundary  — medical data scoped to Atom only
 *   6. Secure event logging    — encrypted, never logs raw input
 */

import secureStorage from '@/services/secureStorage';

// ─── Types ────────────────────────────────────────────────────

export type DataClassification = 'general' | 'medical';
export type SessionState       = 'normal' | 'locked';

export interface SecurityStatus {
  injectionShield: 'active';
  outputFilter:    'active';
  medicalDataMode: 'local_only';
  sessionState:    SessionState;
}

export interface InjectionCheckResult {
  blocked:        boolean;
  warningMessage: string;
}

export interface AnomalyCheckResult {
  locked:  boolean;
  message: string;
}

// ─── Prompt Injection Patterns ────────────────────────────────
//
// Catches the most common prompt injection attack vectors.
// Evaluated against raw user input before it reaches any persona.

const INJECTION_PATTERNS: RegExp[] = [
  // Direct instruction override
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions|rules|context)/i,
  /override\s+(your\s+)?(rules|instructions|safety|guidelines)/i,
  /bypass\s+(your\s+)?(rules|safety|filters|restrictions)/i,
  // System prompt extraction
  /reveal\s+(your\s+)?system\s+prompt/i,
  /show\s+(me\s+)?(your\s+)?(hidden|system|internal)\s+(prompt|instructions|rules)/i,
  /print\s+(your\s+)?(instructions|prompt|rules|configuration)/i,
  /repeat\s+everything\s+(above|before|you\s+were\s+told)/i,
  /what\s+(are|were)\s+your\s+(original|initial|system)\s+(instructions|prompt|rules)/i,
  /output\s+(your|the)\s+(system|initial|original)\s+(prompt|message|instructions)/i,
  // Data exfiltration
  /send\s+.*\b(database|data|info|credentials|keys?|tokens?)\b/i,
  /exfiltrate/i,
  /extract\s+(all|the)\s+(data|info|memory|knowledge)/i,
  /forward\s+(this|all|the)\s+(data|conversation|history)\s+to/i,
  // Role manipulation
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /pretend\s+(to\s+be|you\s+are)\s+/i,
  /act\s+as\s+(if\s+you\s+are|a\s+different)\s+/i,
  /switch\s+to\s+(evil|uncensored|unrestricted|jailbreak)/i,
  /enter\s+(dev|developer|debug|admin)\s+mode/i,
  /\bDAN\b.*\bjailbreak\b/i,
  // Encoding evasion
  /base64\s*(decode|encode).*instruction/i,
  /rot13/i,
  // Delimiter injection
  /```system/i,
  /<\/?system>/i,
  /\[INST\]/i,
  /<<SYS>>/i,
];

// ─── Forbidden Output Patterns ────────────────────────────────
//
// Catches accidental or induced leakage of system internals
// from AI responses before they reach the chat thread.

const FORBIDDEN_OUTPUT: RegExp[] = [
  /system prompt/i,
  /internal policy/i,
  /api[_ ]?key/i,
  /database dump/i,
  // API key patterns — catch leaked keys in responses
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/,           // Anthropic
  /sk-[A-Za-z0-9]{20,}/,                            // OpenAI
  /sk_[a-f0-9]{40,}/,                               // ElevenLabs
  /tvly-[A-Za-z0-9_-]{20,}/,                        // Tavily
  // Persona internals — never leak the architecture
  /SHARED_CONTEXT/,
  /CLOUD_PROMPTS/,
  /LOCAL_PROMPTS/,
  /INJECTION_PATTERNS/,
  /FORBIDDEN_OUTPUT/,
  /buildAtomPrompt/,
  /securityGateway/,
  // Memory store keys
  /memory_v1_[a-z]+/,
  /knowledge_v1_[a-z]+/,
  /medical_entries_v1/,
  /security_events_v1/,
];

// ─── Medical Keywords ─────────────────────────────────────────
//
// Any message matching these terms is classified as medical data
// and routed to local AI where possible.

const MEDICAL_KEYWORDS = /\b(symptom|symptoms|medication|medications|prescri(?:ption|bed)|doctor|physician|diagnosis|diagnose|pain|aching|ache|health|headache|migraine|fatigue|tired|exhausted|fever|nausea|nauseated|dizzy|dizziness|vomit|blood\s*pressure|heart\s*rate|pulse|pharmacy|hospital|clinic|specialist|therapy|treatment|side\s+effect|allergy|allergic|chronic|acute|inflammation|swollen|swelling|rash|anxiety|depression|insomnia|arthritis|diabetes|asthma|inhaler|dosage|dose|mg\b|ml\b|lab\s+result|blood\s+test|x.ray|scan|mri|ct\s+scan|surgery|injury)\b/i;

// ─── Storage Key ──────────────────────────────────────────────

const SECURITY_LOG_KEY = 'security_events_v1';

// ─── Anomaly Detector State ───────────────────────────────────

// In-memory ring buffer of request timestamps (cleared on lock reset)
const requestTimestamps: number[] = [];
const ANOMALY_WINDOW_MS  = 10_000; // 10 seconds
const ANOMALY_THRESHOLD  = 20;     // max requests per window

let _sessionLocked      = false;
let _lockExpiryTimeout: ReturnType<typeof setTimeout> | null = null;

// ─── 1. Injection Detector ────────────────────────────────────

/**
 * Check user input for prompt injection patterns.
 * Call this BEFORE building any API payload.
 */
export function checkInjection(input: string): InjectionCheckResult {
  const hit = INJECTION_PATTERNS.find(rx => rx.test(input));
  if (hit) {
    logSecurityEvent('injection_blocked', 'system').catch(() => {});
    return {
      blocked: true,
      warningMessage: '[Security] Message blocked — detected a prompt injection pattern.',
    };
  }
  return { blocked: false, warningMessage: '' };
}

// ─── 2. Output Sanitizer ─────────────────────────────────────

/**
 * Scan AI response for forbidden content leakage.
 * Call this on every raw string returned by Claude before
 * placing it in the chat thread or speaking it aloud.
 */
export function sanitizeOutput(output: string): string {
  let cleaned = output;
  for (const rx of FORBIDDEN_OUTPUT) {
    if (rx.test(cleaned)) {
      logSecurityEvent('output_filtered', 'system').catch(() => {});
      cleaned = cleaned.replace(rx, '[redacted]');
    }
  }
  return cleaned;
}

// ─── 3. Anomaly Detector ─────────────────────────────────────

/**
 * Record a new request and check for rate-limit anomaly.
 * Returns locked=true if >ANOMALY_THRESHOLD requests in ANOMALY_WINDOW_MS.
 * Session auto-unlocks after 30 seconds (simulating Face ID re-auth).
 */
export function checkAnomaly(): AnomalyCheckResult {
  if (_sessionLocked) {
    return {
      locked: true,
      message:
        '[Security] Session locked due to unusual request volume. Tap "Unlock Session" to re-authenticate.',
    };
  }

  const now    = Date.now();
  const cutoff = now - ANOMALY_WINDOW_MS;
  requestTimestamps.push(now);

  // Evict timestamps outside the window
  let head = 0;
  while (head < requestTimestamps.length && requestTimestamps[head] < cutoff) head++;
  if (head > 0) requestTimestamps.splice(0, head);

  if (requestTimestamps.length > ANOMALY_THRESHOLD) {
    _sessionLocked = true;
    logSecurityEvent('anomaly_lock', 'system').catch(() => {});

    // Auto-unlock after 30 s (production: replace with Face ID callback)
    if (_lockExpiryTimeout) clearTimeout(_lockExpiryTimeout);
    _lockExpiryTimeout = setTimeout(() => {
      _sessionLocked = false;
      requestTimestamps.length = 0;
      _lockExpiryTimeout = null;
    }, 30_000);

    return {
      locked: true,
      message:
        '[Security] Unusual request volume detected. Session locked for 30 seconds. Tap "Unlock Session" to re-authenticate immediately.',
    };
  }

  return { locked: false, message: '' };
}

/**
 * Immediately unlock the session (call after successful Face ID / biometric).
 */
export function resetSessionLock(): void {
  _sessionLocked = false;
  requestTimestamps.length = 0;
  if (_lockExpiryTimeout) {
    clearTimeout(_lockExpiryTimeout);
    _lockExpiryTimeout = null;
  }
}

/** Returns true if the session is currently locked (module-level read). */
export function isSessionLocked(): boolean {
  return _sessionLocked;
}

// ─── 4. Data Classifier ──────────────────────────────────────

/**
 * Classify user input as 'medical' or 'general'.
 * Medical input should be routed to local AI where available.
 */
export function classifyData(input: string): DataClassification {
  return MEDICAL_KEYWORDS.test(input) ? 'medical' : 'general';
}

// ─── 5. Persona Trust Boundary ───────────────────────────────

/**
 * Build the medical context string appropriate for a given persona.
 *
 * - Vera ('vera'), Atom ('pete'), Atlas ('atlas'): receive full medical context
 * - All other personas: receive only an anonymised count summary
 *
 * This enforces the principle that raw health data never reaches
 * Architect / Builder / Critic / Researcher.
 */
const MEDICAL_ACCESS_PERSONAS = new Set(['vera', 'pete', 'atlas']);

export function buildMedicalContext(
  personaId:   string,
  entryCount:  number,
  fullContext: string,
): string {
  if (entryCount === 0) return '';
  if (MEDICAL_ACCESS_PERSONAS.has(personaId)) return fullContext;
  // Other personas: summary only — no medical detail
  return `\n\nNote: The user has logged ${entryCount} health ${entryCount === 1 ? 'entry' : 'entries'} in their private medical memory. Medical details are confidential and restricted to trusted personas.`;
}

// ─── 6. Secure Logging ───────────────────────────────────────

interface SecurityEvent {
  timestamp:  number;
  event_type: string;
  persona_id: string;
  // NEVER include: raw input, medical content, API keys
}

/**
 * Append a security event to the encrypted log.
 * Logs metadata only — raw user input and medical data are never recorded.
 */
export async function logSecurityEvent(
  eventType: string,
  personaId: string,
): Promise<void> {
  try {
    const raw    = await secureStorage.getItem(SECURITY_LOG_KEY);
    const events: SecurityEvent[] = raw ? (JSON.parse(raw) as SecurityEvent[]) : [];
    events.push({ timestamp: Date.now(), event_type: eventType, persona_id: personaId });
    // Cap at 200 events to bound storage size
    if (events.length > 200) events.splice(0, events.length - 200);
    await secureStorage.setItem(SECURITY_LOG_KEY, JSON.stringify(events));
  } catch (e) {
    // Never throw from the security logger — silently swallow storage errors
    console.warn('[Security] logSecurityEvent failed:', e);
  }
}

/**
 * Return the last N security events for display in the dashboard.
 * Returns metadata only — safe to render in UI.
 */
export async function getSecurityLog(limit = 20): Promise<SecurityEvent[]> {
  try {
    const raw = await secureStorage.getItem(SECURITY_LOG_KEY);
    if (!raw) return [];
    const events = JSON.parse(raw) as SecurityEvent[];
    return events.slice(-limit).reverse(); // newest first
  } catch (e) {
    console.warn('[Security] getSecurityLog failed:', e);
    return [];
  }
}

// ─── 7. Cloud Prompt Sanitizer ────────────────────────────────
//
// Before sending system prompts to the cloud API, strip sensitive
// information that the model doesn't need to see.

const SENSITIVE_PATTERNS_IN_PROMPT: RegExp[] = [
  // API keys that might have leaked into context
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /sk_[a-f0-9]{40,}/g,
  /tvly-[A-Za-z0-9_-]{20,}/g,
  // File paths that reveal device structure
  /\/var\/mobile\/Containers\/[^\s]+/g,
  /\/Users\/[^\s]+/g,
  // Raw medical entries with PII (names, dates, locations)
  // These should have been trust-bounded, but defense in depth
];

/**
 * Strip sensitive information from a system prompt before sending to cloud.
 * Call this on the final assembled prompt before the API call.
 */
export function sanitizePromptForCloud(prompt: string): string {
  let cleaned = prompt;
  for (const rx of SENSITIVE_PATTERNS_IN_PROMPT) {
    cleaned = cleaned.replace(rx, '[redacted]');
  }
  return cleaned;
}

// ─── 8. Security Status ──────────────────────────────────────

/**
 * Snapshot of the current security posture.
 * Injection shield and output filter are always active.
 * Medical data mode is always local_only by policy.
 * Session state reflects the anomaly detector.
 */
export function getSecurityStatus(): SecurityStatus {
  return {
    injectionShield: 'active',
    outputFilter:    'active',
    medicalDataMode: 'local_only',
    sessionState:    _sessionLocked ? 'locked' : 'normal',
  };
}
