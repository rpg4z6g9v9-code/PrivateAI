/**
 * toolExecutor.ts — PrivateAI Tool Executor
 *
 * Executes tool actions parsed from AI responses.
 * Each tool maps directly to an existing service.
 *
 * Supported tools:
 *   set_goal        — Save a goal to shared memory
 *   create_reminder — Create an iOS reminder
 *   search_web      — Tavily web search
 *   check_calendar  — Read upcoming calendar events
 *   log_health      — Log a medical entry (on-device only)
 *   save_note       — Save an on-device note
 */

import { tavilySearch } from './webSearch';
import { sanitizeExternalContent } from './promptFirewall';
import { addGoal } from './sharedMemory';
import {
  fetchTodayEvents, fetchTomorrowEvents, fetchWeekEvents,
  formatEventsForPrompt, hasCalendarPermission,
} from './calendarService';
import {
  createReminder, parseDueDate, hasRemindersPermission,
} from './remindersService';
import { saveNote } from './notesService';
import { extractLocalMedical, addEntry as addMedEntry, checkUrgent } from './medicalMemory';
import { logSecurityEvent } from './securityGateway';
import type { ToolAction } from './toolTypes';

export type { ToolAction } from './toolTypes';

// ─── Tool Call Parser ────────────────────────────────────────
//
// Parses [TOOL: name] ... [/TOOL] blocks from AI responses.

export function parseToolCalls(response: string): ToolAction[] {
  const tools: ToolAction[] = [];
  const rx = /\[TOOL:\s*(\w+)\]([\s\S]*?)\[\/TOOL\]/g;
  let match;

  while ((match = rx.exec(response)) !== null) {
    const action = match[1].trim();
    const body = match[2].trim();

    // Parse key: value pairs from the body
    const data: Record<string, string> = {};
    for (const line of body.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        if (key && val) data[key] = val;
      }
    }

    tools.push({
      action: action as ToolAction['action'],
      query: data.query || data.title || data.input || undefined,
      data,
    });
  }

  return tools;
}

/**
 * Strip tool call blocks from the response so the user sees clean text.
 */
export function stripToolBlocks(response: string): string {
  return response.replace(/\[TOOL:\s*\w+\][\s\S]*?\[\/TOOL\]/g, '').trim();
}

// ─── Executor ────────────────────────────────────────────────

export async function executeTool(action: ToolAction): Promise<{ result: string; success: boolean }> {
  console.log('[Tool] Executing:', action.action, action.data);

  try {
    switch (action.action) {

      // ── Set Goal ──────────────────────────────────────────
      case 'set_goal': {
        const title = (action.data as Record<string, string>)?.title;
        if (!title) return { result: 'No goal title provided', success: false };
        const goal = await addGoal(title);
        console.log('[Tool] Goal saved:', goal.title);
        return { result: `Goal saved: "${goal.title}"`, success: true };
      }

      // ── Create Reminder ───────────────────────────────────
      case 'create_reminder': {
        const title = (action.data as Record<string, string>)?.title;
        if (!title) return { result: 'No reminder title provided', success: false };
        const hasPerm = await hasRemindersPermission();
        if (!hasPerm) return { result: 'Reminders permission not granted. Enable it in the sidebar.', success: false };
        const due = (action.data as Record<string, string>)?.due;
        const dueDate = due ? parseDueDate(due) : undefined;
        await createReminder(title, dueDate);
        console.log('[Tool] Reminder created:', title, due ? `due: ${due}` : '');
        return { result: `Reminder created: "${title}"${due ? ` — due ${due}` : ''}`, success: true };
      }

      // ── Search Web ────────────────────────────────────────
      case 'search_web':
      case 'web_search': {
        const query = action.query || (action.data as Record<string, string>)?.query;
        if (!query) return { result: 'No search query provided', success: false };
        const results = await tavilySearch(query);
        const clean = sanitizeExternalContent(JSON.stringify(results));
        console.log('[Tool] Web search:', query);
        return { result: clean, success: true };
      }

      // ── Check Calendar ────────────────────────────────────
      case 'check_calendar': {
        const hasPerm = await hasCalendarPermission();
        if (!hasPerm) return { result: 'Calendar permission not granted. Enable it in the sidebar.', success: false };
        const range = (action.data as Record<string, string>)?.range || 'today';
        let events;
        if (range === 'tomorrow') events = await fetchTomorrowEvents();
        else if (range === 'week') events = await fetchWeekEvents();
        else events = await fetchTodayEvents();
        const formatted = formatEventsForPrompt(events, range);
        console.log('[Tool] Calendar check:', range, events.length, 'events');
        return { result: formatted || `No events ${range}.`, success: true };
      }

      // ── Log Health ────────────────────────────────────────
      case 'log_health': {
        const input = (action.data as Record<string, string>)?.input;
        if (!input) return { result: 'No health description provided', success: false };
        const draft = extractLocalMedical(input);
        if (!draft) return { result: 'Could not extract health information from the description.', success: false };
        const entry = await addMedEntry(draft);
        const isUrgent = checkUrgent(input);
        logSecurityEvent('medical_tool_log', 'system').catch(() => {});
        console.log('[Tool] Health entry logged:', draft.type, isUrgent ? '(URGENT)' : '');
        return {
          result: `Health entry logged: ${draft.type} — "${draft.structured.what}"${isUrgent ? '\n\nThis sounds urgent. If this is a medical emergency, call 911.' : ''}`,
          success: true,
        };
      }

      // ── Save Note ─────────────────────────────────────────
      case 'save_note': {
        const title = (action.data as Record<string, string>)?.title;
        const content = (action.data as Record<string, string>)?.content;
        if (!title || !content) return { result: 'Need both title and content for a note', success: false };
        await saveNote(title, content);
        console.log('[Tool] Note saved:', title);
        return { result: `Note saved: "${title}"`, success: true };
      }

      default:
        console.warn('[Tool] Unknown action:', action.action);
        return { result: `Unknown tool: ${action.action}`, success: false };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Tool] Execution failed:', action.action, msg);
    return { result: `Tool error: ${msg}`, success: false };
  }
}
