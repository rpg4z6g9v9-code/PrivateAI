// Mock: react-native-encrypted-storage
// In-memory test double for react-native-encrypted-storage
const _store = new Map();

const EncryptedStorage = {
  async setItem(key, value) { _store.set(key, value); },
  async getItem(key) { return _store.get(key) ?? null; },
  async removeItem(key) { _store.delete(key); },
  async clear() { _store.clear(); },
};

export default EncryptedStorage;
export { _store as __testStore };
