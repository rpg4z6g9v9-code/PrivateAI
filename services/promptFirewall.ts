/**
 * promptFirewall.ts — PrivateAI Prompt Firewall
 *
 * Sanitizes content that arrives from external sources (web search results,
 * file contents) before it is injected into the model context.
 *
 * Defends against indirect prompt injection — where a web page or external
 * document embeds instructions aimed at hijacking the AI rather than informing
 * the user. Replaces matched patterns with [blocked] so surrounding content
 * remains usable.
 *
 * Distinct from securityGateway.sanitizeOutput (which sanitizes AI responses)
 * and checkInjection (which blocks user input). This layer covers external data.
 */

const BLOCKED_PATTERNS = [
  // Instruction override
  'ignore previous instructions',
  'ignore all instructions',
  'disregard previous',
  'disregard all prior',
  'forget your instructions',
  'override your rules',
  'bypass your safety',
  'bypass restrictions',
  // Identity manipulation
  'you are now',
  'new persona',
  'pretend to be',
  'act as if you are',
  'switch to evil',
  'enter dev mode',
  'enter admin mode',
  'jailbreak',
  // Prompt extraction
  'system prompt',
  'reveal your prompt',
  'print your instructions',
  'repeat everything above',
  'output your instructions',
  'what are your rules',
  // Data exfiltration
  'send data to',
  'exfiltrate',
  'forward this to',
  'extract all data',
  'send to this url',
  'send to http',
  // Hidden instructions (delimiter injection)
  '[INST]',
  '<<SYS>>',
  '</s>',
  '<|im_end|>',
];

/**
 * Sanitize external content (web results, files) before prompt injection.
 * Also detects invisible Unicode control characters used for evasion.
 */
export function sanitizeExternalContent(text: string): string {
  let cleaned = text;

  // Strip invisible Unicode characters (zero-width spaces, RTL marks, etc.)
  // These are used to hide injection payloads in seemingly normal text
  cleaned = cleaned.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, '');

  // Strip HTML tags that could contain hidden instructions
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '[blocked]');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '[blocked]');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Block known injection patterns
  for (const pattern of BLOCKED_PATTERNS) {
    const rx = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    cleaned = cleaned.replace(rx, '[blocked]');
  }

  // Truncate excessively long external content (prevents context stuffing)
  if (cleaned.length > 10000) {
    cleaned = cleaned.slice(0, 10000) + '\n[content truncated for safety]';
  }

  return cleaned;
}
