/**
 * intelligenceOrchestrator.ts — Phase 3 Intelligence Layer Orchestrator
 *
 * Coordinates all Phase 3 intelligence agents in sequence after
 * Phase 2 cloud sync completes. Produces structured log output:
 *
 *   [Phase3] Starting Intelligence Layer Analysis...
 *   [Phase3] ✅ Monthly Digest Generated
 *   [Phase3] ✅ Decision Memory Generated
 *   [Phase3] ✅ Knowledge Graph Generated
 *   [Phase3] ✅ Pattern Analysis Generated
 *   [Phase3] ✅ Intelligence Layer Complete
 */

import { checkAndRunDigest, generateMonthlyDigest, type MonthlyDigest } from './monthlyDigestAgent';
// Lazy imports — only loaded when their section is enabled
// import { analyzeDecisions, type DecisionMemory } from './decisionMemoryAgent';
// import { analyzePatterns, type PatternReport } from './patternAnalysisAgent';
// import { extractAndIndexConcepts, getGraphSummary, type GraphSummary } from '../knowledgeGraph';
// import { getAllSummaries } from '../conversationSummarizer';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface IntelligenceReport {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  digest: MonthlyDigest | null;
  decisions: any | null;      // DecisionMemory — re-enable import when section is active
  graphSummary: any | null;   // GraphSummary — re-enable import when section is active
  patterns: any | null;       // PatternReport — re-enable import when section is active
  errors: string[];
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

/**
 * Run the full Phase 3 Intelligence Layer analysis.
 * Call after Phase 2 sync (e.g., after syncToLocalMock completes).
 *
 * Each agent runs sequentially to avoid resource contention.
 * Failures are caught per-agent so one failure doesn't block the rest.
 */
export async function runIntelligenceLayer(): Promise<IntelligenceReport> {
  console.log('🔥 PHASE3 ENTRY');
  const startTime = Date.now();
  const report: IntelligenceReport = {
    startedAt: new Date(startTime).toISOString(),
    completedAt: '',
    durationMs: 0,
    digest: null,
    decisions: null,
    graphSummary: null,
    patterns: null,
    errors: [],
  };

  console.log('[Phase3] Starting Intelligence Layer Analysis...');

  // ── 1. Monthly Digest (ACTIVE) ─────────────────────────────
  try {
    const digest = await checkAndRunDigest();
    if (digest) {
      report.digest = digest;
    } else {
      // Already generated this month — generate for current month on-demand
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      report.digest = await generateMonthlyDigest(currentMonth);
    }
    console.log('[Phase3] ✅ Monthly Digest Generated');
  } catch (e) {
    const msg = `Monthly Digest failed: ${(e as Error).message}`;
    report.errors.push(msg);
    console.error('[Phase3] ❌ Monthly Digest failed:', e);
  }

  // ── 2. Decision Memory (DISABLED — isolating digest first) ──
  // try {
  //   report.decisions = await analyzeDecisions();
  //   console.log('[Phase3] ✅ Decision Memory Generated');
  // } catch (e) {
  //   const msg = `Decision Memory failed: ${(e as Error).message}`;
  //   report.errors.push(msg);
  //   console.error('[Phase3] ❌ Decision Memory failed:', e);
  // }

  // ── 3. Knowledge Graph (DISABLED — isolating digest first) ──
  // try {
  //   const summaries = await getAllSummaries();
  //   const recentSummaries = summaries.slice(0, 20);
  //   for (const s of recentSummaries) {
  //     const text = [
  //       ...s.highlights,
  //       ...s.hardStickNotes,
  //       ...s.actionItems.map(a => a.task),
  //     ].join('. ');
  //     if (text.length > 10) {
  //       await extractAndIndexConcepts(text);
  //     }
  //   }
  //   report.graphSummary = await getGraphSummary();
  //   console.log('[Phase3] ✅ Knowledge Graph Generated');
  // } catch (e) {
  //   const msg = `Knowledge Graph failed: ${(e as Error).message}`;
  //   report.errors.push(msg);
  //   console.error('[Phase3] ❌ Knowledge Graph failed:', e);
  // }

  // ── 4. Pattern Analysis (DISABLED — isolating digest first) ─
  // try {
  //   report.patterns = await analyzePatterns();
  //   console.log('[Phase3] ✅ Pattern Analysis Generated');
  // } catch (e) {
  //   const msg = `Pattern Analysis failed: ${(e as Error).message}`;
  //   report.errors.push(msg);
  //   console.error('[Phase3] ❌ Pattern Analysis failed:', e);
  // }

  // ── Complete ───────────────────────────────────────────────
  const endTime = Date.now();
  report.completedAt = new Date(endTime).toISOString();
  report.durationMs = endTime - startTime;

  if (report.errors.length === 0) {
    console.log(`[Phase3] ✅ Intelligence Layer Complete (${report.durationMs}ms)`);
  } else {
    console.log(
      `[Phase3] ⚠️ Intelligence Layer Complete with ${report.errors.length} error(s) (${report.durationMs}ms)`
    );
  }

  return report;
}

console.log('[IntelligenceOrchestrator] Service loaded');
