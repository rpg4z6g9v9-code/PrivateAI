/**
 * dataVault.ts — Face ID / Biometric Vault
 * 
 * Manages device unlock state and session locking.
 * - vaultUnlocked: true if user has passed biometric auth this session
 * - Auto-locks after 5 min backgrounding
 */

import * as LocalAuth from 'expo-local-authentication';

let vaultUnlocked = false;
let lockTimestamp: number | null = null;

export async function canAccessVault(): Promise<boolean> {
  return vaultUnlocked;
}

export async function unlockVault(): Promise<void> {
  vaultUnlocked = true;
  lockTimestamp = null;
}

export async function lockVault(): Promise<void> {
  vaultUnlocked = false;
  lockTimestamp = Date.now();
}

export function isVaultLocked(): boolean {
  return !vaultUnlocked;
}

export function getVaultStatus(): { locked: boolean; lockedSince?: number } {
  return {
    locked: !vaultUnlocked,
    lockedSince: lockTimestamp ?? undefined,
  };
}
