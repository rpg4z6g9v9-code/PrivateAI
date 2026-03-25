/**
 * patternAnalysisAgent.ts — Conversation Pattern Analysis
 *
 * Analyzes conversation summaries to detect:
 * - Recurring topics (what you talk about most)
 * - Time patterns (when you're most active)
 * - Stalled action items (things that stay pending)
 * - Topic evolution (how interests shift over time)
 *
 * Pure local analysis — no API calls, no cloud dependency.
 */

import { getAllSummaries, type ConversationSummary, type ActionItem } from '../conversationSummarizer';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface PatternReport {
  generatedAt: string;
  conversationsAnalyzed: number;
  dateRange: { earliest: string; latest: string };

  // Topic patterns
  topTopics: Array<{ subject: string; count: number; percentage: number }>;
  topicsByWeek: Array<{ week: string; subjects: Record<string, number> }>;

  // Time patterns
  hourDistribution: Record<number, number>;  // hour (0-23) → count
  dayDistribution: Record<string, number>;   // "Mon","Tue",... → count
  peakHour: number;
  peakDay: string;
  avgConversationsPerDay: number;

  // Action item health
  stalledActions: Array<{ task: string; age: number; fromDate: string }>;
  completionRate: number;  // 0-1

  // Insights (human-readable)
  insights: string[];
}

// ─────────────────────────────────────────────────────────────
// ANALYSIS
// ─────────────────────────────────────────────────────────────

/**
 * Run full pattern analysis on all stored summaries.
 */
