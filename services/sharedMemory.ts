/**
 * sharedMemory.ts — PrivateAI Two-Tier Shared Memory Layer
 *
 * Tier 1: SHARED CONTEXT (global, read by all personas)
 *   - User profile (name, role, values)
 *   - Active goals
 *   - Knowledge graph highlights (confirmed nodes, milestones, top patterns)
 *   - Cross-persona insights (topics that surface across multiple personas)
 *
 * Tier 2: PRIVATE NAMESPACE (per persona, existing memory.ts / knowledgeBase.ts)
 *   - Persona-specific conversation patterns
 *   - Persona-specific knowledge entries
 *
 * All data stays on-device. This service reads from multiple stores
 * and composes a shared context string for prompt injection.
 */

import secureStorage from './secureStorage';
import { synthesizeInsights, getGraphSummary, getTopInsights } from './knowledgeGraph';
import { getRecentEntries } from './medicalMemory';
import { signData } from './integrityCheck';

const AsyncStorage = secureStorage;

// ─── Storage Keys ────────────────────────────────────────────

const PROFILE_KEY = 'shared_profile_v1';
const GOALS_KEY = 'shared_goals_v1';

// ─── Types ───────────────────────────────────────────────────

export interface UserProfile {
  name: string;
  role: string;
  values: string[];
  updatedAt: string;
}

export interface Goal {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'done';
  createdAt: string;
  updatedAt: string;
}

// ─── Profile CRUD ────────────────────────────────────────────

export async function getProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  try {
    const data = JSON.stringify(profile);
    await AsyncStorage.setItem(PROFILE_KEY, data);
    await signData(PROFILE_KEY, data);
  } catch (e) { console.warn('[SharedMemory] saveProfile failed:', e); }
}

// ─── Goals CRUD ──────────────────────────────────────────────

export async function getGoals(): Promise<Goal[]> {
  try {
    const raw = await AsyncStorage.getItem(GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function saveGoals(goals: Goal[]): Promise<void> {
  try {
    const data = JSON.stringify(goals);
    await AsyncStorage.setItem(GOALS_KEY, data);
    await signData(GOALS_KEY, data);
  } catch (e) { console.warn('[SharedMemory] saveGoals failed:', e); }
}

export async function addGoal(title: string): Promise<Goal> {
  const goals = await getGoals();
  const goal: Goal = {
    id: Date.now().toString(),
    title,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  goals.push(goal);
  await saveGoals(goals);
  return goal;
}

export async function updateGoalStatus(id: string, status: Goal['status']): Promise<void> {
  const goals = await getGoals();
  const goal = goals.find(g => g.id === id);
  if (goal) {
    goal.status = status;
    goal.updatedAt = new Date().toISOString();
    await saveGoals(goals);
  }
}

// ─── Shared Context Builder ──────────────────────────────────
//
// Composes the global context string injected into every persona's prompt.
// Kept concise — max ~500 tokens to leave room for persona-specific context.

export async function buildSharedContext(): Promise<string> {
  const parts: string[] = [];

  // 1. User profile
  const profile = await getProfile();
  if (profile) {
    parts.push(`User: ${profile.name} — ${profile.role}`);
    if (profile.values.length > 0) {
      parts.push(`Core values: ${profile.values.join(', ')}`);
    }
  }

  // 2. Active goals
  const goals = await getGoals();
  const active = goals.filter(g => g.status === 'active');
  if (active.length > 0) {
    const goalLines = active.slice(0, 5).map(g => `- ${g.title}`).join('\n');
    parts.push(`Active goals:\n${goalLines}`);
  }

  // 3. Knowledge graph highlights (top confirmed + recurring patterns)
  const topInsights = await getTopInsights(3);
  if (topInsights) {
    parts.push(topInsights);
  }

  // 4. Medical summary (count only — not detail, to respect trust boundary)
  try {
    const medEntries = await getRecentEntries(100);
    if (medEntries.length > 0) {
      parts.push(`Health tracking: ${medEntries.length} entries logged`);
    }
  } catch { /* non-critical */ }

  if (parts.length === 0) {
    console.log('[SharedMemory] buildSharedContext: empty — no profile, goals, or insights');
    return '';
  }

  const result = `\n\n--- Shared Context (all personas) ---\n${parts.join('\n\n')}`;
  console.log('[SharedMemory] buildSharedContext:', parts.length, 'sections,', result.length, 'chars');
  return result;
}

// ─── Compact Shared Context (for local model) ───────────────
//
// Ultra-short version for Llama's 2048-token context.
// Max ~200 tokens — just profile + active goals.

export async function buildSharedContextCompact(): Promise<string> {
  const parts: string[] = [];

  const profile = await getProfile();
  if (profile) {
    parts.push(`User: ${profile.name}, ${profile.role}`);
  }

  const goals = await getGoals();
  const active = goals.filter(g => g.status === 'active');
  if (active.length > 0) {
    const goalList = active.slice(0, 3).map(g => g.title).join('; ');
    parts.push(`Goals: ${goalList}`);
  }

  if (parts.length === 0) return '';
  return `\n\n${parts.join('\n')}`;
}

// ─── Goal Detection ──────────────────────────────────────────
//
// Lightweight regex-based detection of goal statements in user messages.
// No API call — runs synchronously after each exchange.

const GOAL_PATTERNS = [
  /my goal is (?:to )?(.{10,120})/i,
  /i want to (.{10,120})/i,
  /i need to (.{10,120})/i,
  /i'm (?:trying|planning|going) to (.{10,120})/i,
  /goal[:\s]+(.{10,120})/i,
  /objective[:\s]+(.{10,120})/i,
  /i'm focused on (.{10,120})/i,
  /priority is (?:to )?(.{10,120})/i,
];

/**
 * Extract potential goals from a user message and save them.
 * Called after each exchange — non-blocking, fire-and-forget.
 */
export async function detectAndSaveGoals(userMessage: string): Promise<void> {
  try {
    console.log('[SharedMemory] detectAndSaveGoals scanning:', userMessage.slice(0, 80));
    const existing = await getGoals();
    const existingTitles = new Set(existing.map(g => g.title.toLowerCase()));

    for (const rx of GOAL_PATTERNS) {
      const match = userMessage.match(rx);
      if (!match?.[1]) continue;

      // Clean up the extracted goal
      let title = match[1].trim();
      // Strip trailing punctuation
      title = title.replace(/[.!?,;:]+$/, '').trim();
      // Skip if too short or already exists
      if (title.length < 10) continue;
      if (existingTitles.has(title.toLowerCase())) continue;
      // Skip if it's a question, not a statement
      if (title.includes('?')) continue;

      await addGoal(title);
      console.log('[SharedMemory] Goal detected and saved:', title);
      return; // one goal per message max
    }
  } catch (e) {
    console.warn('[SharedMemory] detectAndSaveGoals failed:', e);
  }
}

/**
 * Build shared context for a specific persona, respecting access rules.
 *
 * Access tiers:
 *   atlas:  goals, profile, knowledge graph, medical count
 *   vera:   profile, medical (full — handled separately by securityGateway)
 *   cipher: profile, security events (TODO), knowledge graph
 *   lumen:  profile, knowledge graph (full), goals
 *   pete:   everything
 */
export async function buildPersonaSharedContext(personaId: string): Promise<string> {
  // For now, all personas get the same shared context.
  // The trust boundary for medical detail is handled by securityGateway.buildMedicalContext().
  // Future: filter sections based on persona's memoryaccess spec.
  return buildSharedContext();
}
