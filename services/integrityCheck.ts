/**
 * integrityCheck.ts — PrivateAI Data Integrity Verification
 *
 * Detects tampering of critical on-device data stores.
 * Uses HMAC-style checksums (SHA-256 hash of content + device-specific salt)
 * to verify data hasn't been modified outside the app.
 *
 * Protected stores:
 *   - User profile (shared memory)
 *   - Goals
 *   - Medical entries
 *   - Security event log
 *
 * On tamper detection: logs a security event and flags to the user.
 * Does NOT delete data — the user decides what to do.
 */

import secureStorage from './secureStorage';
import { logSecurityEvent } from './securityGateway';

// ─── Config ──────────────────────────────────────────────────

const CHECKSUM_PREFIX = 'integrity_v1_';
// Salt is per-install — generated once and stored in secure storage
const SALT_KEY = 'integrity_salt_v1';

// ─── Hash Function ───────────────────────────────────────────
//
// SHA-256 via SubtleCrypto (available in React Native's Hermes engine).
// Falls back to a strong non-cryptographic hash if SubtleCrypto is unavailable.

async function sha256(str: string): Promise<string> {
  try {
    // SubtleCrypto is available in modern React Native (Hermes)
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback: FNV-1a 64-bit (much stronger than DJB2, no crypto dependency)
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x01000193 >>> 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (c >> 8), 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
}

function hash(str: string): Promise<string> {
  return sha256(str);
}

async function generateSecureSalt(): Promise<string> {
  try {
    // Use crypto.getRandomValues for secure randomness
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback: timestamp + multiple Math.random calls
    const parts = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2));
    return `${Date.now()}_${parts.join('')}`;
  }
}

async function getSalt(): Promise<string> {
  let salt = await secureStorage.getItem(SALT_KEY);
  if (!salt) {
    salt = await generateSecureSalt();
    await secureStorage.setItem(SALT_KEY, salt);
  }
  return salt;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Compute and store a checksum for a data store.
 * Call this after every write to a protected store.
 */
export async function signData(storeKey: string, data: string): Promise<void> {
  try {
    const salt = await getSalt();
    const checksum = await hash(salt + storeKey + data);
    await secureStorage.setItem(CHECKSUM_PREFIX + storeKey, checksum);
  } catch (e) {
    console.warn('[Integrity] signData failed:', e);
  }
}

/**
 * Verify a data store's integrity against its stored checksum.
 * Returns true if data is untampered (or no checksum exists yet).
 * Returns false if tampering is detected.
 */
export async function verifyData(storeKey: string, data: string): Promise<boolean> {
  try {
    const storedChecksum = await secureStorage.getItem(CHECKSUM_PREFIX + storeKey);
    if (!storedChecksum) return true; // no checksum yet — first run

    const salt = await getSalt();
    const currentChecksum = await hash(salt + storeKey + data);

    if (currentChecksum !== storedChecksum) {
      console.error('[Integrity] TAMPER DETECTED on store:', storeKey);
      logSecurityEvent('tamper_detected', storeKey).catch(() => {});
      return false;
    }

    return true;
  } catch (e) {
    console.warn('[Integrity] verifyData failed:', e);
    return true; // fail open — don't lock the user out on errors
  }
}

/**
 * Run integrity checks on all critical stores.
 * Call on app launch (non-blocking).
 */
export async function runIntegrityChecks(): Promise<{
  passed: boolean;
  tamperedStores: string[];
}> {
  const criticalStores = [
    'shared_profile_v1',
    'shared_goals_v1',
    'medical_entries_v1',
    'security_events_v1',
  ];

  const tamperedStores: string[] = [];

  for (const key of criticalStores) {
    try {
      const data = await secureStorage.getItem(key);
      if (!data) continue; // store doesn't exist yet

      const valid = await verifyData(key, data);
      if (!valid) {
        tamperedStores.push(key);
      }
    } catch (e) {
      console.warn('[Integrity] Check failed for', key, ':', e);
    }
  }

  if (tamperedStores.length > 0) {
    console.error('[Integrity] TAMPER DETECTED in:', tamperedStores.join(', '));
    logSecurityEvent('integrity_check_failed', 'system').catch(() => {});
  } else {
    console.log('[Integrity] All critical stores verified');
  }

  return {
    passed: tamperedStores.length === 0,
    tamperedStores,
  };
}
