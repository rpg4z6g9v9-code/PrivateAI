# Skill Registry

All tools, skills, agents, and workflows in PrivateAI must be registered here.
Nothing becomes permanent without visibility and review.

---

## Lifecycle

```
Draft → Review → Approved → Used → Measured → Keep or Remove
```

- **Draft** — proposed but not yet reviewed
- **Review** — under evaluation (Claude + Pete)
- **Approved** — cleared for use, not yet proven
- **Active** — used and producing value
- **Trial** — approved but not yet used enough to confirm value
- **Archived** — removed from active use, kept for reference
- **Deleted** — removed entirely

Hermes may propose new skills. Proposed skills enter at `draft` status only.
A skill does not become `active` until it has been used and confirmed valuable.

---

## Expiration rule

| Unused duration | Action |
|-----------------|--------|
| 30 days | Review — confirm still needed |
| 60 days | Archive — move to Archived section below |
| 90 days | Delete — remove from repo |

Review before any deletion. Not automatic.

---

## Registry

| Skill | Type | Created | Last Used | Owner | Status | Purpose |
|-------|------|---------|-----------|-------|--------|---------|
| verify | agent | 2026-05 | 2026-05-28 | Claude | active | Post-change structured review before commit |
| security-audit | agent | 2026-05 | 2026-05-28 | Claude | active | Security review of diffs and new capabilities |
| debug | agent | 2026-05 | — | Claude | trial | Structured debugging protocol |
| test-gen | agent | 2026-05 | — | Claude | trial | Generate test cases from source |
| invariant-check | agent | 2026-05 | 2026-05-28 | Claude | active | Deep architectural invariant verification |
| refactor | agent | 2026-05 | — | Claude | trial | Scoped refactor with blast-radius check |
| privateai-smoke | agent | 2026-05 | 2026-05-28 | Claude | active | Fast post-change smoke check (8 invariants) |
| improvement-review | agent | 2026-05-28 | never | Hermes/Claude | trial | Weekly read-only review; produces recommendations only |

---

## Ownership

- **Claude** — agent/skill author and maintainer
- **Hermes** — may propose; cannot own active skills until pipeline is established
- **Pete** — final approval on all status changes

---

## Archived

| Skill | Archived | Reason |
|-------|----------|--------|
| — | — | — |

---

## Rejected / Never Built

| Skill | Decision | Reason |
|-------|----------|--------|
| self-improvement | rejected | AI rewrites own prompts without review — removes proposal/action boundary and audit trail |

---

## Rule

> No tool, skill, agent, or workflow may become permanent without visibility and review.

Every registered item must have:
- a visible entry in this registry
- an owner
- a stated purpose
- a last-used date (updated on use)
- justification for continued existence after 30 days of non-use

Dead skills become maintenance debt. Archive aggressively.
