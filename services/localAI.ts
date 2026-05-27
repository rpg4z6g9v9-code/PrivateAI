/**
 * localAI.ts — PrivateAI On-Device Inference
 *
 * Downloads and runs a quantized Llama 3.1 8B model (GGUF) entirely on-device
 * via llama.rn (React Native bindings for llama.cpp). Zero data leaves device.
 *
 * Model: Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf (~4.7 GB)
 * Stored: FileSystem.cacheDirectory/
 *
 * Usage:
 *   await downloadModel(onProgress)   — first-time download (~4.7 GB)
 *   await initModel()                 — load into memory (~15–40s on device)
 *   const reply = await generateLocal(userMessage, systemPrompt)
 *   await releaseModel()              — free memory
 */

// expo-file-system/next uses requireNativeModule('FileSystem') — never null.
// The legacy expo-file-system uses requireOptionalNativeModule which returns a null shim in dev.
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { initLlama, releaseAllLlama } from 'llama.rn';
import type { LlamaContext } from 'llama.rn';
import { LOCAL_PROMPTS } from './personaPrompts';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Ollama host config ───────────────────────────────────────
// Persisted so the user can change it in Settings without a rebuild.

const OLLAMA_HOST_KEY = 'ollama_host_v1';
const DEFAULT_OLLAMA_HOST = '192.168.4.43:11434';

export async function getOllamaHost(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(OLLAMA_HOST_KEY);
    if (stored && stored.trim() !== DEFAULT_OLLAMA_HOST) {
      // Clear stale host — always use DEFAULT_OLLAMA_HOST
      await AsyncStorage.removeItem(OLLAMA_HOST_KEY);
    }
    return DEFAULT_OLLAMA_HOST;
  } catch {
    return DEFAULT_OLLAMA_HOST;
  }
}

export async function setOllamaHost(host: string): Promise<void> {
  await AsyncStorage.setItem(OLLAMA_HOST_KEY, host.trim());
}

// ─── Model config ─────────────────────────────────────────────

// Llama 3.2 3B — designed for mobile, ~1.8 GB download
const MODEL_URL =
  'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf';

const MODEL_FILENAME = 'llama-3b.gguf';

/** Returns the file:// URI for the model file using the legacy API (most reliable). */
function getModelPath(): string {
  const baseDir = FileSystemLegacy.cacheDirectory ?? FileSystemLegacy.documentDirectory;
  if (!baseDir) throw new Error('File system not ready — try restarting the app');
  return baseDir + MODEL_FILENAME;
}

