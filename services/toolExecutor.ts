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
import { searchFiles } from './filesService';
import { listEntries } from './knowledgeBase';
import { scanContent, formatThreatReport } from './threatScanner';
import { recordThreat, isBlocked, checkLearnedPatterns, generateThreatDigest, addToBlocklist } from './threatIntelligence';
import { Linking } from 'react-native';
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

      // ── Run Code ─────────────────────────────────────────
      case 'run_code': {
        const code = (action.data as Record<string, string>)?.code;
        if (!code) return { result: 'No code provided', success: false };
        // Sandboxed execution — no access to require, fetch, global, process
        try {
          const sandbox = new Function(
            'return (function() { "use strict"; ' +
            'const require = undefined; const fetch = undefined; ' +
            'const process = undefined; const global = undefined; ' +
            `return (${code}); })()`,
          );
          const output = sandbox();
          const resultStr = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);
          console.log('[Tool] Code executed, result:', resultStr.slice(0, 100));
          return { result: `Result: ${resultStr}`, success: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { result: `Code error: ${msg}`, success: false };
        }
      }

      // ── Read File / Knowledge Base ────────────────────────
      case 'read_file': {
        const query = action.query || (action.data as Record<string, string>)?.query;
        if (!query) return { result: 'No search query provided', success: false };
        // Search knowledge base entries across all personas
        const results = await searchFiles(query);
        if (results.length === 0) {
          // Try knowledge base
          const allPersonas = ['atlas', 'vera', 'cipher', 'lumen', 'pete'];
          const entries = [];
          for (const pid of allPersonas) {
            const pEntries = await listEntries(pid);
            entries.push(...pEntries.filter(e =>
              e.title.toLowerCase().includes(query.toLowerCase()) ||
              e.content.toLowerCase().includes(query.toLowerCase())
            ));
          }
          if (entries.length === 0) return { result: `No files or knowledge entries found for "${query}"`, success: false };
          const formatted = entries.slice(0, 3).map(e => `${e.title}:\n${e.content.slice(0, 500)}`).join('\n\n---\n\n');
          return { result: formatted, success: true };
        }
        const formatted = results.slice(0, 3).map(f => `${f.name}:\n${f.content?.slice(0, 500) || '(no content)'}`).join('\n\n---\n\n');
        console.log('[Tool] File search:', query, results.length, 'results');
        return { result: formatted, success: true };
      }

      // ── Open App ──────────────────────────────────────────
      case 'open_app': {
        const app = (action.data as Record<string, string>)?.app?.toLowerCase();
        const data = (action.data as Record<string, string>)?.data || '';
        if (!app) return { result: 'No app specified', success: false };

        const urlSchemes: Record<string, string> = {
          messages:  data ? `sms:${data}` : 'sms:',
          mail:      data ? `mailto:${data}` : 'mailto:',
          maps:      data ? `maps://?q=${encodeURIComponent(data)}` : 'maps://',
          safari:    data || 'https://www.google.com',
          settings:  'app-settings:',
          phone:     data ? `tel:${data}` : 'tel:',
          shortcuts: 'shortcuts://',
          calendar:  'calshow://',
          notes:     'mobilenotes://',
          photos:    'photos-redirect://',
          music:     'music://',
          files:     'shareddocuments://',
        };

        const url = urlSchemes[app];
        if (!url) return { result: `Unknown app: "${app}". Available: ${Object.keys(urlSchemes).join(', ')}`, success: false };

        try {
          const canOpen = await Linking.canOpenURL(url);
          if (!canOpen) return { result: `Cannot open ${app} — URL scheme not supported on this device`, success: false };
          await Linking.openURL(url);
          console.log('[Tool] Opened app:', app, url);
          return { result: `Opened ${app}`, success: true };
        } catch (e) {
          return { result: `Failed to open ${app}: ${e instanceof Error ? e.message : String(e)}`, success: false };
        }
      }

      // ── Run Shortcut ──────────────────────────────────────
      case 'run_shortcut': {
        const name = (action.data as Record<string, string>)?.name;
        if (!name) return { result: 'No shortcut name provided', success: false };
        const input = (action.data as Record<string, string>)?.input || '';
        const url = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}${input ? `&input=text&text=${encodeURIComponent(input)}` : ''}`;
        try {
          const canOpen = await Linking.canOpenURL(url);
          if (!canOpen) return { result: 'Shortcuts app not available', success: false };
          await Linking.openURL(url);
          console.log('[Tool] Running shortcut:', name);
          return { result: `Running shortcut: "${name}"`, success: true };
        } catch (e) {
          return { result: `Failed to run shortcut: ${e instanceof Error ? e.message : String(e)}`, success: false };
        }
      }

      // ── Scan Threat ───────────────────────────────────────
      case 'scan_threat': {
        const content = (action.data as Record<string, string>)?.content;
        if (!content) return { result: 'No content to scan', success: false };
        const type = ((action.data as Record<string, string>)?.type || 'email') as 'email' | 'link' | 'message' | 'file';

        // Check blocklist first — instant block for known threats
        const blocked = await isBlocked(content);
        if (blocked) {
          return {
            result: `BLOCKED — this content matches a known threat in your blocklist.\n\nBlocked entry: ${blocked.value} (${blocked.type})\nReason: ${blocked.reason}\nHit count: ${blocked.hitCount}`,
            success: true,
          };
        }

        // Check learned patterns
        const learnedMatches = await checkLearnedPatterns(content);

        // Run full scan
        const report = scanContent(content, type);

        // Record to threat intelligence — auto-blocks high/critical domains and senders
        await recordThreat(report, type, content);

        // Format report
        let formatted = formatThreatReport(report);

        // Append learned pattern matches if any
        if (learnedMatches.length > 0) {
          formatted += `\n\nAdditional matches from threat memory: ${learnedMatches.join(', ')}`;
        }

        // Append blocklist update notification
        if (report.level === 'critical' || report.level === 'high') {
          formatted += '\n\nMalicious domains and senders from this content have been auto-added to your blocklist.';
        }

        console.log('[Tool] Threat scan:', report.level, report.indicators.length, 'indicators,', learnedMatches.length, 'learned matches');
        return { result: formatted, success: true };
      }

      // ── Threat Digest ────────────────────────────────────
      case 'threat_digest': {
        const digest = await generateThreatDigest();
        console.log('[Tool] Threat digest generated');
        return { result: digest, success: true };
      }

      // ── Block Sender ──────────────────────────────────────
      case 'block_sender': {
        const type = (action.data as Record<string, string>)?.type as 'domain' | 'email' | 'ip' | 'phone';
        const value = (action.data as Record<string, string>)?.value;
        const reason = (action.data as Record<string, string>)?.reason || 'Manually blocked';
        if (!type || !value) return { result: 'Need both type and value to block', success: false };
        const entry = await addToBlocklist(type, value, reason);
        console.log('[Tool] Blocked:', type, value);
        return { result: `Blocked ${type}: ${value}\nReason: ${reason}\nThis ${type} will be flagged in future scans.`, success: true };
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
