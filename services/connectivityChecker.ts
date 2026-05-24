/**
 * connectivityChecker.ts — Detect cloud API availability
 * 
 * Pings Claude API endpoint every 30s to determine if cloud is reachable.
 * Used to show offline indicator and fallback routing.
 */

let isConnected = true;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckTime = 0;

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';
const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const TIMEOUT_MS = 5_000; // 5 second timeout per check

/**
 * Start periodic connectivity checks.
 * Call once on app startup.
 */
export function startConnectivityCheck(): void {
  if (checkInterval) return; // Already running

  checkOnce(); // Check immediately

  checkInterval = setInterval(() => {
    checkOnce();
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop connectivity checks.
 * Call on app shutdown or cleanup.
 */
export function stopConnectivityCheck(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

/**
 * Perform a single connectivity check.
 * Non-blocking; updates isConnected state.
 */
async function checkOnce(): Promise<void> {
  const now = Date.now();

  // Skip if we just checked (within 5s)
  if (now - lastCheckTime < 5_000) return;

  lastCheckTime = now;

  try {
    // Minimal request — just check if API is reachable
    // No authentication needed for this HEAD check
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 400 (auth) or 429 (rate limit) = API is up, we just can't access
    // 200, 204, etc. = API is up
    // Anything else = API might be down
    isConnected = response.status < 500;
  } catch (e) {
    // Timeout, network error, etc.
    isConnected = false;
  }
}

/**
 * Get current connectivity status (no async).
 * Returns cached value from last check.
 */
export function isCloudAvailable(): boolean {
  return isConnected;
}

/**
 * Get connectivity status with icon for UI.
 */
export function getConnectivityBadge(): { icon: string; color: string; text: string } {
  if (isConnected) {
    return { icon: '☁️', color: '#4a9eff', text: 'cloud ready' };
  } else {
    return { icon: '🔴', color: '#ff6b6b', text: 'offline' };
  }
}

/**
 * Force a connectivity check (e.g., user pulls to refresh).
 */
export async function forceConnectivityCheck(): Promise<boolean> {
  lastCheckTime = 0; // Reset timer
  await checkOnce();
  return isConnected;
}
