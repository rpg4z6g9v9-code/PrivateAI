/**
 * medicalMemory.ts — PrivateAI Medical Memory System
 *
 * Fully on-device. Zero medical data leaves the device except when Pete
 * explicitly triggers generateAppointmentSummary() which calls the Claude API.
 *
 * Entry extraction uses local regex/keyword parsing — no API call needed
 * to parse a voice note into structured format.
 *
 * Storage: secureStorage (AES-256 via device secure enclave)
 * Key: 'medical_entries_v1'
 */

import secureStorage from './secureStorage';
import { canAccessVault } from './dataVault';

const STORAGE_KEY = 'medical_entries_v1';

// ─── Schema ───────────────────────────────────────────────────

export interface MedicalEntry {
  id: string;
  timestamp: string;          // ISO8601
  type: 'symptom' | 'medication' | 'visit' | 'lab' | 'pattern';
  rawInput: string;           // original voice/text transcript — never discard
  structured: {
    what: string;
    severity?: string;        // mild | moderate | severe | critical
    duration?: string;
    context?: string;
    urgent?: boolean;
  };
  confirmed: boolean;
  tags: string[];
  linkedEntries: string[];    // IDs of related entries
}

export type EntryDraft = Omit<MedicalEntry, 'id' | 'timestamp' | 'confirmed' | 'linkedEntries'>;

// ─── UUID ─────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── CRUD ─────────────────────────────────────────────────────

