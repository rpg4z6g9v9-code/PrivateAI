/**
 * Control Plane — Brave Key Migration (M4 / D4)
 *
 * Migrates the Brave Search API key from AsyncStorage (legacy) to secureStorage.
 *
 * Migration protocol (copy → verify → remove):
 *   1. Check secureStorage first — if key present, already migrated.
 *   2. Read legacy key from AsyncStorage.
 *   3. Copy to secureStorage. If write fails (Fault A) → migration_failed, legacy preserved.
 *   4. Verify secureStorage read-back succeeds and matches.
 *      If read-back fails or mismatches (Fault B) → migration_failed, legacy preserved.
 *   5. Remove legacy AsyncStorage key. If remove fails (Fault C) →
 *      migrated_legacy_cleanup_failed: secure copy is valid but legacy may persist.
 *      Subsequent retry can remove legacy safely.
 *
 * Key rules:
 *   - Never log key values.
 *   - Never return key value in migration status/result.
 *   - Migration failure must NOT delete the only usable copy.
 *   - Incomplete cleanup is explicitly reported, not silently swallowed.
 *
 * No-Settings migration:
 *   getBraveApiKeySecure() performs inline migration (steps 2–5) when secureStorage is
 *   empty. Migration does not depend on Settings being opened.
 *
 * Stale-key resurrection prevention:
 *   setBraveApiKeySecure() removes legacy AsyncStorage key after writing secureStorage.
 *   Returns BraveKeySetResult so callers can distinguish successful cleanup from partial.
 */

import secureStorage from '../secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Storage keys ─────────────────────────────────────────────────────────────

// Legacy AsyncStorage key (pre-D4)
const LEGACY_ASYNC_KEY = 'brave_search_api_key_v1';

// Secure storage key (post-D4)
const SECURE_KEY = 'brave_search_api_key_secure_v1';

// ── Migration ─────────────────────────────────────────────────────────────────

export type MigrationStatus =
  | 'already_secure'              // key already in secureStorage, nothing to do
  | 'migrated'                    // successfully moved: secure copy verified, legacy removed
  | 'no_key'                      // no key found in either store
  | 'migration_failed'            // copy or verify failed — legacy key preserved
  | 'migrated_legacy_cleanup_failed'; // secure copy verified; legacy AsyncStorage removal failed
                                      // subsequent call to migrateBraveKey() will clean up

export interface MigrationResult {
  status: MigrationStatus;
  error?: string;
  /** True if web.search is usable after migration (key present in secure store). */
  keyAvailable: boolean;
}

/**
 * Run D4 Brave key migration. Idempotent — safe to call on every app launch.
 * Never throws. Never logs the key value.
 *
 * Fault semantics:
 *   Fault A (secureStorage.setItem fails): status='migration_failed', legacy preserved, keyAvailable=false.
 *   Fault B (secureStorage readback fails/mismatches): status='migration_failed', legacy preserved, keyAvailable=false.
 *   Fault C (AsyncStorage.removeItem fails): status='migrated_legacy_cleanup_failed', secure copy valid, keyAvailable=true.
 */
export async function migrateBraveKey(): Promise<MigrationResult> {
  try {
    // Step 1: Check secureStorage first
    const existing = await secureStorage.getItem(SECURE_KEY);
    if (existing && existing.trim().length > 0) {
      return { status: 'already_secure', keyAvailable: true };
    }

    // Step 2: Read legacy AsyncStorage key
    const legacy = await AsyncStorage.getItem(LEGACY_ASYNC_KEY);
    if (!legacy || legacy.trim().length === 0) {
      return { status: 'no_key', keyAvailable: false };
    }

    // Step 3: Copy to secureStorage — Fault A: write failure
    try {
      await secureStorage.setItem(SECURE_KEY, legacy.trim());
    } catch (e) {
      // Legacy preserved — do not delete it
      return {
        status: 'migration_failed',
        error: e instanceof Error ? e.message : String(e),
        keyAvailable: false,
      };
    }

    // Step 4: Verify read-back — Fault B: readback failure or mismatch
    let readback: string | null;
    try {
      readback = await secureStorage.getItem(SECURE_KEY);
    } catch (e) {
      // Readback threw — legacy preserved
      return {
        status: 'migration_failed',
        error: e instanceof Error ? e.message : String(e),
        keyAvailable: false,
      };
    }
    if (!readback || readback.trim() !== legacy.trim()) {
      // Mismatch — legacy preserved
      return {
        status: 'migration_failed',
        error: 'secureStorage read-back did not match',
        keyAvailable: false,
      };
    }

    // Step 5: Remove legacy key ONLY after successful verification — Fault C: remove failure
    try {
      await AsyncStorage.removeItem(LEGACY_ASYNC_KEY);
      return { status: 'migrated', keyAvailable: true };
    } catch (e) {
      // Secure copy is valid. Legacy key may persist — incomplete cleanup.
      // Caller should retry or accept that legacy will be cleaned on next successful call.
      return {
        status: 'migrated_legacy_cleanup_failed',
        error: e instanceof Error ? e.message : String(e),
        keyAvailable: true,
      };
    }
  } catch (e) {
    return {
      status: 'migration_failed',
      error: e instanceof Error ? e.message : String(e),
      keyAvailable: false,
    };
  }
}

