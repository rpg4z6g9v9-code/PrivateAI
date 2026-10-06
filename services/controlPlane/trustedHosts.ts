/**
 * Control Plane — Trusted-Host Configuration (M4 / D5)
 *
 * Provides the D5 boundary configuration substrate for M5 candidate resolution.
 *
 * M4 scope:
 *   - TrustedHostConfig persistence and CRUD
 *   - Read API: getTrustedHosts, hasTrustedHostDeclaration, getTrustedHostDeclaration
 *   - Settings-only write API: declareTrustedHost, revokeTrustedHost
 *   - Architecture CIDR constant: AUTO_TRUSTED_CIDR (consumed by M5 for resolution)
 *
 * M5 scope (NOT implemented here):
 *   - Runtime host → BoundaryResolution (isTrustedHost, getTrustedHostBoundary)
 *   - Combining architecture rule + declarations + actual runtime host
 *
 * Write authority:
 *   declareTrustedHost() is only to be called from Settings (system.tsx).
 *   The send path, orchestration, aiRouter, localAI, Recorder result handling,
 *   tool-result handling, and model output have NO write reference.
 *
 * A trusted-host declaration states: "this host is PRIVATE_LAN".
 * It does NOT mean: "this host is authorized for this request."
 * A declaration alone can NEVER produce ALLOW. M6 authorization is separate.
 */

import secureStorage from '../secureStorage';
import type { TrustedHostConfig, TrustedHostId } from './types';

// ── Storage ──────────────────────────────────────────────────────────────────

const TRUSTED_HOSTS_KEY = 'cp_trusted_hosts_v1';
const CONFIG_VERSION = 1;

// ── Architecture rule constant (M5 consumes this for boundary resolution) ────

/**
 * IP prefix for the architecture-trusted subnet.
 * M5 uses this constant when resolving whether a runtime host falls in PRIVATE_LAN.
 * M4 does NOT perform that resolution — it only stores and exposes this constant.
 */
export const AUTO_TRUSTED_CIDR = '192.168.4.';

// ── Persistence helpers ───────────────────────────────────────────────────────

async function loadAll(): Promise<TrustedHostConfig[]> {
  try {
    const raw = await secureStorage.getItem(TRUSTED_HOSTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TrustedHostConfig[];
  } catch {
    return [];
  }
}

async function saveAll(configs: TrustedHostConfig[]): Promise<void> {
  await secureStorage.setItem(TRUSTED_HOSTS_KEY, JSON.stringify(configs));
}

// ── Read API (available to all modules) ──────────────────────────────────────

/** Returns all explicitly declared trusted-host configurations. */
export async function getTrustedHosts(): Promise<TrustedHostConfig[]> {
  return loadAll();
}

/**
 * True if the host has an explicit user declaration in the trusted-host store.
 * Does NOT apply the architecture rule — that is M5 resolution logic.
 * M5 combines: AUTO_TRUSTED_CIDR + hasTrustedHostDeclaration → BoundaryResolution.
 */
export async function hasTrustedHostDeclaration(host: string): Promise<boolean> {
  const configs = await loadAll();
  const bare = host.split(':')[0];
  return configs.some(c => c.host === host || c.host === bare);
}

/**
 * Returns the TrustedHostConfig for an explicitly declared host, or null if absent.
 * Does NOT apply the architecture rule — that is M5 resolution logic.
 */
export async function getTrustedHostDeclaration(host: string): Promise<TrustedHostConfig | null> {
  const configs = await loadAll();
  const bare = host.split(':')[0];
  return configs.find(c => c.host === host || c.host === bare) ?? null;
}

// ── Write API (Settings-only — do NOT import from send path or orchestration) ─

/**
 * Declare a host as PRIVATE_LAN.
 * SETTINGS-ONLY. Must not be called from send path, orchestration,
 * aiRouter, localAI, Recorder result handling, or model output.
 *
 * Only PRIVATE_LAN may be declared. Attempting any other boundary is rejected.
 * A declaration states boundary only — it never authorizes execution.
 */
export async function declareTrustedHost(
  host: string,
  userDeclaration: string,
): Promise<TrustedHostConfig> {
  if (!host.trim()) throw new Error('trusted_host: host must be non-empty');
  if (!userDeclaration.trim()) throw new Error('trusted_host: user_declaration must be non-empty');

  const configs = await loadAll();

  // Generate a stable ID for this host
  const id = `th.${Date.now()}.${Math.random().toString(36).slice(2, 6)}` as TrustedHostId;
  const bare = host.trim().split(':')[0];

  // Remove any existing declaration for this host before adding new one
  const filtered = configs.filter(c => c.host !== host.trim() && c.host !== bare);

  const config: TrustedHostConfig = {
    id,
    host: host.trim(),
    declared_boundary: 'PRIVATE_LAN',
    user_declaration: userDeclaration.trim(),
    timestamp: new Date().toISOString(),
    version: CONFIG_VERSION,
  };

  filtered.push(config);
  await saveAll(filtered);
  return config;
}

/**
 * Remove a trusted-host declaration by ID.
 * SETTINGS-ONLY.
 */
export async function revokeTrustedHost(id: string): Promise<void> {
  const configs = await loadAll();
  await saveAll(configs.filter(c => c.id !== id));
}

// ── Test support ──────────────────────────────────────────────────────────────

/** Clear all trusted-host declarations. For tests only. */
export async function __clearTrustedHosts(): Promise<void> {
  await secureStorage.removeItem(TRUSTED_HOSTS_KEY);
}
