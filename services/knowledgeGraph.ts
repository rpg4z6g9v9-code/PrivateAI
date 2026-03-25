/**
 * knowledgeGraph.ts — PrivateAI Knowledge Graph
 *
 * SQLite-backed graph of concepts extracted from conversations.
 * Nodes represent topics, preferences, projects, interests, milestones.
 * Edges capture relationships between concepts.
 *
 * Sprint 4 additions:
 *   - Temporal columns: node_type, learned, confirmed, created_at
 *   - Milestone creation for significant decisions
 *   - synthesizeInsights() for "what have you learned about me?" queries
 *   - confirmNode() for user-validated knowledge
 *
 * All data stays on-device in the SQLite database (knowledgeGraph.db).
 */

import type { SQLiteDatabase } from 'expo-sqlite';

// Lazy import — expo-sqlite requires a native rebuild.
// If the native module isn't available yet, KG functions degrade gracefully (return empty).
let SQLite: typeof import('expo-sqlite') | null = null;
try {
  SQLite = require('expo-sqlite');
} catch {
  console.warn('[KG] expo-sqlite native module not available — knowledge graph disabled');
}

// ── Types ─────────────────────────────────────────────────────

export type NodeType = 'concept' | 'milestone' | 'preference' | 'project';

export interface KGNode {
  id: string;
  type: 'topic' | 'preference' | 'project' | 'interest' | 'insight' | 'milestone';
  label: string;
  description: string;
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  frequency: number;
  node_type: NodeType;
  learned: number;   // 1 = auto-extracted, 0 = manual
  confirmed: number; // 1 = user-confirmed, 0 = unconfirmed
  created_at: number;
  source: string | null; // e.g. filename for file-indexed concepts
}

export interface KGEdge {
  id: string;
  fromId: string;
  toId: string;
  relation: 'relates_to' | 'contradicts' | 'enables' | 'requires';
  strength: number;
  relation_type: string | null;
  created_at: number;
}

export interface GraphSummary {
  nodeCount: number;
  topicCount: number;
  preferenceCount: number;
  milestoneCount: number;
  confirmedCount: number;
}

// ── UUID ──────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Database ──────────────────────────────────────────────────

let db: SQLiteDatabase | null = null;

/** Try to add a column; silently ignore if it already exists. */
async function addColumnIfMissing(
  database: SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  try {
    await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    // Column already exists — expected on second run
    console.warn('[KG] addColumn skipped (likely exists):', e);
  }
}

export async function initKnowledgeGraph(): Promise<void> {
  if (!SQLite) {
    console.warn('[KG] Skipping init — native module not available');
    return;
  }
  try {
    db = await SQLite.openDatabaseAsync('knowledgeGraph.db');

    // ── Base tables (Sprint 4) ──────────────────────────────────
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS kg_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        confidence REAL,
        firstSeen INTEGER,
        lastSeen INTEGER,
        frequency INTEGER DEFAULT 1
      );
    `);

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS kg_edges (
        id TEXT PRIMARY KEY,
        fromId TEXT NOT NULL,
        toId TEXT NOT NULL,
        relation TEXT NOT NULL,
        strength REAL,
        FOREIGN KEY(fromId) REFERENCES kg_nodes(id),
        FOREIGN KEY(toId) REFERENCES kg_nodes(id)
      );
    `);

    // ── Schema migration: temporal + milestone columns ───────────
    await addColumnIfMissing(db, 'kg_nodes', 'node_type',   "TEXT DEFAULT 'concept'");
    await addColumnIfMissing(db, 'kg_nodes', 'learned',     'INTEGER DEFAULT 1');
    await addColumnIfMissing(db, 'kg_nodes', 'confirmed',   'INTEGER DEFAULT 0');
    await addColumnIfMissing(db, 'kg_nodes', 'created_at',  'INTEGER');

    await addColumnIfMissing(db, 'kg_nodes', 'source',       'TEXT');

    await addColumnIfMissing(db, 'kg_edges', 'relation_type', 'TEXT');
    await addColumnIfMissing(db, 'kg_edges', 'created_at',    'INTEGER');

    // ── Historical data cleanup — normalize existing junk ──────
    await cleanupExistingNodes();

    console.log('[KG] Knowledge Graph initialized');
  } catch (error) {
    console.error('[KG] Init failed:', error);
  }
}

