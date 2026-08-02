/**
 * embeddings.ts — Semantic retrieval over uploaded notes
 *
 * Ranks stored graph nodes against a chat question by cosine similarity,
 * reusing the same nomic-embed-text primitive (services/embeddingService.ts)
 * already used for conversation search — same Ollama host, same model, same
 * best-effort-never-throws contract. This feature must never block or break
 * chat: an unreachable host, a timeout, or a note with no embedding yet
 * (e.g. uploaded before this feature existed) all resolve to "no match".
 */

import { embedText, cosineSimilarity } from './embeddingService';
import { getGraphNodes, type GraphNode } from './graphNodes';

const TOP_N = 3;
const MIN_SIMILARITY = 0.3; // matches embeddingService's conversation-search threshold — tune once real notes/questions are in hand

/**
 * Embeds `question` and ranks it against every stored note with an
 * embedding, returning up to TOP_N node ids scoring at/above MIN_SIMILARITY.
 * Returns [] if Ollama is unreachable, nothing scores highly enough, or no
 * notes have embeddings yet.
 */
export async function findRelevantNodes(question: string): Promise<string[]> {
  const questionEmbedding = await embedText(question);
  if (!questionEmbedding) return [];

  const nodes = await getGraphNodes();
  const embedded = nodes.filter((n): n is GraphNode & { embedding: number[] } => !!n.embedding?.length);
  if (embedded.length === 0) return [];

  const scored = embedded.map(n => ({ id: n.id, score: cosineSimilarity(questionEmbedding, n.embedding) }));

  return scored
    .filter(n => n.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N)
    .map(n => n.id);
}

// ─── Ambient graph edges (for the 3D graph screen) ──────────────
// Purely embedding-derived "connections" for visual display — not the same
// thing as retrieval matches above (higher threshold: a visual edge should
// read as "closely related", not just "relevant enough" for an answer).

export interface GraphEdge {
  a: string;
  b: string;
}

// Provisional — tuned against only 2 embedded notes, so this isn't based on
// a real score distribution yet. Revisit once more notes are embedded.
const EDGE_MIN_SIMILARITY = 0.45; // higher than MIN_SIMILARITY (retrieval)
const EDGE_MAX_PER_NODE = 3; // cap to avoid a fully-connected visual mess

/**
 * Derives visual connection edges between nodes purely from embedding
 * similarity — no LLM link-detection. Computed once (e.g. on graph load),
 * not per frame. Nodes without an embedding yet (uploaded before this
 * feature existed) are simply skipped, not an error.
 *
 * For each node, keeps only its EDGE_MAX_PER_NODE strongest matches
 * above EDGE_MIN_SIMILARITY; an edge survives if either endpoint counts it
 * among its own top matches (not required to be mutual), then duplicates
 * (both sides picking the same pair) are collapsed to one edge.
 */
export function computeGraphEdges(nodes: GraphNode[]): GraphEdge[] {
  const embedded = nodes.filter((n): n is GraphNode & { embedding: number[] } => !!n.embedding?.length);
  if (embedded.length < 2) return [];

  const candidatesById = new Map<string, { id: string; score: number }[]>();
  embedded.forEach(n => candidatesById.set(n.id, []));

  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const score = cosineSimilarity(embedded[i].embedding, embedded[j].embedding);
      if (score < EDGE_MIN_SIMILARITY) continue;
      candidatesById.get(embedded[i].id)!.push({ id: embedded[j].id, score });
      candidatesById.get(embedded[j].id)!.push({ id: embedded[i].id, score });
    }
  }

  const seenPairs = new Set<string>();
  const edges: GraphEdge[] = [];
  candidatesById.forEach((candidates, nodeId) => {
    candidates
      .sort((x, y) => y.score - x.score)
      .slice(0, EDGE_MAX_PER_NODE)
      .forEach(c => {
        const pairKey = [nodeId, c.id].sort().join('::');
        if (seenPairs.has(pairKey)) return;
        seenPairs.add(pairKey);
        edges.push({ a: nodeId, b: c.id });
      });
  });

  return edges;
}
