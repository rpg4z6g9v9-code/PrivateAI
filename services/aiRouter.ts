/**
 * aiRouter.ts — PrivateAI AI Router
 *
 * Single entry point: decide local (Llama) vs cloud (Claude), execute inference,
 * parse tool calls from the response, run them, then feed results back for a
 * refined answer.
 *
 * Routing: reasoning → cloud (Claude), discussion → local (Llama).
 *
 * Context isolation: reasoning tasks get austere prompts (no memory/history bleed),
 * chat tasks get rich prompts with filtered memory and capped recent turns.
 *
 * Compression activates when history > MIN_MESSAGES_TO_COMPRESS (chat mode only).
 */

import { generateLocal, isModelLoaded } from './localAI';
import { executeTool } from './toolExecutor';
import type { ToolAction } from './toolTypes';
import { callClaudeAPI, type ConversationMessage } from './claude';
import { getContext } from './contextMemory';
import { compressConversationHistory } from './contextCompressor';
import {
  extractAndIndexConcepts, queryGraphContext, getTopInsights,
  isLearnQuery, synthesizeInsights,
  containsMilestone, createMilestone,
  shouldAutoIndex,
} from './knowledgeGraph';
// ROUTER_SYSTEM_PROMPT available from personaPrompts if needed
import { detectTaskType, type PromptMode } from './atomPrompts';
import {
  routeAndAssemble, getIsolationMode, sanitizeForPrompt,
  getFileContextForPrompt,
  type AssembledPrompt,
} from './contextIsolation';

// ── Types ─────────────────────────────────────────────────────

export interface AIRouterResult {
  text: string;
  model: 'claude' | 'llama' | 'instant';
  route: 'local' | 'cloud' | 'quick_reply';
  latency: number;
  toolsUsed: string[];
}

// ── Compression config ────────────────────────────────────────

const COMPRESSION_CONFIG = {
  /** Compression only activates when history exceeds this length. */
  MIN_MESSAGES_TO_COMPRESS: 8,
  /** Always keep this many recent messages verbatim. */
  KEEP_RECENT_MESSAGES: 6,
  /** Set to false to disable compression globally (e.g. for debugging). */
  COMPRESSION_ENABLED: true,
} as const;

// ── Smart Routing ────────────────────────────────────────────

type QuestionType = 'reasoning' | 'discussion';

const REASONING_KEYWORDS = [
  'logic', 'puzzle', 'syllogism', 'math', 'calculate',
  'pattern', 'sequence', 'day of week', 'date',
  'how many', 'solve', 'next number', 'what comes next',
  'if all', 'if some', 'therefore', 'conclude',
];

const DISCUSSION_KEYWORDS = [
  'explain', 'why', 'ethical', 'should', 'transparent',
  'aware', 'hallucination', 'uncertainty', 'privacy',
  'opinion', 'think about', 'what do you',
];

function detectQuestionType(text: string): QuestionType {
  const lower = text.toLowerCase();
  if (REASONING_KEYWORDS.some(k => lower.includes(k))) return 'reasoning';
  if (DISCUSSION_KEYWORDS.some(k => lower.includes(k))) return 'discussion';
  return 'discussion';
}

/**
 * Smart routing: reasoning → cloud (Claude is better at logic),
 * discussion → local when model is loaded (Llama handles conversation fine).
 * Falls back to old heuristic when forceLocal is set.
 */
function shouldUseLocal(message: string): boolean {
  const qType = detectQuestionType(message);
  console.log('[aiRouter] questionType:', qType, '→ prefer:', qType === 'reasoning' ? 'cloud' : 'local');
  return qType !== 'reasoning';
}

// ── Tool call parser ──────────────────────────────────────────

/**
 * Extract JSON tool-call objects from a model response.
 * Uses [^{}]* so multi-line JSON blobs are matched correctly.
 */
