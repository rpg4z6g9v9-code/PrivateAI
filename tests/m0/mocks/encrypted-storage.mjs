// Mock: react-native-encrypted-storage
// In-memory test double for react-native-encrypted-storage
// Supports fault injection via __injectFault(op, error, skipCount).
const _store = new Map();

// Fault queue: op -> { error, skip }. Fires once after skipping `skip` calls.
const _faults = new Map();

function _checkFault(op) {
  if (!_faults.has(op)) return;
  const f = _faults.get(op);
  if (f.skip > 0) { f.skip--; return; }
  _faults.delete(op);
  throw f.error;
}

const EncryptedStorage = {
  async setItem(key, value) { _checkFault('setItem'); _store.set(key, value); },
  async getItem(key) { _checkFault('getItem'); return _store.get(key) ?? null; },
  async removeItem(key) { _checkFault('removeItem'); _store.delete(key); },
  async clear() { _checkFault('clear'); _store.clear(); },
};

export default EncryptedStorage;
export { _store as __testStore };

/**
 * Inject a one-shot fault for the given operation.
 * @param {string} op - 'setItem' | 'getItem' | 'removeItem' | 'clear'
 * @param {Error|null} error - error to throw (defaults to generic mock fault)
 * @param {number} skipCount - skip this many calls before throwing (default 0 = throw on next call)
 */
export function __injectFault(op, error = null, skipCount = 0) {
  _faults.set(op, { error: error ?? new Error(`mock encrypted-storage ${op} fault`), skip: skipCount });
}

/** Clear all injected faults. */
export function __clearFaults() { _faults.clear(); }