export async function getEntries(): Promise<MedicalEntry[]> {
  if (!canAccessVault()) return [];
  try {
    const raw = await secureStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function saveEntries(entries: MedicalEntry[]): Promise<void> {
  await secureStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function addEntry(draft: EntryDraft): Promise<MedicalEntry> {
  const entry: MedicalEntry = {
    ...draft,
    id: uuid(),
    timestamp: new Date().toISOString(),
    confirmed: true,
    linkedEntries: [],
  };
  const entries = await getEntries();
  await saveEntries([entry, ...entries]); // newest first

  // Phase 4: recompress on every new entry (async, non-blocking)
  runCompression([entry, ...entries]).catch(() => {});

  // Phase 5: run pattern detection (async, non-blocking)
  runPatternDetection([entry, ...entries]).catch(() => {});

  return entry;
}

export async function updateEntry(id: string, patch: Partial<MedicalEntry>): Promise<void> {
  const entries = await getEntries();
  await saveEntries(entries.map(e => e.id === id ? { ...e, ...patch } : e));
}

export async function deleteEntry(id: string): Promise<void> {
  const entries = await getEntries();
  await saveEntries(entries.filter(e => e.id !== id));
}

export async function linkEntries(id1: string, id2: string): Promise<void> {
  const entries = await getEntries();
  await saveEntries(entries.map(e => {
    if (e.id === id1 && !e.linkedEntries.includes(id2))
      return { ...e, linkedEntries: [...e.linkedEntries, id2] };
    if (e.id === id2 && !e.linkedEntries.includes(id1))
      return { ...e, linkedEntries: [...e.linkedEntries, id1] };
    return e;
  }));
}

// ─── Filtered queries ─────────────────────────────────────────

export async function getEntriesByType(type: MedicalEntry['type']): Promise<MedicalEntry[]> {
  return (await getEntries()).filter(e => e.type === type);
}

export async function getEntriesByDateRange(start: Date, end: Date): Promise<MedicalEntry[]> {
  const s = start.getTime(), en = end.getTime();
  return (await getEntries()).filter(e => {
    const t = new Date(e.timestamp).getTime();
    return t >= s && t <= en;
  });
}

export async function getEntriesByTag(tag: string): Promise<MedicalEntry[]> {
  const lower = tag.toLowerCase();
  return (await getEntries()).filter(e => e.tags.some(t => t.toLowerCase().includes(lower)));
}

export async function getRecentEntries(days: number): Promise<MedicalEntry[]> {
  const cutoff = Date.now() - days * 86_400_000;
  return (await getEntries()).filter(e => new Date(e.timestamp).getTime() >= cutoff);
}

export async function getEntriesBySymptom(symptom: string): Promise<MedicalEntry[]> {
  const lower = symptom.toLowerCase();
  return (await getEntries()).filter(e =>
    e.type === 'symptom' &&
    (e.structured.what.toLowerCase().includes(lower) ||
     e.rawInput.toLowerCase().includes(lower) ||
     e.tags.some(t => t.toLowerCase().includes(lower))),
  );
}

// ─── Urgent keyword detection ─────────────────────────────────

const URGENT_KEYWORDS = [
  'chest pain', 'chest tightness', 'chest pressure',
  'difficulty breathing', "can't breathe", 'cannot breathe', 'shortness of breath',
  'loss of consciousness', 'unconscious', 'passed out', 'fainted',
  'severe pain', 'excruciating',
  'stroke', 'heart attack', 'cardiac',
  'seizure', 'convulsion',
  'anaphylaxis', 'severe allergic reaction', 'throat closing',
  'suicidal', 'overdose', 'poisoning',
  'severe bleeding', 'uncontrolled bleeding',
  'call 911', 'emergency room', 'going to the er',
];

export function checkUrgent(text: string): boolean {
  const lower = text.toLowerCase();
  return URGENT_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Local extraction (fully on-device, no API call) ─────────
//
// Parses raw voice/text input into MedicalEntry structured fields
// using keyword matching and simple regex patterns.

const BODY_PARTS = [
  'head', 'forehead', 'temple', 'scalp',
  'eye', 'eyes', 'ear', 'ears', 'nose', 'throat', 'neck',
  'chest', 'heart', 'lung', 'lungs', 'rib',
  'stomach', 'abdomen', 'belly', 'bowel', 'intestine', 'colon',
  'back', 'spine', 'shoulder', 'arm', 'elbow', 'wrist', 'hand', 'finger',
  'hip', 'leg', 'knee', 'ankle', 'foot', 'toe',
  'skin', 'joint', 'muscle', 'nerve',
  'kidney', 'liver', 'bladder', 'prostate',
];

export function extractLocalMedical(rawInput: string): EntryDraft {
  const lower = rawInput.toLowerCase();

  // ── Type ────────────────────────────────────────────────────
  let type: MedicalEntry['type'] = 'symptom';
  if (/\b(took|taking|started|stopped|prescribed|medication|medicine|pill|tablet|capsule|drug|dose|mg\b|ml\b|supplement|vitamin|antibiotic|inhaler)\b/.test(lower))
    type = 'medication';
  else if (/\b(doctor|physician|appointment|visit|clinic|hospital|er\b|emergency room|specialist|gp\b|check.?up|consultation)\b/.test(lower))
    type = 'visit';
  else if (/\b(blood test|lab\b|result|test came back|levels|reading|count|biopsy|scan|x.?ray|mri\b|ct scan|ultrasound|ecg|ekg)\b/.test(lower))
    type = 'lab';
  else if (/\b(pattern|recurring|always|every time|keeps happening|noticed that|tends to|regularly|chronically)\b/.test(lower))
    type = 'pattern';

  // ── What (first meaningful clause, max 80 chars) ─────────────
  const what = rawInput.replace(/\n/g, ' ').trim().slice(0, 80);

  // ── Severity ─────────────────────────────────────────────────
  let severity: string | undefined;
  if      (/\b(mild|slight|minor|a little|not too bad)\b/.test(lower)) severity = 'mild';
  else if (/\b(moderate|medium|tolerable|manageable|some\b)\b/.test(lower)) severity = 'moderate';
  else if (/\b(severe|very\s+(bad|painful|strong)|intense|bad\b|worst|unbearable|excruciating|awful|terrible)\b/.test(lower)) severity = 'severe';
  else if (/\b(critical|extreme|emergency)\b/.test(lower)) severity = 'critical';

  // ── Duration ─────────────────────────────────────────────────
  const durationRx = /\b(since\s+[\w\s]+?(?=\s*[,.]|$)|for\s+\d+\s+\w+|\d+\s+(?:day|hour|week|month)s?|yesterday|today|this\s+morning|this\s+afternoon|last\s+(?:night|week|month)|past\s+\d+\s+\w+)\b/i;
  const durationMatch = rawInput.match(durationRx);
  const duration = durationMatch?.[0]?.trim();

  // ── Context (anything after a trigger word) ───────────────────
  const contextRx = /\b(?:after|when|because|triggered by|worse when|better when|started\s+after|following)\b(.{5,60})/i;
  const contextMatch = rawInput.match(contextRx);
  const context = contextMatch ? contextMatch[0].trim() : undefined;

  // ── Urgent ──────────────────────────────────────────────────
  const urgent = checkUrgent(rawInput);

  // ── Tags ────────────────────────────────────────────────────
  const tags: string[] = [type];
  if (severity) tags.push(severity);
  for (const part of BODY_PARTS) {
    if (lower.includes(part) && !tags.includes(part)) tags.push(part);
  }
  if (urgent) tags.push('urgent');

  return { type, rawInput, structured: { what, severity, duration, context, urgent }, tags };
}

// ─── Timeline context builder ─────────────────────────────────

export function buildTimelineContext(entries: MedicalEntry[]): string {
  if (entries.length === 0) return '';
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const lines = sorted.map(e => {
    const date = new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const badge = e.structured.urgent ? ' [URGENT]' : '';
    const sev = e.structured.severity ? ` · ${e.structured.severity}` : '';
    const dur = e.structured.duration ? ` · ${e.structured.duration}` : '';
    return `[${date}] ${e.type.toUpperCase()}${badge}: ${e.structured.what}${sev}${dur}`;
  });
  return lines.join('\n');
}

// ─── Pre-appointment summary (explicit Claude API call) ────────
//
// Only called when Pete explicitly taps "Generate Summary".
// This is the ONLY point where medical data leaves the device.

export async function generateAppointmentSummary(
  entries: MedicalEntry[],
  apiKey: string,
): Promise<string> {
  if (entries.length === 0) throw new Error('No entries to summarize');
  if (!apiKey) throw new Error('Claude API key not configured');

  const timeline = buildTimelineContext(entries);
  const patterns = await getPatterns();
  const patternCtx = buildPatternContext(patterns);

  const prompt = `You are a medical documentation assistant. Summarize this patient health timeline for use at a medical appointment.

HEALTH TIMELINE:
${timeline}${patternCtx}

Produce a structured summary with these exact sections:

SUMMARY
One paragraph overview of the patient's health picture over this period.

TIMELINE
Key events in chronological order, focusing on changes and progression.

CURRENT CONCERNS
The most active or recent symptoms, medications, and issues.

PATTERNS NOTICED
Any recurring symptoms, triggers, or trends visible in the data.

QUESTIONS FOR DOCTOR
3-5 specific questions the patient should ask their doctor based on this history.

IMPORTANT: This is a personal health log summary for a patient to bring to an appointment. Present it clearly and factually. Do not diagnose. Do not recommend treatments. Flag anything marked URGENT prominently.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: 'You are a medical documentation assistant helping a patient organize their health history for a doctor appointment. Be concise, factual, and clear.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data?.content?.[0]?.text ?? '').trim();
}

// ─── Formatting helpers ───────────────────────────────────────

const TYPE_LABELS: Record<MedicalEntry['type'], string> = {
  symptom:    'Symptom',
  medication: 'Medication',
  visit:      'Doctor Visit',
  lab:        'Lab / Test',
  pattern:    'Pattern',
};

const TYPE_COLORS: Record<MedicalEntry['type'], string> = {
  symptom:    '#ff6b6b',
  medication: '#4ecdc4',
  visit:      '#45b7d1',
  lab:        '#96ceb4',
  pattern:    '#cc99ff',
};

export function entryTypeLabel(type: MedicalEntry['type']): string {
  return TYPE_LABELS[type] ?? type;
}

export function entryTypeColor(type: MedicalEntry['type']): string {
  return TYPE_COLORS[type] ?? '#888';
}

export function entryRelativeDate(timestamp: string): string {
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 14)  return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────
// PHASE 4 — Hierarchical Temporal Compression
// ─────────────────────────────────────────────────────────────

const WEEKLY_KEY  = 'medical_weekly_v1';
const MONTHLY_KEY = 'medical_monthly_v1';
const PATTERNS_KEY = 'medical_patterns_v1';

// ─── Schemas ──────────────────────────────────────────────────

export interface SymptomSummary {
  name: string;
  count: number;
  avgSeverity: string;          // mild | moderate | severe | critical | mixed
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface WeeklySummary {
  weekStart: string;            // ISO8601 Monday of that week
  symptoms: SymptomSummary[];
  medications: { name: string; started?: boolean; stopped?: boolean; dosageChange?: boolean }[];
  visits: string[];             // free-text visit descriptions
  anomalies: string[];          // urgent events or outliers
}

export interface MonthlySummary {
  month: string;                // 'YYYY-MM'
  symptomFrequency: Record<string, number>;
  symptomTrends: Record<string, string>;
  medicationChanges: string[];
  doctorVisits: string[];
  abnormalEvents: string[];
}

// ─── Severity helpers ─────────────────────────────────────────

const SEV_RANK: Record<string, number> = {
  mild: 1, moderate: 2, severe: 3, critical: 4,
};

function avgSevLabel(entries: MedicalEntry[]): string {
  const ranked = entries.map(e => SEV_RANK[e.structured.severity ?? ''] ?? 0).filter(n => n > 0);
  if (ranked.length === 0) return 'mild';
  const avg = ranked.reduce((s, n) => s + n, 0) / ranked.length;
  if (avg >= 3.5) return 'critical';
  if (avg >= 2.5) return 'severe';
  if (avg >= 1.5) return 'moderate';
  return 'mild';
}

function severityTrend(older: MedicalEntry[], newer: MedicalEntry[]): 'increasing' | 'stable' | 'decreasing' {
  const rankOf = (es: MedicalEntry[]) => {
    const vals = es.map(e => SEV_RANK[e.structured.severity ?? ''] ?? 0).filter(n => n > 0);
    return vals.length > 0 ? vals.reduce((s, n) => s + n, 0) / vals.length : 0;
  };
  const diff = rankOf(newer) - rankOf(older);
  if (diff > 0.4) return 'increasing';
  if (diff < -0.4) return 'decreasing';
  return 'stable';
}

// ─── Monday of the week for a given date ─────────────────────

function mondayOf(d: Date): string {
  const day = d.getDay();                     // 0=Sun … 6=Sat
  const offset = day === 0 ? -6 : 1 - day;   // shift back to Monday
  const mon = new Date(d);
  mon.setDate(d.getDate() + offset);
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString();
}

// ─── compressToWeeklySummary ──────────────────────────────────

export function compressToWeeklySummary(entries: MedicalEntry[]): WeeklySummary[] {
  // Group entries by their Monday
  const byWeek = new Map<string, MedicalEntry[]>();
  for (const e of entries) {
    const key = mondayOf(new Date(e.timestamp));
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key)!.push(e);
  }

  const summaries: WeeklySummary[] = [];

  for (const [weekStart, week] of byWeek) {
    const symptoms = week.filter(e => e.type === 'symptom');
    const meds     = week.filter(e => e.type === 'medication');
    const visits   = week.filter(e => e.type === 'visit');
    const urgent   = week.filter(e => e.structured.urgent);

    // Cluster symptoms by name (from structured.what, normalised)
    const symMap = new Map<string, MedicalEntry[]>();
    for (const s of symptoms) {
      const key = s.structured.what.toLowerCase().slice(0, 30);
      if (!symMap.has(key)) symMap.set(key, []);
      symMap.get(key)!.push(s);
    }

    // To compute trend we split week in half (older vs newer half)
    const symSummaries: SymptomSummary[] = [];
    for (const [name, ses] of symMap) {
      const sorted = [...ses].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const mid = Math.floor(sorted.length / 2);
      const older = sorted.slice(0, mid);
      const newer = sorted.slice(mid);
      symSummaries.push({
        name,
        count: ses.length,
        avgSeverity: avgSevLabel(ses),
        trend: severityTrend(older, newer),
      });
    }

    // Medication events
    const medSummaries = meds.map(m => {
      const raw = m.rawInput.toLowerCase();
      return {
        name: m.structured.what.slice(0, 50),
        started:  /\b(started|began|first|new)\b/.test(raw),
        stopped:  /\b(stopped|ended|discontinued|no longer)\b/.test(raw),
        dosageChange: /\b(increased|decreased|changed|adjusted|dose|dosage|mg)\b/.test(raw),
      };
    });

    summaries.push({
      weekStart,
      symptoms: symSummaries,
      medications: medSummaries,
      visits: visits.map(v => v.structured.what.slice(0, 80)),
      anomalies: urgent.map(u => u.structured.what.slice(0, 80)),
    });
  }

  // Sort ascending by week start
  return summaries.sort((a, b) => new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime());
}

// ─── compressToMonthlySummary ─────────────────────────────────

export function compressToMonthlySummary(weeklies: WeeklySummary[]): MonthlySummary[] {
  const byMonth = new Map<string, WeeklySummary[]>();
  for (const w of weeklies) {
    const month = w.weekStart.slice(0, 7); // 'YYYY-MM'
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(w);
  }

  const summaries: MonthlySummary[] = [];

  for (const [month, weeks] of byMonth) {
    const freq: Record<string, number> = {};
    const trends: Record<string, string> = {};
    const medChanges: string[] = [];
    const docVisits: string[] = [];
    const abnormal: string[] = [];

    for (const w of weeks) {
      for (const s of w.symptoms) {
        freq[s.name] = (freq[s.name] ?? 0) + s.count;
        // Last trend wins — we're going forward in time
        trends[s.name] = s.trend;
      }
      for (const m of w.medications) {
        const flags = [m.started && 'started', m.stopped && 'stopped', m.dosageChange && 'dosage change']
          .filter(Boolean).join(', ');
        if (flags) medChanges.push(`${m.name} (${flags})`);
      }
      docVisits.push(...w.visits);
      abnormal.push(...w.anomalies);
    }

    summaries.push({
      month,
      symptomFrequency: freq,
      symptomTrends: trends,
      medicationChanges: [...new Set(medChanges)],
      doctorVisits: [...new Set(docVisits)],
      abnormalEvents: [...new Set(abnormal)],
    });
  }

  return summaries.sort((a, b) => a.month.localeCompare(b.month));
}

// ─── Storage for compressed layers ───────────────────────────

async function saveWeeklySummaries(s: WeeklySummary[]): Promise<void> {
  await secureStorage.setItem(WEEKLY_KEY, JSON.stringify(s));
}

async function saveMonthlySummaries(s: MonthlySummary[]): Promise<void> {
  await secureStorage.setItem(MONTHLY_KEY, JSON.stringify(s));
}

export async function getWeeklySummaries(): Promise<WeeklySummary[]> {
  try {
    const raw = await secureStorage.getItem(WEEKLY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export async function getMonthlySummaries(): Promise<MonthlySummary[]> {
  try {
    const raw = await secureStorage.getItem(MONTHLY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// ─── runCompression (called after every addEntry) ─────────────

export async function runCompression(entries: MedicalEntry[]): Promise<void> {
  const weeklies = compressToWeeklySummary(entries);
  const monthlies = compressToMonthlySummary(weeklies);
  await saveWeeklySummaries(weeklies);
  await saveMonthlySummaries(monthlies);
}

// ─── buildRetrievalContext ────────────────────────────────────
//
// Smart context builder that stays under ~1500 tokens:
//   • Last 30 days  → full raw entries (buildTimelineContext)
//   • Older than 30 days → monthly summaries only
//
// Raw data is NEVER deleted — this is an additional read layer.

export async function buildRetrievalContext(symptom?: string, days = 30): Promise<string> {
  const allEntries = await getEntries();
  const cutoff = Date.now() - days * 86_400_000;

  const recent = allEntries.filter(e => new Date(e.timestamp).getTime() >= cutoff);
  const older  = allEntries.filter(e => new Date(e.timestamp).getTime() < cutoff);

  const parts: string[] = [];

  // Recent: full raw timeline (already terse — one line per entry)
  if (recent.length > 0) {
    const filtered = symptom
      ? recent.filter(e =>
          e.structured.what.toLowerCase().includes(symptom.toLowerCase()) ||
          e.tags.some(t => t.toLowerCase().includes(symptom.toLowerCase())))
      : recent;
    if (filtered.length > 0) {
      parts.push(`=== Last ${days} days (${filtered.length} entries) ===\n${buildTimelineContext(filtered)}`);
    }
  }

  // Older: monthly summaries only (far more compact)
  if (older.length > 0) {
    const monthlies = await getMonthlySummaries();
    const olderMonths = monthlies.filter(m => {
      const monthEnd = new Date(m.month + '-28').getTime();
      return monthEnd < cutoff;
    });
    if (olderMonths.length > 0) {
      const lines = olderMonths.map(m => {
        const topSymptoms = Object.entries(m.symptomFrequency)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 4)
          .map(([name, count]) => `${name}×${count}`)
          .join(', ');
        const visits = m.doctorVisits.length > 0 ? ` · visits: ${m.doctorVisits.slice(0, 2).join('; ')}` : '';
        const meds   = m.medicationChanges.length > 0 ? ` · meds: ${m.medicationChanges.slice(0, 2).join('; ')}` : '';
        return `[${m.month}] ${topSymptoms}${meds}${visits}`;
      });
      parts.push(`=== Earlier history (monthly summaries) ===\n${lines.join('\n')}`);
    }
  }

  return parts.join('\n\n');
}

// ─────────────────────────────────────────────────────────────
// PHASE 5 — Pattern Detection
// ─────────────────────────────────────────────────────────────

export interface PatternSummary {
  id: string;
  patternType:
    | 'frequency_increase'
    | 'severity_escalation'
    | 'medication_correlation'
    | 'time_of_day'
    | 'symptom_chain';
  relatedSymptoms: string[];
  confidence: number;           // 0–1
  timeframe: string;
  description: string;
}

// ─── Severity ordinal for numeric comparison ──────────────────

function sevOrdinal(s?: string): number {
  if (s === 'critical') return 4;
  if (s === 'severe')   return 3;
  if (s === 'moderate') return 2;
  if (s === 'mild')     return 1;
  return 0;
}

function meanSev(entries: MedicalEntry[]): number {
  const vals = entries.map(e => sevOrdinal(e.structured.severity)).filter(n => n > 0);
  if (vals.length === 0) return 0;
  return vals.reduce((s, n) => s + n, 0) / vals.length;
}

// ─── Pattern 1: Frequency Increase ───────────────────────────

function detectFrequencyIncrease(symptoms: MedicalEntry[]): PatternSummary[] {
  const now = Date.now();
  const last30  = symptoms.filter(e => now - new Date(e.timestamp).getTime() <= 30 * 86_400_000);
  const prev30  = symptoms.filter(e => {
    const age = now - new Date(e.timestamp).getTime();
    return age > 30 * 86_400_000 && age <= 60 * 86_400_000;
  });

  if (last30.length === 0 || prev30.length === 0) return [];

  // Cluster by symptom name
  const nameCluster = (es: MedicalEntry[]) => {
    const m = new Map<string, number>();
    for (const e of es) {
      const k = e.structured.what.toLowerCase().slice(0, 30);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  const recent  = nameCluster(last30);
  const earlier = nameCluster(prev30);
  const patterns: PatternSummary[] = [];

  for (const [name, recentCount] of recent) {
    const prevCount = earlier.get(name) ?? 0;
    if (prevCount === 0) continue;  // new symptom — not a frequency increase
    if (recentCount > prevCount * 1.5) {
      const ratio = recentCount / prevCount;
      patterns.push({
        id: uuid(),
        patternType: 'frequency_increase',
        relatedSymptoms: [name],
        confidence: Math.min(0.95, 0.5 + ratio * 0.15),
        timeframe: 'last 60 days',
        description: `"${name}" occurred ${recentCount}× in the last 30 days vs ${prevCount}× the prior 30 days — frequency increasing.`,
      });
    }
  }

  return patterns;
}

// ─── Pattern 2: Severity Escalation ──────────────────────────

function detectSeverityEscalation(symptoms: MedicalEntry[]): PatternSummary[] {
  const now = Date.now();
  const nameCluster = (es: MedicalEntry[]) => {
    const m = new Map<string, MedicalEntry[]>();
    for (const e of es) {
      const k = e.structured.what.toLowerCase().slice(0, 30);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  };

  const recent  = nameCluster(symptoms.filter(e => now - new Date(e.timestamp).getTime() <= 30 * 86_400_000));
  const earlier = nameCluster(symptoms.filter(e => {
    const age = now - new Date(e.timestamp).getTime();
    return age > 30 * 86_400_000 && age <= 60 * 86_400_000;
  }));

  const patterns: PatternSummary[] = [];

  for (const [name, recentEs] of recent) {
    const prevEs = earlier.get(name);
    if (!prevEs || prevEs.length === 0) continue;
    const rMean = meanSev(recentEs);
    const pMean = meanSev(prevEs);
    if (rMean > 0 && pMean > 0 && rMean > pMean) {
      const delta = rMean - pMean;
      patterns.push({
        id: uuid(),
        patternType: 'severity_escalation',
        relatedSymptoms: [name],
        confidence: Math.min(0.92, 0.45 + delta * 0.2),
        timeframe: 'last 60 days',
        description: `"${name}" severity worsening — recent avg ${rMean.toFixed(1)} vs prior ${pMean.toFixed(1)} on a 1–4 scale.`,
      });
    }
  }

  return patterns;
}

// ─── Pattern 3: Medication Correlation ───────────────────────

function detectMedicationCorrelation(entries: MedicalEntry[]): PatternSummary[] {
  const sorted = [...entries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const meds     = sorted.filter(e => e.type === 'medication');
  const symptoms = sorted.filter(e => e.type === 'symptom');
  const patterns: PatternSummary[] = [];
  const WINDOW = 5 * 86_400_000; // 5 days in ms

  for (const med of meds) {
    const medTime = new Date(med.timestamp).getTime();
    const nearby  = symptoms.filter(s => {
      const diff = new Date(s.timestamp).getTime() - medTime;
      return diff >= 0 && diff <= WINDOW;
    });
    if (nearby.length >= 2) {
      const symNames = [...new Set(nearby.map(s => s.structured.what.toLowerCase().slice(0, 30)))];
      patterns.push({
        id: uuid(),
        patternType: 'medication_correlation',
        relatedSymptoms: symNames,
        confidence: Math.min(0.80, 0.4 + nearby.length * 0.08),
        timeframe: `within 5 days of ${new Date(med.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        description: `${nearby.length} symptom(s) occurred within 5 days of "${med.structured.what.slice(0, 50)}" — possible medication correlation.`,
      });
    }
  }

  return patterns;
}

// ─── Pattern 4: Time of Day ───────────────────────────────────

function detectTimeOfDay(symptoms: MedicalEntry[]): PatternSummary[] {
  if (symptoms.length < 5) return [];
  const nameCluster = new Map<string, number[]>();

  for (const s of symptoms) {
    const key  = s.structured.what.toLowerCase().slice(0, 30);
    const hour = new Date(s.timestamp).getHours();
    if (!nameCluster.has(key)) nameCluster.set(key, []);
    nameCluster.get(key)!.push(hour);
  }

  const patterns: PatternSummary[] = [];

  for (const [name, hours] of nameCluster) {
    if (hours.length < 4) continue;
    // Slide a 3-hour window across 24h; find peak count
    let maxCount = 0;
    let peakHour = 0;
    for (let h = 0; h < 24; h++) {
      const count = hours.filter(x => ((x - h + 24) % 24) < 3).length;
      if (count > maxCount) { maxCount = count; peakHour = h; }
    }
    const pct = maxCount / hours.length;
    if (pct >= 0.6) {
      const label = `${peakHour}:00–${(peakHour + 3) % 24}:00`;
      patterns.push({
        id: uuid(),
        patternType: 'time_of_day',
        relatedSymptoms: [name],
        confidence: Math.min(0.90, pct),
        timeframe: 'recurring',
        description: `${Math.round(pct * 100)}% of "${name}" occurrences cluster between ${label}.`,
      });
    }
  }

  return patterns;
}

// ─── Pattern 5: Symptom Chains ───────────────────────────────

function detectSymptomChains(symptoms: MedicalEntry[]): PatternSummary[] {
  if (symptoms.length < 6) return [];
  const sorted = [...symptoms].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const WINDOW = 24 * 3_600_000; // 24 hours
  const chains = new Map<string, number>();

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (diff > WINDOW) break;
      const nameA = a.structured.what.toLowerCase().slice(0, 25);
      const nameB = b.structured.what.toLowerCase().slice(0, 25);
      if (nameA === nameB) continue;
      const key = `${nameA} → ${nameB}`;
      chains.set(key, (chains.get(key) ?? 0) + 1);
    }
  }

  const patterns: PatternSummary[] = [];

  for (const [chain, count] of chains) {
    if (count >= 3) {
      const [a, b] = chain.split(' → ');
      patterns.push({
        id: uuid(),
        patternType: 'symptom_chain',
        relatedSymptoms: [a, b],
        confidence: Math.min(0.88, 0.4 + count * 0.08),
        timeframe: 'recurring',
        description: `"${a}" followed by "${b}" within 24h on ${count} separate occasions.`,
      });
    }
  }

  return patterns;
}

