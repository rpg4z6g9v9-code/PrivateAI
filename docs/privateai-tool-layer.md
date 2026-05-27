# PrivateAI Tool Layer — Design Document

Status: design only — not yet implemented
Reference: OpenClaw architecture (tool allowlists, MCP servers, permission controls)
Principle: AI proposes actions. Deterministic tools execute them. Every call is logged.

## Implementation sequence (confirmed)

```
1. Two weeks of stabilization + lived usage (current phase)
2. Operational visibility panel — node status, storage, last sync, recent events
3. web.search only — proves tool proposal, logging, executor, provenance
4. file.read — proves sandboxing
5. file.write with confirmation — proves permission UX
6. calendar/reminder create — first write-to-external
7. Higher-risk tools: not before the above are boringly reliable
```

Rule: read-only tools prove the tool layer before write tools test the permission layer.
Rule: if the system can't explain what it did, it should not be trusted to do more.
Therefore: operational visibility before tool execution.

---

## 1. Proposed Architecture

The tool layer sits above interpretation and below user interaction:

```
System of record (SQLite)
    ↓
Deterministic operations (SQL / typed functions)
    ↓
AI interpretation (model over query results)
    ↓
Action proposal (model identifies tool + params)
    ↓
Permission check (allowlist + confirmation gate)
    ↓
Tool execution (deterministic, sandboxed)
    ↓
Result logged (tool_calls table)
    ↓
Result returned to model for interpretation
```

The model never executes actions directly. It proposes them as structured output.
A deterministic executor handles the actual call, after the permission gate clears.

This keeps the System of Record Rule intact:
- AI proposes (interpretation layer)
- Tool executes (deterministic layer)
- SQLite records (truth layer)

---

## 2. Tool Permission Model

### Trust tiers

| Tier | Behavior                        | Examples                        |
|------|---------------------------------|---------------------------------|
| 0    | Auto-approved, no confirmation  | Web search, file read (sandbox) |
| 1    | Requires user confirmation      | File write, calendar create     |
| 2    | Denied by default               | Email send, shell exec, delete  |

### Allowlist structure

Each tool entry specifies:
- `name` — unique identifier
- `tier` — 0 / 1 / 2
- `description` — shown to user at confirmation
- `params_schema` — typed, validated before execution
- `sandbox` — path restrictions or scope limits where applicable

Tools not on the allowlist cannot be called. The model cannot propose unlisted tools.

### Denylist (permanent)

Never allowed, regardless of prompt:
- `email.send` — draft only, never send
- `shell.exec` — no shell access
- `file.delete` — no destructive file operations
- `browser.click` / `browser.fill` — no browser automation
- `finance.transfer` — no financial transactions
- `api.call` with arbitrary URLs — no unconstrained outbound calls

---

## 3. First Three Tools

### Tool 1: `web.search`

Tier: 0 (auto-approved, read-only)

```typescript
interface WebSearchParams {
  query: string;        // max 200 chars
  max_results?: number; // default 5, max 10
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}
```

Implementation: fetch from a single approved search API (e.g. Brave Search API or Tavily).
No browser automation. Returns snippets only — model reads and interprets.
Network call logged to tool_calls. Result not stored as fact.

### Tool 2: `file.read`

Tier: 0 (auto-approved, read-only within sandbox)

```typescript
interface FileReadParams {
  path: string;  // must resolve within SANDBOX_ROOT
}
```

Sandbox root: `~/Documents/PrivateAI-sandbox/` (created on first use, never outside this).
Path traversal (../): rejected before execution.
Returns file contents as string (text files only, max 50KB).

### Tool 3: `file.write`

Tier: 1 (requires user confirmation)

```typescript
interface FileWriteParams {
  path: string;    // must resolve within SANDBOX_ROOT
  content: string; // the content to write
  mode: 'create' | 'append'; // overwrite not allowed in v1
}
```

Confirmation prompt shows: `Write to [filename]? ([N] chars)`
User must explicitly approve before file is touched.
Both approval and execution logged.

---

## 4. Action Log Schema

