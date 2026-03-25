/**
 * memory.ts — PrivateAI Memory Layer
 *
 * Stores structured memory entries per persona. After each conversation
 * exchange, a lightweight Claude call extracts recurring themes and merges
 * them into the memory store. Memory is injected into system prompts so
 * each persona knows what Atom keeps coming back to.
 *
 * Storage key: memory_v1_{personaId}  (AsyncStorage, JSON array)
 */

import secureStorage from './secureStorage';
import { canAccessVault } from './dataVault';

const AsyncStorage = secureStorage;

// ─── Types ────────────────────────────────────────────────────

export interface MemoryEntry {
  topic: string;
  summary: string;
  keywords: string[];
  frequency: number;
  firstSeen: string;  // ISO date string
  lastSeen: string;   // ISO date string
  exampleQuotes: string[];
  personaId: string;
}

interface ExtractedPattern {
  topic: string;
  summary: string;
  keywords: string[];
}

// ─── Constants ────────────────────────────────────────────────

const MEMORY_KEY = (personaId: string) => `memory_v1_${personaId}`;
const MAX_QUOTES  = 3;   // rolling window of most recent quotes per topic
const MAX_ENTRIES = 30;  // max entries per persona before oldest are dropped

// ─── Storage ──────────────────────────────────────────────────

export async function loadMemory(personaId: string): Promise<MemoryEntry[]> {
  if (!canAccessVault()) return [];
  try {
    const raw = await AsyncStorage.getItem(MEMORY_KEY(personaId));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[Memory] loadMemory failed:', e);
    return [];
  }
}

async function saveMemory(personaId: string, entries: MemoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MEMORY_KEY(personaId), JSON.stringify(entries));
  } catch (e) { console.warn('[Memory] saveMemory failed:', e); }
}

export async function clearMemory(personaId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(MEMORY_KEY(personaId));
  } catch (e) { console.warn('[Memory] clearMemory failed:', e); }
}

// ─── Merge ────────────────────────────────────────────────────

function mergeEntries(
  existing: MemoryEntry[],
  extracted: ExtractedPattern[],
  personaId: string,
  userMessage: string,
): MemoryEntry[] {
  const now = new Date().toISOString();
  const updated = [...existing];
  // Trim the user message to a readable quote length
  const quote = userMessage.replace(/\s+/g, ' ').trim().slice(0, 120);

  for (const ext of extracted) {
    const normTopic = ext.topic.toLowerCase().trim();

    // Match on topic name or shared keyword
    const idx = updated.findIndex(e =>
      e.topic.toLowerCase() === normTopic ||
      e.keywords.some(k => ext.keywords.map(kw => kw.toLowerCase()).includes(k.toLowerCase()))
    );

    if (idx >= 0) {
      const entry = updated[idx];
      entry.frequency += 1;
      entry.lastSeen = now;
      entry.summary = ext.summary;
      // Add new keywords without duplicates
      for (const kw of ext.keywords) {
        if (!entry.keywords.map(k => k.toLowerCase()).includes(kw.toLowerCase())) {
          entry.keywords.push(kw);
        }
      }
      // Rolling quote window
      if (quote && !entry.exampleQuotes.includes(quote)) {
        entry.exampleQuotes = [...entry.exampleQuotes, quote].slice(-MAX_QUOTES);
      }
    } else {
      // New entry
      updated.push({
        topic: ext.topic,
        summary: ext.summary,
        keywords: ext.keywords,
        frequency: 1,
        firstSeen: now,
        lastSeen: now,
        exampleQuotes: quote ? [quote] : [],
        personaId,
      });
    }
  }

  // Sort by frequency descending, cap at MAX_ENTRIES
  return updated
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, MAX_ENTRIES);
}

// ─── Pattern Extraction ───────────────────────────────────────
//
// Sends a lightweight call to claude-haiku (cheapest/fastest) after each
// exchange. Fire-and-forget from the caller's perspective — never throws.

export async function extractPatterns(
  personaId: string,
  userMessage: string,
  assistantReply: string,
  apiKey: string,
): Promise<void> {
  if (!apiKey || !userMessage.trim()) return;

  try {
    const existing = await loadMemory(personaId);

    const prompt =
      `Analyze this conversation exchange. Identify any recurring themes, questions, goals, or topics the user cares about.

User: ${userMessage.slice(0, 500)}
Assistant: ${assistantReply.slice(0, 500)}

Return ONLY a raw JSON array — no markdown fences, no explanation. Format:
[{"topic":"short topic name","summary":"one sentence about what they care about","keywords":["kw1","kw2","kw3"]}]

Rules:
- Only include topics that reveal something meaningful about the user's interests, goals, or recurring concerns.
- Skip small talk and one-off questions.
- If nothing meaningful, return [].`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return;

    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? '';

    // Be defensive about JSON parsing — Claude sometimes wraps in backticks
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    let extracted: ExtractedPattern[];
    try {
      extracted = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('[Memory] JSON parse failed:', e);
      return;
    }

    if (!Array.isArray(extracted) || extracted.length === 0) return;

    // Validate shape of each entry before merging
    const valid = extracted.filter(
      e => typeof e.topic === 'string' &&
           typeof e.summary === 'string' &&
           Array.isArray(e.keywords)
    );
    if (valid.length === 0) return;

    const merged = mergeEntries(existing, valid, personaId, userMessage);
    await saveMemory(personaId, merged);
  } catch (e) {
    // Memory extraction must never surface as an error to the user
    console.warn('[Memory] extractPatterns failed:', e);
  }
}

// ─── Local AI memory merge ────────────────────────────────────
//
// Called from index.tsx after extractPatternsLocal() returns patterns
// without needing an API key. Merges the pre-extracted patterns directly.

export async function mergeExtractedPatterns(
  personaId: string,
  patterns: { topic: string; summary: string; keywords: string[] }[],
  userMessage: string,
): Promise<void> {
  try {
    const existing = await loadMemory(personaId);
    const merged = mergeEntries(existing, patterns, personaId, userMessage);
    await saveMemory(personaId, merged);
  } catch (e) { console.warn('[Memory] mergeExtractedPatterns failed:', e); }
}

// ─── System Prompt Injection ──────────────────────────────────
//
// Returns the memory block to append to a persona's system prompt.
// Shows the top 5 entries by frequency.

export function buildMemoryPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';

  const top = entries.slice(0, 5);
  const lines = top.map(e => {
    const times = e.frequency === 1 ? '1 time' : `${e.frequency} times`;
    const quote = e.exampleQuotes.length > 0
      ? ` Most recently: "${e.exampleQuotes[e.exampleQuotes.length - 1]}"`
      : '';
    return `- "${e.topic}" has come up ${times}. ${e.summary}.${quote}`;
  });

  return `\n\nLong-term memory — what I've noticed about Atom:\n${lines.join('\n')}\n\nUse this context to personalize your responses. If a topic has come up multiple times, acknowledge the pattern naturally when relevant.`;
}

// ─── Helpers ──────────────────────────────────────────────────

export function relativeDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
