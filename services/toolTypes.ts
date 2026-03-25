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
  | 'run_code'
  | 'read_file'
  | 'open_app'
  | 'run_shortcut'
  | 'scan_threat'
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

### run_code
Execute a JavaScript snippet and return the result. Use for calculations, data transforms, or quick logic.
Parameters:
  code: JavaScript code to execute (required)
Example:
[TOOL: run_code]
code: const fib = n => n <= 1 ? n : fib(n-1) + fib(n-2); fib(10)
[/TOOL]

### read_file
Search and read content from the user's knowledge base.
Parameters:
  query: Search term to find relevant files/entries (required)
Example:
[TOOL: read_file]
query: React Native architecture notes
[/TOOL]

### open_app
Open another app on the user's phone via URL scheme.
Parameters:
  app: App name — "messages", "mail", "maps", "safari", "settings", "phone", "shortcuts" (required)
  data: Optional data (e.g. URL for safari, address for maps, number for phone)
Example:
[TOOL: open_app]
app: safari
data: https://developer.apple.com
[/TOOL]

### run_shortcut
Run an iOS Shortcut by name. The user must have the shortcut installed.
Parameters:
  name: Exact name of the iOS Shortcut (required)
  input: Optional text input to pass to the shortcut
Example:
[TOOL: run_shortcut]
name: Block Spam Sender
input: spammer@fake-domain.com
[/TOOL]

### scan_threat
Analyze pasted content (email, message, link) for security threats. Returns a threat assessment with severity, indicators found, and recommended actions.
Parameters:
  content: The suspicious content to analyze (required)
  type: "email", "link", "message", or "file" (default: "email")
Example:
[TOOL: scan_threat]
type: email
content: Subject: URGENT: Your account has been compromised! Click here immediately to verify...
[/TOOL]

Rules:
- Only call tools when they genuinely help the user
- Never call log_health unless the user is describing actual health information
- For set_goal, only save when the user expresses a clear intention or goal
- For run_code, never execute code that accesses the file system, network, or device APIs
- For scan_threat, always provide a clear threat level and actionable next steps
- Always include the tool result naturally in your response — don't just dump raw output
`;
