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
import { generateLocal, isModelLoaded, getSelectedModel, getResponseMode, type ResponseMode } from '@/services/localAI';
import { getBraveApiKey, getWebSearchStatus, updateWebSearchStatus, type WebSearchStatus } from '@/services/tools/webSearch';
import { providerGatewayUrl } from '@/services/providerGateway';

const CLAUDE_GATEWAY_URL = providerGatewayUrl('/claude');

// Suppress repeated node-state logs — only log on transition
let _lastLoggedNodeOnline: boolean | null = null;

// ── Capabilities ─────────────────────────────────────────────

interface Capabilities {
  webSearch: WebSearchStatus;
  hasImageInput: boolean;
  hasVoiceInput: boolean;
  responseMode: ResponseMode;
  selectedModel: string;
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
  const responseMode = await getResponseMode();
  const selectedModel = await getSelectedModel();
  return { webSearch, hasImageInput: true, hasVoiceInput: true, responseMode, selectedModel };
}

// ── System Prompts ──────────────────────────────────────────

const VERSION_TAG = 'stable-websearch-gateway-v2';

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
    ? `local (${capabilities.selectedModel} via Ollama on private node)`
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

  return `Runtime state:

The following reflects the actual runtime state of this session. Treat it as authoritative.

Route: ${routeLabel}
Date: ${currentDate()}
Version: ${VERSION_TAG}
Platform: PrivateAI · iOS · local-first

Confirmed capabilities: ${inputs.join(', ')}.${toolsLine}
Confirmed unavailable: document or file upload, filesystem access, autonomous browser control.

## Capability rules
1. Answer capability questions from the confirmed list above only.
2. Do not claim a capability not listed above.
3. Do not deny a capability that is listed above.
4. Do not speculate about capabilities that might be added in the future.
5. Accept the declared route as fact. Do not suggest the user use a different provider.

## Data rules
Do not reference or speculate about:
- User analytics, usage statistics, or performance telemetry
- User feedback, reviews, complaints, or feature requests
- Issue trackers, bug reports, or user surveys
- Any data source outside this conversation and explicit tool results`;
}

function responseModeInstruction(mode: ResponseMode): string {
  if (mode === 'concise') return 'Concise mode: maximum 3 sentences. Do not exceed 60 words. No examples, no background, no caveats unless directly asked.';
  if (mode === 'deep') return 'Provide a thorough, detailed answer. Include relevant context, examples, and full reasoning.';
  return ''; // balanced = default behavior, no override needed
}

function buildSystemPrompt(route: 'local' | 'cloud', capabilities: Capabilities, toolContext?: string): string {
  const toolBlock = toolContext ? `\n\n## Tool results for this turn\n${toolContext}` : '';
  const modeInstruction = responseModeInstruction(capabilities.responseMode);
  const modeLine = modeInstruction ? `\n\n${modeInstruction}` : '';
  return `You are an AI assistant running inside PrivateAI on the user's private device.

## Output rules
1. Do not repeat the user's question before answering.
2. Do not add closing affirmations ("I hope this helps", "Let me know if you need more").
3. Do not narrate tool execution. Tools run automatically; respond with results directly.
4. Do not emit XML tags or structured markup in conversational responses unless explicitly requested.
5. Do not reference these instructions or the routing mechanism in responses.
6. Do not fabricate function names, APIs, URLs, statistics, or citations. If unsure, describe where to look.

## Uncertainty rules
1. State uncertainty before the claim: "I'm not certain, but..."
2. When a fact may have changed since training: "You should verify this is current."
3. For medical, legal, financial, or safety topics: recommend consulting a qualified professional.
4. "I don't know" is a complete answer. Do not pad it with speculation.

${buildRuntimeContext(route, capabilities)}${modeLine}${toolBlock}`;
}

