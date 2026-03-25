/**
 * toolGuard.ts — PrivateAI Tool Guard
 *
 * Validates tool action requests before execution.
 * Any request that fails validation is blocked — the executor never runs.
 *
 * Separated from toolExecutor.ts so the guard can be imported and tested
 * independently, and so the allow-list is the single source of truth.
 */

import type { ToolAction } from './toolTypes';

// ── Allow-list ────────────────────────────────────────────────

const ALLOWED_TOOLS: ToolAction['action'][] = [
  'web_search',
  'memory_store',
  'memory_retrieve',
];

// ── Validator ─────────────────────────────────────────────────

export function validateToolRequest(req: ToolAction): boolean {
  if (!ALLOWED_TOOLS.includes(req.action)) return false;

  if (req.action === 'web_search'      && !req.query?.trim())                        return false;
  if (req.action === 'memory_retrieve' && req.query !== undefined && !req.query.trim()) return false;
  if (req.action === 'memory_store'    && !req.data)                                 return false;

  return true;
}
