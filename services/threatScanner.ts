/**
 * threatScanner.ts — PrivateAI Threat Analysis Engine
 *
 * Analyzes pasted content (emails, links, messages) for security threats.
 * All analysis runs on-device — suspicious content is never sent to cloud.
 *
 * Detection categories:
 *   - Phishing indicators (urgency, spoofed senders, suspicious links)
 *   - Tracking pixels and beacons
 *   - Malware link patterns
 *   - Social engineering tactics
 *   - Data exfiltration attempts
 *   - Known malicious domains
 */

import { logSecurityEvent } from './securityGateway';

// ─── Types ───────────────────────────────────────────────────

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'clean';
export type ContentType = 'email' | 'link' | 'message' | 'file';

export interface ThreatIndicator {
  category: string;
  description: string;
  severity: ThreatLevel;
  evidence: string;
}

export interface ThreatReport {
  level: ThreatLevel;
  summary: string;
  indicators: ThreatIndicator[];
  actions: string[];
  rawIndicatorCount: number;
}

// ─── Phishing Patterns ───────────────────────────────────────

const URGENCY_PATTERNS = [
  /\b(urgent|immediately|right\s+now|act\s+fast|expires?\s+(today|soon|in\s+\d+))\b/i,
  /\b(account\s+(suspended|compromised|locked|disabled|will\s+be\s+(closed|deleted)))\b/i,
  /\b(verify\s+(your\s+)?(identity|account|information|details))\b/i,
  /\b(unusual\s+(activity|sign.?in|login|transaction))\b/i,
  /\b(confirm\s+(your|this)\s+(payment|order|transaction|identity))\b/i,
  /\b(limited\s+time|only\s+\d+\s+(hours?|minutes?|days?)\s+(left|remaining))\b/i,
  /\b(failure\s+to\s+(respond|verify|confirm)\s+will\s+result)\b/i,
];

const SPOOFING_PATTERNS = [
  /\b(dear\s+(customer|user|member|valued|sir|madam|account\s+holder))\b/i,
  /\b(from|sent\s+by|on\s+behalf\s+of):?\s*(apple|google|microsoft|amazon|paypal|netflix|bank\b)/i,
  /reply-to:?\s*[^\n]*@(?!.*\.(apple|google|microsoft|amazon)\.com)/i,
];

const SUSPICIOUS_LINK_PATTERNS = [
  /https?:\/\/[^\s]*@[^\s]*/,                    // URL with @ (redirect trick)
  /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, // IP address URL
  /https?:\/\/[^\s]*\.(tk|ml|ga|cf|gq|xyz|top|buzz|click|link)\b/i, // suspicious TLDs
  /https?:\/\/bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd/i,      // URL shorteners
  /https?:\/\/[^\s]*-(?:login|verify|secure|update|confirm)\./i,     // fake subdomain
  /https?:\/\/[^\s]*(?:signin|log-?in|account)[^\s]*\.[^\s]*\.[^\s]/, // deep subdomain phishing
];

