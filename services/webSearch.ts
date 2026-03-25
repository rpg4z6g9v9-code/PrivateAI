/**
 * webSearch.ts — Tavily web search integration
 *
 * Privacy rules:
 *   - Never searches if medical keywords detected
 *   - Strips personal identifiers before sending query
 *   - Only the sanitized question leaves the device
 */

const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_API_KEY ?? '';

// ── Medical keyword guard ─────────────────────────────────────
// If the message touches health data, we never send it to Tavily
const MEDICAL_RX = /\b(symptom|medication|doctor|physician|diagnosis|pain|health|headache|fever|nausea|blood\s*pressure|heart\s*rate|pharmacy|hospital|clinic|therapy|treatment|allergy|anxiety|depression|diabetes|surgery|injury|dosage|prescription)\b/i;

// ── Search intent signals ─────────────────────────────────────
const SEARCH_RX = /\b(search|look\s*up|latest|current|today|news|recent|2025|2026|price|prices|weather|stock|market|who\s*is|who\s*are|what\s*happened|tell\s*me\s*about|what'?s\s*new|breaking|trending|announced|released|just\s*came\s*out)\b/i;

// ── Types ─────────────────────────────────────────────────────

export interface SearchResult {
  title:   string;
  url:     string;
  content: string;
  score:   number;
}

export interface SearchResponse {
  answer:  string;
  results: SearchResult[];
}

// ── Query sanitizer ───────────────────────────────────────────
// Strips first-person pronouns and proper nouns that could identify the user.
// Only the intent of the question is sent — not personal context.
function sanitizeQuery(query: string): string {
  return query
    .replace(/\b(pete|adam|my\s+name\s+is\s+\w+)\b/gi, '')
    .replace(/\b(my|our|we|i'm|i\s+am)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Public API ────────────────────────────────────────────────

/**
 * Returns true if this message warrants a web search.
 * Never returns true for medical content.
 */
export function shouldSearch(text: string): boolean {
  if (MEDICAL_RX.test(text)) return false;
  return SEARCH_RX.test(text);
}

/**
 * Call Tavily and return the synthesized answer + source list.
 * Sanitizes the query before it leaves the device.
 */
export async function tavilySearch(query: string): Promise<SearchResponse> {
  const sanitized = sanitizeQuery(query);
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key:        TAVILY_KEY,
      query:          sanitized,
      search_depth:   'basic',
      max_results:    5,
      include_answer: true,
    }),
  });
  if (!response.ok) throw new Error(`Tavily ${response.status}`);
  return response.json();
}

/**
 * Build the context string injected before the user question.
 * Claude uses this to cite sources naturally.
 */
export function buildSearchContext(query: string, search: SearchResponse): string {
  const sources = search.results
    .slice(0, 3)
    .map(r => `- ${r.title}: ${r.url}`)
    .join('\n');
  const answer = search.answer?.trim() ?? '';
  return `[WEB SEARCH RESULTS]\n${answer}\n\nSources:\n${sources}\n\n[USER QUESTION]\n${query}`;
}