/**
 * One-time cleanup of existing nodes:
 * - Normalize labels: title case, strip trailing punctuation
 * - Remove junk nodes (too short, all punctuation, stopwords)
 * - Merge duplicates that differ only in casing
 */
async function cleanupExistingNodes(): Promise<void> {
  if (!db) return;
  try {
    const allNodes = await db.getAllAsync<{ id: string; label: string }>(
      'SELECT id, label FROM kg_nodes',
    );
    if (allNodes.length === 0) return;

    const seen = new Map<string, string>(); // normalized label → first id
    let cleaned = 0;
    let removed = 0;

    for (const node of allNodes) {
      const normalized = normalizeLabel(node.label);

      // Remove junk labels
      if (!isValidLabel(normalized)) {
        await db.runAsync('DELETE FROM kg_edges WHERE fromId = ? OR toId = ?', node.id, node.id);
        await db.runAsync('DELETE FROM kg_nodes WHERE id = ?', node.id);
        removed++;
        continue;
      }

      // Check for duplicate after normalization
      const existing = seen.get(normalized.toLowerCase());
      if (existing && existing !== node.id) {
        // Merge: bump frequency on the existing, delete this duplicate
        await db.runAsync(
          'UPDATE kg_nodes SET frequency = frequency + 1 WHERE id = ?',
          existing,
        );
        await db.runAsync('DELETE FROM kg_edges WHERE fromId = ? OR toId = ?', node.id, node.id);
        await db.runAsync('DELETE FROM kg_nodes WHERE id = ?', node.id);
        removed++;
        continue;
      }

      // Update label if normalization changed it
      if (normalized !== node.label) {
        await db.runAsync('UPDATE kg_nodes SET label = ? WHERE id = ?', normalized, node.id);
        cleaned++;
      }

      seen.set(normalized.toLowerCase(), node.id);
    }

    if (cleaned > 0 || removed > 0) {
      console.log(`[KG] Cleanup: ${cleaned} labels normalized, ${removed} junk nodes removed`);
    }
  } catch (e) {
    console.warn('[KG] Cleanup error (non-fatal):', e);
  }
}

// ── Label quality utilities ─────────────────────────────────

