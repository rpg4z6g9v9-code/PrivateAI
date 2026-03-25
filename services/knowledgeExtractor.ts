/**
 * knowledgeExtractor.ts — AI-Powered Knowledge Extraction
 *
 * Uses Claude Haiku (cheap, fast) to extract structured knowledge
 * from conversations. Replaces dumb keyword matching with real
 * understanding of entities, relationships, decisions, and context.
 *
 * Extraction types:
 *   - Entities: people, tools, projects, concepts, preferences
 *   - Relationships: enables, contradicts, depends_on, chose_over, part_of
 *   - Decisions: chose X over Y, decided to, committed to
 *   - Facts: stated beliefs, preferences, values
 *
 * Called after substantive exchanges (non-blocking, fire-and-forget).
 * Uses Haiku to keep cost near zero (~$0.001 per extraction).
 */

import Constants from 'expo-constants';
import { sanitizePromptForCloud } from './securityGateway';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ─── Types ───────────────────────────────────────────────────

export interface ExtractedEntity {
  label: string;
  type: 'person' | 'tool' | 'project' | 'concept' | 'preference' | 'goal' | 'decision';
  description: string;
  confidence: number;  // 0-1
}

export interface ExtractedRelationship {
  from: string;        // entity label
  to: string;          // entity label
  relation: 'enables' | 'contradicts' | 'depends_on' | 'chose_over' | 'part_of' | 'relates_to' | 'requires' | 'replaced_by';
  description: string;
  confidence: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// ─── Extraction Prompt ───────────────────────────────────────

const EXTRACTION_PROMPT = `You are a knowledge extraction engine. Analyze the conversation and extract structured knowledge.

Return ONLY valid JSON in this exact format — no markdown, no explanation:

{
  "entities": [
    {
      "label": "short name",
      "type": "person|tool|project|concept|preference|goal|decision",
      "description": "one sentence describing this entity in context",
      "confidence": 0.8
    }
  ],
  "relationships": [
    {
      "from": "entity label",
      "to": "entity label",
      "relation": "enables|contradicts|depends_on|chose_over|part_of|relates_to|requires|replaced_by",
      "description": "one sentence explaining this relationship",
      "confidence": 0.7
    }
  ]
}

Rules:
- Only extract MEANINGFUL entities — skip greetings, filler, generic words
- Confidence: 0.9+ for explicitly stated facts, 0.6-0.8 for inferred, below 0.6 skip it
- For decisions: use "chose_over" with from=chosen, to=rejected
- For preferences: type="preference", describe what and why
- For goals: type="goal", include timeline if mentioned
- Keep labels short (1-3 words), consistent casing
- Maximum 8 entities and 6 relationships per extraction
- If nothing meaningful to extract, return {"entities":[],"relationships":[]}`;

// ─── API Call ────────────────────────────────────────────────

async function callHaiku(userMessage: string, assistantReply: string): Promise<string> {
  const apiKey = Constants.expoConfig?.extra?.claudeApiKey as string | undefined;
  if (!apiKey) throw new Error('No API key');

  const content = `User said: "${userMessage.slice(0, 600)}"\n\nAssistant replied: "${assistantReply.slice(0, 600)}"`;

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 500,
      system: sanitizePromptForCloud(EXTRACTION_PROMPT),
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku API error: ${res.status}`);
  const data = await res.json();
  return (data?.content?.[0]?.text ?? '').trim();
}

// ─── Parser ──────────────────────────────────────────────────

function parseExtractionResult(raw: string): ExtractionResult | null {
  try {
    // Find JSON in the response (handles markdown wrapping)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.relationships)) return null;

    // Filter and validate entities
    const entities: ExtractedEntity[] = parsed.entities
      .filter((e: any) =>
        typeof e.label === 'string' && e.label.length >= 2 &&
        typeof e.type === 'string' &&
        typeof e.confidence === 'number' && e.confidence >= 0.5
      )
      .map((e: any) => ({
        label: e.label.trim(),
        type: e.type,
        description: (e.description || '').trim().slice(0, 200),
        confidence: Math.min(1, Math.max(0, e.confidence)),
      }));

    // Filter and validate relationships
    const validRelations = new Set(['enables', 'contradicts', 'depends_on', 'chose_over', 'part_of', 'relates_to', 'requires', 'replaced_by']);
    const relationships: ExtractedRelationship[] = parsed.relationships
      .filter((r: any) =>
        typeof r.from === 'string' && r.from.length >= 2 &&
        typeof r.to === 'string' && r.to.length >= 2 &&
        typeof r.relation === 'string' && validRelations.has(r.relation) &&
        typeof r.confidence === 'number' && r.confidence >= 0.5
      )
      .map((r: any) => ({
        from: r.from.trim(),
        to: r.to.trim(),
        relation: r.relation,
        description: (r.description || '').trim().slice(0, 200),
        confidence: Math.min(1, Math.max(0, r.confidence)),
      }));

    return { entities, relationships };
  } catch (e) {
    console.warn('[KGExtract] Parse failed:', e);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Extract structured knowledge from a conversation exchange.
 * Uses Haiku (~$0.001/call) for cost efficiency.
 *
 * Returns null if extraction fails or nothing meaningful found.
 */
export async function extractKnowledge(
  userMessage: string,
  assistantReply: string,
): Promise<ExtractionResult | null> {
  try {
    const raw = await callHaiku(userMessage, assistantReply);
    const result = parseExtractionResult(raw);

    if (result && (result.entities.length > 0 || result.relationships.length > 0)) {
      console.log('[KGExtract] Extracted:', result.entities.length, 'entities,', result.relationships.length, 'relationships');
      return result;
    }

    return null;
  } catch (e) {
    console.warn('[KGExtract] Extraction failed (non-fatal):', e);
    return null;
  }
}

/**
 * Quality gate — only run extraction on substantive exchanges.
 * Saves API calls on greetings and short responses.
 */
export function shouldExtract(userMessage: string, assistantReply: string): boolean {
  // Both messages need substance
  if (userMessage.trim().length < 20) return false;
  if (assistantReply.trim().length < 50) return false;
  // Skip pure questions with short answers
  if (userMessage.trim().endsWith('?') && assistantReply.trim().length < 100) return false;
  return true;
}