function parseToolCalls(response: string): ToolAction[] {
  const toolPattern = /\{[^{}]*"action"[^{}]*\}/g;
  const matches = response.match(toolPattern) ?? [];

  return matches
    .map(m => {
      try { return JSON.parse(m) as ToolAction; }
      catch { return null; }
    })
    .filter((t): t is ToolAction => t !== null);
}

// ── Quick replies ─────────────────────────────────────────────

const QUICK_REPLIES: Record<string, string> = {
  hi:           "Hey! What are we building today?",
  hello:        "Hey! What are we building today?",
  thanks:       "You're welcome!",
  'thank you':  "You're welcome!",
  ok:           "Got it.",
  okay:         "Got it.",
};

// ── Main router ───────────────────────────────────────────────

/**
 * Route a message to the best available model, run any tool calls in the
 * response, then return a refined final answer.
 *
 * Falls back to Claude if Llama is not loaded, even when routing prefers local.
 */
export async function routeAI(
  userMessage: string,
  options: {
    forceLocal?: boolean;
    history?: ConversationMessage[];
    systemPrompt?: string;
    mode?: PromptMode;
    /** Structured context for isolation layer (preferred over systemPrompt) */
    memoryPrompt?: string;
    knowledgeContext?: string;
    connectorContext?: string;
    medicalContext?: string;
    fileContext?: string;
  } = {},
): Promise<AIRouterResult> {
  const t0 = Date.now();

  // ── Quick reply: no model call needed ───────────────────────
  const quickReply = QUICK_REPLIES[userMessage.toLowerCase().trim()];
  if (quickReply) {
    return { text: quickReply, model: 'instant', route: 'quick_reply', latency: 0, toolsUsed: [] };
  }

  // ── "What have you learned?" — synthesize from KG directly ──
  if (isLearnQuery(userMessage)) {
    const insights = await synthesizeInsights();
    return { text: insights, model: 'instant', route: 'quick_reply', latency: Date.now() - t0, toolsUsed: [] };
  }

  // ── Routing decision ─────────────────────────────────────────
  const preferLocal = options.forceLocal !== undefined
    ? options.forceLocal
    : shouldUseLocal(userMessage);
  const modelLoaded = isModelLoaded();
  const useLocal = preferLocal && modelLoaded;

  console.log('[aiRouter] routing decision:', {
    messageLength: userMessage.length,
    hasResearch:   userMessage.includes('research'),
    forceLocal:    options.forceLocal,
    preferLocal,
    modelLoaded,
    useLocal,
    decidedRoute:  useLocal ? 'llama' : 'claude',
  });

  // ── Context Isolation: assemble prompt based on task type ────
  const promptMode: PromptMode = options.mode ?? (useLocal ? 'local' : 'cloud');
  const taskType = detectTaskType(userMessage);
  const isolation = getIsolationMode(taskType);

  // ── Document grounding: fetch relevant file context (chat only) ─
  let fileContext = options.fileContext ?? '';
  if (isolation === 'chat' && !fileContext) {
    try {
      fileContext = await getFileContextForPrompt(userMessage);
    } catch (e) {
      console.warn('[Router] getFileContextForPrompt failed:', e);
      fileContext = '';
    }
  }

  const assembled: AssembledPrompt = routeAndAssemble(userMessage, promptMode, {
    personaPrompt: options.systemPrompt,
    memoryPrompt: options.memoryPrompt,
    knowledgeContext: options.knowledgeContext,
    connectorContext: options.connectorContext,
    medicalContext: options.medicalContext,
    fileContext,
    contextEcho: getContext(),
    history: options.history,
  });

  let systemPrompt = assembled.systemPrompt;
  let historyForModel: ConversationMessage[] = assembled.messages;

  // ── Local model hard cap ──────────────────────────────────────
  // Llama 3.2 3B has a 2048-token context. If routed to local,
  // use compact local prompt + inject a condensed shared context (goals/profile).
  // Budget: ~800 tokens system, ~1200 for conversation.
  if (useLocal && systemPrompt.length > 2000) {
    const { buildLocalSystemPrompt } = require('./localAI');
    const { buildSharedContextCompact } = require('./sharedMemory');
    const localPersonaId = options.systemPrompt?.includes('Atlas') ? 'atlas'
      : options.systemPrompt?.includes('Vera') ? 'vera'
      : options.systemPrompt?.includes('Cipher') ? 'cipher'
      : options.systemPrompt?.includes('Lumen') ? 'lumen'
      : 'pete';
    const localBase = buildLocalSystemPrompt(localPersonaId);
    const sharedCompact: string = await buildSharedContextCompact();
    systemPrompt = localBase + sharedCompact;
    // Only keep last 2 turns for local to save context
    historyForModel = historyForModel.slice(-3);
    console.log('[aiRouter] local cap applied — prompt trimmed to', systemPrompt.length, 'chars');
  }

  console.log('[aiRouter] prompt:', {
    length: systemPrompt.length,
    mode: promptMode,
    taskType,
    isolation,
    hasPersonaPrompt: !!options.systemPrompt,
  });

  // ── Compression (chat mode only — reasoning stays austere) ───
  if (
    isolation === 'chat' &&
    !useLocal &&
    COMPRESSION_CONFIG.COMPRESSION_ENABLED &&
    historyForModel.length > COMPRESSION_CONFIG.MIN_MESSAGES_TO_COMPRESS
  ) {
    // Separate the final user message before compressing history
    const currentUserMsg = historyForModel[historyForModel.length - 1];
    const pastMessages = historyForModel.slice(0, -1);

    const compressed = await compressConversationHistory(
      pastMessages,
      COMPRESSION_CONFIG.KEEP_RECENT_MESSAGES,
    );

    if (compressed.summary) {
      systemPrompt += `\n\nEarlier conversation summary:\n${compressed.summary}`;
    }

    historyForModel = [...compressed.compressedMessages, currentUserMsg];
  }

  // ── Knowledge Graph: auto-index + milestone detection ──────────
  // Quality-gated: only index substantive messages (not greetings/questions/commands)
  if (shouldAutoIndex(userMessage)) {
    extractAndIndexConcepts(userMessage).catch((e) => {
      console.warn('[KG] Auto-index failed (non-fatal):', e);
    });

    // Auto-detect milestones (significant decisions)
    if (containsMilestone(userMessage)) {
      const title = userMessage.length > 80 ? userMessage.slice(0, 80) + '...' : userMessage;
      createMilestone(title).catch(() => {});
    }
  }

  // Enrich system prompt with graph context — CHAT ONLY
  // Reasoning tasks stay austere to prevent context contamination
  if (isolation === 'chat') {
    const [graphContext, topInsights] = await Promise.all([
      queryGraphContext(userMessage),
      getTopInsights(),
    ]);
    if (graphContext) {
      const cleaned = sanitizeForPrompt(graphContext);
      if (cleaned) systemPrompt += `\n\n${cleaned}`;
    }
    if (topInsights) {
      const cleaned = sanitizeForPrompt(topInsights);
      if (cleaned) systemPrompt += `\n\n${cleaned}`;
    }
  }

  // ── Step 1: first model call ─────────────────────────────────
  let response = useLocal
    ? await generateLocal(userMessage, systemPrompt)
    : await callClaudeAPI(historyForModel, systemPrompt);

  const model: 'claude' | 'llama' = useLocal ? 'llama' : 'claude';

  // ── Step 2: execute tool calls found in response ─────────────
  const toolCalls = parseToolCalls(response);

  for (const toolCall of toolCalls) {
    const result = await executeTool(toolCall);
    response += `\n\nTool result: ${JSON.stringify(result)}`;
  }

  return {
    text: response,
    model,
    route: useLocal ? 'local' : 'cloud',
    latency: Date.now() - t0,
    toolsUsed: toolCalls.map(t => t.action),
  };
}
