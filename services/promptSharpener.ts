/**
 * promptSharpener.ts — PrivateAI Prompt Optimization Middleware
 *
 * Sits between user input and model inference. Two modes:
 *
 * INTERNAL (local model): Transforms vague input into structured prompts
 * that a 3B model can execute well within its 2048-token context.
 *
 * EXTERNAL (cloud API): Sharpens for quality AND strips personal/medical
 * data before it leaves the device.
 *
 * Based on the Lyra 4-D methodology adapted for local deployment:
 *   Deconstruct → Diagnose → Develop → Deliver
 *
 * Core principle: Every token sent to a cloud API is a privacy cost.
 * A sharper prompt means fewer round-trips, less exposure.
 * Prompt optimization is a privacy feature.
 */

// ─── Types ───────────────────────────────────────────────────

export interface SharpenedPrompt {
  text: string;
  changes: string[];
  privacyStripped: string[];
  route: 'local' | 'cloud';
}

// ─── 1. Sharpening Patterns ─────────────────────────────────
//
// The 7 transformations that turn vague input into clear prompts.

// Pattern 1: Vagueness Fix
const VAGUE_PATTERNS = [
  /^tell me about\s+/i,
  /^help me with\s+/i,
  /^write something about\s+/i,
  /^what about\s+/i,
  /^explain\s+/i,
  /^i need help with\s+/i,
];

function fixVagueness(input: string): { text: string; changed: boolean } {
  for (const rx of VAGUE_PATTERNS) {
    if (rx.test(input) && input.trim().split(/\s+/).length < 8) {
      // Input is vague — but we can't guess what they want, so leave it
      // The sharpener adds structure, not content
      return { text: input, changed: false };
    }
  }
  return { text: input, changed: false };
}

// Pattern 2: Detect request type for structural optimization
type RequestType = 'factual' | 'creative' | 'technical' | 'analysis' | 'decision' | 'summary' | 'general';

function classifyRequest(input: string): RequestType {
  const lower = input.toLowerCase();
  if (/\b(compare|vs|versus|difference|better|pros?\s+and\s+cons?|tradeoff)\b/.test(lower)) return 'analysis';
  if (/\b(should\s+i|decide|option|choice|which\s+(?:one|way))\b/.test(lower)) return 'decision';
  if (/\b(code|function|implement|build|debug|fix|error|bug|api|database)\b/.test(lower)) return 'technical';
  if (/\b(write|draft|create|compose|story|email|letter|message)\b/.test(lower)) return 'creative';
  if (/\b(summarize|summary|tldr|key\s+points|overview)\b/.test(lower)) return 'summary';
  if (/\b(what\s+is|how\s+does|explain|why\s+does|define|describe)\b/.test(lower)) return 'factual';
  return 'general';
}

// ─── 2. Privacy Filter ──────────────────────────────────────
//
// Strips unnecessary personal information from outbound prompts.
// The most private prompt is the one that gets the right answer
// with the least personal information exposed.