// ─── detectPatterns (runs all 5 detectors) ───────────────────

export function detectPatterns(entries: MedicalEntry[]): PatternSummary[] {
  const symptoms = entries.filter(e => e.type === 'symptom');
  return [
    ...detectFrequencyIncrease(symptoms),
    ...detectSeverityEscalation(symptoms),
    ...detectMedicationCorrelation(entries),
    ...detectTimeOfDay(symptoms),
    ...detectSymptomChains(symptoms),
  ];
}

// ─── Pattern storage ──────────────────────────────────────────

export async function savePatterns(patterns: PatternSummary[]): Promise<void> {
  await secureStorage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
}

export async function getPatterns(): Promise<PatternSummary[]> {
  try {
    const raw = await secureStorage.getItem(PATTERNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// ─── runPatternDetection (called after every addEntry) ────────
//
// Rate-limited: re-runs at most once per day unless forced.
// Stores detected patterns in encrypted storage.

const PATTERN_TS_KEY = 'medical_pattern_ts_v1';

export async function runPatternDetection(
  entries: MedicalEntry[],
  force = false,
): Promise<PatternSummary[]> {
  if (!force) {
    try {
      const lastRun = await secureStorage.getItem(PATTERN_TS_KEY);
      if (lastRun) {
        const age = Date.now() - Number(lastRun);
        if (age < 86_400_000) return getPatterns(); // < 1 day old — skip
      }
    } catch (e) { console.warn('[Medical] pattern rate-limit check failed:', e); }
  }
  const patterns = detectPatterns(entries);
  await savePatterns(patterns);
  try { await secureStorage.setItem(PATTERN_TS_KEY, String(Date.now())); } catch (e) { console.warn('[Medical] pattern timestamp save failed:', e); }
  return patterns;
}

// ─── Pattern display helpers ──────────────────────────────────

const PATTERN_TYPE_LABELS: Record<PatternSummary['patternType'], string> = {
  frequency_increase:     'Freq. Increase',
  severity_escalation:    'Worsening',
  medication_correlation: 'Med. Correlation',
  time_of_day:            'Time of Day',
  symptom_chain:          'Symptom Chain',
};

const PATTERN_TYPE_COLORS: Record<PatternSummary['patternType'], string> = {
  frequency_increase:     '#ffaa44',
  severity_escalation:    '#ff5555',
  medication_correlation: '#44aaff',
  time_of_day:            '#aa88ff',
  symptom_chain:          '#44ffaa',
};

export function patternTypeLabel(type: PatternSummary['patternType']): string {
  return PATTERN_TYPE_LABELS[type] ?? type;
}

export function patternTypeColor(type: PatternSummary['patternType']): string {
  return PATTERN_TYPE_COLORS[type] ?? '#888';
}

export function confidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ─── Inject top patterns into appointment summary prompt ──────
//
// Called by generateAppointmentSummary to enrich the Claude prompt
// with detected patterns so the model can highlight them.

export function buildPatternContext(patterns: PatternSummary[]): string {
  if (patterns.length === 0) return '';
  const top = [...patterns]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  const lines = top.map(p =>
    `- [${patternTypeLabel(p.patternType)} · ${Math.round(p.confidence * 100)}% confidence] ${p.description}`,
  );
  return `\nDETECTED PATTERNS (auto-detected, highlight in your summary):\n${lines.join('\n')}`;
}
