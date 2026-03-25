/**
 * kernel.ts — PrivateAI Super-Agent Orchestration Kernel
 *
 * Pure classification and synthesis logic. No React, no API calls.
 * The kernel decides WHO responds, in WHAT ORDER, and HOW to synthesize.
 * All async execution remains in sendTeamResponse (index.tsx).
 *
 * Routing categories and default chains:
 *   simple   → [] guests     — lead persona responds alone
 *   research → researcher → critic
 *   coding   → architect → builder → critic
 *   complex  → researcher → architect → builder → critic
 *
 * Lead persona (Atlas/Atom) always opens (brief frame) and closes (kernel synthesis).
 */

// ─── Types ────────────────────────────────────────────────────

export type RoutingCategory = 'simple' | 'research' | 'coding' | 'complex';
export type ConfidenceLevel  = 'high' | 'medium' | 'low';

export interface KernelPlan {
  category: RoutingCategory;
  /** Ordered guest persona IDs. Does not include 'pete' (Atom opens and closes). */
  guests: string[];
  /** Human-readable explanation shown in the handoff banner. */
  rationale: string;
  /** False for 'simple' — caller falls through to single-persona response. */
  useTeam: boolean;
}

export interface PersonaResult {
  personaId: string;
  response: string;
  confidence: ConfidenceLevel;
}

// ─── Signal patterns ─────────────────────────────────────────

const RESEARCH_RX = /\b(research|explain|why\b|what\s+is|how\s+does|overview|compare|difference|differences|learn|understand|what\s+are|what\s+were|history|background|context|meaning|define|definition|tell\s+me\s+about)\b/i;

const CODING_RX   = /\b(code|implement|build|create|write|deploy|develop|ship|function|component|hook|screen|service|fix\b|refactor|bug\b|crash|error\b|api\b|database|query|endpoint|integration|typescript|react\s+native|expo)\b/i;

const ARCH_RX     = /\b(architect(?:ure)?|system|design\b|struct(?:ure)?|scal(?:e|able|ability)|schema|pattern\b|infrastructure|data\s+model|data\s+flow|pipeline)\b/i;

const COMPLEX_RX  = /\b(full\b|entire|complete\b|end.to.end|from\s+scratch|project\b|roadmap|strategy|multi.?step|plan\s+and|both\b|design\s+and|build\s+and|research\s+and)\b/i;

