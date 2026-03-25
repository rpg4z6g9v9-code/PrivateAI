/**
 * PHASE 2: Cloud Sync Service
 * ──────────────────────────────────────────────────────────────
 * 
 * Multi-provider cloud storage with tiered compression strategy.
 * Supports: Synology NAS, Nextcloud, AWS S3
 * 
 * ARCHITECTURE:
 *   HOT (0-7 days)   → Device only, full summaries, fast access
 *   WARM (7-30 days) → Cloud + compressed, keeps key data
 *   COLD (30+ days)  → Archive by month, subject index only
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAllSummaries } from './conversationSummarizer';
import type { ConversationSummary } from './conversationSummarizer';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface CloudSyncConfig {
  provider: 'synology' | 'nextcloud' | 's3';
  endpoint: string;           // NAS IP, Nextcloud URL, or AWS region
  apiKey: string;             // API key or AWS credentials
  enabled: boolean;
  syncInterval: number;       // milliseconds (default: 6 hours)
  lastSyncTime?: number;
  compressionEnabled: boolean;
  autoCloudBackup: boolean;
}

export interface SyncJob {
  id: string;
  startTime: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  itemsProcessed: number;
  bytesUploaded: number;
  error?: string;
  endTime?: number;
}

export interface CloudStorageMetrics {
  hotTierSize: number;        // bytes on device
  warmTierSize: number;       // bytes on cloud
  coldTierSize: number;       // archived bytes
  hotItemCount: number;
  warmItemCount: number;
  coldItemCount: number;
  lastSyncTime: string;
  nextSyncTime: string;
  syncStatus: 'idle' | 'syncing' | 'error';
}

interface CompressedSummary {
  id: string;
  date: string;
  subject: string;
  highlights: string[];
  hardStickNotes: string[];
  actionItems: Array<{ task: string; status: string }>;
  messageCount: number;
}

interface SuperCompressedSummary {
  id: string;
  date: string;
  subject: string;
  keywords: string[];
  messageCount: number;
}

// ─────────────────────────────────────────────────────────────
// CONFIGURATION MANAGEMENT
// ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'privateai_cloud_sync_config';
const SYNC_JOBS_KEY = 'privateai_sync_jobs';
const METRICS_KEY = 'privateai_cloud_metrics';

export async function getCloudConfig(): Promise<CloudSyncConfig | null> {
  try {
    const config = await AsyncStorage.getItem(CONFIG_KEY);
    return config ? JSON.parse(config) : null;
  } catch (error) {
    console.error('[CloudSync] Error loading config:', error);
    return null;
  }
}

export async function setCloudConfig(config: CloudSyncConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    console.log('[CloudSync] Config saved:', config.provider);
  } catch (error) {
    console.error('[CloudSync] Error saving config:', error);
    throw error;
  }
}

export async function validateConfig(config: CloudSyncConfig): Promise<boolean> {
  if (!config.endpoint || !config.apiKey) {
    console.warn('[CloudSync] Missing endpoint or API key');
    return false;
  }

  try {
    switch (config.provider) {
      case 'synology':
        return await validateSynologyConnection(config);
      case 'nextcloud':
        return await validateNextcloudConnection(config);
      case 's3':
        return await validateS3Connection(config);
      default:
        return false;
    }
  } catch (error) {
    console.error('[CloudSync] Validation failed:', error);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// PROVIDER VALIDATION
// ─────────────────────────────────────────────────────────────

async function validateSynologyConnection(config: CloudSyncConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.endpoint}/webapi/auth.cgi?api=SYNO.API.Auth&method=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `account=admin&passwd=${config.apiKey}&session=FileStation&format=json`,
    });
    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('[CloudSync] Synology validation error:', error);
    return false;
  }
}

async function validateNextcloudConnection(config: CloudSyncConfig): Promise<boolean> {
  try {
    const base64Auth = Buffer.from(`admin:${config.apiKey}`).toString('base64');
    const response = await fetch(`${config.endpoint}/ocs/v2.php/apps/files/api/v1/shares`, {
      headers: { Authorization: `Basic ${base64Auth}` },
    });
    return response.status === 200;
  } catch (error) {
    console.error('[CloudSync] Nextcloud validation error:', error);
    return false;
  }
}

async function validateS3Connection(config: CloudSyncConfig): Promise<boolean> {
  // Placeholder - AWS SDK would handle this
  console.log('[CloudSync] S3 validation (placeholder)');
  return true;
}

// ─────────────────────────────────────────────────────────────
// COMPRESSION FUNCTIONS
// ─────────────────────────────────────────────────────────────

function compressSummary(summary: ConversationSummary): CompressedSummary {
  // WARM tier: Keep highlights, hard-stick notes, action items
  return {
    id: summary.id,
    date: summary.date,
    subject: summary.subject,
    highlights: summary.highlights.slice(0, 3),
    hardStickNotes: summary.hardStickNotes,
    actionItems: summary.actionItems.map(a => ({
      task: a.task,
      status: a.status,
    })),
    messageCount: summary.messageCount,
  };
}

function superCompressSummary(summary: ConversationSummary): SuperCompressedSummary {
  // COLD tier: Subject index only
  const keywords = [
    summary.subject,
    ...summary.highlights.slice(0, 2).flatMap(h => h.split(' ').slice(0, 3)),
  ].filter(Boolean).slice(0, 10);

  return {
    id: summary.id,
    date: summary.date,
    subject: summary.subject,
    keywords,
    messageCount: summary.messageCount,
  };
}

// ─────────────────────────────────────────────────────────────
// TIERED STORAGE MANAGEMENT
// ─────────────────────────────────────────────────────────────

export async function categorizeByTier(
  summaries: ConversationSummary[]
): Promise<{
  hot: ConversationSummary[];
  warm: CompressedSummary[];
  cold: SuperCompressedSummary[];
}> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const hot: ConversationSummary[] = [];
  const warm: CompressedSummary[] = [];
  const cold: SuperCompressedSummary[] = [];

  summaries.forEach(summary => {
    const summaryDate = new Date(summary.date);

    if (summaryDate > sevenDaysAgo) {
      hot.push(summary);
    } else if (summaryDate > thirtyDaysAgo) {
      warm.push(compressSummary(summary));
    } else {
      cold.push(superCompressSummary(summary));
    }
  });

  return { hot, warm, cold };
}

// ─────────────────────────────────────────────────────────────
// UPLOAD OPERATIONS
// ─────────────────────────────────────────────────────────────

export async function uploadSummaries(dateRange?: { start: string; end: string }): Promise<SyncJob> {
  const job: SyncJob = {
    id: `sync_${Date.now()}`,
    startTime: Date.now(),
    status: 'running',
    itemsProcessed: 0,
    bytesUploaded: 0,
  };

  try {
    const config = await getCloudConfig();
    if (!config || !config.enabled) {
      throw new Error('Cloud sync not configured');
    }

    let summaries = await getAllSummaries();

    // Filter by date range if provided
    if (dateRange) {
      summaries = summaries.filter(s => {
        const date = new Date(s.date);
        return date >= new Date(dateRange.start) && date <= new Date(dateRange.end);
      });
    }

    const { hot, warm, cold } = await categorizeByTier(summaries);

    // Upload each tier
    const warmPayload = JSON.stringify(warm);
    const coldPayload = JSON.stringify(cold);

    job.itemsProcessed = warm.length + cold.length;
    job.bytesUploaded = warmPayload.length + coldPayload.length;

    switch (config.provider) {
      case 'synology':
        await uploadToSynology(config, warmPayload, coldPayload);
        break;
      case 'nextcloud':
        await uploadToNextcloud(config, warmPayload, coldPayload);
        break;
      case 's3':
        await uploadToS3(config, warmPayload, coldPayload);
        break;
    }

    job.status = 'completed';
    job.endTime = Date.now();

    // Update metrics
    await updateStorageMetrics(summaries);

    // Update config with last sync time
    config.lastSyncTime = Date.now();
    await setCloudConfig(config);

    console.log(
      `[CloudSync] Upload complete: ${job.itemsProcessed} items, ${job.bytesUploaded} bytes`
    );

    return job;
  } catch (error) {
    job.status = 'failed';
    job.error = (error as Error).message;
    job.endTime = Date.now();

    console.error('[CloudSync] Upload failed:', error);
    return job;
  }
}

async function uploadToSynology(
  config: CloudSyncConfig,
  warmPayload: string,
  coldPayload: string
): Promise<void> {
  // Synology WebDAV upload
  const timestamp = new Date().toISOString().split('T')[0];

  try {
    // Upload WARM tier
    const warmResponse = await fetch(`${config.endpoint}/dav/PrivateAI/summaries/warm/${timestamp}.json`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`admin:${config.apiKey}`).toString('base64')}`,
      },
      body: warmPayload,
    });

    if (!warmResponse.ok) {
      throw new Error(`Synology WARM upload failed: ${warmResponse.status}`);
    }

    // Upload COLD tier (monthly)
    const yearMonth = new Date().toISOString().substring(0, 7);
    const coldResponse = await fetch(
      `${config.endpoint}/dav/PrivateAI/summaries/cold/${yearMonth}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`admin:${config.apiKey}`).toString('base64')}`,
        },
        body: coldPayload,
      }
    );

    if (!coldResponse.ok) {
      throw new Error(`Synology COLD upload failed: ${coldResponse.status}`);
    }

    console.log('[CloudSync] Synology upload successful');
  } catch (error) {
    console.error('[CloudSync] Synology upload error:', error);
    throw error;
  }
}

async function uploadToNextcloud(
  config: CloudSyncConfig,
  warmPayload: string,
  coldPayload: string
): Promise<void> {
  // Nextcloud WebDAV upload
  const base64Auth = Buffer.from(`admin:${config.apiKey}`).toString('base64');
  const timestamp = new Date().toISOString().split('T')[0];

  try {
    // Upload WARM tier
    const warmResponse = await fetch(
      `${config.endpoint}/remote.php/dav/files/admin/PrivateAI/summaries/warm/${timestamp}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${base64Auth}`,
        },
        body: warmPayload,
      }
    );

    if (!warmResponse.ok) {
      throw new Error(`Nextcloud WARM upload failed: ${warmResponse.status}`);
    }

    // Upload COLD tier
    const yearMonth = new Date().toISOString().substring(0, 7);
    const coldResponse = await fetch(
      `${config.endpoint}/remote.php/dav/files/admin/PrivateAI/summaries/cold/${yearMonth}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${base64Auth}`,
        },
        body: coldPayload,
      }
    );

    if (!coldResponse.ok) {
      throw new Error(`Nextcloud COLD upload failed: ${coldResponse.status}`);
    }

    console.log('[CloudSync] Nextcloud upload successful');
  } catch (error) {
    console.error('[CloudSync] Nextcloud upload error:', error);
    throw error;
  }
}

async function uploadToS3(
  config: CloudSyncConfig,
  warmPayload: string,
  coldPayload: string
): Promise<void> {
  // AWS S3 upload (placeholder)
  console.log('[CloudSync] S3 upload not yet implemented');
  // TODO: Implement AWS S3 SDK integration
  throw new Error('S3 upload not implemented');
}

// ─────────────────────────────────────────────────────────────
// PROJECT FILE FETCHING
// ─────────────────────────────────────────────────────────────

export async function fetchProjectFromCloud(
  projectName: string
): Promise<string | null> {
  try {
    const config = await getCloudConfig();
    if (!config || !config.enabled) {
      throw new Error('Cloud sync not configured');
    }

    // Try to fetch from cloud first
    try {
      const cloudPath = `${config.endpoint}/dav/PrivateAI/projects/${projectName}.zip`;
      const response = await fetch(cloudPath);

      if (response.ok) {
        const blob = await response.blob();
        const localPath = `${FileSystem.documentDirectory}projects/${projectName}.zip`;

        // Save to device
        await FileSystem.writeAsStringAsync(localPath, await blob.text(), {
          encoding: FileSystem.EncodingType.UTF8,
        });

        console.log(`[CloudSync] Fetched ${projectName} from cloud`);
        return localPath;
      }
    } catch (error) {
      console.warn(`[CloudSync] Cloud fetch failed, checking local:`, error);
    }

    // Fall back to local device
    const localPath = `${FileSystem.documentDirectory}projects/${projectName}.zip`;
    const fileInfo = await FileSystem.getInfoAsync(localPath);

    if (fileInfo.exists) {
      console.log(`[CloudSync] Using local ${projectName}`);
      return localPath;
    }

    return null;
  } catch (error) {
    console.error('[CloudSync] Project fetch error:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// STORAGE METRICS
// ─────────────────────────────────────────────────────────────

export async function updateStorageMetrics(summaries: ConversationSummary[]): Promise<void> {
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
  } catch (error) {
    console.error('[CloudSync] Error updating metrics:', error);
  }
}

export async function getStorageMetrics(): Promise<CloudStorageMetrics | null> {
  try {
    const metrics = await AsyncStorage.getItem(METRICS_KEY);
    return metrics ? JSON.parse(metrics) : null;
  } catch (error) {
    console.error('[CloudSync] Error getting metrics:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// SYNC JOB TRACKING
// ─────────────────────────────────────────────────────────────

export async function getSyncJobs(): Promise<SyncJob[]> {
  try {
    const jobs = await AsyncStorage.getItem(SYNC_JOBS_KEY);
    return jobs ? JSON.parse(jobs) : [];
  } catch (error) {
    console.error('[CloudSync] Error loading sync jobs:', error);
    return [];
  }
}

export async function recordSyncJob(job: SyncJob): Promise<void> {
  try {
    const jobs = await getSyncJobs();
    jobs.push(job);
    // Keep last 50 jobs
    const recent = jobs.slice(-50);
    await AsyncStorage.setItem(SYNC_JOBS_KEY, JSON.stringify(recent));
  } catch (error) {
    console.error('[CloudSync] Error recording sync job:', error);
  }
}

export async function clearSyncJobs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SYNC_JOBS_KEY);
  } catch (error) {
    console.error('[CloudSync] Error clearing sync jobs:', error);
  }
}

console.log('[CloudSync] Service loaded');
