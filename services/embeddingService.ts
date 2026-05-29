/**
 * embeddingService.ts — Local semantic embedding via nomic-embed-text
 *
 * Generates text embeddings using nomic-embed-text running on the Mac Mini
 * Ollama instance. Embeddings are stored in SQLite and used for semantic
 * conversation search.
 *
 * All operations are local — no cloud calls, no data leaves the device/LAN.
 * All errors are silent — embedding failure never blocks the send flow.
 */

import { getOllamaHost } from '@/services/localAI';
import { storeEmbedding, getAllEmbeddings, getConversations } from '@/services/conversationDB';
import type { ConversationSummary } from '@/services/conversationDB';

const EMBED_MODEL = 'nomic-embed-text:latest';
const DEFAULT_TOP_K = 10;
const MIN_SCORE = 0.3; // discard results below this threshold

// ── Core embedding ────────────────────────────────────────────

/**
 * Generate a single embedding vector via nomic-embed-text on Mac Mini.
 * Returns null if the node is offline or the request fails.
 */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const host = await getOllamaHost();
    const response = await fetch(`http://${host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    const embedding = json.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    return embedding as number[];
  } catch {
    return null;
  }
}

// ── Similarity ────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors. Returns 0–1 (1 = identical).
 * Assumes both vectors have the same length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Background embed on send ──────────────────────────────────

/**
 * Embed a user message and store it. Fire-and-forget — never throws.
 * Called after persistMessage() on the send path.
 *
 * Embedding rule: only user-visible chat messages are embedded.
 * Never embed: system prompts, tool context, routing metadata,
 * assistant messages, or any internal/hidden content.
 * All embedding is local — nomic-embed-text on Mac Mini only.
 * No cloud call is ever made for embeddings.
 */
export function embedUserMessage(
  content: string,
  messageId: string,
  conversationId: string,
): void {
  // Intentionally not awaited — must never block the send flow
  (async () => {
    try {
      const embedding = await embedText(content);
      if (!embedding) return;
      await storeEmbedding(messageId, conversationId, embedding);
    } catch {
      // Silent — embedding is best-effort
    }
  })();
}

// ── Semantic search ───────────────────────────────────────────

/**
 * Search conversations by meaning using stored embeddings.
 *
 * 1. Embed the query locally
 * 2. Load all stored embeddings from SQLite
 * 3. Compute cosine similarity in JS
 * 4. Return top K ConversationSummary objects, ranked by score
 *
 * Falls back to null if Mac Mini is offline or no embeddings exist,
 * so callers can fall back to SQL LIKE search.
 */
export async function semanticSearchConversations(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<ConversationSummary[] | null> {
  if (!query.trim()) return null;

  // 1. Embed the query
  const queryVec = await embedText(query.trim());
  if (!queryVec) return null;

  // 2. Load all stored embeddings
  const rows = await getAllEmbeddings();
  if (rows.length === 0) return null;

  // 3. Score each row
  const scores = new Map<string, number>(); // conversationId → best score
  for (const row of rows) {
    const score = cosineSimilarity(queryVec, row.embedding);
    const existing = scores.get(row.conversationId) ?? 0;
    if (score > existing) scores.set(row.conversationId, score);
  }

  // 4. Filter below threshold, sort descending
  const ranked = Array.from(scores.entries())
    .filter(([, score]) => score >= MIN_SCORE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => id);

  if (ranked.length === 0) return null;

  // 5. Fetch ConversationSummary for each matched conversation ID
  const all = await getConversations();
  const resultMap = new Map(all.map(c => [c.id, c]));

  const results: ConversationSummary[] = [];
  for (const id of ranked) {
    const summary = resultMap.get(id);
    if (summary) results.push(summary);
  }

  return results.length > 0 ? results : null;
}
