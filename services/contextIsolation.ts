/**
 * contextIsolation.ts — PrivateAI Context Isolation Layer
 *
 * Production pattern: reasoning and chat tasks get different prompt
 * assemblies to prevent context contamination.
 *
 * Reasoning (logic, math, puzzles):
 *   SYSTEM + RUNTIME_HEADER + USER — no memory, no conversation history bleed
 *
 * Chat (discussion, general):
 *   SYSTEM + RUNTIME_HEADER + FILTERED_MEMORY + RECENT_TURNS + USER
 *
 * This prevents memory bleed from polluting reasoning accuracy while
 * keeping chat contextually rich.
 */

import { buildAtomPrompt, detectTaskType, type PromptMode, type TaskType } from './atomPrompts';
import type { ConversationMessage } from './claude';
import { getFiles, getFileContent, type FileMetadata } from './knowledgeBase';
import { listFiles, type StoredFile } from './filesService';

// ── Configuration ──────────────────────────────────────────────

const ISOLATION_CONFIG = {
  /** Max memory items injected into chat prompts. */
  MAX_MEMORY_ITEMS: 4,
  /** Minimum relevance score (0-1) for memory inclusion. */
  MIN_MEMORY_SCORE: 0.75,
  /** Recent turns kept for reasoning tasks. */
  REASONING_RECENT_TURNS: 2,
  /** Recent turns kept for chat tasks. */
  CHAT_RECENT_TURNS: 6,
} as const;

// ── Contamination Patterns ─────────────────────────────────────

/** Strings that should never appear in a reasoning prompt. */
const CONTAMINATION_PATTERNS = [
  'internal router state',
  'developer scratchpad',
  'debug note',
  'TODO:',
  'FIXME:',
  'sprint',
  'milestone',
  'earlier conversation summary',
];

// ── Types ──────────────────────────────────────────────────────

export type IsolationMode = 'reasoning' | 'chat';

export interface AssembledPrompt {
  systemPrompt: string;
  messages: ConversationMessage[];
  isolation: IsolationMode;
  taskType: TaskType;
  promptMode: PromptMode;
}

// ── Core Functions ─────────────────────────────────────────────

/**
 * Determine isolation mode from task type.
 * Logic and summarization get austere reasoning context.
 * Everything else gets rich chat context.
 */
export function getIsolationMode(taskType: TaskType): IsolationMode {
  return taskType === 'logic' || taskType === 'summarization'
    ? 'reasoning'
    : 'chat';
}

/**
 * Sanitize a memory/context string by removing contamination patterns.
 * Returns cleaned string or empty if entirely contaminated.
 */
export function sanitizeForPrompt(text: string): string {
  if (!text) return '';

  let cleaned = text;
  for (const pattern of CONTAMINATION_PATTERNS) {
    // Remove lines containing contamination patterns
    cleaned = cleaned
      .split('\n')
      .filter(line => !line.toLowerCase().includes(pattern.toLowerCase()))
      .join('\n');
  }

  return cleaned.trim();
}

/**
 * Filter and cap memory entries for prompt injection.
 * Scores by simple keyword overlap with the user message.
 */
export function selectRelevantMemory(
  memoryPrompt: string,
  userMessage: string,
): string {
  if (!memoryPrompt) return '';

  // Split memory into individual entries (separated by double newlines)
  const entries = memoryPrompt
    .split(/\n\n+/)
    .map(e => e.trim())
    .filter(Boolean);

  if (entries.length === 0) return '';

  // Score each entry by keyword overlap with user message
  const userWords = new Set(
    userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  );

  const scored = entries.map(entry => {
    const entryWords = entry.toLowerCase().split(/\s+/);
    const overlap = entryWords.filter(w => userWords.has(w)).length;
    const score = userWords.size > 0 ? overlap / userWords.size : 0;
    return { entry, score };
  });

  // Filter by minimum score, cap at MAX_MEMORY_ITEMS
  const selected = scored
    .filter(s => s.score >= ISOLATION_CONFIG.MIN_MEMORY_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, ISOLATION_CONFIG.MAX_MEMORY_ITEMS)
    .map(s => s.entry);

  return selected.length > 0 ? selected.join('\n\n') : '';
}

/**
 * Select recent conversation turns based on isolation mode.
 * Reasoning: last 2 turns only (minimal context).
 * Chat: last 6 turns (rich context).
 */
export function selectRecentTurns(
  history: ConversationMessage[],
  isolation: IsolationMode,
): ConversationMessage[] {
  const maxTurns = isolation === 'reasoning'
    ? ISOLATION_CONFIG.REASONING_RECENT_TURNS
    : ISOLATION_CONFIG.CHAT_RECENT_TURNS;

  // A "turn" is a user+assistant pair, so we take maxTurns * 2 messages
  const maxMessages = maxTurns * 2;
  return history.slice(-maxMessages);
}

/**
 * Check if a context string should be excluded from the prompt entirely.
 * Returns true if it contains poisoning patterns or is too noisy.
 */
