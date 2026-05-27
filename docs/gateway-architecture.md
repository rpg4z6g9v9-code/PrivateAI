# PrivateAI Gateway Architecture

**Status:** Design reference — not yet fully implemented.
**Date:** 2026-05-26
**Inspired by:** OpenClaw gateway pattern (used as outside validation, not integrated)

---

## Core Concept

PrivateAI is a gateway: one runtime that knows what channels, tools, models, and permissions exist,
and enforces the rules about what can happen.

The gateway owns:
- routing decisions
- capability state
- permission enforcement
- action logging

The gateway does not own:
- conversation content (SQLite, immutable)
- user data (encrypted vault)

---

## 1. Runtime State

What the gateway knows at any moment:

| State | Source | Current |
|---|---|---|
| route | aiRouter.ts | local / cloud |
| active model | aiRouter.ts | phi4-mini / claude-sonnet |
| node health | localAI.ts checkPrivateNode() | online / offline |
| web.search status | webSearch.ts _sessionStatus | unavailable / configured / operational / degraded / auth_failed |
| safe mode | securityGateway.ts | on / off |

All runtime state is readable from the System panel.

---

## 2. Channels

Where input enters the gateway.

| Channel | Status | Notes |
|---|---|---|
| iOS chat UI | active | primary surface |
| Voice input | active | microphone, auto-stop on silence |
| Image input | active | photo attachment |
| Email | not yet | future — read-only first |
| SMS | not yet | future |
| Web dashboard | not yet | future |

Rule: new channels require the same logging and permission model as existing ones before activation.

---

## 3. Capabilities

What the gateway can do on behalf of the user.

### Active
| Capability | Type | Tier | Status |
|---|---|---|---|
| web.search | read-only | 0 (auto) | operational |
| image input | read-only | 0 (auto) | operational |
| voice input | read-only | 0 (auto) | operational |
| conversation memory | read-only | 0 (auto) | operational |

### Not yet implemented (ordered by readiness)
| Capability | Type | Tier | Blocker |
|---|---|---|---|
| file.read | read-only | 0 (sandboxed) | next — after stress-test |
| finance.query | read-only | 0 (auto) | after file.read |
| memory.retrieve | read-only | 0 (auto) | after finance.query |
| file.write | write | 1 (confirm) | after read-only proven |
| calendar.read | read-only | 1 (confirm) | permission model needed |

### Permanently restricted
| Capability | Reason |
|---|---|
| shell execution | destructive, unscoped |
| email send | write to external system |
| browser automation | unscoped external surface |
| GitHub write | destructive |
| arbitrary URL fetch | SSRF risk |
| multi-step autonomous chains | no interrupt model yet |

---

## 4. Permission Tiers

```
Tier 0 — auto-approved, read-only
  web.search, file.read (sandboxed), memory.retrieve

Tier 1 — user confirmation required before execution
  file.write, calendar modifications, any write action

Tier 2 — disabled by default, requires explicit opt-in per session
  external messaging, form submission

Tier 3 — permanently denied
  shell exec, destructive deletes, credential access, browser automation
```

Principle: **read-only first. write actions later. destructive actions last or never.**

Confirmation is a UI gate enforced by the gateway — not a prompt instruction to the model.
The model proposes. The gateway decides.

---

## 5. Logs

Every capability execution produces an append-only record.

| Field | Purpose |
|---|---|
| id | unique call ID |
| tool_name | which capability |
| input_summary | what was requested (no secrets) |
| status | running → completed / failed |
| duration_ms | latency |
| result_summary | outcome (sanitized) |
| conversation_id | provenance link |
| model | which model triggered it |
| route | local or cloud |

Rules:
- append-only (no updates, no deletes)
- visible in System panel → operations
- failure classification preserved (degraded vs auth_failed vs unavailable)
- no API keys, secrets, or PII in logs

---

## 6. Progression Sequence

The order capabilities should be added — each depends on the one before being stable:

```
web.search (done)
→ stress-test + degrade/recover cycle (current)
→ file.read sandboxed
→ finance.query
→ memory.retrieve
→ file.write with confirmation gate
→ calendar.read
→ (multi-channel channels if needed)
→ write actions — only after permission model proven
```

Do not skip steps. Visibility and logging must precede every new capability.

---

## OpenClaw Reference

OpenClaw validates this architecture pattern from outside.

What PrivateAI takes from it: the **gateway concept** — one runtime owning channel/tool/permission routing.

What PrivateAI does not copy: autonomous email, calendar writes, shell execution, multi-step chains, n8n automation. Those require a fully proven permission and interrupt model first.

PrivateAI's advantage: trust architecture is being built before capability surface is expanded.
