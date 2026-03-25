/**
 * contextMemory.ts — PrivateAI Context Echo
 *
 * Lightweight in-memory rolling window of recent conversation context.
 * Injected into Claude's system prompt so Atom stays aware of
 * conversation flow without requiring full message history on every call.
 *
 * Intentionally simple: no persistence, no encryption, no async.
 * Cleared on app restart. Long-term memory lives in memory.ts.
 */

const MAX_CONTEXT_CHARS = 500;

let recentContext = '';

export function updateContext(userMessage: string, assistantResponse: string): void {
  const entry = `User: ${userMessage}\nAtom: ${assistantResponse}`;
  // Append and trim to last MAX_CONTEXT_CHARS so oldest context falls off
  recentContext = (recentContext + '\n' + entry).slice(-MAX_CONTEXT_CHARS);
}

export function getContext(): string {
  return recentContext;
}

export function clearContext(): void {
  recentContext = '';
}
