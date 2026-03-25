/**
 * toolTypes.ts — Shared tool types for PrivateAI
 *
 * Extracted from toolExecutor.ts to break circular imports
 * (toolGuard and aiRouter both need ToolAction).
 */

export interface ToolAction {
  action: 'web_search' | 'memory_store' | 'memory_retrieve';
  query?: string;
  data?: { topic: string; summary: string; keywords: string[] } | { topic: string; summary: string; keywords: string[] }[];
}