const TRACKING_PATTERNS = [
  /https?:\/\/[^\s]*(?:track|pixel|beacon|open|click|img)[^\s]*\.(?:gif|png|jpg)\?/i,
  /https?:\/\/[^\s]*(?:email\..*\/o\/|e\..*\/o\/)/i,  // common email tracking
  /<img[^>]*(?:width|height)\s*=\s*["']1["'][^>]*>/i,  // 1x1 pixel
  /https?:\/\/[^\s]*(?:mailchimp|sendgrid|mailgun|amazonaws.*ses)/i,
];

const MALWARE_PATTERNS = [
  /\.(?:exe|bat|cmd|scr|pif|com|vbs|js|wsf|hta)\b/i,   // executable extensions
  /https?:\/\/[^\s]*\.(?:zip|rar|7z|tar)\b/i,            // archive downloads
  /(?:enable\s+(?:macros?|content|editing))/i,             // macro enablement
  /(?:powershell|cmd\.exe|wscript|cscript)\b/i,           // script execution
];

const SOCIAL_ENGINEERING_PATTERNS = [
  /\b(you\s+(have\s+)?won|congratulations|you('ve|\s+have)\s+been\s+selected)\b/i,
  /\b(click\s+(here|below|this\s+link)\s+to\s+(claim|verify|confirm|update))\b/i,
  /\b(do\s+not\s+share\s+this\s+(with\s+anyone|email|message))\b/i,
  /\b(reply\s+with\s+your\s+(password|ssn|social|credit\s+card|account\s+number))\b/i,
  /\b(wire\s+transfer|western\s+union|bitcoin\s+wallet|crypto\s+wallet|gift\s+card)\b/i,
];

const DATA_LEAK_PATTERNS = [
  /\b(password|passwd|pwd)\s*[:=]\s*\S+/i,
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i,
  /\b\d{3}-\d{2}-\d{4}\b/,                    // SSN format
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit card format
];

// ─── Scanner ─────────────────────────────────────────────────

export function scanContent(content: string, type: ContentType = 'email'): ThreatReport {
  const indicators: ThreatIndicator[] = [];

  // Urgency manipulation
  for (const rx of URGENCY_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Urgency Manipulation',
        description: 'Creates false urgency to pressure immediate action',
        severity: 'high',
        evidence: match[0],
      });
    }
  }

  // Sender spoofing
  for (const rx of SPOOFING_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Sender Spoofing',
        description: 'Impersonates a trusted sender or organization',
        severity: 'high',
        evidence: match[0],
      });
    }
  }

  // Suspicious links
  for (const rx of SUSPICIOUS_LINK_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Suspicious Link',
        description: 'URL uses techniques common in phishing attacks',
        severity: 'critical',
        evidence: match[0].slice(0, 80),
      });
    }
  }

  // Tracking pixels/beacons
  for (const rx of TRACKING_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Tracking',
        description: 'Contains tracking pixel or email beacon',
        severity: 'medium',
        evidence: match[0].slice(0, 80),
      });
    }
  }

  // Malware indicators
  for (const rx of MALWARE_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Malware Risk',
        description: 'Contains potentially malicious file type or execution command',
        severity: 'critical',
        evidence: match[0],
      });
    }
  }

  // Social engineering
  for (const rx of SOCIAL_ENGINEERING_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Social Engineering',
        description: 'Uses manipulation tactics to extract information or action',
        severity: 'high',
        evidence: match[0],
      });
    }
  }

  // Data leaks in content
  for (const rx of DATA_LEAK_PATTERNS) {
    const match = content.match(rx);
    if (match) {
      indicators.push({
        category: 'Data Exposure',
        description: 'Contains what appears to be sensitive credentials or personal data',
        severity: 'critical',
        evidence: match[0].slice(0, 20) + '***',
      });
    }
  }

  // Deduplicate by category (keep highest severity per category)
  const byCategory = new Map<string, ThreatIndicator>();
  for (const ind of indicators) {
    const existing = byCategory.get(ind.category);
    if (!existing || severityRank(ind.severity) > severityRank(existing.severity)) {
      byCategory.set(ind.category, ind);
    }
  }
  const deduped = [...byCategory.values()];

  // Determine overall threat level
  const level = determineLevel(deduped);

  // Generate action items
  const actions = generateActions(deduped, type);

  // Build summary
  const summary = buildSummary(level, deduped, type);

  // Log security event
  if (level !== 'clean') {
    logSecurityEvent(`threat_scan_${level}`, 'cipher').catch(() => {});
  }

  return {
    level,
    summary,
    indicators: deduped,
    actions,
    rawIndicatorCount: indicators.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function severityRank(s: ThreatLevel): number {
  return { critical: 4, high: 3, medium: 2, low: 1, clean: 0 }[s];
}

function determineLevel(indicators: ThreatIndicator[]): ThreatLevel {
  if (indicators.length === 0) return 'clean';
  const maxSeverity = Math.max(...indicators.map(i => severityRank(i.severity)));
  // Escalate if multiple high-severity indicators (compound attack)
  const highCount = indicators.filter(i => severityRank(i.severity) >= 3).length;
  if (highCount >= 3) return 'critical';
  if (maxSeverity >= 4) return 'critical';
  if (maxSeverity >= 3) return 'high';
  if (maxSeverity >= 2) return 'medium';
  return 'low';
}

function buildSummary(level: ThreatLevel, indicators: ThreatIndicator[], type: ContentType): string {
  if (level === 'clean') {
    return `No threats detected in this ${type}. It appears safe, but always exercise caution with unexpected messages.`;
  }

  const categories = [...new Set(indicators.map(i => i.category))];
  return `THREAT LEVEL: ${level.toUpperCase()} — ${indicators.length} indicator${indicators.length !== 1 ? 's' : ''} found: ${categories.join(', ')}.`;
}

function generateActions(indicators: ThreatIndicator[], type: ContentType): string[] {
  const actions: string[] = [];
  const categories = new Set(indicators.map(i => i.category));

  if (categories.has('Suspicious Link') || categories.has('Malware Risk')) {
    actions.push('DO NOT click any links in this message');
    actions.push('DO NOT download any attachments');
  }

  if (categories.has('Sender Spoofing')) {
    actions.push('Verify the sender by contacting the organization directly (not through links in this message)');
    actions.push('Check the actual email address — not just the display name');
  }

  if (categories.has('Social Engineering') || categories.has('Urgency Manipulation')) {
    actions.push('Do not respond or take any immediate action — legitimate organizations do not pressure you like this');
  }

  if (categories.has('Data Exposure')) {
    actions.push('Change any passwords that may have been exposed');
    actions.push('Enable two-factor authentication on affected accounts');
    actions.push('Monitor your accounts for unauthorized activity');
  }

  if (categories.has('Tracking')) {
    actions.push('This message tracks when you open it — the sender knows you read it');
    actions.push('Consider blocking this sender');
  }

  if (type === 'email' && indicators.length > 0) {
    actions.push('Report this email as phishing in your mail app');
    actions.push('Block the sender');
    actions.push('Delete the email');
  }

  if (indicators.length === 0) {
    actions.push('No immediate action needed');
  }

  return actions;
}

/**
 * Format a threat report as readable text for the chat.
 */
export function formatThreatReport(report: ThreatReport): string {
  const lines: string[] = [];

  lines.push(report.summary);
  lines.push('');

  if (report.indicators.length > 0) {
    lines.push('Indicators found:');
    for (const ind of report.indicators) {
      lines.push(`  [${ind.severity.toUpperCase()}] ${ind.category}: ${ind.description}`);
      lines.push(`    Evidence: "${ind.evidence}"`);
    }
    lines.push('');
  }

  if (report.actions.length > 0) {
    lines.push('Recommended actions:');
    for (const action of report.actions) {
      lines.push(`  - ${action}`);
    }
  }

  return lines.join('\n');
}
