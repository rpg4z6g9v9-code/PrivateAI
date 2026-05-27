/**
 * toolDB.ts — Tool execution log (append-only)
 *
 * Every tool call is recorded here. Records are never deleted.
 * Status moves forward only: running → completed | failed.
 *
 * Doctrine:
 *   AI proposes. Deterministic executors act. Every action is logged.
 *   Models never directly mutate state.
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'privateai_tools_v1.db';
let db: SQLite.SQLiteDatabase | null = null;

// ── Types ─────────────────────────────────────────────────────

export type ToolCallStatus = 'running' | 'completed' | 'failed';

export type ToolCall = {
  id: string;
  tool_name: string;
  input_summary: string;
  status: ToolCallStatus;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  result_summary: string | null;
  conversation_id: string | null;
  model: string | null;
  route: string | null;
};

// ── Init ──────────────────────────────────────────────────────

export async function initToolDB(): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tool_calls (
      id              TEXT PRIMARY KEY,
      tool_name       TEXT    NOT NULL,
      input_summary   TEXT    NOT NULL,
      status          TEXT    NOT NULL,
      started_at      INTEGER NOT NULL,
      completed_at    INTEGER,
      duration_ms     INTEGER,
      result_summary  TEXT,
      conversation_id TEXT,
      model           TEXT,
      route           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_started
      ON tool_calls(started_at DESC);
  `);
}

// ── Write ─────────────────────────────────────────────────────

export async function logToolStart(params: {
  id: string;
  tool_name: string;
  input_summary: string;
  conversation_id?: string | null;
  model?: string | null;
  route?: string | null;
}): Promise<void> {
  if (!db) return;
  await db.runAsync(
    `INSERT INTO tool_calls
       (id, tool_name, input_summary, status, started_at, conversation_id, model, route)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    [
      params.id,
      params.tool_name,
      params.input_summary,
      Date.now(),
      params.conversation_id ?? null,
      params.model ?? null,
      params.route ?? null,
    ]
  );
}

export async function logToolComplete(id: string, resultSummary: string | null): Promise<void> {
  if (!db) return;
  const now = Date.now();
  await db.runAsync(
    `UPDATE tool_calls
     SET status = 'completed',
         completed_at = ?,
         duration_ms  = (? - started_at),
         result_summary = ?
     WHERE id = ?`,
    [now, now, resultSummary, id]
  );
}

export async function logToolFail(id: string, error: string): Promise<void> {
  if (!db) return;
  const now = Date.now();
  await db.runAsync(
    `UPDATE tool_calls
     SET status = 'failed',
         completed_at = ?,
         duration_ms  = (? - started_at),
         result_summary = ?
     WHERE id = ?`,
    [now, now, error, id]
  );
}

// ── Read ──────────────────────────────────────────────────────

export async function getRecentToolCalls(limit = 10): Promise<ToolCall[]> {
  if (!db) return [];
  return db.getAllAsync<ToolCall>(
    `SELECT * FROM tool_calls ORDER BY started_at DESC LIMIT ?`,
    [limit]
  );
}