export function shouldExcludeFromPrompt(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  // Exclude if >50% of lines match contamination patterns
  const lines = lower.split('\n').filter(Boolean);
  if (lines.length === 0) return true;
  const contaminated = lines.filter(line =>
    CONTAMINATION_PATTERNS.some(p => line.includes(p.toLowerCase())),
  ).length;
  return contaminated / lines.length > 0.5;
}

/**
 * Get a runtime header for the current task type.
 * Provides task-specific instructions without full prompt weight.
 */
function getRuntimeHeader(taskType: TaskType): string {
  switch (taskType) {
    case 'logic':
      return '[RUNTIME: Evaluation mode. Answer the question. Do not reference prior conversation topics.]';
    case 'summarization':
      return '[RUNTIME: Summarization mode. Focus only on the provided content.]';
    case 'memory_extraction':
      return '[RUNTIME: Memory extraction mode. Analyze for patterns and preferences.]';
    default:
      return '';
  }
}

// ── Prompt Builders ────────────────────────────────────────────

/**
 * Build an austere reasoning prompt.
 * SYSTEM + RUNTIME + USER only. No memory, no conversation history bleed.
 */
export function buildReasoningPrompt(
  userMessage: string,
  promptMode: PromptMode,
  taskType: TaskType,
  _personaPrompt?: string,
): AssembledPrompt {
  const parts: string[] = [];

  // Layer 1: Atom system prompt (identity + rules + mode + task)
  parts.push(buildAtomPrompt(promptMode, taskType));

  // Layer 2: Runtime header (task-specific instruction)
  const runtime = getRuntimeHeader(taskType);
  if (runtime) parts.push(runtime);

  // Layer 3: NO persona prompt for reasoning — it contains project context
  // (North star, mission, persona descriptions) that contaminates logic/math answers.
  // The Atom system prompt from buildAtomPrompt is sufficient.

  return {
    systemPrompt: parts.join('\n\n'),
    messages: [{ role: 'user', content: userMessage }],
    isolation: 'reasoning',
    taskType,
    promptMode,
  };
}

/**
 * Build a rich chat prompt with controlled context.
 * SYSTEM + RUNTIME + FILTERED_MEMORY + RECENT_TURNS + USER
 */
export function buildChatPrompt(
  userMessage: string,
  promptMode: PromptMode,
  taskType: TaskType,
  options: {
    personaPrompt?: string;
    memoryPrompt?: string;
    knowledgeContext?: string;
    connectorContext?: string;
    medicalContext?: string;
    contextEcho?: string;
    fileContext?: string;
    history?: ConversationMessage[];
  } = {},
): AssembledPrompt {
  const parts: string[] = [];

  // Layer 1: Atom system prompt
  parts.push(buildAtomPrompt(promptMode, taskType));

  // Layer 2: Runtime header
  const runtime = getRuntimeHeader(taskType);
  if (runtime) parts.push(runtime);

  // Layer 3: Persona prompt (full, for chat)
  if (options.personaPrompt) {
    parts.push(options.personaPrompt);
  }

  // Layer 4: Filtered memory (relevance-scored, capped)
  if (options.memoryPrompt) {
    const relevant = selectRelevantMemory(options.memoryPrompt, userMessage);
    if (relevant) {
      parts.push(`Relevant memory:\n${relevant}`);
    }
  }

  // Layer 5: Knowledge context (sanitized)
  if (options.knowledgeContext) {
    const cleaned = sanitizeForPrompt(options.knowledgeContext);
    if (cleaned && !shouldExcludeFromPrompt(cleaned)) {
      parts.push(cleaned);
    }
  }

  // Layer 6: Connector context (sanitized)
  if (options.connectorContext) {
    const cleaned = sanitizeForPrompt(options.connectorContext);
    if (cleaned && !shouldExcludeFromPrompt(cleaned)) {
      parts.push(cleaned);
    }
  }

  // Layer 7: Medical context (already trust-bounded by securityGateway)
  if (options.medicalContext) {
    parts.push(options.medicalContext);
  }

  // Layer 8: File context (document grounding — referenced files)
  if (options.fileContext) {
    parts.push(options.fileContext);
  }

  // Layer 9: Context echo (recent conversation summary)
  if (options.contextEcho) {
    const cleaned = sanitizeForPrompt(options.contextEcho);
    if (cleaned) {
      parts.push(`Recent conversation context:\n${cleaned}`);
    }
  }

  // Select recent turns (controlled window)
  const history = options.history ?? [];
  const recentTurns = selectRecentTurns(history, 'chat');

  return {
    systemPrompt: parts.join('\n\n'),
    messages: [...recentTurns, { role: 'user', content: userMessage }],
    isolation: 'chat',
    taskType,
    promptMode,
  };
}

// ── Document Grounding ────────────────────────────────────────

/** Max characters of file content to inject into the prompt. */
const MAX_FILE_CONTEXT_CHARS = 8_000;

