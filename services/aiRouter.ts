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
import { generateLocal } from '@/services/localAI';
import { isModelLoaded } from '@/services/localAI';

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';
const CLAUDE_API_BASE = 'https://api.anthropic.com/v1/messages';

// ── System Prompts ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are Claude, a helpful AI assistant. You are conversing with the user on their private device.

You are trustworthy, honest, and direct. You respect the user's privacy and only provide information when asked.

Keep responses concise and clear.`;

// Local (Ollama/phi4-mini) gets a tighter prompt — smaller model responds better to explicit brevity constraints.
const LOCAL_SYSTEM_PROMPT = `You are a helpful AI assistant running on a private local device.
Be direct and brief. Answer in 1-3 sentences unless the user asks for more detail.
For simple questions give simple answers. Do not add unnecessary caveats or preamble.`;

// ── Route Decision ───────────────────────────────────────────

export async function routeAI(params: AIRouteParams): Promise<AIRouteResult> {
  const { messages, isSensitive, safeMode, nodeOnline, onToken } = params;

  // Rule 1: Sensitive data (medical/financial/PII) → always local if available
  if (isSensitive) {
    if (nodeOnline === false) {
      throw new Error(
        'Cannot send sensitive data to cloud. Private node is offline. Reconnect to your local network or remove sensitive content.'
      );
    }
    const localResult = await tryLocalRoute(messages, onToken);
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
    const localResult = await tryLocalRoute(messages, onToken);
    if (localResult) return localResult;
    throw new Error(
      'Cloud features disabled due to security event. Use local AI or reset the app.'
    );
  }

  // Rule 3: Local-first — skip attempt if node is known offline
  if (nodeOnline === false) {
    console.log('[Router] Node known offline — routing direct to cloud');
    return await cloudRoute(messages);
  }

  console.log('[Router] Routing: local');
  const localResult = await tryLocalRoute(messages, onToken);
  if (localResult) return localResult;

  console.log('[Router] Routing: cloud fallback');
  return await cloudRoute(messages);
}

// ── Cloud Route ──────────────────────────────────────────────

async function cloudRoute(messages: ConversationMessage[]): Promise<AIRouteResult> {
  if (!CLAUDE_API_KEY) {
    throw new Error('Claude API key not configured');
  }

  const start = Date.now();

  const payload: ClaudeAPIRequest = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  };

  const response = await fetch(CLAUDE_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  const data: ClaudeAPIResponse = await response.json();
  const latency = Date.now() - start;

  const text = data.content[0]?.text ?? '';

  return {
    text,
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
  onToken?: (token: string) => void,
): Promise<AIRouteResult | null> {
  const isLoaded = await isModelLoaded();
  if (!isLoaded) return null;

  try {
    const start = Date.now();
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const text = await generateLocal(lastMessage, LOCAL_SYSTEM_PROMPT, onToken);
    const latency = Date.now() - start;

    return {
      text,
      route: 'local',
      model: 'llama-1b',
      latency,
    };
  } catch (e) {
    console.error('[Router] Local route failed:', String(e), e instanceof Error ? e.message : '');
    return null;
  }
}
