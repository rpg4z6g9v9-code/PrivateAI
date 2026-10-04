// Mock: expo-sqlite
// In-memory SQLite double with fault injection support

let _shouldFail = false;

class MockDB {
  constructor() { this._tables = {}; }
  async execAsync(sql) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
  }
  async runAsync(sql, params) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
    return { changes: 1, lastInsertRowId: 1 };
  }
  async getAllAsync(sql, params) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
    return [];
  }
  async getFirstAsync(sql, params) {
    if (_shouldFail) throw new Error('SQLITE_IOERR: disk I/O error');
    return null;
  }
}

export async function openDatabaseAsync(name) {
  return new MockDB();
}

export function __setFault(shouldFail) { _shouldFail = shouldFail; }
