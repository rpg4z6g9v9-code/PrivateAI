// Mock: @react-native-async-storage/async-storage
// In-memory AsyncStorage double
const _store = new Map();

const AsyncStorage = {
  async setItem(key, value) { _store.set(key, value); },
  async getItem(key) { return _store.get(key) ?? null; },
  async removeItem(key) { _store.delete(key); },
  async clear() { _store.clear(); },
  async getAllKeys() { return [..._store.keys()]; },
  async multiGet(keys) { return keys.map(k => [k, _store.get(k) ?? null]); },
  async multiSet(pairs) { pairs.forEach(([k, v]) => _store.set(k, v)); },
  async multiRemove(keys) { keys.forEach(k => _store.delete(k)); },
};

export default AsyncStorage;
export { _store as __testStore };
