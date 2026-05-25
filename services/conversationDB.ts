/**
 * conversationDB.ts — SQLite-backed conversation persistence
 *
 * Schema supports multiple conversations. All read/write functions
 * accept a conversationId — callers track which one is active.
 *
 * Usage:
 *   await initConversationDB()                         — call once on app mount
 *   const id = await getLatestConversationId()         — restore most recent session
 *   await persistMessage(msg, conversationId)          — append message
 *   await loadConversation(conversationId)             — restore messages
 *   const id = await createConversation()              — start new session
 *   await clearConversation(conversationId)            — wipe messages (keeps row)
 *   await updateConversationTitle(conversationId, t)   — set/update display title
 *   await getConversations()                           — list for history UI
 *
 * ---
 * Conversation state model (not yet implemented, document before codebase grows):
 *
 *   ACTIVE conversation  — the one currently receiving new messages.
 *                          One at a time. Tracked in component state (activeConversationId).
 *                          Writes go here. UI is rendering this.
 *
 *   LOADED conversation  — one whose messages have been fetched into memory.
 *                          Currently always the same as ACTIVE.
 *                          Will diverge when: preloading, caching adjacent sessions,
 *                          search previews, background summarization, or side-by-side views.
 *
 * Invariant today: ACTIVE === LOADED. Break this only intentionally.
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'privateai_v1.db';
export const DEFAULT_CONVO_ID = 'default';

let db: SQLite.SQLiteDatabase | null = null;

// ── Types ─────────────────────────────────────────────────────

export type PersistedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  routedVia: string | null;
  latency: number | null;
  model: string | null;
};

// ── Init ──────────────────────────────────────────────────────

export async function initConversationDB(): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      title      TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT    NOT NULL,
      role            TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
      content         TEXT    NOT NULL,
      timestamp       INTEGER NOT NULL,
      routed_via      TEXT,
      latency         INTEGER,
      model           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv_ts
      ON messages(conversation_id, timestamp);
  `);

  // Ensure the default conversation row exists
  await db.runAsync(
    'INSERT OR IGNORE INTO conversations (id, created_at) VALUES (?, ?)',
    [DEFAULT_CONVO_ID, Date.now()]
  );
}

// ── Create ────────────────────────────────────────────────────

export async function createConversation(): Promise<string> {
  if (!db) throw new Error('[DB] createConversation called before initConversationDB');
  const id = `conv_${Date.now()}`;
  await db.runAsync(
    'INSERT INTO conversations (id, created_at) VALUES (?, ?)',
    [id, Date.now()]
  );
  return id;
}

// ── Restore ───────────────────────────────────────────────────

/**
 * Returns the conversation_id that has the most recent message.
 * Falls back to DEFAULT_CONVO_ID if no messages exist yet.
 */
export async function getLatestConversationId(): Promise<string> {
  if (!db) return DEFAULT_CONVO_ID;
  const row = await db.getFirstAsync<{ conversation_id: string }>(
    'SELECT conversation_id FROM messages ORDER BY timestamp DESC LIMIT 1'
  );
  return row?.conversation_id ?? DEFAULT_CONVO_ID;
}

// ── Write ─────────────────────────────────────────────────────

export async function persistMessage(
  msg: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    routedVia?: string | null;
    latency?: number | null;
    model?: string | null;
    timestamp?: number;
  },
  conversationId: string
): Promise<void> {
  if (!db) {
    console.warn('[DB] persistMessage called before initConversationDB');
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO messages
       (id, conversation_id, role, content, timestamp, routed_via, latency, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      msg.timestamp ?? Date.now(),
      msg.routedVia ?? null,
      msg.latency ?? null,
      msg.model ?? null,
    ]
  );
}

// ── Clear ─────────────────────────────────────────────────────

export async function clearConversation(conversationId: string): Promise<void> {
  if (!db) return;
  await db.runAsync(
    'DELETE FROM messages WHERE conversation_id = ?',
    [conversationId]
  );
}

// ── List ──────────────────────────────────────────────────────

export type ConversationSummary = {
  id: string;
  createdAt: number;
  lastActive: number | null;
  title: string | null;    // explicitly set title (first user message, editable later)
  snippet: string | null;  // first message content, fallback display
};

/**
 * Returns up to 20 conversations that have at least one message,
 * ordered by most recent activity.
 */
export async function getConversations(): Promise<ConversationSummary[]> {
  if (!db) return [];
  return db.getAllAsync<ConversationSummary>(
    `SELECT
       c.id,
       c.created_at                                                                                    AS createdAt,
       c.title,
       (SELECT timestamp FROM messages WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1)   AS lastActive,
       (SELECT content   FROM messages WHERE conversation_id = c.id ORDER BY timestamp ASC  LIMIT 1)   AS snippet
     FROM conversations c
     WHERE EXISTS (SELECT 1 FROM messages WHERE conversation_id = c.id)
     ORDER BY lastActive DESC
     LIMIT 20`
  );
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<void> {
  if (!db) return;
  await db.runAsync(
    'UPDATE conversations SET title = ? WHERE id = ?',
    [title, conversationId]
  );
}

// ── Read ──────────────────────────────────────────────────────

export async function loadConversation(conversationId: string): Promise<PersistedMessage[]> {
  if (!db) return [];
  return db.getAllAsync<PersistedMessage>(
    `SELECT id, role, content, timestamp,
            routed_via AS routedVia, latency, model
     FROM messages
     WHERE conversation_id = ?
     ORDER BY timestamp ASC`,
    [conversationId]
  );
}