/** file:// URI → plain POSIX path for llama.rn (which calls fopen() internally). */
function uriToPosix(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

// Stop tokens for Llama 3.2 instruct format
const STOP_TOKENS = ['</s>', '<|end|>', '<|eot_id|>', '<|im_end|>', '<|endoftext|>'];

// ─── Singleton context ────────────────────────────────────────

let llamaContext: LlamaContext | null = null;

// Transition-only node logging — suppress repeated same-state logs
let _lastNodeOnline: boolean | null = null;

// ─── Model file helpers ───────────────────────────────────────

export async function isModelDownloaded(): Promise<boolean> {
  try {
    const baseDir = FileSystemLegacy.cacheDirectory ?? FileSystemLegacy.documentDirectory;
    if (!baseDir) return false;
    const info = await FileSystemLegacy.getInfoAsync(baseDir + MODEL_FILENAME);
    return info.exists && !!info.size && info.size > 100_000_000;
  } catch (e) {
    console.warn('[LocalAI] isModelDownloaded check failed:', e);
    return false;
  }
}

export async function getModelSizeMB(): Promise<number> {
  try {
    const baseDir = FileSystemLegacy.cacheDirectory ?? FileSystemLegacy.documentDirectory;
    if (!baseDir) return 0;
    const info = await FileSystemLegacy.getInfoAsync(baseDir + MODEL_FILENAME);
    if (!info.exists || !info.size) return 0;
    return Math.round(info.size / 1_048_576);
  } catch (e) {
    console.warn('[LocalAI] getModelSizeMB failed:', e);
    return 0;
  }
}

// ─── Download ─────────────────────────────────────────────────

/** Delete the model file unconditionally — used for stuck/partial downloads. */
export function deleteModelFile(): void {
  const baseDir = FileSystemLegacy.cacheDirectory ?? FileSystemLegacy.documentDirectory;
  if (!baseDir) return;
  FileSystemLegacy.deleteAsync(baseDir + MODEL_FILENAME, { idempotent: true })
    .then(() => console.log('[Download] Deleted model file'))
    .catch((e) => console.warn('[Download] Delete failed:', e));
}

export async function downloadLlamaModel(
  onProgress?: (progress: number) => void,
): Promise<string> {
  // Resolve destination using legacy API (reliable file:// URI)
  const baseDir = FileSystemLegacy.cacheDirectory ?? FileSystemLegacy.documentDirectory;
  if (!baseDir) throw new Error('File system not ready — try restarting the app');
  const destUri = baseDir + MODEL_FILENAME;

  // Skip if already fully downloaded
  const info = await FileSystemLegacy.getInfoAsync(destUri);
  if (info.exists && info.size && info.size > 100_000_000) {
    console.log('[LocalAI] Model already exists at', destUri, `(${Math.round(info.size / 1_048_576)} MB)`);
    onProgress?.(100);
    return destUri;
  }

  // Delete any partial/corrupt file
  if (info.exists) {
    await FileSystemLegacy.deleteAsync(destUri, { idempotent: true });
    console.log('[Download] Deleted partial file');
  }

  console.log('[LocalAI] Downloading to', destUri);
  onProgress?.(0);

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[LocalAI] Retry ${attempt}/${MAX_RETRIES}...`);
        await FileSystemLegacy.deleteAsync(destUri, { idempotent: true });
      }

      // Use legacy createDownloadResumable — supports progress callbacks
      const downloadResumable = FileSystemLegacy.createDownloadResumable(
        MODEL_URL,
        destUri,
        {},
        (downloadProgress) => {
          const pct = Math.round(
            (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100,
          );
          onProgress?.(pct);
        },
      );

      const result = await downloadResumable.downloadAsync();
      if (!result?.uri) throw new Error('Download returned no URI');

      // Verify the file is reasonable size
      const check = await FileSystemLegacy.getInfoAsync(result.uri);
      if (!check.exists || !check.size || check.size < 100_000_000) {
        throw new Error(`Downloaded file too small (${check.exists && check.size ? Math.round(check.size / 1_048_576) : 0} MB) — likely incomplete`);
      }

      console.log('[LocalAI] Download complete:', result.uri, `(${Math.round(check.size / 1_048_576)} MB)`);
      onProgress?.(100);
      return result.uri;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[LocalAI] Download attempt ${attempt} failed:`, lastError.message);
    }
  }

  // All retries exhausted — clean up and throw
  await FileSystemLegacy.deleteAsync(destUri, { idempotent: true });
  throw new Error(`Download failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

/** Backwards-compatible wrapper for existing callers. */
export async function downloadModel(
  onProgress?: (pct: number) => void,
): Promise<void> {
  await downloadLlamaModel(onProgress);
}

export async function deleteModel(): Promise<void> {
  try {
    await releaseModel();
    await FileSystemLegacy.deleteAsync(getModelPath(), { idempotent: true });
  } catch (e) { console.warn('[LocalAI] deleteModel failed:', e); }
}

// ─── Init / Release ───────────────────────────────────────────

export async function initModel(): Promise<void> {
  if (llamaContext) return; // already loaded

  const downloaded = await isModelDownloaded();
  if (!downloaded) throw new Error('Model not downloaded');

  const modelPath = uriToPosix(getModelPath());
  console.log('[LocalAI] initModel — loading from:', modelPath);

  // Verify file exists and is reasonable size before attempting load
  const info = await FileSystemLegacy.getInfoAsync(getModelPath());
  if (!info.exists || !info.size) {
    throw new Error('Model file missing or empty');
  }
  console.log('[LocalAI] Model file size:', Math.round(info.size / 1_048_576), 'MB');

  try {
    llamaContext = await initLlama({
      model: modelPath,          // llama.rn calls fopen() — needs plain POSIX path
      use_mlock: false,          // avoid locking physical RAM — better for battery
      n_ctx: 2048,               // conservative context to reduce memory footprint
      n_threads: 4,              // safe thread count — avoids contention with UI thread
      n_gpu_layers: 20,          // partial Metal offload — safe for 3B on most iPhones
    });
    console.log('[LocalAI] Model loaded successfully');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[LocalAI] initLlama failed:', msg);
    // Release any partial context to prevent memory leaks after failed init
    try { await releaseAllLlama(); } catch (e2) { console.warn('[LocalAI] releaseAllLlama cleanup failed:', e2); }
    llamaContext = null;
    throw new Error(`Failed to load model: ${msg}`);
  }
}

export async function releaseModel(): Promise<void> {
  try {
    await releaseAllLlama();
  } catch (e) { console.warn('[LocalAI] releaseModel failed:', e); }
  llamaContext = null;
}

// ─── Local system prompt builder ─────────────────────────────
//
// Constructs a structured system prompt for on-device Llama 3.1 8B.
// Uses LOCAL_PROMPTS from personaPrompts.ts (single source of truth).
// Applies Tier-3 framework: reasoning engine, hallucination guard,
// autonomous task loop, and thinking scaffold.

const TIER3_REASONING_ENGINE = `
## REASONING ENGINE
Before answering any complex question:
- Break the problem into components
- Consider at least two approaches
- Choose the best one and explain why in plain terms`;

const TIER3_HALLUCINATION_GUARD = `
## HALLUCINATION PREVENTION
- If you are not certain, say "I'm not certain, but..." before the claim
- If a fact, number, or API detail may have changed, say "you should verify this"
- For health, medical, legal, or financial topics: always recommend consulting a qualified professional
- Never invent function names, library APIs, or statistics — if unsure, say so and describe where to look`;

const TIER3_TASK_LOOP = `
## AUTONOMOUS TASK LOOP (complex requests)
PLAN: What needs to be done and in what order?
EXECUTE: Do the work completely — no placeholders
EVALUATE: Does this actually solve the problem? What could go wrong?
REFINE: Simplify. Remove anything that doesn't add value.`;

const TIER3_THINKING_SCAFFOLD = `
Before answering: 1. Analyze the problem. 2. Think through possible solutions. 3. Verify your logic. 4. Produce the final answer.
Shorthand: Analyze briefly → Plan → Answer clearly.`;

/**
 * Build a structured system prompt for on-device Llama 3.1 8B inference.
 *
 * Uses persona-specific cores from personaPrompts.ts (sized for 4096-token context)
 * instead of the full cloud system prompts. Injects Tier-3 framework:
 * reasoning engine, hallucination guard, autonomous task loop, thinking scaffold.
 *
 * @param personaId        One of: pete | architect | critic | researcher | builder
 * @param memoryContext    Output of buildMemoryPrompt() — injected if non-empty
 * @param knowledgeContext Output of buildKnowledgePrompt() — injected if non-empty
 * @param connectorContext Output of buildConnectorContext() — injected if non-empty
 */
export function buildLocalSystemPrompt(
  personaId: string,
  memoryContext = '',
  knowledgeContext = '',
  connectorContext = '',
): string {
  const core = LOCAL_PROMPTS[personaId] ?? LOCAL_PROMPTS.pete;

  const parts = [
    core,
    TIER3_REASONING_ENGINE,
    TIER3_HALLUCINATION_GUARD,
    TIER3_TASK_LOOP,
  ];

  if (memoryContext.trim())    parts.push(memoryContext.trim());
  if (knowledgeContext.trim()) parts.push(knowledgeContext.trim());
  if (connectorContext.trim()) parts.push(connectorContext.trim());

  // Thinking scaffold always goes last — it's the final instruction before the user turn
  parts.push(TIER3_THINKING_SCAFFOLD);

  return parts.join('\n').trim();
}

// ─── Streaming helper ─────────────────────────────────────────
//
// React Native fetch does not support ReadableStream, but XHR does.
// readyState 3 (LOADING) fires progressively as NDJSON lines arrive.

function streamFromOllama(
  host: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let fullText = '';
    let processed = 0;

    const flush = () => {
      const newText = xhr.responseText.slice(processed);
      processed = xhr.responseText.length;
      for (const line of newText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          const token: string = obj.message?.content ?? '';
          if (token) { fullText += token; onToken(token); }
        } catch {}
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3) flush();
      if (xhr.readyState === 4) {
        flush(); // drain any remainder
        if (xhr.status >= 200 && xhr.status < 300) resolve(fullText.trim());
        else reject(new Error(`Ollama error: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('[Ollama] Network error during streaming'));
    signal.addEventListener('abort', () => { xhr.abort(); reject(new Error('Aborted')); });

    xhr.open('POST', `http://${host}/api/chat`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
      model: 'phi4-mini:latest',
      messages,
      stream: true,
      temperature: 0.7,
    }));
  });
}