Every tool proposal, approval/denial, and execution result is written to SQLite.

```sql
CREATE TABLE IF NOT EXISTS tool_calls (
  id              TEXT    PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  tool            TEXT    NOT NULL,
  params          TEXT    NOT NULL,  -- JSON, validated params
  tier            INTEGER NOT NULL,  -- 0, 1, or 2
  status          TEXT    NOT NULL
    CHECK(status IN ('proposed','approved','denied','executed','failed')),
  result          TEXT,              -- JSON, null until executed
  error           TEXT,              -- null unless failed
  confirmed_at    INTEGER,           -- null for tier-0 (auto-approved)
  executed_at     INTEGER,
  model           TEXT    NOT NULL,  -- which model proposed the action
  conversation_id TEXT               -- links back to conversations table
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_created ON tool_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool    ON tool_calls(tool);
```

The log is append-only. No tool_call row is mutated after `executed` or `failed` status.
Status transitions: proposed → approved/denied → executed/failed.

Why this matters:
- Every action is auditable after the fact
- Stale approvals cannot be silently replayed
- Model version is recorded (provenance for AI-proposed actions)
- Conversation linkage enables "what tools did this session use?"

---

## 5. Confirmation Rules

### Tier 0 — auto-approved

Model proposes → immediate execution → result returned.
Still logged (status: `approved` + `executed` in same transaction).

### Tier 1 — user confirmation required

1. Model proposes action with params
2. UI presents confirmation dialog:
   ```
   [Tool name]: [human-readable description of what will happen]
   Params: [readable summary]
   [Approve] [Deny]
   ```
3. User approves → execution → result returned to model
4. User denies → model receives denial, may propose alternative
5. Both outcomes logged with `confirmed_at` timestamp

The model never sees the confirmation as a prompt injection opportunity.
Confirmation is a UI gate, not a model gate.

### Tier 2 — denied

Model may propose, but executor rejects immediately.
Response to model: `{"error": "tool denied — not in approved tier"}`
Logged as `denied`. No user prompt shown (not worth interrupting for).

### Timeout

Tier-1 confirmations expire after 30 seconds with no user response.
Treated as denial. Logged as `denied`.

---

## 6. What Not to Automate Yet

### Not in v1

**Email send** — drafts only. Sending email is high-stakes and irreversible.
Even with confirmation, the risk of accidental send is too high for early tooling.

**Calendar delete / edit** — creation is low-risk. Editing existing events is not.
v1: calendar create only.

**Shell commands** — even with allowlisting, shell access creates too large an attack surface.
Not in scope until the tool layer has demonstrated reliability over months.

**Browser automation** — clicking, form-filling, and navigation introduce unpredictable side effects.
Reference architecture only for now.

**Reminder delete** — creation is fine. Deletion is irreversible from the user's perspective.

**Any financial action** — the finance domain is read/write to local SQLite only.
No connection to external financial systems in any form.

**Arbitrary API calls** — the web.search tool is the only outbound call allowed in v1.
No model-proposed `fetch()` to arbitrary URLs.

### Why this restraint matters

The tool layer earns trust incrementally. Starting with two read-heavy tools
(search + file read) and one write-with-confirmation (file write) proves:
- the permission model works
- the logging is reliable
- the confirmation UX is non-annoying
- the model proposes sensible actions

Only after that foundation is stable should higher-tier tools be considered.

---

## Implementation Order (when ready)

1. `tool_calls` table migration in a new `toolDB.ts` (or appended to financeDB pattern)
2. Tool executor service: `services/toolExecutor.ts`
   - allowlist check
   - params validation
   - sandbox enforcement
   - logging
3. Confirmation UI: modal in index.tsx, triggered by tool proposal in AI response
4. `web.search` implementation (tier 0)
5. `file.read` implementation (tier 0)
6. `file.write` implementation (tier 1, confirmation required)
7. Integration with aiRouter: model response parsed for tool proposals

Do not implement until the finance proof loop has run for at least 2 weeks.
The tool layer depends on the logging infrastructure being trusted.

---

Last updated: 2026-05-25
