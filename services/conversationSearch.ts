/**
 * conversationSearch.ts — Search encrypted chat history
 * 
 * Simple in-memory search on decrypted messages.
 * Returns matching message IDs + context.
 */

interface SearchResult {
  messageId: string;
  content: string;
  role: 'user' | 'assistant';
  matchedText: string;
  context: string; // 50 chars before + after match
}

export function searchConversations(
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>,
  query: string
): SearchResult[] {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');

  messages.forEach((msg) => {
    if (msg.content.toLowerCase().includes(queryLower)) {
      const matches = msg.content.matchAll(regex);
      for (const match of matches) {
        const start = Math.max(0, match.index! - 25);
        const end = Math.min(msg.content.length, match.index! + match[0].length + 25);
        const context = msg.content.slice(start, end).trim();

        results.push({
          messageId: msg.id,
          content: msg.content,
          role: msg.role,
          matchedText: match[0],
          context: `...${context}...`,
        });
      }
    }
  });

  return results;
}

/**
 * Get a summary/title for a conversation based on first few messages.
 * Used to label conversations in the picker.
 */
export function generateConversationTitle(
  messages: Array<{ content: string; role: 'user' | 'assistant' }>,
  maxLength = 50
): string {
  const firstUserMsg = messages.find((m) => m.role === 'user')?.content ?? '';
  if (!firstUserMsg) return 'New Conversation';

  // Extract first 50 chars, stop at sentence boundary
  let title = firstUserMsg.slice(0, maxLength);
  const lastPeriod = title.lastIndexOf('.');
  const lastQuestion = title.lastIndexOf('?');
  const lastStop = Math.max(lastPeriod, lastQuestion);

  if (lastStop > 20) {
    title = title.slice(0, lastStop + 1);
  }

  return title.trim() || 'New Conversation';
}
