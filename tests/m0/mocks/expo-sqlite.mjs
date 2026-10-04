// Mock: expo-sqlite
// In-memory SQL-like store with transaction semantics for M3 Recorder testing.
// Supports: CREATE TABLE, INSERT INTO, INSERT OR REPLACE, SELECT WHERE, BEGIN/COMMIT/ROLLBACK.

let _shouldFail = false;
let _commitShouldFail = false;
const _databases = new Map();

class MockDB {
  constructor(name) {
    this._name = name;
    if (!_databases.has(name)) _databases.set(name, new Map());
    this._tables = _databases.get(name);
    this._txnStaged = null; // null = no active transaction
  }

  _getRows(tbl) {
    return this._tables.get(tbl) || [];
  }

  async execAsync(sql) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
    const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g);
    if (createMatch) {
      for (const m of createMatch) {
        const tbl = m.replace('CREATE TABLE IF NOT EXISTS ', '');
        if (!this._tables.has(tbl)) this._tables.set(tbl, []);
      }
    }
  }

  async runAsync(sql, params) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');

    // Transaction control
    if (sql.trim() === 'BEGIN TRANSACTION' || sql.trim() === 'BEGIN') {
      this._txnStaged = [];
      return { changes: 0, lastInsertRowId: 0 };
    }
    if (sql.trim() === 'COMMIT') {
      if (_commitShouldFail) {
        this._txnStaged = null;
        throw new Error('SQLITE_IOERR: commit failed');
      }
      if (this._txnStaged) {
        for (const op of this._txnStaged) op();
        this._txnStaged = null;
      }
      return { changes: 0, lastInsertRowId: 0 };
    }
    if (sql.trim() === 'ROLLBACK') {
      this._txnStaged = null;
      return { changes: 0, lastInsertRowId: 0 };
    }

    // INSERT INTO table (...) VALUES (?, ?, ...)
    const insertMatch = sql.match(/INSERT INTO (\w+)\s*\(/);
    if (insertMatch) {
      const tbl = insertMatch[1];
      if (!this._tables.has(tbl)) this._tables.set(tbl, []);
      const colMatch = sql.match(/INSERT INTO \w+\s*\(([^)]+)\)/);
      if (colMatch && params) {
        const cols = colMatch[1].split(',').map(c => c.trim());
        const row = {};
        cols.forEach((col, i) => { row[col] = params[i] ?? null; });
        const pk = cols[0];
        const rows = this._tables.get(tbl);
        if (rows.some(r => r[pk] === row[pk])) {
          throw new Error(`UNIQUE constraint failed: ${tbl}.${pk}`);
        }
        if (this._txnStaged !== null) {
          // Stage the insert — only committed on COMMIT
          this._txnStaged.push(() => rows.push(row));
        } else {
          rows.push(row);
        }
      }
      return { changes: 1, lastInsertRowId: 1 };
    }

    // INSERT OR REPLACE INTO table (...) VALUES (?, ?, ...)
    const replaceMatch = sql.match(/INSERT OR REPLACE INTO (\w+)\s*\(/);
    if (replaceMatch) {
      const tbl = replaceMatch[1];
      if (!this._tables.has(tbl)) this._tables.set(tbl, []);
      const colMatch = sql.match(/INSERT OR REPLACE INTO \w+\s*\(([^)]+)\)/);
      if (colMatch && params) {
        const cols = colMatch[1].split(',').map(c => c.trim());
        const row = {};
        cols.forEach((col, i) => { row[col] = params[i] ?? null; });
        const pk = cols[0];
        const rows = this._tables.get(tbl);
        const idx = rows.findIndex(r => r[pk] === row[pk]);
        if (idx >= 0) rows[idx] = row; else rows.push(row);
      }
      return { changes: 1, lastInsertRowId: 1 };
    }

    // UPDATE — no-op for mock (toolDB uses it but M3 doesn't test that path)
    return { changes: 0, lastInsertRowId: 0 };
  }

  async getAllAsync(sql, params) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
    const selectMatch = sql.match(/SELECT \* FROM (\w+)/);
    if (!selectMatch) return [];
    const tbl = selectMatch[1];
    const rows = this._tables.get(tbl) || [];

    const whereMatch = sql.match(/WHERE (\w+) = \?/);
    if (whereMatch && params && params.length > 0) {
      return rows.filter(r => r[whereMatch[1]] === params[0]);
    }
    const limitMatch = sql.match(/LIMIT (\d+)/);
    if (limitMatch) return rows.slice(0, parseInt(limitMatch[1]));
    return [...rows];
  }

  async getFirstAsync(sql, params) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
    const rows = await this.getAllAsync(sql, params);
    return rows[0] || null;
  }
}

// Initialization pause hook: set a deferred promise that openDatabaseAsync awaits.
let _openGate = null; // { promise, resolve, reject }

export async function openDatabaseAsync(name) {
  if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
  if (_openGate) await _openGate.promise;
  return new MockDB(name);
}

export function __setFault(shouldFail) { _shouldFail = shouldFail; }
export function __setCommitFault(shouldFail) { _commitShouldFail = shouldFail; }
export function __clearAll() { _databases.clear(); }

/** Pause openDatabaseAsync until __releaseOpen is called. */
export function __pauseOpen() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  _openGate = { promise, resolve, reject };
}
/** Release a paused openDatabaseAsync successfully. */
export function __releaseOpen() { if (_openGate) { _openGate.resolve(); _openGate = null; } }
/** Release a paused openDatabaseAsync with failure. */
export function __failOpen(err) { if (_openGate) { _openGate.reject(err || new Error('open failed')); _openGate = null; } }
