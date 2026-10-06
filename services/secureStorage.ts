/**
 * secureStorage.ts — PrivateAI Encrypted Storage
 *
 * Wraps react-native-encrypted-storage with the same interface as
 * AsyncStorage. On iOS uses the Keychain (AES-256); on Android uses
 * EncryptedSharedPreferences backed by the Android Keystore.
 *
 * Drop-in replacement: setItem / getItem / removeItem.
 */

import EncryptedStorage from 'react-native-encrypted-storage';

const secureStorage = {
  async setItem(key: string, value: string): Promise<void> {
    await EncryptedStorage.setItem(key, value);
  },

  async getItem(key: string): Promise<string | null> {
    try {
      return await EncryptedStorage.getItem(key) ?? null;
    } catch (e) {
      console.warn('[Storage] getItem failed:', e);
      return null;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await EncryptedStorage.removeItem(key);
    } catch (e) { console.warn('[Storage] removeItem failed:', e); }
  },

  /**
   * Attempt to remove a key and return whether the removal succeeded.
   * Returns true if EncryptedStorage.removeItem completed without error.
   * Returns false (and logs non-secret failure) if it threw.
   * Never exposes the key value in logs.
   */
  async removeItemWithStatus(key: string): Promise<boolean> {
    try {
      await EncryptedStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn('[Storage] removeItem failed:', e);
      return false;
    }
  },
};

export default secureStorage;
