/**
 * decisionMemoryAgent.ts — Decision Memory Tracking
 *
 * Extracts and tracks important decisions from conversation summaries.
 * Identifies decision patterns, tracks outcomes, and flags decisions
 * that may need follow-up or have become contradictory.
 *
 * Pure local analysis — no API calls, no cloud dependency.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAllSummaries, type ConversationSummary } from '../conversationSummarizer';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface Decision {
  id: string;
  text: string;
  subject: string;
  date: string;
  category: 'architecture' | 'tooling' | 'process' | 'personal' | 'general';
  status: 'active' | 'superseded' | 'review_needed';
  relatedDecisions: string[];   // IDs of potentially contradictory/related decisions
}

export interface DecisionMemory {
  generatedAt: string;
  totalDecisions: number;
  decisions: Decision[];
  categoryBreakdown: Record<string, number>;
  recentDecisions: Decision[];          // Last 30 days
  reviewNeeded: Decision[];             // Contradictions or stale decisions
  decisionFrequency: number;            // Avg decisions per week
  insights: string[];
}

const DECISIONS_KEY = 'privateai_decision_memory';

// ─────────────────────────────────────────────────────────────
// DECISION EXTRACTION
// ─────────────────────────────────────────────────────────────

const DECISION_SIGNALS = [
  'decided', 'chose', 'going with', 'settled on', 'committed to',
  'will use', 'switching to', 'moving to', 'adopting', 'dropping',
  'replacing', 'keeping', 'sticking with', 'agreed to', 'confirmed',
  'finalized', 'locked in', 'approved', 'rejected', 'ruled out',
];

const CATEGORY_KEYWORDS: Record<Decision['category'], string[]> = {
  architecture: ['architecture', 'database', 'schema', 'api', 'backend', 'frontend', 'stack', 'framework', 'pattern', 'structure'],
  tooling: ['tool', 'library', 'package', 'dependency', 'sdk', 'cli', 'editor', 'ide', 'plugin'],
  process: ['workflow', 'process', 'sprint', 'deploy', 'release', 'test', 'ci', 'review', 'schedule'],
  personal: ['habit', 'routine', 'goal', 'health', 'exercise', 'diet', 'sleep', 'meditation'],
  general: [],
};

function categorizeDecision(text: string): Decision['category'] {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'general') continue;
    if (keywords.some(kw => lower.includes(kw))) {
      return category as Decision['category'];
    }
  }
  return 'general';
}

function isDecisionText(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_SIGNALS.some(signal => lower.includes(signal));
}

function extractDecisionsFromNotes(
  notes: string[],
  subject: string,
  date: string,
): Decision[] {
  const decisions: Decision[] = [];

  for (const note of notes) {
    if (!isDecisionText(note)) continue;

    decisions.push({
      id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text: note,
      subject,
      date,
      category: categorizeDecision(note),
      status: 'active',
      relatedDecisions: [],
    });
  }

  return decisions;
}

// ─────────────────────────────────────────────────────────────
// CONTRADICTION / RELATION DETECTION
// ─────────────────────────────────────────────────────────────

function findRelatedDecisions(decision: Decision, allDecisions: Decision[]): string[] {
  const related: string[] = [];
  const words = new Set(
    decision.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );

  for (const other of allDecisions) {
    if (other.id === decision.id) continue;
    if (other.category !== decision.category) continue;

    const otherWords = new Set(
      other.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );
    const overlap = [...words].filter(w => otherWords.has(w)).length;

    // If >30% word overlap in same category, likely related
    if (overlap >= 2 && overlap / Math.min(words.size, otherWords.size) > 0.3) {
      related.push(other.id);
    }
  }

  return related;
}

function detectReviewNeeded(decisions: Decision[]): Decision[] {
  const review: Decision[] = [];
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const dec of decisions) {
    // Flag decisions with related/potentially contradictory decisions
    if (dec.relatedDecisions.length > 0) {
      const hasNewer = dec.relatedDecisions.some(relId => {
        const related = decisions.find(d => d.id === relId);
        return related && new Date(related.date).getTime() > new Date(dec.date).getTime();
      });
      if (hasNewer && dec.status === 'active') {
        dec.status = 'review_needed';
        review.push(dec);
        continue;
      }
    }

    // Flag old active decisions (90+ days) for review
    const age = now - new Date(dec.date).getTime();
    if (age > 3 * thirtyDaysMs && dec.status === 'active') {
      dec.status = 'review_needed';
      review.push(dec);
    }
  }

  return review;
}

// ─────────────────────────────────────────────────────────────
// INSIGHT GENERATION
// ─────────────────────────────────────────────────────────────

function generateInsights(memory: Omit<DecisionMemory, 'insights'>): string[] {
  const insights: string[] = [];

  if (memory.totalDecisions === 0) {
    return ['No decisions tracked yet. Keep conversing and I\'ll identify key decisions.'];
  }

  // Category breakdown
  const topCategory = Object.entries(memory.categoryBreakdown)
    .sort((a, b) => b[1] - a[1])[0];
  if (topCategory && topCategory[1] > 1) {
    insights.push(
      `Most decisions are about ${topCategory[0]} (${topCategory[1]} decisions).`
    );
  }

  // Decision frequency
  if (memory.decisionFrequency > 3) {
    insights.push(`High decision velocity: ~${memory.decisionFrequency.toFixed(1)} decisions/week.`);
  } else if (memory.decisionFrequency > 0 && memory.decisionFrequency < 0.5) {
    insights.push(`Low decision frequency: ~${memory.decisionFrequency.toFixed(1)} decisions/week.`);
  }

  // Review needed
  if (memory.reviewNeeded.length > 0) {
    insights.push(
      `${memory.reviewNeeded.length} decision(s) may need review — ` +
      `either superseded or older than 90 days.`
    );
  }

  // Recent activity
  if (memory.recentDecisions.length > 0) {
    insights.push(
      `${memory.recentDecisions.length} decision(s) made in the last 30 days.`
    );
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────
// MAIN ANALYSIS
// ─────────────────────────────────────────────────────────────

/**
 * Analyze all summaries and build a decision memory report.
 */