/** Normalize a label: title case, strip trailing punctuation, collapse whitespace. */
function normalizeLabel(label: string): string {
  let s = label.trim();
  // Strip trailing punctuation (periods, commas, colons, etc.)
  s = s.replace(/[.,;:!?…]+$/, '').trim();
  // Strip leading punctuation
  s = s.replace(/^[.,;:!?…]+/, '').trim();
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');
  // Title case: capitalize first letter of each word
  s = s.replace(/\b\w/g, c => c.toUpperCase()).replace(/\b(\w)/g, (_, c) => c.toUpperCase());
  // Fix ALL CAPS: if the whole thing is uppercase, title-case it
  if (s === s.toUpperCase() && s.length > 2) {
    s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return s;
}

/** Check if a label is meaningful enough to store. */
function isValidLabel(label: string): boolean {
  if (!label || label.length < 3) return false;
  // All punctuation or numbers
  if (/^[\d\s\W]+$/.test(label)) return false;
  // Single repeated character
  if (/^(.)\1+$/.test(label)) return false;

  const lower = label.toLowerCase();
  const STOPWORDS = new Set([
    'the', 'this', 'that', 'with', 'from', 'have', 'been', 'will', 'just',
    'also', 'about', 'very', 'really', 'actually', 'basically', 'something',
    'thing', 'things', 'stuff', 'good', 'great', 'nice', 'well', 'much',
    'here', 'there', 'what', 'when', 'where', 'which', 'who', 'how',
    'some', 'any', 'all', 'each', 'every', 'other', 'more', 'most',
    'like', 'want', 'need', 'make', 'know', 'think', 'sure', 'right',
    'okay', 'yeah', 'yes', 'thanks', 'thank', 'please', 'sorry',
    'hello', 'hey', 'got', 'get', 'can', 'could', 'would', 'should',
  ]);
  if (STOPWORDS.has(lower)) return false;

  return true;
}

/** Clean a description: normalize casing, strip trailing punctuation, cap length. */
function cleanDescription(desc: string): string {
  let s = desc.trim();
  if (!s) return '';
  // Strip trailing punctuation sequences
  s = s.replace(/[.,;:!?…]+$/, '').trim();
  // If ALL CAPS, convert to sentence case
  if (s === s.toUpperCase() && s.length > 3) {
    s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  // Cap length
  if (s.length > 120) s = s.slice(0, 117) + '...';
  return s;
}

// ── Concept extraction + indexing ──────────────────────────────

// ── Concept Keywords (seed vocabulary) ────────────────────────
//
// These are high-signal terms the graph always recognizes.
// The NP extractor below catches everything else.

const CONCEPT_KEYWORDS: Array<{
  word: string;
  type: KGNode['type'];
  confidence: number;
}> = [
  // Preferences & values
  { word: 'privacy',          type: 'preference', confidence: 0.9 },
  { word: 'local inference',  type: 'preference', confidence: 0.8 },
  { word: 'encrypt',          type: 'preference', confidence: 0.9 },
  { word: 'on-device',        type: 'preference', confidence: 0.8 },
  { word: 'open source',      type: 'preference', confidence: 0.7 },
  // Tech topics
  { word: 'architecture',     type: 'topic',      confidence: 0.8 },
  { word: 'security',         type: 'topic',      confidence: 0.9 },
  { word: 'knowledge graph',  type: 'topic',      confidence: 0.8 },
  { word: 'machine learning', type: 'topic',      confidence: 0.8 },
  { word: 'ai safety',        type: 'topic',      confidence: 0.8 },
  { word: 'react native',     type: 'topic',      confidence: 0.7 },
  { word: 'swift',            type: 'topic',      confidence: 0.7 },
  { word: 'vision pro',       type: 'interest',   confidence: 0.8 },
  { word: 'llama',            type: 'topic',      confidence: 0.7 },
  { word: 'claude',           type: 'topic',      confidence: 0.7 },
  { word: 'medical',          type: 'topic',      confidence: 0.8 },
  // Projects
  { word: 'privateai',        type: 'project',    confidence: 0.9 },
  { word: 'private ai',       type: 'project',    confidence: 0.9 },
  { word: 'app store',        type: 'topic',      confidence: 0.7 },
  { word: 'dashboard',        type: 'project',    confidence: 0.6 },
  { word: 'control room',     type: 'project',    confidence: 0.7 },
];

// ── Noun Phrase Extraction ───────────────────────────────────
//
// Extracts capitalized noun phrases and multi-word technical terms.
// This catches concepts beyond the keyword list — e.g. "Secure Enclave",
// "Metal GPU", "App Store", names of tools/frameworks.

const NP_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
const TECH_PATTERN = /\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*(?:\s+\d+(?:\.\d+)?)?)\b/g;

// Phrases to never index — common English phrases that match the pattern
const NP_BLACKLIST = new Set([
  'the', 'this', 'that', 'what', 'which', 'when', 'where', 'how',
  'i am', 'i have', 'i want', 'i need', 'i think', 'i know',
  'do not', 'does not', 'can not', 'will not',
  'let me', 'tell me', 'show me', 'help me',
  'for example', 'in addition', 'on the other hand',
  'thank you', 'of course', 'right now',
].map(s => s.toLowerCase()));

function extractNounPhrases(text: string): string[] {
  const phrases = new Set<string>();

  // Capitalized multi-word phrases (e.g. "Vision Pro", "App Store")
  let match;
  while ((match = NP_PATTERN.exec(text)) !== null) {
    const phrase = match[1].trim();
    if (phrase.length >= 4 && phrase.length <= 40 && !NP_BLACKLIST.has(phrase.toLowerCase())) {
      phrases.add(phrase);
    }
  }

  return [...phrases];
}

// ── Quality Gate ─────────────────────────────────────────────
//
// Messages must pass these checks before auto-indexing:
// 1. Minimum length (short messages are usually greetings/commands)
// 2. Not a question (questions don't assert knowledge)
// 3. Contains substantive content (not just pleasantries)

const QUESTION_ONLY_RX = /^[^.!]*\?$/; // entire message is one question
const COMMAND_RX = /^(show|open|go|switch|delete|clear|stop|start|help|set|turn|toggle)\b/i;

function shouldAutoIndex(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  // Too short — likely a command or greeting
  if (trimmed.length < 30) return false;
  // Pure question — no assertions to index
  if (QUESTION_ONLY_RX.test(trimmed)) return false;
  // Command — not a knowledge statement
  if (COMMAND_RX.test(trimmed)) return false;
  return true;
}

// ── Concept Extraction (combined) ────────────────────────────

function extractConcepts(
  text: string,
): Array<{ type: KGNode['type']; label: string; description: string; confidence: number }> {
  const lowerText = text.toLowerCase();
  const sentences = text.split(/[.!?\n]/);
  const concepts: Array<{ type: KGNode['type']; label: string; description: string; confidence: number }> = [];
  const seen = new Set<string>();

  // 1. Keyword matches (high confidence — known vocabulary)
  for (const kw of CONCEPT_KEYWORDS) {
    if (!lowerText.includes(kw.word)) continue;
    const relevant = sentences.find(s => s.toLowerCase().includes(kw.word));
    const label = normalizeLabel(kw.word);
    if (!isValidLabel(label)) continue;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    concepts.push({
      type: kw.type,
      label,
      description: cleanDescription(relevant?.trim().slice(0, 150) ?? ''),
      confidence: kw.confidence,
    });
  }

  // 2. Noun phrase extraction (medium confidence — discovered vocabulary)
  const nps = extractNounPhrases(text);
  for (const np of nps) {
    const label = normalizeLabel(np);
    if (!isValidLabel(label)) continue;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const relevant = sentences.find(s => s.includes(np));
    concepts.push({
      type: 'topic',
      label,
      description: cleanDescription(relevant?.trim().slice(0, 150) ?? ''),
      confidence: 0.5, // lower confidence — not in known vocabulary
    });
  }

  return concepts;
}

/**
 * Extract concepts from text and upsert them into the graph.
 * @param confirmed If true, marks nodes as user-confirmed (from "Remember this" button).
 */
export async function extractAndIndexConcepts(
  text: string,
  options: { confirmed?: boolean; source?: string } = {},
): Promise<number> {
  if (!db) return 0;

  try {
    const concepts = extractConcepts(text);
    const now = Date.now();
    const confirmedVal = options.confirmed ? 1 : 0;
    const source = options.source ?? null;

    for (const concept of concepts) {
      // Case-insensitive lookup — handles old lowercase labels after cleanup
      const existing = await db.getFirstAsync<KGNode>(
        'SELECT * FROM kg_nodes WHERE LOWER(label) = ?',
        concept.label.toLowerCase(),
      );

      if (existing) {
        const setConfirmed = options.confirmed ? ', confirmed = 1' : '';
        const setSource = source && !existing.source ? `, source = '${source}'` : '';
        await db.runAsync(
          `UPDATE kg_nodes SET frequency = frequency + 1, lastSeen = ?,
           label = ?,
           description = CASE WHEN ? != '' THEN ? ELSE description END
           ${setConfirmed}${setSource}
           WHERE id = ?`,
          now, concept.label, concept.description, concept.description, existing.id,
        );
      } else {
        await db.runAsync(
          `INSERT INTO kg_nodes (id, type, label, description, confidence, firstSeen, lastSeen, frequency, node_type, learned, confirmed, created_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'concept', 1, ?, ?, ?)`,
          uuid(), concept.type, concept.label, concept.description,
          concept.confidence, now, now, 1, confirmedVal, now, source,
        );
      }
    }

    // ── Create edges between co-occurring concepts ─────────────
    // If multiple concepts appear in the same text, they're related.
    if (concepts.length >= 2) {
      for (let i = 0; i < concepts.length; i++) {
        for (let j = i + 1; j < concepts.length; j++) {
          const labelA = concepts[i].label;
          const labelB = concepts[j].label;

          // Look up node IDs
          const nodeA = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM kg_nodes WHERE label = ?', labelA,
          );
          const nodeB = await db.getFirstAsync<{ id: string }>(
            'SELECT id FROM kg_nodes WHERE label = ?', labelB,
          );
          if (!nodeA || !nodeB) continue;

          // Check if edge already exists (either direction)
          const existing = await db.getFirstAsync<{ id: string; strength: number }>(
            `SELECT id, strength FROM kg_edges
             WHERE (fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?)`,
            nodeA.id, nodeB.id, nodeB.id, nodeA.id,
          );

          if (existing) {
            // Strengthen existing edge (cap at 1.0)
            const newStrength = Math.min(1.0, (existing.strength ?? 0.3) + 0.1);
            await db.runAsync(
              'UPDATE kg_edges SET strength = ? WHERE id = ?',
              newStrength, existing.id,
            );
          } else {
            // Create new edge
            await db.runAsync(
              `INSERT INTO kg_edges (id, fromId, toId, relation, strength, relation_type, created_at)
               VALUES (?, ?, ?, 'relates_to', 0.3, 'co_occurrence', ?)`,
              uuid(), nodeA.id, nodeB.id, now,
            );
          }
        }
      }
    }

    if (concepts.length > 0) {
      console.log('[KG] Indexed', concepts.length, 'concepts:', concepts.map(c => c.label).join(', '));
    }
    return concepts.length;
  } catch (error) {
    console.error('[KG] Extract failed:', error);
    return 0;
  }
}

