/**
 * claude.ts — PrivateAI Claude API Client
 *
 * Thin wrapper around the Anthropic messages API.
 * Centralises the API key check, headers, and error handling so
 * every caller gets consistent behaviour without duplicating fetch logic.
 */

import Constants from 'expo-constants';
import { sanitizePromptForCloud } from './securityGateway';

export const CLAUDE_MODEL = 'claude-sonnet-4-6';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Send a conversation to Claude and return the next assistant text response.
 *
 * @param conversationHistory  Full message history (user + assistant turns)
 * @param systemPrompt         System prompt to prepend
 * @param maxTokens            Max tokens in the response (default 1024)
 */
export async function callClaudeAPI(
  conversationHistory: ConversationMessage[],
  systemPrompt: string,
  maxTokens = 1024,
): Promise<string> {
  // app.config.js exposes the key as `claudeApiKey` under `extra`
  const apiKey = Constants.expoConfig?.extra?.claudeApiKey as string | undefined;
  if (!apiKey) throw new Error('claudeApiKey is not set in app.config.js extra');

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: sanitizePromptForCloud(systemPrompt),
      messages: conversationHistory,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data?.content?.[0]?.text ?? '').trim();
}