const PRIVACY_PATTERNS: Array<{ rx: RegExp; replacement: string; label: string }> = [
  // Names
  { rx: /\b(my name is|i'm|i am)\s+[A-Z][a-z]+/gi, replacement: '[name redacted]', label: 'name' },
  // Phone numbers
  { rx: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[phone redacted]', label: 'phone' },
  // Email addresses
  { rx: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '[email redacted]', label: 'email' },
  // Specific dates with year
  { rx: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi, replacement: '[date redacted]', label: 'date' },
  // SSN
  { rx: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN redacted]', label: 'SSN' },
  // Credit card
  { rx: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[card redacted]', label: 'credit card' },
  // Street addresses (basic)
  { rx: /\b\d+\s+[A-Z][a-z]+\s+(?:St|Ave|Blvd|Dr|Rd|Way|Ln|Ct)\b\.?/g, replacement: '[address redacted]', label: 'address' },
  // Specific medical values (BP, glucose, etc.) — generalize, don't strip
  { rx: /\b(?:my\s+)?(?:blood\s+pressure|bp)\s+(?:is|was|reads?)\s+\d{2,3}\/\d{2,3}\b/gi, replacement: 'blood pressure reading', label: 'medical value' },
  // API keys
  { rx: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g, replacement: '[API key redacted]', label: 'API key' },
  { rx: /sk-[A-Za-z0-9]{20,}/g, replacement: '[API key redacted]', label: 'API key' },
];

function stripPrivacy(input: string): { text: string; stripped: string[] } {
  let text = input;
  const stripped: string[] = [];

  for (const { rx, replacement, label } of PRIVACY_PATTERNS) {
    if (rx.test(text)) {
      text = text.replace(rx, replacement);
      stripped.push(label);
      // Reset lastIndex for global regexes
      rx.lastIndex = 0;
    }
  }

  return { text, stripped };
}

// ─── 3. Internal Prompt Structuring ─────────────────────────
//
// For local model: transform natural language into structured prompt
// that fits in 2048-token context and gives the 3B model clear direction.

function structureForLocal(
  input: string,
  personaName: string,
  personaRole: string,
  sharedContext: string,
): string {
  const requestType = classifyRequest(input);

  // Build structured prompt using the internal routing template
  const parts: string[] = [];

  // Role (compact)
  parts.push(`ROLE: ${personaName} — ${personaRole}`);

  // Shared context (ultra-compact — just goals and profile)
  if (sharedContext.trim()) {
    parts.push(sharedContext.trim());
  }

  // Task with type-specific instruction
  switch (requestType) {
    case 'analysis':
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Compare across clear criteria. Use bullet points. State which option you recommend and why.');
      break;
    case 'decision':
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Give 2-3 options with tradeoffs. Recommend one. State confidence level.');
      break;
    case 'technical':
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Be specific. Include code if relevant. State language and framework.');
      break;
    case 'creative':
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Match the requested tone and format. Be concise unless length is specified.');
      break;
    case 'summary':
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Key points only. 3-5 bullet points max. Lead with the most important takeaway.');
      break;
    case 'factual':
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Answer directly. Cite confidence level. Flag if uncertain.');
      break;
    default:
      parts.push(`TASK: ${input}`);
      parts.push('CONSTRAINTS: Answer directly and concisely.');
  }

  return parts.join('\n');
}

// ─── 4. External Prompt Sharpening ──────────────────────────
//
// For cloud API: optimize for quality AND strip for privacy.

function sharpenForCloud(
  input: string,
  personaName: string,
): { text: string; changes: string[]; privacyStripped: string[] } {
  const changes: string[] = [];
  let text = input;

  // Privacy filter first
  const { text: privacyClean, stripped } = stripPrivacy(text);
  text = privacyClean;

  // Classify and add structure if missing
  const requestType = classifyRequest(text);
  const wordCount = text.trim().split(/\s+/).length;

  // Only sharpen if the prompt is short/vague — don't rewrite detailed prompts
  if (wordCount < 15) {
    switch (requestType) {
      case 'factual':
        if (!text.includes('explain') && !text.includes('describe')) {
          text = `Explain ${text}. Include key details and flag any uncertainty.`;
          changes.push('Added depth instruction for factual query');
        }
        break;
      case 'technical':
        if (!text.includes('language') && !text.includes('in ')) {
          text += ' Specify the technology stack and provide concrete examples.';
          changes.push('Added specificity for technical query');
        }
        break;
      case 'decision':
        if (!text.includes('option') && !text.includes('tradeoff')) {
          text += ' Present 2-3 options with explicit tradeoffs and a recommendation.';
          changes.push('Added decision framework structure');
        }
        break;
    }
  }

  return { text, changes, privacyStripped: stripped };
}

// ─── 5. Public API ───────────────────────────────────────────

/**
 * Sharpen a prompt for local inference.
 * Structures the input into ROLE/CONTEXT/TASK/CONSTRAINTS format
 * that a 3B model can execute within its limited context window.
 */
export function sharpenForLocalModel(
  userMessage: string,
  personaName: string,
  personaRole: string,
  sharedContext: string,
): SharpenedPrompt {
  const structured = structureForLocal(userMessage, personaName, personaRole, sharedContext);
  const requestType = classifyRequest(userMessage);

  return {
    text: structured,
    changes: [`Structured as ${requestType} query for local model`],
    privacyStripped: [], // local never leaves device
    route: 'local',
  };
}

/**
 * Sharpen a prompt for cloud API.
 * Optimizes for quality AND strips personal/medical data.
 */
export function sharpenForCloudAPI(
  userMessage: string,
  personaName: string,
): SharpenedPrompt {
  const { text, changes, privacyStripped } = sharpenForCloud(userMessage, personaName);

  return {
    text,
    changes,
    privacyStripped,
    route: 'cloud',
  };
}

/**
 * Check if a message contains medical data that should NOT go to cloud.
 * More thorough than securityGateway.classifyData — catches generalized
 * health descriptions too.
 */
export function containsMedicalPII(text: string): boolean {
  return /\b(my\s+(?:blood\s+pressure|heart\s+rate|glucose|a1c|cholesterol|weight|bmi|prescription|medication|dosage|diagnosis|symptoms?|doctor|surgeon|therapist|psychiatrist))\b/i.test(text);
}