/**
 * Pre-validate text before storing to the knowledge graph.
 * Returns the number of meaningful concepts that would be extracted.
 * Use this to check if "remember this" would actually produce anything useful.
 */
export function prevalidateForKG(text: string): { conceptCount: number; labels: string[] } {
  const concepts = extractConcepts(text);
  return {
    conceptCount: concepts.length,
    labels: concepts.map(c => c.label),
  };
}

// Re-export utilities for external use
export { normalizeLabel, isValidLabel, shouldAutoIndex };

// ── Milestones ────────────────────────────────────────────────

const MILESTONE_KEYWORDS = [
  'decided', 'realized', 'chose', 'committed',
  'agreed', 'designed', 'implemented', 'built',
  'shipped', 'launched', 'completed', 'finished',
];

/**
 * Returns true if the message contains milestone-significant language.
 */
export function containsMilestone(text: string): boolean {
  const lower = text.toLowerCase();
  return MILESTONE_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Create a milestone node and connect it to related concept labels.
 */
export async function createMilestone(
  title: string,
  relatedLabels: string[] = [],
): Promise<void> {
  if (!db) return;

  try {
    const nodeId = uuid();
    const now = Date.now();

    await db.runAsync(
      `INSERT INTO kg_nodes (id, type, label, description, confidence, firstSeen, lastSeen, frequency, node_type, learned, confirmed, created_at)
       VALUES (?, 'milestone', ?, '', 1.0, ?, ?, 1, 'milestone', 0, 1, ?)`,
      nodeId, title, now, now, now,
    );

    // Connect to related concepts
    for (const label of relatedLabels) {
      const related = await db.getFirstAsync<KGNode>(
        'SELECT id FROM kg_nodes WHERE label = ?',
        label,
      );
      if (related) {
        await db.runAsync(
          `INSERT INTO kg_edges (id, fromId, toId, relation, strength, relation_type, created_at)
           VALUES (?, ?, ?, 'relates_to', 0.8, 'milestone_link', ?)`,
          uuid(), nodeId, related.id, now,
        );
      }
    }

    console.log('[KG] Milestone created:', title);
  } catch (error) {
    console.error('[KG] Milestone creation failed:', error);
  }
}

// ── Confirmation ──────────────────────────────────────────────

/**
 * Mark all nodes matching a label as user-confirmed.
 */
export async function confirmNode(label: string): Promise<void> {
  if (!db) return;
  try {
    await db.runAsync(
      'UPDATE kg_nodes SET confirmed = 1 WHERE LOWER(label) = ?',
      label.toLowerCase(),
    );
    console.log('[KG] Confirmed node:', label);
  } catch (error) {
    console.error('[KG] Confirm failed:', error);
  }
}

/**
 * Delete a node and its edges from the knowledge graph.
 */
export async function deleteNode(nodeId: string): Promise<void> {
  if (!db) return;
  try {
    await db.runAsync('DELETE FROM kg_edges WHERE fromId = ? OR toId = ?', nodeId, nodeId);
    await db.runAsync('DELETE FROM kg_nodes WHERE id = ?', nodeId);
    console.log('[KG] Deleted node:', nodeId);
  } catch (error) {
    console.error('[KG] Delete node failed:', error);
  }
}

// ── "What have you learned about me?" synthesis ────────────────

/**
 * Returns true if the message is asking about learned knowledge.
 * Uses flexible prefix matching to catch tense variations (learn/learned, notice/noticed).
 */
export function isLearnQuery(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('what have you learn') ||
    lower.includes('what do you know') ||
    lower.includes('what patterns') ||
    lower.includes('tell me about myself') ||
    lower.includes('what have you notice') ||
    lower.includes('what do you remember') ||
    lower.includes('summarize what you know')
  );
}