/**
 * Check if the user message references any indexed files and return
 * relevant file content for prompt injection.
 *
 * Matching strategy:
 * 1. Exact filename mention (e.g. "what's in notes.txt?")
 * 2. Keyword overlap with file names (fuzzy)
 *
 * Returns formatted file context string or empty.
 */
export async function getFileContextForPrompt(userMessage: string): Promise<string> {
  const lower = userMessage.toLowerCase();

  // Gather files from both stores
  let kbFiles: FileMetadata[] = [];
  let storedFiles: StoredFile[] = [];
  try {
    [kbFiles, storedFiles] = await Promise.all([getFiles(), listFiles()]);
  } catch (e) {
    console.warn('[Context] getFileContextForPrompt failed:', e);
    return '';
  }

  // Build unified list with content
  const candidates: { name: string; content: string }[] = [];

  for (const f of kbFiles) {
    if (f.content) candidates.push({ name: f.name, content: f.content });
  }
  for (const f of storedFiles) {
    if (f.content) candidates.push({ name: f.name, content: f.content });
  }

  if (candidates.length === 0) return '';

  // Deduplicate by name (prefer KB version which may be more recent)
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    const key = c.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Generic file-referencing keywords → check content, not just name
  const FILE_KEYWORDS = ['file', 'document', 'content', 'indexed', 'uploaded'];
  const mentionsFiles = FILE_KEYWORDS.some(k => lower.includes(k));

  // Score each file by relevance to the user message
  const userWords = new Set(
    lower.split(/\s+/).filter(w => w.length > 2),
  );

  const scored = unique.map(file => {
    const nameLower = file.name.toLowerCase();
    // Exact filename mention → high score
    if (lower.includes(nameLower) || lower.includes(nameLower.replace(/\.[^.]+$/, ''))) {
      return { file, score: 1.0 };
    }
    // Keyword overlap with filename
    const nameWords = nameLower.replace(/[._-]/g, ' ').split(/\s+/);
    const nameOverlap = nameWords.filter(w => userWords.has(w)).length;
    const nameScore = nameWords.length > 0 ? nameOverlap / nameWords.length : 0;
    if (nameScore >= 0.5) return { file, score: nameScore };

    // Content relevance: check if user's question words appear in file content
    const contentLower = file.content.toLowerCase();
    const contentWords = [...userWords].filter(w => w.length > 3);
    const contentHits = contentWords.filter(w => contentLower.includes(w)).length;
    const contentScore = contentWords.length > 0 ? contentHits / contentWords.length : 0;

    // If user mentions generic file keywords, lower the threshold
    if (mentionsFiles && contentScore >= 0.2) return { file, score: 0.6 };

    return { file, score: contentScore >= 0.4 ? contentScore : nameScore };
  });

  // Only include files with meaningful relevance
  const relevant = scored
    .filter(s => s.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3); // max 3 files

  if (relevant.length === 0) return '';

  // Build context string with truncation
  let totalChars = 0;
  const sections: string[] = [];

  for (const { file } of relevant) {
    const remaining = MAX_FILE_CONTEXT_CHARS - totalChars;
    if (remaining <= 0) break;

    const excerpt = file.content.length > remaining
      ? file.content.slice(0, remaining) + '\n... (content truncated)'
      : file.content;

    sections.push(`[File: ${file.name}]\n${excerpt}`);
    totalChars += excerpt.length;
  }

  console.log('[contextIsolation] Injecting file context for', relevant.length, 'files');

  let context = '\n\n### INDEXED FILES CONTEXT ###\n';
  context += `The user has indexed ${unique.length} file(s). `;
  context += `The following ${relevant.length} file(s) may be relevant:\n\n`;
  context += sections.join('\n\n');
  context += '\n\n### INSTRUCTION ###\n';
  context += 'When you reference information from these files, cite the filename like: [Source: filename.txt]\n';
  context += '---';

  return context;
}

// ── Single Entry Point ─────────────────────────────────────────

/**
 * Route and assemble the prompt based on task type.
 * This is the single entry point replacing direct prompt assembly.
 *
 * Reasoning tasks → austere prompt (no contamination)
 * Chat tasks → rich prompt (controlled context)
 */
export function routeAndAssemble(
  userMessage: string,
  promptMode: PromptMode,
  options: {
    personaPrompt?: string;
    memoryPrompt?: string;
    knowledgeContext?: string;
    connectorContext?: string;
    medicalContext?: string;
    contextEcho?: string;
    fileContext?: string;
    history?: ConversationMessage[];
  } = {},
): AssembledPrompt {
  const taskType = detectTaskType(userMessage);
  const isolation = getIsolationMode(taskType);

  console.log('[contextIsolation] mode:', isolation, 'taskType:', taskType);

  if (isolation === 'reasoning') {
    return buildReasoningPrompt(
      userMessage,
      promptMode,
      taskType,
      options.personaPrompt,
    );
  }

  return buildChatPrompt(
    userMessage,
    promptMode,
    taskType,
    options,
  );
}
