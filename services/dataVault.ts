/**
 * dataVault.ts — PrivateAI Local Data Vault
 *
 * Biometric-gated access to stored personal knowledge:
 *   • General memory   (memory.ts)
 *   • Medical memory   (medicalMemory.ts)
 *   • Knowledge base   (knowledgeBase.ts)
 *
 * Design:
 *   - Unlock via Face ID / Touch ID / device passcode
 *   - Unlock state is in-memory only — never persisted to disk
 *   - Auto-expires after VAULT_TTL_MS (5 minutes)
 *   - lockVault() is called by the AppState listener on background lock
 *   - On simulator / no biometrics: silently grants access
 *
 * Usage: call canAccessVault() at the top of every gated function.
 * If false, return empty data — do NOT throw (callers expect arrays/strings).
 */

import * as LocalAuth from 'expo-local-authentication';

// ── Config ─────────────────────────────────────────────────────

const VAULT_TTL_MS = 5 * 60 * 1_000; // 5 minutes

// ── State ──────────────────────────────────────────────────────

let _unlockedAt: number | null = null;

// ── API ────────────────────────────────────────────────────────

/**
 * Returns true if the vault is currently unlocked and within TTL.
 * Does NOT trigger a biometric prompt — call unlockVault() for that.
 */
export function canAccessVault(): boolean {
  if (_unlockedAt === null) return false;
  return Date.now() - _unlockedAt < VAULT_TTL_MS;
}

/**
 * Trigger biometric authentication to unlock the vault.
 * - On success: sets unlock timestamp, returns true
 * - On cancel/failure: returns false (vault stays locked)
 * - No biometrics enrolled: silently unlocks (simulator-safe)
 */
export async function unlockVault(): Promise<boolean> {
  if (canAccessVault()) return true;

  const hasHardware = await LocalAuth.hasHardwareAsync();
  const isEnrolled  = await LocalAuth.isEnrolledAsync();

  if (!hasHardware || !isEnrolled) {
    // Simulator or no biometric enrollment — unlock silently
    _unlockedAt = Date.now();
    return true;
  }

  const result = await LocalAuth.authenticateAsync({
    promptMessage:         'Unlock your Private Data Vault',
    fallbackLabel:         'Use Passcode',
    cancelLabel:           'Cancel',
    disableDeviceFallback: false,
  });

  if (result.success) {
    _unlockedAt = Date.now();
    return true;
  }

  return false;
}

/**
 * Immediately lock the vault.
 * Called by the AppState listener when the app returns from background
 * after BACKGROUND_LOCK_MS, and by explicit "lock" UI actions.
 */
export function lockVault(): void {
  _unlockedAt = null;
}