/**
 * Synthesize all graph knowledge into a readable summary.
 */
export async function synthesizeInsights(): Promise<string> {
  if (!db) return 'Knowledge graph not initialized yet.';

  try {
    // 1. User-confirmed principles
    const confirmed = await db.getAllAsync<KGNode>(
      `SELECT label, description, frequency FROM kg_nodes
       WHERE confirmed = 1
       ORDER BY frequency DESC LIMIT 5`,
    );

    // 2. Recent milestones
    const milestones = await db.getAllAsync<KGNode>(
      `SELECT label, created_at FROM kg_nodes
       WHERE node_type = 'milestone'
       ORDER BY created_at DESC LIMIT 3`,
    );

    // 3. Auto-learned concepts (unconfirmed)
    const learned = await db.getAllAsync<KGNode>(
      `SELECT label, description, frequency FROM kg_nodes
       WHERE learned = 1 AND confirmed = 0
       ORDER BY frequency DESC LIMIT 5`,
    );

    // 4. Total stats
    const summary = await getGraphSummary();

    // Build prose
    let response = `From our conversations, here's what I know (${summary.nodeCount} concepts tracked):\n\n`;

    if (confirmed.length > 0) {
      response += 'Core principles you\'ve confirmed:\n';
      for (const c of confirmed) {
        response += `  - ${c.label}${c.description ? `: ${c.description}` : ''} (${c.frequency}x)\n`;
      }
      response += '\n';
    }

    if (milestones.length > 0) {
      response += 'Key decisions and milestones:\n';
      for (const m of milestones) {
        const date = new Date(m.created_at).toLocaleDateString();
        response += `  - ${m.label} (${date})\n`;
      }
      response += '\n';
    }

    if (learned.length > 0) {
      response += 'Patterns I\'m noticing (not yet confirmed):\n';
      for (const l of learned) {
        response += `  - ${l.label}${l.description ? `: ${l.description}` : ''} (${l.frequency}x)\n`;
      }
      response += '\n';
    }

    if (confirmed.length === 0 && milestones.length === 0 && learned.length === 0) {
      response = 'I haven\'t learned much yet. Keep chatting and I\'ll pick up on your interests, preferences, and key decisions.';
    }

    return response;
  } catch (error) {
    console.error('[KG] Synthesis failed:', error);
    return 'Unable to retrieve insights right now.';
  }
}

