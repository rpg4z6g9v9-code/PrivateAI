/**
 * cloudSyncAgent.ts — Background Cloud Sync Agent
 *
 * Runs periodic sync of conversation summaries to cloud/local mock.
 * Default interval: 6 hours. Minimum throttle: 15 minutes.
 *
 * Usage:
 *   import { initializeCloudSyncAgent } from '@/services/agents/cloudSyncAgent';
 *   await initializeCloudSyncAgent();   // call once at app startup
 *   triggerManualSync();                 // optional manual trigger
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { getCloudConfig, uploadSummaries, recordSyncJob } from '../cloudSync';
import { syncToLocalMock } from '../cloudSync-local';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const TASK_NAME = 'privateai-cloud-sync';
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 hours
const MIN_THROTTLE_MS = 15 * 60 * 1000;            // 15 minutes

let _lastSyncTime = 0;
let _syncInProgress = false;

// ─────────────────────────────────────────────────────────────
// CORE SYNC LOGIC
// ─────────────────────────────────────────────────────────────

/**
 * Run a single sync cycle.
 * Uses real cloud provider if configured, otherwise falls back to local mock.
 */
async function runSyncCycle(): Promise<void> {
  if (_syncInProgress) {
    console.log('[SyncAgent] Sync already in progress, skipping');
    return;
  }

  // Throttle: don't sync more often than MIN_THROTTLE_MS
  const elapsed = Date.now() - _lastSyncTime;
  if (elapsed < MIN_THROTTLE_MS) {
    console.log(`[SyncAgent] Throttled — last sync ${Math.round(elapsed / 1000)}s ago`);
    return;
  }

  _syncInProgress = true;
  console.log('[SyncAgent] Starting sync cycle...');

  try {
    const config = await getCloudConfig();

    let job;
    if (config && config.enabled) {
      // Real cloud provider configured
      job = await uploadSummaries();
    } else {
      // Fall back to local mock
      job = await syncToLocalMock();
    }

    await recordSyncJob(job);
    _lastSyncTime = Date.now();

    console.log(
      `[SyncAgent] Cycle complete: ${job.status}, ` +
      `${job.itemsProcessed} items, ${job.bytesUploaded} bytes`
    );
  } catch (e) {
    console.error('[SyncAgent] Sync cycle error:', e);
  } finally {
    _syncInProgress = false;
  }
}

// ─────────────────────────────────────────────────────────────
// BACKGROUND TASK (iOS Background Fetch)
// ─────────────────────────────────────────────────────────────

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await runSyncCycle();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.warn('[SyncAgent] background task failed:', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─────────────────────────────────────────────────────────────
// FOREGROUND TIMER
// ─────────────────────────────────────────────────────────────

let _intervalId: ReturnType<typeof setInterval> | null = null;

function startForegroundTimer(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  stopForegroundTimer();
  _intervalId = setInterval(() => {
    runSyncCycle().catch(e => console.error('[SyncAgent] Timer error:', e));
  }, intervalMs);
  console.log(`[SyncAgent] Foreground timer started (${Math.round(intervalMs / 60000)}min)`);
}

function stopForegroundTimer(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────

/**
 * Initialize the sync agent. Call once at app startup.
 * Registers iOS background fetch and starts a foreground timer.
 */
export async function initializeCloudSyncAgent(): Promise<void> {
  try {
    // Register background fetch (iOS will decide when to wake us)
    const status = await BackgroundFetch.getStatusAsync();

    if (status === BackgroundFetch.BackgroundFetchStatus.Available) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 6 * 60 * 60, // 6 hours in seconds
        stopOnTerminate: false,
        startOnBoot: false,
      });
      console.log('[SyncAgent] Background fetch registered');
    } else {
      console.warn('[SyncAgent] Background fetch not available, status:', status);
    }
  } catch (e) {
    // Background fetch may not be available in Expo Go
    console.warn('[SyncAgent] Background fetch registration failed:', e);
  }

  // Always start foreground timer as fallback
  const config = await getCloudConfig();
  const interval = config?.syncInterval ?? DEFAULT_INTERVAL_MS;
  startForegroundTimer(interval);

  // Run an initial sync after a short delay (let app finish loading)
  setTimeout(() => {
    runSyncCycle().catch(e => console.error('[SyncAgent] Initial sync error:', e));
  }, 10_000);

  console.log('[SyncAgent] Initialized');
}

/**
 * Trigger an immediate sync (e.g., from a "Sync Now" button).
 */
export async function triggerManualSync(): Promise<void> {
  // Reset throttle for manual triggers
  _lastSyncTime = 0;
  await runSyncCycle();
}

/**
 * Stop the sync agent (cleanup).
 */
export async function stopCloudSyncAgent(): Promise<void> {
  stopForegroundTimer();
  try {
    await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
  } catch (e) {
    console.warn('[SyncAgent] unregisterTaskAsync failed:', e);
  }
  console.log('[SyncAgent] Stopped');
}

/**
 * Check if a sync is currently running.
 */
export function isSyncing(): boolean {
  return _syncInProgress;
}

/**
 * Get the timestamp of the last successful sync.
 */
export function getLastSyncTime(): number {
  return _lastSyncTime;
}

console.log('[SyncAgent] Service loaded');
