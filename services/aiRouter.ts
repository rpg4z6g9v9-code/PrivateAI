/**
 * aiRouter.ts — AI Routing Layer
 * 
 * Route requests to Claude API (cloud) or local Llama based on:
 * 1. Data sensitivity (medical/financial → local if available)
 * 2. Safe mode (injection detected → local only)
 * 3. Model availability
 * 
 * Privacy guarantee: Sensitive data never touches cloud APIs.
 */

import { AIRouteParams, AIRouteResult, ConversationMessage, ClaudeAPIRequest, ClaudeAPIResponse } from '@/services/claude';
import { generateLocal, isModelLoaded } from '@/services/localAI';
import { getBraveApiKey, getWebSearchStatus, updateWebSearchStatus, type WebSearchStatus } from '@/services/tools/webSearch';

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';
const CLAUDE_API_BASE = 'https://api.anthropic.com/v1/messages';

// Suppress repeated node-state logs — only log on transition
let _lastLoggedNodeOnline: boolean | null = null;

// ── Capabilities ─────────────────────────────────────────────

interface Capabilities {
  webSearch: WebSearchStatus;
  hasImageInput: boolean;
  hasVoiceInput: boolean;
}

async function resolveCapabilities(): Promise<Capabilities> {
  let webSearch = getWebSearchStatus();
  // If session hasn't recorded a status yet, check AsyncStorage for a saved key
  if (webSearch === 'unavailable') {
    const key = await getBraveApiKey();
    if (key.length > 0) {
      webSearch = 'configured';
      updateWebSearchStatus('configured');
    }
  }
  return { webSearch, hasImageInput: true, hasVoiceInput: true };
}

// ── System Prompts ──────────────────────────────────────────

const VERSION_TAG = 'stable-memory-workspace-v1';

