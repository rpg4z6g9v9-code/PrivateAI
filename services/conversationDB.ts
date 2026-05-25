/**
 * conversationDB.ts — SQLite-backed conversation persistence
 *
 * v1 scope: single default conversation, append-only message log.
 * Schema is intentionally extensible: search, export, embeddings,
 * multi-conversation support can be added without a migration.
 *
 * Usage:
 *   await initConversationDB()    — call once on app mount
 *   await persistMessage(msg)     — call after each message
 *   await loadConversation()      — call on mount to restore history
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'privateai_v1.db';
const DEFAULT_CONVO_ID = 'default';

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
  `);

  // Ensure the default conversation row exists
  await db.runAsync(
    'INSERT OR IGNORE INTO conversations (id, created_at) VALUES (?, ?)',
    [DEFAULT_CONVO_ID, Date.now()]
  );
}

// ── Write ─────────────────────────────────────────────────────

export async function persistMessage(msg: {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  routedVia?: string | null;
  latency?: number | null;
  model?: string | null;
  timestamp?: number;
}): Promise<void> {
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
      DEFAULT_CONVO_ID,
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

export async function clearConversation(): Promise<void> {
  if (!db) return;
  await db.runAsync(
    'DELETE FROM messages WHERE conversation_id = ?',
    [DEFAULT_CONVO_ID]
  );
}

// ── Read ──────────────────────────────────────────────────────

export async function loadConversation(): Promise<PersistedMessage[]> {
  if (!db) return [];
  return db.getAllAsync<PersistedMessage>(
    `SELECT id, role, content, timestamp,
            routed_via AS routedVia, latency, model
     FROM messages
     WHERE conversation_id = ?
     ORDER BY timestamp ASC`,
    [DEFAULT_CONVO_ID]
  );
}
