/**
 * toolExecutor.ts — PrivateAI Tool Executor
 *
 * Executes tool actions emitted by the AI router. Imports existing services
 * directly — no logic is reimplemented here.
 *
 * Security:
 *   - All requests validated by toolGuard before execution
 *   - Web search results sanitized by promptFirewall before return
 *
 * Supported actions:
 *   web_search      — Tavily search via webSearch.ts
 *   memory_store    — Merge a pattern into general memory via memory.ts
 *   memory_retrieve — Load and format general memory via memory.ts
 */

import { tavilySearch } from './webSearch';
import { loadMemory, mergeExtractedPatterns, buildMemoryPrompt } from './memory';
import { validateToolRequest } from './toolGuard';
import { sanitizeExternalContent } from './promptFirewall';
import { canAccessVault } from './dataVault';

// ── Types ─────────────────────────────────────────────────────

export type { ToolAction } from './toolTypes';
import type { ToolAction } from './toolTypes';

// Default persona for general (non-medical) memory operations.
// Medical data never flows through this executor — it stays in medicalMemory.ts.
const DEFAULT_PERSONA = 'pete';

// ── Executor ──────────────────────────────────────────────────

export async function executeTool(action: ToolAction): Promise<unknown> {
  if (!validateToolRequest(action)) {
    console.warn('[toolExecutor] blocked invalid tool request:', action.action);
    return { error: 'Tool blocked by security guard' };
  }

  switch (action.action) {
    case 'web_search': {
      const searchResults = await tavilySearch(action.query!);
      const clean = sanitizeExternalContent(JSON.stringify(searchResults));
      return clean;
    }

    case 'memory_store': {
      const patterns = Array.isArray(action.data!) ? action.data! : [action.data!];
      await mergeExtractedPatterns(DEFAULT_PERSONA, patterns, '');
      return { stored: patterns.length };
    }

    case 'memory_retrieve': {
      if (!canAccessVault()) {
        return { error: 'Vault locked — biometric authentication required to access memory.' };
      }
      const entries = await loadMemory(DEFAULT_PERSONA);
      const filtered = action.query
        ? entries.filter(e =>
            e.topic.toLowerCase().includes(action.query!.toLowerCase()) ||
            e.keywords.some(k => k.toLowerCase().includes(action.query!.toLowerCase()))
          )
        : entries;
      return buildMemoryPrompt(filtered);
    }

    default:
      return null;
  }
}