function currentDate(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Runtime grounding block — injected into every system prompt.
 *
 * Purpose: prevent the model from filling environmental uncertainty
 * with plausible-sounding claims (hallucinated user reports, fake telemetry,
 * wrong training cutoff assumptions, etc.).
 *
 * Keep this minimal and factual. Not personality — operational truth.
 */
function buildRuntimeContext(route: 'local' | 'cloud', capabilities: Capabilities): string {
  const routeLabel = route === 'local'
    ? 'local (phi4-mini via Ollama on private node)'
    : 'cloud (Claude API)';

  const inputs: string[] = ['persistent conversation memory'];
  if (capabilities.hasImageInput) inputs.unshift('image input (photo attachment)');
  if (capabilities.hasVoiceInput) inputs.unshift('voice input (microphone)');

  let toolsLine = '';
  if (capabilities.webSearch === 'operational' || capabilities.webSearch === 'configured') {
    toolsLine = '\nAvailable tools: web search.';
  } else if (capabilities.webSearch === 'degraded') {
    toolsLine = '\nAvailable tools: web search (temporarily degraded — last attempt failed, may recover).';
  } else if (capabilities.webSearch === 'auth_failed') {
    toolsLine = '\nAvailable tools: web search (key invalid — needs reconfiguration in System settings before it will work).';
  }
  // 'unavailable': omit entirely

  return `## Runtime state — canonical

The following reflects the actual runtime state of this session. Do not contradict or ignore it.

Route: ${routeLabel}
Date: ${currentDate()}
Version: ${VERSION_TAG}
Platform: PrivateAI · iOS · local-first

Confirmed capabilities: ${inputs.join(', ')}.${toolsLine}
Confirmed unavailable: document or file upload, filesystem access, autonomous browser control.

When asked what you can do, answer from the above — not from training assumptions.
Do not narrate tool execution or emit XML tags. Tools run automatically; respond with results directly.

Do not reference or speculate about:
- User analytics, usage statistics, or performance telemetry
- User feedback, reviews, complaints, or feature requests
- Issue trackers, bug reports, or user surveys
- Any data source outside this conversation and explicit tool results

If you don't know something, say so directly. Do not substitute plausible-sounding claims for missing information.`;
}

function buildSystemPrompt(route: 'local' | 'cloud', capabilities: Capabilities, toolContext?: string): string {
  const toolBlock = toolContext ? `\n\n## Tool results for this turn\n${toolContext}` : '';
  return `You are Claude, a helpful AI assistant running inside PrivateAI on the user's private device.

You are trustworthy, honest, and direct. You respect the user's privacy and only provide information when asked.

Keep responses concise and clear.

${buildRuntimeContext(route, capabilities)}${toolBlock}`;
}

// Local (Ollama/phi4-mini) gets a tighter prompt — smaller model responds better to explicit brevity constraints.
function buildLocalSystemPrompt(route: 'local' | 'cloud', capabilities: Capabilities, toolContext?: string): string {
  const toolBlock = toolContext ? `\n\n## Tool results for this turn\n${toolContext}` : '';
  return `You are a helpful AI assistant running inside PrivateAI on a private local device.
Be direct and brief. Answer in 1-3 sentences unless the user asks for more detail.
For simple questions give simple answers. Do not add unnecessary caveats or preamble.

${buildRuntimeContext(route, capabilities)}${toolBlock}`;
}

// ── Route Decision ───────────────────────────────────────────

export async function routeAI(params: AIRouteParams): Promise<AIRouteResult> {
  const { messages, isSensitive, safeMode, nodeOnline, onToken, toolContext } = params;

  const capabilities = await resolveCapabilities();

  // Rule 1: Sensitive data (medical/financial/PII) → always local if available
  if (isSensitive) {
    if (nodeOnline === false) {
      throw new Error(
        'Cannot send sensitive data to cloud. Private node is offline. Reconnect to your local network or remove sensitive content.'
      );
    }
    const localResult = await tryLocalRoute(messages, capabilities, onToken, toolContext);
    if (localResult) return localResult;
    throw new Error(
      'Cannot send sensitive data to cloud. Local AI not available. Enable on-device processing or remove sensitive content.'
    );
  }

  // Rule 2: Safe mode (injection detected) → local only
  if (safeMode) {
    if (nodeOnline === false) {
      throw new Error(
        'Cloud features disabled due to security event. Private node is offline — cannot process request.'
      );
    }
    const localResult = await tryLocalRoute(messages, capabilities, onToken, toolContext);
    if (localResult) return localResult;
    throw new Error(
      'Cloud features disabled due to security event. Use local AI or reset the app.'
    );
  }

  // Rule 3: Local-first — skip attempt if node is known offline
  if (nodeOnline === false) {
    if (_lastLoggedNodeOnline !== false) {
      console.log('[Router] Private node offline — routing to cloud');
      _lastLoggedNodeOnline = false;
    }
    return await cloudRoute(messages, capabilities, toolContext);
  }

  if (_lastLoggedNodeOnline !== true) {
    console.log('[Router] Routing: local');
    _lastLoggedNodeOnline = true;
  }
  const localResult = await tryLocalRoute(messages, capabilities, onToken, toolContext);
  if (localResult) return localResult;

  console.log('[Router] Local unavailable — cloud fallback');
  return await cloudRoute(messages, capabilities, toolContext);
}

// ── Cloud Route ──────────────────────────────────────────────

async function cloudRoute(messages: ConversationMessage[], capabilities: Capabilities, toolContext?: string): Promise<AIRouteResult> {
  if (!CLAUDE_API_KEY) {
    throw new Error('Cloud AI unavailable — API key not configured. Check EXPO_PUBLIC_CLAUDE_API_KEY.');
  }

  const start = Date.now();
  console.log('[Cloud] Request starting');

  const payload: ClaudeAPIRequest = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: buildSystemPrompt('cloud', capabilities, toolContext),
    messages,
  };

  let response: Response;
  try {
    response = await fetch(CLAUDE_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isNetworkErr = msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('failed');
    console.error('[Cloud] Fetch failed:', msg);
    throw new Error(
      isNetworkErr
        ? 'Cloud request failed — check internet connection. (Private node is also offline.)'
        : `Cloud request error: ${msg}`
    );
  }

  console.log('[Cloud] HTTP', response.status, `(${Date.now() - start}ms)`);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const isAuth  = response.status === 401 || response.status === 403;
    const isQuota = response.status === 429;
    console.error('[Cloud] Error body:', body.slice(0, 300));
    throw new Error(
      isAuth  ? `Cloud AI: key unauthorized (HTTP ${response.status}) — check API key.` :
      isQuota ? 'Cloud AI: rate limited (429) — try again shortly.' :
                `Cloud AI: HTTP ${response.status}`
    );
  }

  const data: ClaudeAPIResponse = await response.json();
  const latency = Date.now() - start;
  console.log('[Cloud] Success —', latency, 'ms,', data.usage.output_tokens, 'tokens out');

  return {
    text: data.content[0]?.text ?? '',
    route: 'cloud',
    model: data.model,
    latency,
    tokens: {
      input: data.usage.input_tokens,
      output: data.usage.output_tokens,
    },
  };
}

// ── Local Route (Llama 1B) ───────────────────────────────────

async function tryLocalRoute(
  messages: ConversationMessage[],
  capabilities: Capabilities,
  onToken?: (token: string) => void,
  toolContext?: string,
): Promise<AIRouteResult | null> {
  const isLoaded = await isModelLoaded();
  if (!isLoaded) return null;

  try {
    const start = Date.now();
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const text = await generateLocal(lastMessage, buildLocalSystemPrompt('local', capabilities, toolContext), onToken);
    const latency = Date.now() - start;

    return {
      text,
      route: 'local',
      model: 'llama-1b',
      latency,
    };
  } catch (e) {
    console.error('[Router] Local route degraded:', String(e), e instanceof Error ? e.message : '');
    return null;
  }
}
