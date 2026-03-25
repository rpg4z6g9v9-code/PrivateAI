/**
 * toolTypes.ts — Shared tool types for PrivateAI
 *
 * All tool actions the AI personas can invoke.
 */

export type ToolActionType =
  | 'set_goal'
  | 'create_reminder'
  | 'search_web'
  | 'check_calendar'
  | 'log_health'
  | 'save_note'
  | 'web_search'       // legacy alias for search_web
  | 'memory_store'
  | 'memory_retrieve';

export interface ToolAction {
  action: ToolActionType;
  query?: string;
  data?: Record<string, unknown>;
}

/**
 * Tool definitions — injected into persona system prompts so the model
 * knows what tools are available and how to call them.
 */
export const TOOL_DEFINITIONS = `
## Available Tools

You can invoke tools by including a tool call block in your response. Format:

[TOOL: tool_name]
param1: value1
param2: value2
[/TOOL]

Available tools:

### set_goal
Save a goal to the user's shared goals (visible to all personas).
Parameters:
  title: The goal description (required)
Example:
[TOOL: set_goal]
title: Launch PrivateAI on the App Store by April
[/TOOL]

### create_reminder
Create an iOS reminder for the user.
Parameters:
  title: What to remind about (required)
  due: When it's due — natural language like "tomorrow", "Friday", "in 2 hours" (optional)
Example:
[TOOL: create_reminder]
title: Call the doctor
due: Friday
[/TOOL]

### search_web
Search the web for current information. Use when the user asks about recent events, current data, or things you're not confident about.
Parameters:
  query: Search query (required)
Example:
[TOOL: search_web]
query: latest React Native performance benchmarks 2026
[/TOOL]

### check_calendar
Check the user's calendar for upcoming events.
Parameters:
  range: "today", "tomorrow", or "week" (default: "today")
Example:
[TOOL: check_calendar]
range: tomorrow
[/TOOL]

### log_health
Log a health entry to the user's medical memory. Only use when the user describes symptoms, medications, or health events. Always confirm before logging.
Parameters:
  input: The raw health description (required)
Example:
[TOOL: log_health]
input: headache since this morning, mild, gets worse when standing
[/TOOL]

### save_note
Save a note to the user's on-device notes.
Parameters:
  title: Note title (required)
  content: Note content (required)
Example:
[TOOL: save_note]
title: Meeting takeaways
content: Decided to go with Swift for the native rewrite. Timeline is 6 weeks.
[/TOOL]

Rules:
- Only call tools when they genuinely help the user
- Never call log_health unless the user is describing actual health information
- For set_goal, only save when the user expresses a clear intention or goal
- Always include the tool result naturally in your response — don't just dump raw output
`;
