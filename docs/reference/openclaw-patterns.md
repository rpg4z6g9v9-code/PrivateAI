# OpenClaw — Reference Architecture Analysis

**Purpose:** Extract patterns PrivateAI can borrow. Do not install or integrate OpenClaw.
**Date:** 2026-05-26
**Status:** Reference only — no integration planned

---

## 1. What OpenClaw Is

OpenClaw is a self-hosted personal AI agent framework built around a **gateway-first** design.
Its core insight: a personal AI agent is fundamentally a gateway problem, not a model problem.

### Architecture layers

```
Gateway        — WebSocket server, session management, authentication, routing
Integration    — channel adapters (WhatsApp, iMessage, Slack, web UI, CLI, macOS app)
Execution      — tool runner, policy enforcement, sandbox isolation
Intelligence   — model call, context assembly, memory, skill dispatch
```

The gateway is a long-lived Node.js daemon. Every input from any channel enters through it.
The model never touches channels directly — the gateway normalizes everything first.

### Skill system

Skills are declarative capability modules with three parts:
1. **YAML manifest** — name, version, trigger phrases, required tools, required permissions
2. **Instruction block** — Markdown directives telling the agent how to use the skill
3. **Supporting resources** — optional scripts (Python/Bash/Node), config, API glue

Skills declare what they need. The runtime decides what they get.

### Tool permission model

Policy is enforced **before the model call**.
If a tool is not in the allowed list for the current session, channel, and agent — its schema is
never sent to the model. The model cannot hallucinate tools it cannot see.

Enforcement layers (in order, all must pass):
1. Global config
2. Per-agent config
3. Channel policy
4. Provider restrictions (some tools only available with certain models)
5. Sandbox rules
6. Plugin availability

### Logging

Each session writes to `~/.openclaw/workspace/[job]/logs/`:
- User message
- System prompt
- Model response
- Tool calls made
- Tool results

Append-only. Structured per turn. Failure states preserved.

### "Soul" configuration

`SOUL.md` defines the agent's personality, memory, and behavioral rules.
`AGENTS.md` defines which agent handles which channel.

Both are loaded at gateway startup and injected into every context.
This is prompt-level identity, not enforcement — a distinction PrivateAI should not copy for security gates.

---

## 2. What Maps Cleanly to PrivateAI

| OpenClaw pattern | PrivateAI equivalent | Status |
|---|---|---|
| Gateway owns routing, tools, permissions | `aiRouter.ts` + permission tier model | Done |
| Tool policy enforced before model call | Pre-send execution in `index.tsx`, toolContext injection | Done |
| Append-only tool call log | `toolDB.ts` (`privateai_tools_v1.db`) | Done |
| Runtime grounding / capability declaration | `buildRuntimeContext()` in `aiRouter.ts` | Done |
| System visibility panel | `system.tsx` | Done |
| Failure classification (degraded vs auth_failed) | `WebSearchStatus` state model | Done |
| Skill as declarative module with explicit permissions | Future tool layer design in `docs/privateai-tool-layer.md` | Designed, not yet built |
| Per-tool schema exposure controlled by gateway | Tools run client-side; model only sees results | Done (stronger than OpenClaw) |

PrivateAI is already ahead in one area: the model never receives tool schemas at all.
It receives results via `toolContext`. OpenClaw still sends schemas to the model and relies on
policy to suppress execution — PrivateAI's approach removes the surface entirely.

---

## 3. What Should Not Be Copied Yet

| OpenClaw capability | Why not yet |
|---|---|
| Multi-channel input (WhatsApp, iMessage, Slack) | Each channel expands trust boundary; permission model must be proven first |
| Browser automation | Unscoped external surface, no interrupt model |
| Shell / terminal execution | Destructive; Tier 3 permanently denied in PrivateAI |
| Docker sandbox per session | Overkill for current phase; useful if multi-user or untrusted channels added |
| Multi-step autonomous workflow chaining | No interrupt model; cannot confirm mid-chain |
| Write actions (file, email, calendar) | Tier 1+ — not before read-only layer is proven |
| "Soul" as security gate | Prompt-level rules are not enforcement; gates must be code-level |
| Skill marketplace / external skill install | Supply chain risk; no vetting model exists yet |