export async function analyzePatterns(): Promise<PatternReport> {
  const summaries = await getAllSummaries();
  console.log(`[PatternAgent] Analyzing ${summaries.length} summaries`);

  if (summaries.length === 0) {
    return emptyReport();
  }

  const sorted = [...summaries].sort((a, b) => a.date.localeCompare(b.date));
  const earliest = sorted[0].date;
  const latest = sorted[sorted.length - 1].date;

  // ── Topic Analysis ─────────────────────────────────────────
  const topicCounts = new Map<string, number>();
  for (const s of summaries) {
    topicCounts.set(s.subject, (topicCounts.get(s.subject) ?? 0) + 1);
  }
  const topTopics = [...topicCounts.entries()]
    .map(([subject, count]) => ({
      subject,
      count,
      percentage: Math.round((count / summaries.length) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Topics by week
  const weekMap = new Map<string, Record<string, number>>();
  for (const s of summaries) {
    const week = getWeekKey(s.date);
    const subjects = weekMap.get(week) ?? {};
    subjects[s.subject] = (subjects[s.subject] ?? 0) + 1;
    weekMap.set(week, subjects);
  }
  const topicsByWeek = [...weekMap.entries()]
    .map(([week, subjects]) => ({ week, subjects }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // ── Time Patterns ──────────────────────────────────────────
  const hourDist: Record<number, number> = {};
  const dayDist: Record<string, number> = {};
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const s of summaries) {
    const d = new Date(s.date);
    const hour = d.getHours();
    hourDist[hour] = (hourDist[hour] ?? 0) + 1;
    const dayName = dayNames[d.getDay()];
    dayDist[dayName] = (dayDist[dayName] ?? 0) + 1;
  }

  const peakHour = Object.entries(hourDist)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? '12';
  const peakDay = Object.entries(dayDist)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Mon';

  // Average conversations per day
  const daySpan = Math.max(1, Math.ceil(
    (new Date(latest).getTime() - new Date(earliest).getTime()) / (24 * 60 * 60 * 1000)
  ));
  const avgPerDay = Math.round((summaries.length / daySpan) * 10) / 10;

  // ── Action Item Health ─────────────────────────────────────
  const allActions: Array<ActionItem & { fromDate: string }> = [];
  for (const s of summaries) {
    for (const a of s.actionItems) {
      allActions.push({ ...a, fromDate: s.date });
    }
  }

  const doneCount = allActions.filter(a => a.status === 'done').length;
  const completionRate = allActions.length > 0 ? doneCount / allActions.length : 0;

  // Stalled = pending for more than 7 days
  const now = Date.now();
  const stalledActions = allActions
    .filter(a => a.status === 'pending' || a.status === 'blocked')
    .map(a => ({
      task: a.task,
      age: Math.floor((now - new Date(a.fromDate).getTime()) / (24 * 60 * 60 * 1000)),
      fromDate: a.fromDate,
    }))
    .filter(a => a.age >= 7)
    .sort((a, b) => b.age - a.age)
    .slice(0, 10);

  // ── Generate Insights ──────────────────────────────────────
  const insights = generateInsights({
    summaries, topTopics, peakHour: Number(peakHour), peakDay,
    avgPerDay, completionRate, stalledActions,
  });

  const report: PatternReport = {
    generatedAt: new Date().toISOString(),
    conversationsAnalyzed: summaries.length,
    dateRange: { earliest, latest },
    topTopics,
    topicsByWeek,
    hourDistribution: hourDist,
    dayDistribution: dayDist,
    peakHour: Number(peakHour),
    peakDay,
    avgConversationsPerDay: avgPerDay,
    stalledActions,
    completionRate: Math.round(completionRate * 100) / 100,
    insights,
  };

  console.log(
    `[PatternAgent] Analysis complete: ${topTopics.length} topics, ` +
    `peak ${peakDay} ${peakHour}:00, ${stalledActions.length} stalled actions, ` +
    `${Math.round(completionRate * 100)}% completion rate`
  );

  return report;
}

// ─────────────────────────────────────────────────────────────
// INSIGHT GENERATION (rule-based, no API)
// ─────────────────────────────────────────────────────────────

function generateInsights(data: {
  summaries: ConversationSummary[];
  topTopics: PatternReport['topTopics'];
  peakHour: number;
  peakDay: string;
  avgPerDay: number;
  completionRate: number;
  stalledActions: PatternReport['stalledActions'];
}): string[] {
  const insights: string[] = [];

  // Topic breakdown — always show what was actually discussed
  if (data.topTopics.length > 0) {
    const topicList = data.topTopics.slice(0, 4)
      .map(t => `${t.subject} (${t.count}x, ${t.percentage}%)`)
      .join(', ');
    insights.push(`Topics: ${topicList}`);
  }

  // Time pattern — factual only
  const timeLabel = data.peakHour < 6 ? 'late night' :
    data.peakHour < 12 ? 'morning' :
    data.peakHour < 17 ? 'afternoon' : 'evening';
  insights.push(`Peak activity: ${data.peakDay} ${timeLabel}s (${data.peakHour}:00), ${data.avgPerDay}/day avg`);

  // Action item stats — numbers only
  const totalActions = data.summaries.reduce((sum, s) => sum + s.actionItems.length, 0);
  if (totalActions > 0) {
    insights.push(
      `Actions: ${totalActions} total, ${Math.round(data.completionRate * 100)}% done, ` +
      `${data.stalledActions.length} stalled 7+ days`
    );
  }

  // Surface actual stalled items by name
  for (const a of data.stalledActions.slice(0, 3)) {
    insights.push(`Stalled ${a.age}d: "${a.task.slice(0, 70)}"`);
  }

  // Surface actual highlights from recent summaries
  const recentHighlights = data.summaries.slice(0, 5)
    .flatMap(s => s.hardStickNotes)
    .filter(Boolean)
    .slice(0, 3);
  for (const note of recentHighlights) {
    insights.push(`Decision: ${note.slice(0, 80)}`);
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function getWeekKey(isoDate: string): string {
  const d = new Date(isoDate);
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((d.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000) + startOfYear.getDay() + 1) / 7
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function emptyReport(): PatternReport {
  return {
    generatedAt: new Date().toISOString(),
    conversationsAnalyzed: 0,
    dateRange: { earliest: '', latest: '' },
    topTopics: [],
    topicsByWeek: [],
    hourDistribution: {},
    dayDistribution: {},
    peakHour: 0,
    peakDay: '',
    avgConversationsPerDay: 0,
    stalledActions: [],
    completionRate: 0,
    insights: ['No summaries stored yet.'],
  };
}

console.log('[PatternAgent] Service loaded');
