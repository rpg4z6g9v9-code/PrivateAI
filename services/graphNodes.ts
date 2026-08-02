/**
 * graphNodes.ts — Knowledge graph node parsing + persistence
 *
 * Parses picked .md/.txt/.pdf files into simple graph nodes. Embedding-based
 * "connections" between nodes are derived separately (see
 * services/embeddings.ts computeGraphEdges) — this file just owns parsing
 * and storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface GraphNode {
  id: string;
  label: string;
  p: string; // preview text
  embedding?: number[]; // nomic-embed-text vector, set post-parse — see services/embeddings.ts
}

const PREVIEW_LEN = 160;

/** Strips the .md/.txt/.pdf extension for display. */
function labelFromFilename(filename: string): string {
  return filename.replace(/\.(md|txt|pdf)$/i, '');
}

/** Collapses whitespace and truncates raw file content into a short preview. */
function buildPreview(content: string): string {
  const collapsed = content.trim().replace(/\s+/g, ' ');
  return collapsed.length > PREVIEW_LEN ? collapsed.slice(0, PREVIEW_LEN) + '…' : collapsed;
}

export function parseFileToNode(filename: string, content: string, id: string): GraphNode {
  return {
    id,
    label: labelFromFilename(filename),
    p: buildPreview(content),
  };
}

// ─── Persisted handoff to the graph screen ──────────────────────
// Nodes are parsed on the chat screen (needs FileSystem access) and read by
// app/graph.tsx on mount. Persisting them (rather than an in-memory store)
// means the last-uploaded graph survives app restarts and can be reopened
// directly without re-picking files.

const GRAPH_NODES_KEY = 'graph_nodes_v1';

export async function setGraphNodes(nodes: GraphNode[]): Promise<void> {
  await AsyncStorage.setItem(GRAPH_NODES_KEY, JSON.stringify(nodes));
}

export async function getGraphNodes(): Promise<GraphNode[]> {
  try {
    const stored = await AsyncStorage.getItem(GRAPH_NODES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Last-used-context handoff (chat → graph) ───────────────────
// After each chat turn, app/(tabs)/index.tsx writes the node ids whose
// embeddings matched the question here (via services/embeddings.ts
// findRelevantNodes). app/graph.tsx reads it on mount to auto-pulse
// whatever the most recent answer drew on.

const LAST_CONTEXT_NODES_KEY = 'last_context_nodes_v1';

export async function setLastContextNodes(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(LAST_CONTEXT_NODES_KEY, JSON.stringify(ids));
}

export async function getLastContextNodes(): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(LAST_CONTEXT_NODES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