// ─── Inference ────────────────────────────────────────────────

/**
 * Run local inference. Returns the generated text.
 * Throws if the model isn't initialized.
 *
 * @param userMessage   The user's input text
 * @param systemPrompt  Optional system context — use buildLocalSystemPrompt() to construct it
 * @param onToken       Optional streaming callback per token
 */
export async function generateLocal(
  userMessage: string,
  systemPrompt?: string,
  onToken?: (token: string) => void,
): Promise<string> {
  const OLLAMA_HOST = await getOllamaHost();

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userMessage.trim() });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    if (onToken) {
      // Streaming path — XHR delivers NDJSON tokens progressively
      const text = await streamFromOllama(OLLAMA_HOST, messages, onToken, controller.signal);
      clearTimeout(timer);
      return text;
    }

    // Non-streaming path (used when no callback provided, e.g. cloud fallback context)
    const response = await fetch(`http://${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'phi4-mini:latest',
        messages,
        stream: false,
        temperature: 0.7,
      }),
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const json = await response.json();
    return (json.message?.content ?? '').trim();
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Ollama] Error:', msg);
    throw new Error('Private inference node unavailable. Check Wi-Fi and Mac Mini/Ollama status.');
  }
}

// ─── Memory pattern extraction (local) ───────────────────────
//
// Used as a zero-API-cost alternative to the Claude-based extractPatterns().
// Produces the same JSON shape: { topic, summary, keywords }[].

export async function extractPatternsLocal(
  userMessage: string,
  assistantReply: string,
): Promise<{ topic: string; summary: string; keywords: string[] }[]> {
  if (!llamaContext) return [];

  const prompt =
    `Analyze this conversation. Identify any recurring themes, goals, or topics the user cares about.

User: ${userMessage.slice(0, 400)}
Assistant: ${assistantReply.slice(0, 400)}

Return ONLY a raw JSON array. Format:
[{"topic":"short topic name","summary":"one sentence","keywords":["kw1","kw2","kw3"]}]

Rules: only include meaningful recurring interests. If nothing notable, return [].`;

  try {
    const result = await llamaContext.completion({
      messages: [{ role: 'user', content: prompt }],
      n_predict: 200,
      temperature: 0.2,   // low temp for structured output
      stop: STOP_TOKENS,
    });

    const text = result.text ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (e: unknown) =>
        e !== null &&
        typeof e === 'object' &&
        typeof (e as Record<string, unknown>).topic === 'string' &&
        typeof (e as Record<string, unknown>).summary === 'string' &&
        Array.isArray((e as Record<string, unknown>).keywords),
    );
  } catch (e) {
    console.warn('[LocalAI] extractPatternsLocal failed:', e);
    return [];
  }
}

// ─── On-device fallback inference (llama.rn) ──────────────────
//
// Used when Mac Mini is unreachable. Requires initModel() to have been called.

export async function generateLocalOnDevice(
  userMessage: string,
  systemPrompt?: string,
  onToken?: (token: string) => void,
): Promise<string> {
  if (!llamaContext) throw new Error('Model not initialized. Call initModel() first.');

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: userMessage.trim() });

  const result = await llamaContext.completion(
    {
      messages,
      n_predict: 1024,
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      penalty_repeat: 1.1,
      stop: STOP_TOKENS,
    },
    onToken
      ? (data: { token: string }) => onToken(data.token)
      : undefined,
  );

  return (result.text ?? '').trim();
}

// ─── Status helpers ───────────────────────────────────────────

export function isModelLoaded(): boolean {
  // True if on-device llama.rn model is loaded OR Ollama is configured
  return llamaContext !== null || isMacMiniConfigured();
}

/** True when a Mac Mini Ollama host is configured (always true if OLLAMA_HOST is set). */
export function isMacMiniConfigured(): boolean {
  return true; // 192.168.4.43:11434 is hardcoded in generateLocal
}

export type PrivateNodeStatus = {
  online: boolean;
  host: string;
  latency: number | null;
  models: string[];
};

/**
 * Health check for the private inference node.
 * Calls /api/tags — lightweight, no model load required.
 * Logs result and returns structured status.
 */
export async function checkPrivateNode(): Promise<PrivateNodeStatus> {
  const host = await getOllamaHost();
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`http://${host}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    const latency = Date.now() - start;

    if (!res.ok) {
      if (_lastNodeOnline !== false) {
        console.log(`[PrivateNode] offline · HTTP ${res.status}`);
        _lastNodeOnline = false;
      }
      return { online: false, host, latency, models: [] };
    }

    const json = await res.json();
    const models: string[] = (json.models ?? []).map((m: { name: string }) => m.name);

    if (_lastNodeOnline !== true) {
      console.log(`[PrivateNode] online · ${models.join(', ') || 'no models'} · ${latency}ms`);
      _lastNodeOnline = true;
    }
    return { online: true, host, latency, models };

  } catch (e) {
    if (_lastNodeOnline !== false) {
      console.log(`[PrivateNode] offline · check Wi-Fi or Ollama status`);
      _lastNodeOnline = false;
    }
    return { online: false, host, latency: null, models: [] };
  }
}

/**
 * Pre-warm the 70B model on Mac Mini so it's loaded before the user's first message.
 * Sends a minimal request and discards the response. Fire-and-forget — never throws.
 */
export async function warmMacMini(): Promise<void> {
  const OLLAMA_HOST = await getOllamaHost();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const res = await fetch(`http://${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'phi4-mini:latest',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      }),
    });
    clearTimeout(timeout);
    console.log('[Ollama] warm-up complete, status:', res.status);
  } catch (e) {
    console.log('[Ollama] warm-up failed (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}
