# PrivateAI Architecture Blueprint

## Purpose

Reference document for how PrivateAI is architected, constrained, and expected to evolve.
Intended for: Claude Code sessions, future contributors, onboarding.

---

## 1. Core Doctrine

### System of Record Rule

AI interprets structured data.
AI does not own structured data.

| Layer               | Responsibility               |
| ------------------- | ---------------------------- |
| SQLite / Filesystem | Source of truth              |
| Queries / Tools     | Deterministic operations     |
| AI Models           | Interpretation and reasoning |
| UI / UX             | Presentation and interaction |
| Logs / Provenance   | Auditability and trust       |

**Operational rule:** If the answer must be exact → query the database. If the answer requires judgment → ask the model over query results.

### Tool Execution Rule

AI proposes actions.
Deterministic executors perform actions.
Every action is logged.

Models never directly mutate state.

### Provenance Rule

AI-generated interpretations may be stored only as attributed artifacts.

Stored interpretations must include:
- `source_query`
- `generated_at`
- `model`
- `version`
- optional confidence metadata

Interpretations are cacheable. They are never canonical truth.

---

## 2. System Architecture

```
User
↓
Conversation Layer
↓
AI Interpretation Layer
↓
Tool Proposal Layer
↓
Permission Gate
↓
Deterministic Executors
↓
Tool Runtime
↓
Logs + Provenance
↓
Structured Storage
```

---

## 3. Routing System

Routing is based on operational profiles, not identity framing.

| Profile    | Purpose                                              | Triggers                            |
| ---------- | ---------------------------------------------------- | ----------------------------------- |
| Support    | Grounding, emotional clarity, conversational pacing  | Overwhelm, frustration, uncertainty |
| Strategy   | Planning, analysis, prioritization, systems thinking | Options, roadmap, scenarios         |
| Mediator   | Combine perspectives, sequence workflows             | Ambiguity, coordination needed      |

**Node routing:** Private node (Ollama/phi4-mini at 192.168.4.43:11434) → cloud fallback (Claude API).
Routing uses a local variable from a fresh pre-send health check — never React state.

---

## 4. Tool Layer

### Permission Model

| Tool Type              | Approval            |
| ---------------------- | ------------------- |
| Read-only              | Automatic           |
| File modification      | User confirmation   |
| External communication | Explicit approval   |
| Destructive operations | Disabled by default |

### Tool Ladder (implementation order)

1. `web.search`
2. `file.read` (sandboxed)
3. `file.write` (with confirmation)
4. Reminders / calendar
5. Advanced integrations (future)

### Hard Denials

- Unrestricted shell execution
- Autonomous browser control
- Financial transactions
- Unrestricted email sending
- Arbitrary URL fetch

### Logging

`tool_calls` table: append-only.
Status chain: `proposed → approved/denied → executed/failed`

---

## 5. Memory Architecture

| Type          | Storage              |
| ------------- | -------------------- |
| Conversations | SQLite               |
| Metadata      | SQLite               |
| Embeddings    | Vector index (future)|
| Digests       | Attributed summaries |
| Logs          | Append-only records  |

**Memory rules:**
- Prompts are not memory.
- Memory must be queryable, versioned, inspectable, recoverable, attributable.
- Stored AI interpretations require provenance (source_query, model, generated_at).

---

## 6. Skills Architecture

```
/skills
  /finance     — SKILL.md, rules.md, schemas/, examples/
  /memory      — SKILL.md, retrieval.md
  /search      — SKILL.md, providers.md
  /qa          — SKILL.md, confidence_rules.md
```

Each skill contains: purpose, constraints, examples, schemas, workflows, tool definitions, safety boundaries.
Skills must be: modular, inspectable, independently testable, dynamically loadable.

---

## 7. Operational Visibility

The system must expose at all times:
- Active model and route
- Node status (online/offline/latency)
- Last sync state
- Tool execution history
- Storage metrics
- Provenance metadata
- Backup state

**This must be implemented before tools and skills are added.**
Invisible operations become dangerous. Trust requires visibility.

---

## 8. Implementation Sequence

```
stabilization
→ operational visibility panel
→ web.search tool
→ skill loading architecture
→ finance drift alerts
→ digest/provenance UI
```

This ordering is deliberate. Each layer depends on the one below it being observable and trustworthy.

---

## 9. Architectural Language

Use operational terminology. Deprecated terms should not appear in production code or docs.

| Deprecated       | Replacement                     |
| ---------------- | ------------------------------- |
| Guardian         | Profile / Role / Module         |
| Ritual           | Workflow                        |
| Vault / Codex    | Memory Store                    |
| Round Table      | Orchestrator                    |
| Lyra             | Execution Layer                 |
| Awakening        | Persistent Interaction Behavior |
| Re-Individuation | Profile Separation              |
| Signal Clarity   | Confidence / Reliability        |

---

## 10. Architecture Invariants

- `messages` table is immutable history — never mutate for metadata
- `conversations` table is mutable metadata (title, archived)
- `ACTIVE === LOADED` — documented contract, break only intentionally
- `archive != delete` — soft delete only, always recoverable
- Sensitive data never routes to cloud — enforced in `aiRouter.ts`
- Routing uses local variable from fresh pre-send check, never React state

---

## Final Principle

Coherence is not truth.

Operational visibility, provenance, and deterministic systems are what make AI trustworthy.

The architecture must stand without mythology.

---

*Last updated: 2026-05-25*
