/**
 * Control Plane — Recorder (M3)
 *
 * Sole writer to the Control Plane record store.
 * Append-only. No update, delete, replace, or upsert.
 * Query-by-any-id for linked record retrieval.
 *
 * Readiness lifecycle:
 *   initRecorder() begins once, concurrent callers share the same attempt.
 *   ensureReady() awaits readiness with a timeout (never blocks indefinitely).
 *   Failed initialization → immediate degraded state for all callers.
 *
 * ReasoningEngine/model code must hold NO Recorder handle.
 * Recorder failure = degraded state, chat continues.
 */

import * as SQLite from 'expo-sqlite';
import { RECORD_TYPES, type RecordType } from './types';

const DB_NAME = 'privateai_controlplane_v1.db';
let db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<void> | null = null;
let _initFailed = false;

const READY_TIMEOUT_MS = 5000;

// ── Types ───────────────────────────────────────────────────────

export type RecordKind = 'canonical' | 'interim_gate';

/**
 * Discriminated union: invalid combinations structurally impossible.
 * canonical: record_type must be a valid M1 RecordType.
 * interim_gate: record_type must be null.
 */
export type ControlPlaneRecord =
  | {
      record_id: string;
      record_kind: 'canonical';
      record_type: RecordType;
      session_id: string;
      conversation_id: string | null;
      message_id: string | null;
      request_id: string | null;
      timestamp: number;
      source: string;
      payload: string;
    }
  | {
      record_id: string;
      record_kind: 'interim_gate';
      record_type: null;
      session_id: string;
      conversation_id: string | null;
      message_id: string | null;
      request_id: string | null;
      timestamp: number;
      source: string;
      payload: string;
    };

export type RecorderStatus = 'recorded' | 'degraded';

export interface RecorderResult {
  status: RecorderStatus;
  record_id?: string;
  error?: string;
}

// ── Runtime record-shape validation ─────────────────────────────

const VALID_RECORD_TYPES = new Set(RECORD_TYPES as readonly string[]);

function validateRecordShape(record: ControlPlaneRecord): string | null {
  const r = record as Record<string, unknown>;
  const kind = r.record_kind;
  const type = r.record_type;

  if (kind === 'canonical') {
    if (type === null || type === undefined) {
      return 'canonical record requires non-null record_type';
    }
    if (!VALID_RECORD_TYPES.has(type as string)) {
      return `unknown canonical record_type: ${type}`;
    }
    return null;
  }
  if (kind === 'interim_gate') {
    if (type !== null) {
      return `interim_gate record must have record_type=null, got: ${type}`;
    }
    return null;
  }
  return `unknown record_kind: ${String(kind)}`;
}

// ── Init / Readiness ────────────────────────────────────────────

export function initRecorder(): Promise<void> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS cp_records (
          record_id       TEXT PRIMARY KEY,
          record_type     TEXT,
          record_kind     TEXT    NOT NULL DEFAULT 'canonical',
          session_id      TEXT    NOT NULL,
          conversation_id TEXT,
          message_id      TEXT,
          request_id      TEXT,
          timestamp       INTEGER NOT NULL,
          source          TEXT    NOT NULL,
          payload         TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_cp_session ON cp_records(session_id);
        CREATE INDEX IF NOT EXISTS idx_cp_conversation ON cp_records(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_cp_message ON cp_records(message_id);
        CREATE INDEX IF NOT EXISTS idx_cp_request ON cp_records(request_id);
        CREATE INDEX IF NOT EXISTS idx_cp_type ON cp_records(record_type);
      `);
      _initFailed = false;
    } catch (e) {
      _initFailed = true;
      db = null;
      throw e;
    }
  })();

  return _initPromise;
}

/**
 * Await Recorder readiness. Returns true if ready, false if degraded.
 * Never blocks longer than READY_TIMEOUT_MS.
 */
export async function ensureReady(): Promise<boolean> {
  if (db) return true;
  if (_initFailed) return false;
  if (!_initPromise) return false;

  try {
    await Promise.race([
      _initPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('recorder_ready_timeout')), READY_TIMEOUT_MS)),
    ]);
    return db !== null;
  } catch {
    return false;
  }
}

// ── Append (sole write path, validated + transactional) ─────────

export async function appendRecord(record: ControlPlaneRecord): Promise<RecorderResult> {
  // Runtime shape validation before any DB operation
  const shapeError = validateRecordShape(record);
  if (shapeError) {
    return { status: 'degraded', error: `invalid_record_shape: ${shapeError}` };
  }

  if (!db) {
    return { status: 'degraded', error: 'recorder_not_initialized' };
  }

  try {
    await db.runAsync('BEGIN TRANSACTION');
    try {
      await db.runAsync(
        `INSERT INTO cp_records
           (record_id, record_type, record_kind, session_id, conversation_id,
            message_id, request_id, timestamp, source, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.record_id,
          record.record_type,
          record.record_kind,
          record.session_id,
          record.conversation_id,
          record.message_id,
          record.request_id,
          record.timestamp,
          record.source,
          record.payload,
        ]
      );
      await db.runAsync('COMMIT');
      return { status: 'recorded', record_id: record.record_id };
    } catch (e) {
      await db.runAsync('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (e) {
    return { status: 'degraded', error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Query-by-any-id (read-only) ─────────────────────────────────

export async function queryByRecordId(recordId: string): Promise<ControlPlaneRecord[]> {
  if (!db) return [];
  return db.getAllAsync<ControlPlaneRecord>('SELECT * FROM cp_records WHERE record_id = ?', [recordId]);
}

export async function queryBySessionId(sessionId: string): Promise<ControlPlaneRecord[]> {
  if (!db) return [];
  return db.getAllAsync<ControlPlaneRecord>('SELECT * FROM cp_records WHERE session_id = ? ORDER BY timestamp', [sessionId]);
}

export async function queryByConversationId(conversationId: string): Promise<ControlPlaneRecord[]> {
  if (!db) return [];
  return db.getAllAsync<ControlPlaneRecord>('SELECT * FROM cp_records WHERE conversation_id = ? ORDER BY timestamp', [conversationId]);
}

export async function queryByMessageId(messageId: string): Promise<ControlPlaneRecord[]> {
  if (!db) return [];
  return db.getAllAsync<ControlPlaneRecord>('SELECT * FROM cp_records WHERE message_id = ? ORDER BY timestamp', [messageId]);
}

export async function queryByRequestId(requestId: string): Promise<ControlPlaneRecord[]> {
  if (!db) return [];
  return db.getAllAsync<ControlPlaneRecord>('SELECT * FROM cp_records WHERE request_id = ? ORDER BY timestamp', [requestId]);
}

// ── Test support ────────────────────────────────────────────────

export function __resetRecorder(): void {
  db = null;
  _initPromise = null;
  _initFailed = false;
}
