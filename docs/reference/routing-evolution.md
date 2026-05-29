# Routing Evolution

Version: 1.0 (2026-05-29)
Status: Document only — not yet implemented beyond Axis 1.

This document captures the long-term routing architecture for PrivateAI.
It exists to prevent repeated re-discussion and to establish a gate condition
before any automatic routing behavior is built.

---

## Current State — Axis 1: Local vs Cloud

**Implemented: Yes** (aiRouter.ts, stable-websearch-gateway-v2.1)

```
User sends message
↓
checkPrivateNode()
↓
Local first (Ollama / Mac Mini)
↓
Cloud fallback (Claude API) if local unavailable or sensitive-data rule
```

Decision factors today:
- Node online / offline
- Data sensitivity (medical, financial, PII → local only)
- Injection detected (safe mode → local only)

This axis is stable. It will not change without a formal proposal.

---

## Future State — Axis 2: Task Type

**Implemented: No**
**Gate: Recommendation mode must exist and be validated before this is built.**

Axis 2 adds task classification to the routing decision. Instead of only asking
"local or cloud?", the router also asks "what kind of task is this?"

### Task type examples

| Task type | Characteristics | Natural route |
|-----------|----------------|---------------|
| Simple factual question | Short, well-defined answer | Local (Hermes / phi4-mini) |
| Research / freshness | Requires current information | Web search (Perplexity) |
| Memory search | Find something said before | Local embeddings (nomic-embed-text) |
| Code review / architecture | Requires high reasoning quality | Cloud (Claude) |
| Content creation | Script, copy, draft | Local (Hermes) or Cloud |
| Complex multi-step reasoning | Long context, nuanced | Cloud (Claude) |

These are illustrative. Actual categories will be validated against real usage
before being used to route automatically.

---

## Recommendation Mode

**Implemented: No**
**This is the required first step before any auto-routing.**

Before the system routes automatically, it should display its recommendation
and reasoning to the user. The user still decides.

```
User types message
↓
Classifier suggests:

  Recommended: Hermes
  Reason: Simple factual question. Local quality sufficient.
  Estimated cost: $0

↓
User confirms or overrides
↓
Message sends
```

Purpose of recommendation mode:
1. Builds a logged record of what the system would have chosen
2. Allows Pete to evaluate whether the recommendations are good
3. Creates the evidence base required before enabling auto-routing
4. Preserves full user control during the validation period

---

## Auto-Routing Gate

Auto-routing (system chooses model without user confirmation) is not enabled
until ALL of the following are true:

1. **Recommendation mode exists** — system can generate a recommendation and reason
2. **Recommendations are logged** — every recommendation is recorded with the question type, model suggested, and user decision
3. **Recommendations are measured** — accuracy rate tracked over real sessions (not simulated)
4. **Accuracy is demonstrated** — improvement-review confirms the classifier makes good choices in practice
5. **Pete explicitly approves** — auto-routing is activated by a deliberate decision, not by default

Passing items 1–4 is evidence. Item 5 is the gate.

**Rationale:** "Looks smart" is not evidence. Routing changes AI behavior on every message.
That makes it a high-frequency decision with compounding effect. The bar for autonomous
routing must be higher than for individual feature flags.

---

## Long-Term Vision

```
User: "Help me."
↓
PrivateAI Router
↓
Task classified
↓
Best tool / model / data source selected
↓
Result returned

Rules respected:
- runtime-contract.md (capability disclosure)
- ai-autonomy-levels.md (consequence-based authority)
- External data access boundary (read informs, never overwrites)
```

The user should not have to think: "Should I use Hermes? Claude? Perplexity?"
The system handles selection. The user handles approval for consequential actions.

Routing decision ≠ autonomous action.

Choosing a model is low-consequence. Sending, publishing, or modifying data is not.
Those remain gated regardless of how sophisticated the router becomes.

---

## What Is Not Changing

These boundaries apply at every routing tier, now and in the future:

- Sensitive data never routes to cloud (enforced in aiRouter.ts)
- External systems inform decisions; they do not become the source of truth
- All Level 4+ actions require explicit per-action approval
- The router may recommend. Pete decides when to trust it autonomously.

---

## Implementation Prerequisites

Before any Axis 2 work begins:

1. Semantic search (nomic-embed-text) — memory search route requires it
2. Stable Hermes integration — local task routing requires a validated local model
3. Improvement-review baseline — need existing session data to validate classifier
4. Recommendation mode UI — must exist and be used before auto-routing is considered

None of these are blocking today's work. They are listed so the sequence is clear.

---

## Document history

| Date | Change |
|------|--------|
| 2026-05-29 | Initial version — architecture documented, no implementation |
