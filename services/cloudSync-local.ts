/**
 * cloudSync-local.ts — Local File System Mock for Cloud Sync
 *
 * Drop-in replacement for real cloud providers during testing.
 * Uses expo-file-system to store summaries in the app's document directory,
 * mimicking the tiered HOT/WARM/COLD structure of the real cloud sync.
 *
 * When you're ready for a real provider, just swap uploadToLocalMock()
 * calls with uploadSummaries() from cloudSync.ts.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getAllSummaries, type ConversationSummary } from './conversationSummarizer';
import { categorizeByTier, type SyncJob, type CloudStorageMetrics } from './cloudSync';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────────────────────

const MOCK_ROOT = `${FileSystem.documentDirectory}mock-cloud-storage/`;
const WARM_DIR = `${MOCK_ROOT}summaries/warm/`;
const COLD_DIR = `${MOCK_ROOT}summaries/cold/`;
const METRICS_KEY = 'privateai_mock_cloud_metrics';

// ─────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────

let _initialized = false;

/**
 * Create the mock cloud directory structure.
 * Call once at app startup.
 */
export async function initializeMockCloudStorage(): Promise<void> {
  if (_initialized) return;

  try {
    for (const dir of [MOCK_ROOT, WARM_DIR, COLD_DIR]) {
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
    }
    _initialized = true;
    console.log('[LocalMock] Cloud storage initialized at', MOCK_ROOT);
  } catch (e) {
    console.error('[LocalMock] Init error:', e);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────
// UPLOAD (replaces uploadToSynology / uploadToNextcloud)
// ─────────────────────────────────────────────────────────────

export interface MockUploadResult {
  tier: 'warm' | 'cold';
  path: string;
  bytes: number;
}

/**
 * Write a JSON payload to a tier directory, simulating a cloud upload.
 */
export async function uploadToLocalMock(
  tier: 'warm' | 'cold',
  payload: string,
): Promise<MockUploadResult> {
  await initializeMockCloudStorage();

  const dir = tier === 'warm' ? WARM_DIR : COLD_DIR;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.json`;
  const path = `${dir}${filename}`;

  await FileSystem.writeAsStringAsync(path, payload, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  console.log(`[LocalMock] Uploaded to ${tier}/${filename} (${payload.length} bytes)`);

  return { tier, path, bytes: payload.length };
}

// ─────────────────────────────────────────────────────────────
// FULL SYNC (mirrors uploadSummaries from cloudSync.ts)
// ─────────────────────────────────────────────────────────────

/**
 * Run a full sync cycle using local file storage.
 * Categorizes all summaries into tiers, compresses, and writes to disk.
 */
export async function syncToLocalMock(): Promise<SyncJob> {
  const job: SyncJob = {
    id: `mock_sync_${Date.now()}`,
    startTime: Date.now(),
    status: 'running',
    itemsProcessed: 0,
    bytesUploaded: 0,
  };

  try {
    const summaries = await getAllSummaries();

    if (summaries.length === 0) {
      job.status = 'completed';
      job.endTime = Date.now();
      console.log('[LocalMock] No summaries to sync');
      return job;
    }

    const { warm, cold } = await categorizeByTier(summaries);

    let totalBytes = 0;

    if (warm.length > 0) {
      const warmPayload = JSON.stringify(warm, null, 2);
      const warmResult = await uploadToLocalMock('warm', warmPayload);
      totalBytes += warmResult.bytes;
    }

    if (cold.length > 0) {
      const coldPayload = JSON.stringify(cold, null, 2);
      const coldResult = await uploadToLocalMock('cold', coldPayload);
      totalBytes += coldResult.bytes;
    }

    job.itemsProcessed = warm.length + cold.length;
    job.bytesUploaded = totalBytes;
    job.status = 'completed';
    job.endTime = Date.now();

    // Update metrics
    await updateMockMetrics(summaries);

    console.log(
      `[LocalMock] Sync complete: ${job.itemsProcessed} items, ${job.bytesUploaded} bytes, ` +
      `${job.endTime - job.startTime}ms`
    );

    return job;
  } catch (e) {
    job.status = 'failed';
    job.error = (e as Error).message;
    job.endTime = Date.now();
    console.error('[LocalMock] Sync failed:', e);
    return job;
  }
}

// ─────────────────────────────────────────────────────────────
// READ BACK (for verification / debugging)
// ─────────────────────────────────────────────────────────────

/**
 * List all files in a mock tier directory.
 */
export async function listMockFiles(tier: 'warm' | 'cold'): Promise<string[]> {
  await initializeMockCloudStorage();
  const dir = tier === 'warm' ? WARM_DIR : COLD_DIR;

  try {
    return await FileSystem.readDirectoryAsync(dir);
  } catch (e) {
    console.warn('[CloudSync] listMockFiles failed:', e);
    return [];
  }
}

/**
 * Read a specific mock file's content.
 */
export async function readMockFile(tier: 'warm' | 'cold', filename: string): Promise<string> {
  const dir = tier === 'warm' ? WARM_DIR : COLD_DIR;
  return FileSystem.readAsStringAsync(`${dir}${filename}`);
}

/**
 * Delete all mock cloud files (reset for testing).
 */
export async function clearMockStorage(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(MOCK_ROOT);
    if (info.exists) {
      await FileSystem.deleteAsync(MOCK_ROOT, { idempotent: true });
    }
    _initialized = false;
    await AsyncStorage.removeItem(METRICS_KEY);
    console.log('[LocalMock] Storage cleared');
  } catch (e) {
    console.error('[LocalMock] Clear error:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────

async function updateMockMetrics(summaries: ConversationSummary[]): Promise<void> {
  try {
    const { hot, warm, cold } = await categorizeByTier(summaries);

    const metrics: CloudStorageMetrics = {
      hotTierSize: JSON.stringify(hot).length,
      warmTierSize: JSON.stringify(warm).length,
      coldTierSize: JSON.stringify(cold).length,
      hotItemCount: hot.length,
      warmItemCount: warm.length,
      coldItemCount: cold.length,
      lastSyncTime: new Date().toISOString(),
      nextSyncTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      syncStatus: 'idle',
    };

    await AsyncStorage.setItem(METRICS_KEY, JSON.stringify(metrics));
  } catch (e) {
    console.error('[LocalMock] Metrics error:', e);
  }
}

export async function getMockMetrics(): Promise<CloudStorageMetrics | null> {
  try {
    const raw = await AsyncStorage.getItem(METRICS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[CloudSync] getMockMetrics failed:', e);
    return null;
  }
}

console.log('[LocalMock] Service loaded');
