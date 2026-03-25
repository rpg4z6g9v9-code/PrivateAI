/**
 * threatIntelligence.ts — PrivateAI Adaptive Threat Defense
 *
 * Learns from every threat Cipher detects and builds a local threat
 * intelligence database. Over time, the system gets smarter — blocking
 * repeat attackers, recognizing new variants of known attacks, and
 * hardening defenses automatically.
 *
 * All data stays on-device. This is YOUR threat intel, not a cloud service.
 *
 * Capabilities:
 *   1. Threat Memory    — remembers every scanned threat, builds patterns
 *   2. Blocklist        — auto-blocks known malicious domains, senders, patterns
 *   3. Auto-Harden      — adds new detection patterns from confirmed threats
 *   4. Threat Digest    — periodic summary of what's been blocked/detected
 *   5. Exposure Check   — scan if your data appeared in a known threat
 */

import secureStorage from './secureStorage';
import { logSecurityEvent } from './securityGateway';
import { signData } from './integrityCheck';
import type { ThreatReport, ThreatLevel, ContentType } from './threatScanner';

// ─── Storage Keys ────────────────────────────────────────────

const BLOCKLIST_KEY = 'threat_blocklist_v1';
const THREAT_LOG_KEY = 'threat_history_v1';
const LEARNED_PATTERNS_KEY = 'threat_learned_patterns_v1';
const EXPOSURE_KEY = 'threat_exposure_v1';

// ─── Types ───────────────────────────────────────────────────

export interface BlocklistEntry {
  id: string;
  type: 'domain' | 'email' | 'ip' | 'pattern' | 'phone';
  value: string;
  reason: string;
  threatLevel: ThreatLevel;
  addedAt: string;
  hitCount: number;
}

export interface ThreatLogEntry {
  id: string;
  timestamp: string;
  contentType: ContentType;
  threatLevel: ThreatLevel;
  indicators: string[];   // category names
  domains: string[];       // extracted domains
  senders: string[];       // extracted email addresses
  action: 'scanned' | 'blocked' | 'reported';
  summary: string;
}

export interface LearnedPattern {
  id: string;
  pattern: string;        // regex string
  category: string;
  source: string;         // which scan taught us this
  confidence: number;
  createdAt: string;
  matchCount: number;
}

export interface ExposureRecord {
  id: string;
  dataType: 'email' | 'password' | 'phone' | 'apikey' | 'name';
  context: string;        // where it was found (sanitized, no raw data)
  severity: ThreatLevel;
  detectedAt: string;
  resolved: boolean;
  resolution?: string;
}

// ─── Storage Helpers ─────────────────────────────────────────