// ── Graph queries ──────────────────────────────────────────────

export async function queryGraphContext(query: string): Promise<string> {
  if (!db) return '';

  try {
    const term = `%${query.toLowerCase()}%`;
    const nodes = await db.getAllAsync<KGNode>(
      `SELECT * FROM kg_nodes
       WHERE LOWER(label) LIKE ? OR LOWER(description) LIKE ?
       ORDER BY frequency DESC
       LIMIT 5`,
      term, term,
    );

    if (nodes.length === 0) return '';

    const lines = nodes.map(n => {
      const badge = n.confirmed ? '[confirmed]' : '';
      return `- ${n.label} (${n.type}, ${n.frequency}x) ${badge}: ${n.description || '(no description)'}`;
    });

    return `Known insights about the user:\n${lines.join('\n')}`;
  } catch (error) {
    console.error('[KG] Query failed:', error);
    return '';
  }
}

export async function getTopInsights(limit = 5): Promise<string> {
  if (!db) return '';

  try {
    const nodes = await db.getAllAsync<KGNode>(
      'SELECT * FROM kg_nodes WHERE frequency >= 2 ORDER BY frequency DESC LIMIT ?',
      limit,
    );

    if (nodes.length === 0) return '';

    const lines = nodes.map(n =>
      `- ${n.label}: ${n.description || `mentioned ${n.frequency} times`}`,
    );

    return `Recurring themes from past conversations:\n${lines.join('\n')}`;
  } catch (error) {
    console.error('[KG] Top insights failed:', error);
    return '';
  }
}

