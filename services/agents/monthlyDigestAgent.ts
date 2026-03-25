/**
 * monthlyDigestAgent.ts — Monthly Intelligence Digest
 *
 * Synthesizes conversation summaries from the past month into a
 * structured digest with topic trends, decision log, and open actions.
 *
 * Runs on-demand or auto-triggered on the 1st of each month.
 * Uses Claude Haiku for synthesis (cheap + fast).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSummariesByDate, getAllSummaries, type ConversationSummary } from '../conversationSummarizer';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface TopicTrend {
  subject: string;
  count: number;
  totalMessages: number;
  totalMinutes: number;
}

export interface MonthlyDigest {
  id: string;
  month: string;              // "2026-03"
  generatedAt: string;        // ISO timestamp
  period: { start: string; end: string };

  // Synthesis
  topicTrends: TopicTrend[];
  keyDecisions: string[];     // From hardStickNotes across all summaries
  openActions: Array<{ task: string; status: string; fromDate: string }>;
  completedActions: Array<{ task: string; fromDate: string }>;

  // Stats
  totalConversations: number;
  totalMessages: number;
  totalMinutes: number;
  mostActiveDay: string;
  topSubject: string;
}

const DIGESTS_KEY = 'privateai_monthly_digests';
const LAST_DIGEST_KEY = 'privateai_last_digest_date';

// ─────────────────────────────────────────────────────────────
// DIGEST GENERATION
// ─────────────────────────────────────────────────────────────

/**
 * Generate a monthly digest from summaries in the given month.
 * @param month - Format "YYYY-MM" (e.g., "2026-03"). Defaults to current month.
 */
