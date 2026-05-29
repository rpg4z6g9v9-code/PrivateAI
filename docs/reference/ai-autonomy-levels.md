# AI Autonomy Levels

Version: 1.0 (2026-05-28)

Defines what AI agents may do in PrivateAI and under what conditions.
Use this document to evaluate any proposed AI action before approving it.

**Core principle: the boundary isn't the domain, it's the consequence of being wrong.**

- Low consequence if wrong → Level 3 or below, no approval needed
- Real consequence if wrong → Level 4, requires approval gate
- High consequence and autonomous → Level 5, rejected

---

## Levels

### Level 0 — Advisory
AI explains. Human acts.
- AI describes what to do, what to tap, what to change
- No app interaction of any kind
- Always permitted

### Level 1 — Guided
AI suggests steps. Human approves and executes.
- AI produces step-by-step instructions
- Human confirms before each action
- Always permitted

### Level 2 — Assisted
AI reads app state and logs. No actions.
- AI reviews screenshots, logs, status panels
- AI interprets results and reports findings
- No writes, no settings changes, no sends
- Always permitted

### Level 3 — Testing
AI interacts with app in QA/test contexts. No production actions.
- AI may simulate taps, navigation, typing in test/dev environments
- AI may run automated checks, invariant checks, smoke tests
- Applies to Claude Code and test tooling only — not runtime AI
- Permitted in development context. Not permitted in production without explicit approval.

### Level 4 — Approved Automation
AI executes predefined app actions. Requires permission gate.
- AI may perform specific actions that have been explicitly approved
- Each action type must be approved individually — blanket approval is not valid
- Every action must be logged in toolDB with provenance
- User approval policy must be defined before any Level 4 action is implemented
- Status: **not yet implemented** — requires explicit proposal and approval before use

### Level 5 — Autonomous
AI initiates actions independently without user prompt.
- Status: **REJECTED**
- Reason: insufficient auditability and control. AI may propose; AI may not self-initiate.
- Revisit only after Level 4 is proven stable with full audit trail.

---

## Approval Boundary

### Allowed without approval
- Read logs, docs, test results, status panels
- Run tests, invariant checks, smoke checks
- Generate reports, summaries, recommendations
- Read app state (model selected, route, web search status)

### Requires explicit approval (per action, per session)
- Change app settings
- Send messages or queries on behalf of user
- Delete or archive data
- Modify records or conversation history
- Export data to external destination

### Not permitted under any circumstances
- Financial transactions or account access
- Camera, microphone, or location access outside declared app features
- Account recovery or credential changes
- Security configuration changes
- Access to other apps or system resources outside PrivateAI sandbox

---

## Decision rule

When an AI agent proposes an action, check the level:

```
Level 0–2   → permitted, no approval needed
Level 3     → permitted in dev/QA, confirm context first
Level 4     → stop, define permission gate and audit log, get approval
Level 5     → reject
```

If the action does not fit cleanly into a level, treat it as Level 4 until classified.

---

## External Data Access Boundary

Governs any external system that reads or provides data to the project (Perplexity, Google Drive, web search, MCP tools, documentation systems, external APIs).

**Core rule: external systems may inform decisions. They may not become the source of truth.**

### Allowed — read and inform
- Research and reference lookups (Perplexity, web search)
- Public documentation and external reference material
- Summarizing or synthesizing external findings
- Proposing next steps based on external research

### Not allowed — write or replace
- Modifying project files, docs, or records
- Overwriting or syncing into docs/reference/
- Changing git history or approved contracts
- Auto-publishing or sharing private project content
- Becoming the canonical record for any project decision

### Source of truth — always local
- Filesystem and git history
- docs/reference/ contracts and architecture docs
- Approved project records

### Role assignment (current tools)
| Tool | Read external | Write local | Authority |
|------|--------------|-------------|-----------|
| Claude Code | yes | yes | executes approved changes |
| Hermes | yes | propose only | drafts, never commits |
| Perplexity / web search | yes | no | informs only |
| Google Drive / MCP tools | yes | no (without explicit approval) | informs only |
| Pete | yes | yes | final authority |

**Why this matters:** Research ≠ authority. An external tool may know more about the outside world. Your filesystem, git history, and contracts know more about your system. Keep those two domains separate and the system stays auditable.

---

## Relationship to other contracts

- Proposal/action boundary: AI proposes → deterministic executor acts → every action logged
- toolDB: all Level 4 actions must be logged here with provenance
- securityGateway: injection check applies to all AI-generated action content before execution
- runtime-contract.md: capability disclosure rules apply at all levels