// ── Stats ──────────────────────────────────────────────────────

export async function getGraphSummary(): Promise<GraphSummary> {
  if (!db) return { nodeCount: 0, topicCount: 0, preferenceCount: 0, milestoneCount: 0, confirmedCount: 0 };

  try {
    const all = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM kg_nodes',
    );
    const topics = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM kg_nodes WHERE type = ?',
      'topic',
    );
    const prefs = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM kg_nodes WHERE type = ?',
      'preference',
    );
    const milestones = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM kg_nodes WHERE node_type = 'milestone'",
    );
    const confirmed = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM kg_nodes WHERE confirmed = 1',
    );

    return {
      nodeCount: all?.count ?? 0,
      topicCount: topics?.count ?? 0,
      preferenceCount: prefs?.count ?? 0,
      milestoneCount: milestones?.count ?? 0,
      confirmedCount: confirmed?.count ?? 0,
    };
  } catch (error) {
    console.error('[KG] Summary failed:', error);
    return { nodeCount: 0, topicCount: 0, preferenceCount: 0, milestoneCount: 0, confirmedCount: 0 };
  }
}

// ── Visualization data ─────────────────────────────────────────

export interface GraphVisData {
  nodes: KGNode[];
  edges: KGEdge[];
}

/** Fetch all nodes and edges for rendering the graph canvas. */
export async function getGraphVisualizationData(): Promise<GraphVisData> {
  if (!db) return { nodes: [], edges: [] };

  try {
    const nodes = await db.getAllAsync<KGNode>(
      `SELECT * FROM kg_nodes ORDER BY frequency DESC LIMIT 60`,
    );
    const edges = await db.getAllAsync<KGEdge>(
      `SELECT * FROM kg_edges LIMIT 120`,
    );
    return { nodes: nodes ?? [], edges: edges ?? [] };
  } catch (error) {
    console.error('[KG] getGraphVisualizationData failed:', error);
    return { nodes: [], edges: [] };
  }
}

// ── AI-Extracted Knowledge Ingestion ─────────────────────────

import type { ExtractedEntity, ExtractedRelationship, ExtractionResult } from './knowledgeExtractor';

const ENTITY_TYPE_MAP: Record<string, KGNode['type']> = {
  person: 'topic', tool: 'topic', project: 'project',
  concept: 'topic', preference: 'preference', goal: 'interest', decision: 'insight',
};

/**
 * Ingest AI-extracted entities and relationships into the knowledge graph.
 */