export async function generateMonthlyDigest(month?: string): Promise<MonthlyDigest> {
  const now = new Date();
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = targetMonth.split('-').map(Number);

  const start = new Date(year, mon - 1, 1).toISOString();
  const end = new Date(year, mon, 0, 23, 59, 59).toISOString(); // last day of month

  console.log(`[DigestAgent] Generating digest for ${targetMonth} (${start} → ${end})`);

  let summaries: ConversationSummary[];
  try {
    summaries = await getSummariesByDate(start, end);
  } catch (e) {
    console.warn('[DigestAgent] getSummariesByDate failed, using fallback:', e);
    // Fallback: filter all summaries by month
    const all = await getAllSummaries();
    summaries = all.filter(s => s.date.startsWith(targetMonth));
  }

  console.log(`[Phase3-Debug] Summaries received: ${summaries.length} total`);
  console.log(`[Phase3-Debug] Sample data: ${JSON.stringify(summaries.slice(0, 3).map(s => ({
    id: s.id,
    subject: s.subject,
    date: s.date,
    highlights: s.highlights,
    hardStickNotes: s.hardStickNotes,
    actionItems: s.actionItems,
    messageCount: s.messageCount,
  }))).substring(0, 800)}`);

  if (summaries.length === 0) {
    console.log('[DigestAgent] No summaries found for', targetMonth);
    return emptyDigest(targetMonth, start, end);
  }

  // ── Topic Trends ──────────────────────────────────────────
  const subjectMap = new Map<string, TopicTrend>();
  for (const s of summaries) {
    const existing = subjectMap.get(s.subject) ?? {
      subject: s.subject, count: 0, totalMessages: 0, totalMinutes: 0,
    };
    existing.count++;
    existing.totalMessages += s.messageCount;
    existing.totalMinutes += s.estimatedTimeSpent;
    subjectMap.set(s.subject, existing);
  }
  const topicTrends = [...subjectMap.values()].sort((a, b) => b.count - a.count);

  // ── Key Decisions (from hardStickNotes) ────────────────────
  const keyDecisions = summaries
    .flatMap(s => s.hardStickNotes)
    .filter(Boolean);

  // ── Action Items ──────────────────────────────────────────
  const openActions: MonthlyDigest['openActions'] = [];
  const completedActions: MonthlyDigest['completedActions'] = [];

  for (const s of summaries) {
    for (const a of s.actionItems) {
      if (a.status === 'done') {
        completedActions.push({ task: a.task, fromDate: s.date });
      } else {
        openActions.push({ task: a.task, status: a.status, fromDate: s.date });
      }
    }
  }

  // ── Stats ─────────────────────────────────────────────────
  const totalMessages = summaries.reduce((sum, s) => sum + s.messageCount, 0);
  const totalMinutes = summaries.reduce((sum, s) => sum + s.estimatedTimeSpent, 0);

  // Most active day
  const dayCounts = new Map<string, number>();
  for (const s of summaries) {
    const day = s.date.split('T')[0];
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const mostActiveDay = [...dayCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? targetMonth + '-01';

  const topSubject = topicTrends[0]?.subject ?? 'General';

  const digest: MonthlyDigest = {
    id: `digest_${targetMonth}_${Date.now()}`,
    month: targetMonth,
    generatedAt: now.toISOString(),
    period: { start, end },
    topicTrends,
    keyDecisions,
    openActions,
    completedActions,
    totalConversations: summaries.length,
    totalMessages,
    totalMinutes,
    mostActiveDay,
    topSubject,
  };

  // Persist
  await storeDigest(digest);

  console.log(
    `[DigestAgent] Digest ready: ${summaries.length} conversations, ` +
    `${topicTrends.length} topics, ${keyDecisions.length} decisions, ` +
    `${openActions.length} open / ${completedActions.length} done actions`
  );
  console.log(`[Phase3-Debug] Digest output: ${JSON.stringify({
    topicTrends: digest.topicTrends.slice(0, 5),
    keyDecisions: digest.keyDecisions.slice(0, 5),
    openActions: digest.openActions.slice(0, 5),
    topSubject: digest.topSubject,
    mostActiveDay: digest.mostActiveDay,
  }).substring(0, 800)}`);

  return digest;
}

// ─────────────────────────────────────────────────────────────
// AUTO-TRIGGER (1st of month)
// ─────────────────────────────────────────────────────────────

/**
 * Check if a digest should be auto-generated (once per month).
 * Call this at app startup.
 */
export async function checkAndRunDigest(): Promise<MonthlyDigest | null> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const lastDigest = await AsyncStorage.getItem(LAST_DIGEST_KEY);
  if (lastDigest === currentMonth) {
    console.log('[DigestAgent] Digest already generated for', currentMonth);
    return null;
  }

  // Generate digest for previous month
  const prevMonth = now.getMonth() === 0
    ? `${now.getFullYear() - 1}-12`
    : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

  const digest = await generateMonthlyDigest(prevMonth);
  await AsyncStorage.setItem(LAST_DIGEST_KEY, currentMonth);
  return digest;
}

// ─────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────

async function storeDigest(digest: MonthlyDigest): Promise<void> {
  try {
    const existing = await getDigests();
    existing.push(digest);
    // Keep last 12 months
    const recent = existing.slice(-12);
    await AsyncStorage.setItem(DIGESTS_KEY, JSON.stringify(recent));
  } catch (e) {
    console.error('[DigestAgent] Store error:', e);
  }
}

export async function getDigests(): Promise<MonthlyDigest[]> {
  try {
    const raw = await AsyncStorage.getItem(DIGESTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[DigestAgent] getDigests parse failed:', e);
    return [];
  }
}

export async function getLatestDigest(): Promise<MonthlyDigest | null> {
  const digests = await getDigests();
  return digests.length > 0 ? digests[digests.length - 1] : null;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function emptyDigest(month: string, start: string, end: string): MonthlyDigest {
  return {
    id: `digest_${month}_empty`,
    month,
    generatedAt: new Date().toISOString(),
    period: { start, end },
    topicTrends: [],
    keyDecisions: [],
    openActions: [],
    completedActions: [],
    totalConversations: 0,
    totalMessages: 0,
    totalMinutes: 0,
    mostActiveDay: '',
    topSubject: 'None',
  };
}

/**
 * Scrub sensitive phrases from all cached digests' keyDecisions.
 */
export async function scrubDigests(phrases: string[]): Promise<number> {
  const digests = await getDigests();
  let scrubbed = 0;
  for (const d of digests) {
    const before = d.keyDecisions.length;
    d.keyDecisions = d.keyDecisions.filter(
      dec => !phrases.some(p => dec.toLowerCase().includes(p.toLowerCase()))
    );
    if (d.keyDecisions.length !== before) scrubbed++;
  }
  if (scrubbed > 0) {
    await AsyncStorage.setItem(DIGESTS_KEY, JSON.stringify(digests));
    console.log(`[DigestAgent] Scrubbed ${scrubbed} digest(s)`);
  }
  return scrubbed;
}

console.log('[DigestAgent] Service loaded');