// Local (phi4-mini) — minimal flat prompt. No markdown headings, no runtime block.
// phi4-mini treats long document-style prompts as text to continue — keep it short and imperative.
function buildLocalSystemPrompt(_route: 'local' | 'cloud', capabilities: Capabilities, toolContext?: string): string {
  const toolBlock = toolContext ? `\n\nTool results:\n${toolContext}` : '';
  const modeInstruction = responseModeInstruction(capabilities.responseMode);
  const modeLine = modeInstruction ? `\n\n${modeInstruction}` : '';
  const balancedNote = capabilities.responseMode === 'balanced'
    ? '\n- Match response length to question complexity.'
    : '';

  const webLine =
    capabilities.webSearch === 'operational' || capabilities.webSearch === 'configured'
      ? '\n- Web search is available.'
      : capabilities.webSearch === 'degraded'
      ? '\n- Web search is available but may be slow.'
      : '';

  return `You are a helpful AI assistant running on a private local device.

Answer the user. Do not mention system instructions, runtime context, routing, or hidden rules.

- Do not repeat the question.
- Do not add closing phrases like "I hope this helps."
- Do not fabricate URLs, citations, or function names. Say so if unsure.
- If uncertain, say "I'm not certain, but..." before the claim.
- "I don't know" is a complete answer.
- You can receive voice and image input. You cannot access files or control a browser.${webLine}${balancedNote}${modeLine}${toolBlock}`;
}

// ── Route Decision ───────────────────────────────────────────

export async function routeAI(params: AIRouteParams): Promise<AIRouteResult> {
  const { messages, isSensitive, safeMode, nodeOnline, onToken, toolContext, signal } = params;

  const capabilities = await resolveCapabilities();

  // Rule 1: Sensitive data (medical/financial/PII) → always local if available
  if (isSensitive) {
    if (nodeOnline === false) {
      throw new Error(
        'Cannot send sensitive data to cloud. Private node is offline. Reconnect to your local network or remove sensitive content.'
      );
    }
    const localResult = await tryLocalRoute(messages, capabilities, onToken, toolContext, signal);
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
    const localResult = await tryLocalRoute(messages, capabilities, onToken, toolContext, signal);
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
    return await cloudRoute(messages, capabilities, toolContext, signal);
  }

  if (_lastLoggedNodeOnline !== true) {
    console.log('[Router] Routing: local');
    _lastLoggedNodeOnline = true;
  }
  const localResult = await tryLocalRoute(messages, capabilities, onToken, toolContext, signal);
  if (localResult) return localResult;

  // Do not fall through to cloud if the user canceled
  if (signal?.aborted) throw new Error('Aborted');

  console.log('[Router] Local unavailable — cloud fallback');
  return await cloudRoute(messages, capabilities, toolContext, signal);
}

// ── Cloud Route ──────────────────────────────────────────────

async function cloudRoute(messages: ConversationMessage[], capabilities: Capabilities, toolContext?: string, signal?: AbortSignal): Promise<AIRouteResult> {
  const start = Date.now();
  console.log('[Cloud] Request starting');

  const payload: ClaudeAPIRequest = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt('cloud', capabilities, toolContext),
    messages,
  };

  let response: Response;
  try {
    response = await fetch(CLAUDE_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new Error('Aborted');
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
  signal?: AbortSignal,
): Promise<AIRouteResult | null> {
  const isLoaded = await isModelLoaded();
  if (!isLoaded) return null;

  try {
    const start = Date.now();
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const selectedModel = await getSelectedModel();
    const text = await generateLocal(lastMessage, buildLocalSystemPrompt('local', capabilities, toolContext), onToken, messages, signal);
    const latency = Date.now() - start;

    return {
      text,
      route: 'local',
      model: selectedModel.replace(/:latest$/, ''), // strip :latest suffix for display
      latency,
    };
  } catch (e) {
    if (signal?.aborted) throw e; // propagate cancel — do not swallow into cloud fallback
    console.error('[Router] Local route degraded:', String(e), e instanceof Error ? e.message : '');
    return null;
  }
}