export async function analyzeDecisions(): Promise<DecisionMemory> {
  const summaries = await getAllSummaries();
  console.log(`[DecisionAgent] Analyzing ${summaries.length} summaries for decisions`);

  if (summaries.length === 0) {
    return emptyMemory();
  }

  // Extract decisions from hardStickNotes across all summaries
  const allDecisions: Decision[] = [];
  for (const s of summaries) {
    const extracted = extractDecisionsFromNotes(s.hardStickNotes, s.subject, s.date);
    allDecisions.push(...extracted);
  }

  // Find related/contradictory decisions
  for (const dec of allDecisions) {
    dec.relatedDecisions = findRelatedDecisions(dec, allDecisions);
  }

  // Detect which need review
  const reviewNeeded = detectReviewNeeded(allDecisions);

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const dec of allDecisions) {
    categoryBreakdown[dec.category] = (categoryBreakdown[dec.category] ?? 0) + 1;
  }

  // Recent decisions (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentDecisions = allDecisions.filter(d => d.date >= thirtyDaysAgo);

  // Decision frequency (decisions per week)
  const sorted = [...allDecisions].sort((a, b) => a.date.localeCompare(b.date));
  let decisionFrequency = 0;
  if (sorted.length >= 2) {
    const spanMs = new Date(sorted[sorted.length - 1].date).getTime() -
                   new Date(sorted[0].date).getTime();
    const spanWeeks = Math.max(1, spanMs / (7 * 24 * 60 * 60 * 1000));
    decisionFrequency = Math.round((allDecisions.length / spanWeeks) * 10) / 10;
  }

  const partial: Omit<DecisionMemory, 'insights'> = {
    generatedAt: new Date().toISOString(),
    totalDecisions: allDecisions.length,
    decisions: allDecisions,
    categoryBreakdown,
    recentDecisions,
    reviewNeeded,
    decisionFrequency,
  };

  const memory: DecisionMemory = {
    ...partial,
    insights: generateInsights(partial),
  };

  // Persist
  await storeDecisionMemory(memory);

  console.log(
    `[DecisionAgent] Analysis complete: ${allDecisions.length} decisions, ` +
    `${Object.keys(categoryBreakdown).length} categories, ` +
    `${reviewNeeded.length} need review`
  );

  return memory;
}

// ─────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────

async function storeDecisionMemory(memory: DecisionMemory): Promise<void> {
  try {
    await AsyncStorage.setItem(DECISIONS_KEY, JSON.stringify(memory));
  } catch (e) {
    console.error('[DecisionAgent] Store error:', e);
  }
}

export async function getDecisionMemory(): Promise<DecisionMemory | null> {
  try {
    const raw = await AsyncStorage.getItem(DECISIONS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[DecisionAgent] getDecisionMemory parse failed:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function emptyMemory(): DecisionMemory {
  return {
    generatedAt: new Date().toISOString(),
    totalDecisions: 0,
    decisions: [],
    categoryBreakdown: {},
    recentDecisions: [],
    reviewNeeded: [],
    decisionFrequency: 0,
    insights: ['No decisions tracked yet. Keep conversing and I\'ll identify key decisions.'],
  };
}

console.log('[DecisionAgent] Service loaded');