// ── Secure key read/write (post-D4 API) ──────────────────────────────────────

/**
 * Read the Brave API key from secureStorage.
 * If secureStorage is empty and a legacy AsyncStorage key exists, performs inline migration
 * (copy → verify → remove) so migration does not depend on Settings being opened.
 *
 * Fault semantics:
 *   Fault A (secureStorage.setItem fails): legacy key returned without removal.
 *   Fault B (secureStorage readback fails/mismatches): legacy key returned, legacy preserved.
 *   Fault C (AsyncStorage.removeItem fails): secure copy returned; legacy may persist (incomplete cleanup).
 *
 * Never logs the key value. Never throws.
 */
export async function getBraveApiKeySecure(): Promise<string> {
  try {
    const secure = await secureStorage.getItem(SECURE_KEY);
    if (secure && secure.trim().length > 0) return secure.trim();

    // No secure key — attempt inline migration from legacy AsyncStorage
    const legacy = await AsyncStorage.getItem(LEGACY_ASYNC_KEY);
    if (!legacy || legacy.trim().length === 0) return '';

    // Fault A: setItem fails → return legacy key, do not remove it
    try {
      await secureStorage.setItem(SECURE_KEY, legacy.trim());
    } catch {
      return legacy.trim();
    }

    // Fault B: readback fails or mismatches → return legacy key, do not remove it
    let readback: string | null;
    try {
      readback = await secureStorage.getItem(SECURE_KEY);
    } catch {
      return legacy.trim();
    }
    if (!readback || readback.trim() !== legacy.trim()) {
      return legacy.trim();
    }

    // Verification passed. Fault C: removeItem fails → return secure copy, cleanup is incomplete
    try {
      await AsyncStorage.removeItem(LEGACY_ASYNC_KEY);
    } catch {
      // Incomplete cleanup: legacy key may persist, but secure copy is valid
    }

    return readback.trim();
  } catch {
    return '';
  }
}

/**
 * Write the Brave API key to secureStorage and remove the legacy AsyncStorage key.
 * Returns BraveKeySetResult so callers can observe cleanup outcome.
 * Never logs the key value.
 */
export interface BraveKeySetResult {
  stored: boolean;       // true if key written to secureStorage successfully
  legacyRemoved: boolean; // true if legacy AsyncStorage key confirmed removed
}

export async function setBraveApiKeySecure(key: string): Promise<BraveKeySetResult> {
  const trimmed = key.trim();
  if (!trimmed) {
    // Empty key = clear path: remove from both stores
    try { await secureStorage.removeItem(SECURE_KEY); } catch {}
    let legacyRemoved = false;
    try { await AsyncStorage.removeItem(LEGACY_ASYNC_KEY); legacyRemoved = true; } catch {}
    return { stored: false, legacyRemoved };
  }
  // Write to secureStorage
  try {
    await secureStorage.setItem(SECURE_KEY, trimmed);
  } catch {
    return { stored: false, legacyRemoved: false };
  }
  // Remove legacy key to prevent stale resurrection
  let legacyRemoved = false;
  try { await AsyncStorage.removeItem(LEGACY_ASYNC_KEY); legacyRemoved = true; } catch {}
  return { stored: true, legacyRemoved };
}

/**
 * Clear the Brave API key from both stores.
 * Returns BraveKeyClearResult so callers can observe cleanup outcome.
 * If one store removal fails, the other still proceeds.
 */
export interface BraveKeyClearResult {
  secureCleared: boolean;  // true if secureStorage key removed successfully
  legacyCleared: boolean;  // true if legacy AsyncStorage key removed successfully
}

export async function clearBraveApiKeySecure(): Promise<BraveKeyClearResult> {
  const secureCleared = await secureStorage.removeItemWithStatus(SECURE_KEY);
  let legacyCleared = false;
  try { await AsyncStorage.removeItem(LEGACY_ASYNC_KEY); legacyCleared = true; } catch {}
  return { secureCleared, legacyCleared };
}

/**
 * True if a Brave API key is present in either store.
 * Used for status checks without exposing the key.
 */
export async function hasBraveApiKey(): Promise<boolean> {
  const key = await getBraveApiKeySecure();
  return key.length > 0;
}