---

## 4. Safe Future Integration Path

```
Current (now):
  Reference audit only — this document

Next (after stable-websearch-gateway-v1 stress tests pass):
  file.read — sandboxed, Tier 0, same toolContext pattern

After file.read is stable:
  finance.query — read-only SQL, already designed
  memory.retrieve — read-only

After read-only layer proven (all tools stable, logs trusted):
  Evaluate skill manifest format — adopt YAML declaration for PrivateAI tools
  file.write — Tier 1, confirmation gate in UI (not prompt)

After write-capable tools proven:
  Evaluate channel abstraction — second input channel only after permission model is solid
  Consider session isolation model if multi-user scenario appears

OpenClaw integration (if ever):
  Plugin only, not core — connect a single read-only skill
  Never connect write-capable skills before PrivateAI's own write layer is proven
  Never connect shell, browser, or external messaging
```

---

## 5. Risks and Permission Boundaries

### Documented OpenClaw vulnerabilities (from security research)

| Vulnerability | Layer | Implication for PrivateAI |
|---|---|---|
| Shared session scope leaks env vars and API keys across users | Gateway | Not a risk (single-user, no DM/group surface) — but never expose a socket to LAN without auth |
| Command injection via channel input | Execution | PrivateAI has no shell tool — permanently denied |
| SSRF via tool URLs | Execution | PrivateAI prohibits arbitrary URL fetch — enforced in tool design |
| Path traversal enabling local file reads | Execution | file.read must be sandboxed to app Documents dir only — no relative path traversal |
| Prompt-injection-driven code execution | Agent/prompt | securityGateway.ts + fuzzer (109 payloads) — monitor as tools expand |
| Identity mutability at channel input interface | Channel | Single channel (iOS UI) — not exposed; still validate all input at boundary |
| Lexical parsing failures in exec policy engine | Execution | PrivateAI uses intent detection + explicit executor — no LLM-controlled policy parsing |
| Cross-layer exploitation chains | All | Consequence of tool expansion — each new tool adds a new attack surface |

### PrivateAI-specific risks to monitor as tool layer grows

1. **toolContext injection**: web search results injected into system prompt — run through `securityGateway.ts` before injection
2. **Intent detection false positives**: ambiguous queries triggering unintended tool calls — tune `detectSearchQuery()` thresholds
3. **Credential exposure in logs**: `toolDB` must never log API keys or raw query responses containing PII
4. **Scope creep in file.read**: sandbox boundary must be enforced in the executor, not the prompt

### Non-negotiable boundaries (permanent)

```
Shell execution          — permanently denied, no exception
Email / SMS send         — permanently denied until explicit write model exists
Browser automation       — permanently denied
Arbitrary URL fetch      — permanently denied (SSRF)
External skill install   — permanently denied until vetting model exists
Multi-user session share — not applicable; enforce if surface ever expands
```

---

## Sources

- [OpenClaw Architecture, Explained](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [OpenClaw AI Agent Framework: What It Is, How It Works](https://dextralabs.com/blog/openclaw-ai-agent-frameworks/)
- [How OpenClaw Works: Understanding AI Agents Through a Real Architecture](https://bibek-poudel.medium.com/how-openclaw-works-understanding-ai-agents-through-a-real-architecture-5d59cc7a4764)
- [Lessons from OpenClaw's Architecture for Agent Builders](https://blog.agentailor.com/posts/openclaw-architecture-lessons-for-agent-builders)
- [OpenClaw Security — docs.openclaw.ai](https://docs.openclaw.ai/gateway/security)
- [A Systematic Taxonomy of Security Vulnerabilities in OpenClaw](https://arxiv.org/abs/2603.27517)
- [OpenClaw security issues include data leakage & prompt injection — Giskard](https://www.giskard.ai/knowledge/openclaw-security-vulnerabilities-include-data-leakage-and-prompt-injection-risks)
- [Defensible Design for OpenClaw](https://arxiv.org/html/2603.13151v1)
- [Complete Guide for OpenClaw Custom Skill Development](https://www.growexx.com/blog/openclaw-custom-skill-development-complete-guide/)
- [OpenClaw Logging and Debugging](https://sfailabs.com/guides/openclaw-logging-debugging)
