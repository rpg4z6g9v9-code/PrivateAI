# PrivateAI — Agent Protocols

## What "agents" means here

The Claude Code Agent tool supports three built-in types: `Explore`, `Plan`, and general-purpose.

Custom agents in `.claude/agents/*.md` are **reusable prompt protocols** — structured instructions read and executed manually within the main Claude Code context. They are not callable via the Agent tool by name.

**Invocation pattern:**
1. Read the agent `.md` file
2. Execute the protocol as written against the current codebase

---

## Available protocols

### Global (`~/.claude/agents/`)

| Protocol | When to use |
|---|---|
| `verify` | After any significant patch, before committing |
| `security-audit` | Before any new capability lands (new tool, new route, new external input) |
| `debug` | When logs show errors, builds fail, or runtime crashes occur |
| `test-gen` | After new features, before tagging stable milestones |
| `refactor` | When code has grown duplicated, tightly coupled, or inconsistently structured |
| `invariant-check` | Before landing new capabilities, after major refactors, when architectural drift is suspected |

### Project-specific (`PrivateAI/.claude/agents/`)

| Protocol | When to use |
|---|---|
| `privateai-smoke` | After any routing, send flow, security gateway, or tool layer change |

---

## Pipelines

### Lightweight — small isolated changes

```
Implement → verify → commit
```

### Standard — new features, non-trivial patches

```
Explore → Plan → Implement → verify → privateai-smoke → commit
```

### Security-touching — new tool, new input path, new route, auth change

```
Explore → Plan → Implement → security-audit → verify → privateai-smoke → commit
```

### Critical — routing logic, privacy boundary, architectural contracts

```
Explore → Plan → Implement → invariant-check → security-audit → verify → privateai-smoke → commit
```

---

## When each protocol is mandatory

| Condition | Required protocols |
|---|---|
| Any change to `aiRouter.ts` | `privateai-smoke`, `verify` |
| Any change to `securityGateway.ts` | `security-audit`, `privateai-smoke` |
| Any change to `services/tools/` | `security-audit`, `verify` |
| Any change to send flow in `index.tsx` | `privateai-smoke`, `verify` |
| Any new external input path | `security-audit` |
| Any new capability (tool, API) | `security-audit`, `invariant-check` |
| Before tagging a stable milestone | full pipeline |
| After major refactor | `invariant-check`, `verify` |

---

## Commit-blocking conditions

Do not commit if any of the following are true:

- `npx tsc --noEmit` fails
- `verify` returns FAIL
- `privateai-smoke` returns FAIL on any of its 8 invariants
- `security-audit` returns any CRITICAL or HIGH finding
- `invariant-check` returns VIOLATED or CRITICAL on any invariant
- Sensitive data guard (`if (isSensitive)`) is unreachable or removed
- `streamingMsgIdRef.current = null` is missing from the catch block
- `checkInjection(toolContext)` is missing before any `routeAI` call

---

## privateai-smoke vs invariant-check

**privateai-smoke** — fast post-change runner. Fixed 8-invariant checklist. Run after every significant change.

**invariant-check** — deep architectural review. Source of truth for whether PrivateAI's core contracts hold. Run before landing new capabilities or after major refactors.

Use both when in doubt. Use `privateai-smoke` first for speed.