export async function ingestExtraction(result: ExtractionResult): Promise<{ nodes: number; edges: number }> {
  if (!db) return { nodes: 0, edges: 0 };
  const now = Date.now();
  let nodesCreated = 0;
  let edgesCreated = 0;

  try {
    for (const entity of result.entities) {
      const label = normalizeLabel(entity.label);
      if (!isValidLabel(label)) continue;
      const nodeType = ENTITY_TYPE_MAP[entity.type] ?? 'topic';

      const existing = await db.getFirstAsync<KGNode>(
        'SELECT * FROM kg_nodes WHERE LOWER(label) = ?', label.toLowerCase(),
      );

      if (existing) {
        const betterDesc = entity.description.length > (existing.description?.length ?? 0);
        await db.runAsync(
          `UPDATE kg_nodes SET frequency = frequency + 1, lastSeen = ?, confidence = MAX(confidence, ?)
           ${betterDesc ? ', description = ?' : ''}
           WHERE id = ?`,
          ...(betterDesc
            ? [now, entity.confidence, entity.description, existing.id]
            : [now, entity.confidence, existing.id]),
        );
      } else {
        await db.runAsync(
          `INSERT INTO kg_nodes (id, type, label, description, confidence, firstSeen, lastSeen, frequency, node_type, learned, confirmed, created_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'concept', 1, 0, ?, 'ai_extraction')`,
          uuid(), nodeType, label, entity.description, entity.confidence, now, now, now,
        );
        nodesCreated++;
      }
    }

    for (const rel of result.relationships) {
      const fromLabel = normalizeLabel(rel.from);
      const toLabel = normalizeLabel(rel.to);
      const fromNode = await db.getFirstAsync<{ id: string }>('SELECT id FROM kg_nodes WHERE LOWER(label) = ?', fromLabel.toLowerCase());
      const toNode = await db.getFirstAsync<{ id: string }>('SELECT id FROM kg_nodes WHERE LOWER(label) = ?', toLabel.toLowerCase());
      if (!fromNode || !toNode) continue;

      const existingEdge = await db.getFirstAsync<{ id: string; strength: number }>(
        'SELECT id, strength FROM kg_edges WHERE (fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?)',
        fromNode.id, toNode.id, toNode.id, fromNode.id,
      );

      if (existingEdge) {
        const newStrength = Math.min(1.0, (existingEdge.strength ?? 0.3) + 0.15);
        await db.runAsync(
          'UPDATE kg_edges SET strength = ?, relation = ?, relation_type = ? WHERE id = ?',
          newStrength, rel.relation, rel.description, existingEdge.id,
        );
      } else {
        await db.runAsync(
          'INSERT INTO kg_edges (id, fromId, toId, relation, strength, relation_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          uuid(), fromNode.id, toNode.id, rel.relation, rel.confidence, rel.description, now,
        );
        edgesCreated++;
      }
    }

    if (nodesCreated > 0 || edgesCreated > 0) {
      console.log(`[KG] AI ingestion: ${nodesCreated} new nodes, ${edgesCreated} new edges`);
    }
    return { nodes: nodesCreated, edges: edgesCreated };
  } catch (e) {
    console.error('[KG] AI ingestion failed:', e);
    return { nodes: 0, edges: 0 };
  }
}

/**
 * Decay confidence on unconfirmed nodes not seen in 14+ days.
 * Prune nodes below 0.15 confidence. Clean up orphaned edges.
 */
export async function decayConfidence(): Promise<number> {
  if (!db) return 0;
  try {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    await db.runAsync(
      'UPDATE kg_nodes SET confidence = confidence * 0.85 WHERE confirmed = 0 AND lastSeen < ? AND confidence > 0.2',
      cutoff,
    );
    const pruned = await db.runAsync('DELETE FROM kg_nodes WHERE confidence < 0.15 AND confirmed = 0');
    await db.runAsync(
      'DELETE FROM kg_edges WHERE fromId NOT IN (SELECT id FROM kg_nodes) OR toId NOT IN (SELECT id FROM kg_nodes)',
    );
    const removed = pruned.changes ?? 0;
    if (removed > 0) console.log(`[KG] Decay: ${removed} stale nodes pruned`);
    return removed;
  } catch (e) {
    console.warn('[KG] Decay failed:', e);
    return 0;
  }
}