async function loadJSON<T>(key: string): Promise<T[]> {
  try {
    const raw = await secureStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveJSON<T>(key: string, data: T[]): Promise<void> {
  const json = JSON.stringify(data);
  await secureStorage.setItem(key, json);
  await signData(key, json);
}

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 1. Blocklist ────────────────────────────────────────────

export async function getBlocklist(): Promise<BlocklistEntry[]> {
  return loadJSON<BlocklistEntry>(BLOCKLIST_KEY);
}

export async function addToBlocklist(
  type: BlocklistEntry['type'],
  value: string,
  reason: string,
  threatLevel: ThreatLevel = 'high',
): Promise<BlocklistEntry> {
  const list = await getBlocklist();

  // Check if already blocked
  const existing = list.find(e => e.type === type && e.value.toLowerCase() === value.toLowerCase());
  if (existing) {
    existing.hitCount++;
    await saveJSON(BLOCKLIST_KEY, list);
    return existing;
  }

  const entry: BlocklistEntry = {
    id: uid(),
    type,
    value: value.toLowerCase(),
    reason,
    threatLevel,
    addedAt: new Date().toISOString(),
    hitCount: 1,
  };

  list.push(entry);
  // Cap at 500 entries
  if (list.length > 500) list.splice(0, list.length - 500);
  await saveJSON(BLOCKLIST_KEY, list);

  logSecurityEvent('blocklist_add', 'cipher').catch(() => {});
  console.log('[ThreatIntel] Blocked:', type, value);

  return entry;
}

export async function removeFromBlocklist(id: string): Promise<void> {
  const list = await getBlocklist();
  const filtered = list.filter(e => e.id !== id);
  await saveJSON(BLOCKLIST_KEY, filtered);
}

/**
 * Check if a value is on the blocklist.
 * Call this before processing any external content.
 */
export async function isBlocked(value: string): Promise<BlocklistEntry | null> {
  const list = await getBlocklist();
  const lower = value.toLowerCase();
  return list.find(e => lower.includes(e.value)) ?? null;
}

// ─── 2. Threat History ───────────────────────────────────────

export async function getThreatHistory(limit = 50): Promise<ThreatLogEntry[]> {
  const log = await loadJSON<ThreatLogEntry>(THREAT_LOG_KEY);
  return log.slice(-limit).reverse();
}

/**
 * Record a threat scan result. Called automatically after every scan_threat.
 * Extracts domains and email addresses for potential blocklisting.
 */
export async function recordThreat(
  report: ThreatReport,
  contentType: ContentType,
  rawContent: string,
): Promise<ThreatLogEntry> {
  const log = await loadJSON<ThreatLogEntry>(THREAT_LOG_KEY);

  // Extract domains from content
  const domainRx = /https?:\/\/([^\/\s]+)/gi;
  const domains: string[] = [];
  let m;
  while ((m = domainRx.exec(rawContent)) !== null) {
    domains.push(m[1].toLowerCase());
  }

  // Extract email addresses from content
  const emailRx = /[\w.-]+@[\w.-]+\.\w+/gi;
  const senders = [...new Set((rawContent.match(emailRx) ?? []).map(e => e.toLowerCase()))];

  const entry: ThreatLogEntry = {
    id: uid(),
    timestamp: new Date().toISOString(),
    contentType,
    threatLevel: report.level,
    indicators: report.indicators.map(i => i.category),
    domains,
    senders,
    action: 'scanned',
    summary: report.summary,
  };

  log.push(entry);
  if (log.length > 200) log.splice(0, log.length - 200);
  await saveJSON(THREAT_LOG_KEY, log);

  // Auto-block: if threat is high or critical, block extracted domains and senders
  if (report.level === 'critical' || report.level === 'high') {
    for (const domain of domains) {
      // Don't block known safe domains
      if (!isSafeDomain(domain)) {
        await addToBlocklist('domain', domain, `Auto-blocked: ${report.level} threat detected`, report.level);
      }
    }
    for (const sender of senders) {
      await addToBlocklist('email', sender, `Auto-blocked: ${report.level} threat from sender`, report.level);
    }
    entry.action = 'blocked';
  }

  return entry;
}

// ─── 3. Learn from Threats ───────────────────────────────────

export async function getLearnedPatterns(): Promise<LearnedPattern[]> {
  return loadJSON<LearnedPattern>(LEARNED_PATTERNS_KEY);
}

/**
 * Learn a new detection pattern from a confirmed threat.
 * This makes the scanner smarter over time.
 */
export async function learnPattern(
  pattern: string,
  category: string,
  source: string,
): Promise<void> {
  const patterns = await getLearnedPatterns();

  // Don't learn duplicates
  if (patterns.some(p => p.pattern === pattern)) return;

  patterns.push({
    id: uid(),
    pattern,
    category,
    source,
    confidence: 0.7,
    createdAt: new Date().toISOString(),
    matchCount: 0,
  });

  if (patterns.length > 100) patterns.splice(0, patterns.length - 100);
  await saveJSON(LEARNED_PATTERNS_KEY, patterns);
  console.log('[ThreatIntel] Learned new pattern:', category, pattern.slice(0, 40));
}

/**
 * Check content against learned patterns.
 * Returns matching pattern categories.
 */
export async function checkLearnedPatterns(content: string): Promise<string[]> {
  const patterns = await getLearnedPatterns();
  const matches: string[] = [];

  for (const p of patterns) {
    try {
      const rx = new RegExp(p.pattern, 'i');
      if (rx.test(content)) {
        matches.push(p.category);
        p.matchCount++;
      }
    } catch {
      // Invalid regex — skip
    }
  }

  if (matches.length > 0) {
    await saveJSON(LEARNED_PATTERNS_KEY, patterns);
  }

  return matches;
}

// ─── 4. Exposure Tracking ────────────────────────────────────

export async function getExposures(): Promise<ExposureRecord[]> {
  return loadJSON<ExposureRecord>(EXPOSURE_KEY);
}

/**
 * Record a data exposure (e.g. API key found in scanned content,
 * email address found in a phishing campaign).
 */
export async function recordExposure(
  dataType: ExposureRecord['dataType'],
  context: string,
  severity: ThreatLevel,
): Promise<ExposureRecord> {
  const exposures = await getExposures();

  const record: ExposureRecord = {
    id: uid(),
    dataType,
    context,
    severity,
    detectedAt: new Date().toISOString(),
    resolved: false,
  };

  exposures.push(record);
  if (exposures.length > 100) exposures.splice(0, exposures.length - 100);
  await saveJSON(EXPOSURE_KEY, exposures);

  logSecurityEvent('exposure_detected', 'cipher').catch(() => {});
  console.log('[ThreatIntel] Exposure recorded:', dataType, severity);

  return record;
}

export async function resolveExposure(id: string, resolution: string): Promise<void> {
  const exposures = await getExposures();
  const record = exposures.find(e => e.id === id);
  if (record) {
    record.resolved = true;
    record.resolution = resolution;
    await saveJSON(EXPOSURE_KEY, exposures);
  }
}

// ─── 5. Threat Digest ────────────────────────────────────────

/**
 * Generate a summary of recent threat activity.
 * Cipher can present this to the user proactively.
 */
export async function generateThreatDigest(): Promise<string> {
  const history = await getThreatHistory(30);
  const blocklist = await getBlocklist();
  const exposures = await getExposures();
  const unresolved = exposures.filter(e => !e.resolved);

  if (history.length === 0 && blocklist.length === 0) {
    return 'No threat activity recorded yet. Share suspicious emails or messages with me to start building your threat intelligence.';
  }

  const lines: string[] = ['THREAT INTELLIGENCE DIGEST', ''];

  // Recent activity
  const last7Days = history.filter(h => {
    const d = new Date(h.timestamp);
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  });

  if (last7Days.length > 0) {
    const critical = last7Days.filter(h => h.threatLevel === 'critical').length;
    const high = last7Days.filter(h => h.threatLevel === 'high').length;
    lines.push(`Last 7 days: ${last7Days.length} scans — ${critical} critical, ${high} high`);
  }

  // Blocklist stats
  if (blocklist.length > 0) {
    const domains = blocklist.filter(b => b.type === 'domain').length;
    const emails = blocklist.filter(b => b.type === 'email').length;
    lines.push(`Blocklist: ${blocklist.length} entries (${domains} domains, ${emails} senders)`);

    // Top repeat offenders
    const topOffenders = [...blocklist]
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 3);
    if (topOffenders.some(o => o.hitCount > 1)) {
      lines.push('');
      lines.push('Repeat offenders:');
      for (const o of topOffenders.filter(o => o.hitCount > 1)) {
        lines.push(`  ${o.value} — ${o.hitCount} hits (${o.type})`);
      }
    }
  }

  // Unresolved exposures
  if (unresolved.length > 0) {
    lines.push('');
    lines.push(`UNRESOLVED EXPOSURES: ${unresolved.length}`);
    for (const e of unresolved) {
      lines.push(`  [${e.severity.toUpperCase()}] ${e.dataType}: ${e.context}`);
    }
    lines.push('');
    lines.push('Action needed: resolve these exposures (change passwords, rotate keys, etc.)');
  }

  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────

const SAFE_DOMAINS = new Set([
  'google.com', 'apple.com', 'microsoft.com', 'amazon.com',
  'anthropic.com', 'api.anthropic.com',
  'github.com', 'stackoverflow.com',
  'elevenlabs.io', 'api.elevenlabs.io',
  'tavily.com', 'api.tavily.com',
  'huggingface.co',
  'expo.dev', 'expo.io',
]);

function isSafeDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  return SAFE_DOMAINS.has(lower) || [...SAFE_DOMAINS].some(safe => lower.endsWith('.' + safe));
}