const CONVERSATIONAL_RX = /^(hi|hey|hello|thanks|thank\s+you|ok|okay|sure|yes|no|yep|nope|cool|great|nice|got\s+it|sounds\s+good|perfect|what('s|\s+is)\s+up|how\s+are\s+you|good\s+(morning|afternoon|evening))\b/i;

// ─── Classification ───────────────────────────────────────────

/**
 * Classify a user message and return the kernel routing plan.
 * Called once per message at the sendTeamResponse entry point.
 */
export function kernelClassify(text: string): KernelPlan {
  const trimmed = text.trim();
  const lower   = trimmed.toLowerCase();

  // Pure conversational or very short — Atom alone
  if (trimmed.length < 42 || CONVERSATIONAL_RX.test(lower)) {
    return {
      category: 'simple',
      guests: [],
      rationale: 'Conversational — lead responds directly',
      useTeam: false,
    };
  }

  const hasResearch = RESEARCH_RX.test(lower);
  const hasCoding   = CODING_RX.test(lower);
  const hasArch     = ARCH_RX.test(lower);
  const hasComplex  = COMPLEX_RX.test(lower);

  // Complex: multi-domain or explicit cross-cutting project
  if (hasComplex || (hasResearch && hasCoding) || (hasResearch && hasArch)) {
    return {
      category: 'complex',
      guests: ['researcher', 'architect', 'builder', 'critic'],
      rationale: 'Multi-domain: Researcher → Architect → Builder → Critic',
      useTeam: true,
    };
  }

  // Coding: technical implementation (architecture implied)
  if (hasCoding || hasArch) {
    return {
      category: 'coding',
      guests: ['architect', 'builder', 'critic'],
      rationale: 'Technical task: Architect → Builder → Critic',
      useTeam: true,
    };
  }

  // Research: knowledge question needing depth + critique
  if (hasResearch) {
    return {
      category: 'research',
      guests: ['researcher', 'critic'],
      rationale: 'Research question: Researcher → Critic',
      useTeam: true,
    };
  }

  // Complex-enough question but no clear domain signal — strategic/advisory
  if (trimmed.length > 80) {
    return {
      category: 'research',
      guests: ['researcher', 'critic'],
      rationale: 'Advisory question: Researcher → Critic',
      useTeam: true,
    };
  }

  // Short, non-conversational, no domain signal — lead responds alone
  return {
    category: 'simple',
    guests: [],
    rationale: 'Direct question — lead responds alone',
    useTeam: false,
  };
}

// ─── Confidence scoring ───────────────────────────────────────

/**
 * Phrases that indicate the persona triggered its hallucination guard.
 * Their presence pushes confidence down.
 */
const UNCERTAINTY_PHRASES: string[] = [
  "i'm not certain", "i'm not sure", "i'm uncertain",
  "i don't know", "i cannot confirm", "i can't confirm",
  "you should verify", "you'll want to verify", "worth verifying",
  "may have changed", "might be wrong", "i may be incorrect",
  "consult a", "double-check", "double check",
  "as far as i know", "to the best of my knowledge",
  "i believe but", "i think but",
];

/**
 * Phrases that indicate hedging without full uncertainty.
 */
const HEDGING_PHRASES: string[] = [
  "typically", "usually", "generally", "in most cases",
  "it's possible", "might ", "may ", "could be",
  "tends to", "often ", "sometimes ",
];

/**
 * Score the confidence of a persona response based on hallucination guard signals.
 *
 * high   — authoritative, no hedging detected
 * medium — some hedging but no explicit uncertainty flags
 * low    — persona explicitly flagged uncertainty (triggered hallucination guard)
 */
export function scoreConfidence(response: string): ConfidenceLevel {
  const lower = response.toLowerCase();

  const uncertaintyHits = UNCERTAINTY_PHRASES.filter(p => lower.includes(p)).length;
  if (uncertaintyHits >= 1) return 'low';

  const hedgingHits = HEDGING_PHRASES.filter(p => lower.includes(p)).length;
  if (hedgingHits >= 3) return 'medium';

  return 'high';
}

// ─── Synthesis context builder ────────────────────────────────

const CONFIDENCE_BADGE: Record<ConfidenceLevel, string> = {
  high:   '',
  medium: ' [verify some details]',
  low:    ' [⚠ flagged uncertainty]',
};

/**
 * Build the synthesis instruction injected into Atom's closing prompt.
 * Includes each persona's truncated response, confidence badge, and
 * an explicit note when low-confidence responses need to be weighted down.
 */
export function buildKernelSynthesisContext(
  plan: KernelPlan,
  results: PersonaResult[],
): string {
  if (results.length === 0) {
    return '\n\nProvide a clear, direct answer. Lead with the recommendation.';
  }

  const summaries = results
    .map(r => {
      const label = r.personaId.charAt(0).toUpperCase() + r.personaId.slice(1);
      const badge = CONFIDENCE_BADGE[r.confidence];
      return `${label}${badge}:\n"${r.response.slice(0, 380).trim()}"`;
    })
    .join('\n\n');

  const lowConfidenceWarning = results.some(r => r.confidence === 'low')
    ? '\nOne or more team members flagged uncertainty — reflect that in your synthesis rather than presenting everything as settled.'
    : '';

  const anyLowConfidence = results.some(r => r.confidence !== 'high')
    ? '\nWhere confidence was less than high, recommend Pete verify the specific claim.'
    : '';

  return `

Kernel routing: ${plan.rationale}

Team analysis:

${summaries}
${lowConfidenceWarning}${anyLowConfidence}

Now synthesize: resolve any contradictions, lead with the clearest actionable answer, and keep it to 3–5 sentences. Speak in one unified voice as the lead persona.`;
}

// ─── Kernel banner text ───────────────────────────────────────

/**
 * Returns the opening banner text shown before the team starts working.
 * Displayed as a handoff message so the user knows the kernel fired.
 */
export function kernelBannerText(plan: KernelPlan): string {
  return `--- kernel: ${plan.rationale.toLowerCase()} ---`;
}
