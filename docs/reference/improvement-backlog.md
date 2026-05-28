# Improvement Backlog

Items approved for future implementation. Each item originates from an improvement-review session and is approved by Pete before being added here.

Prioritization formula: Value ÷ Complexity ÷ Risk (higher = do sooner)

---

## Status keys

- `approved` — reviewed, approved, not yet started
- `in_progress` — actively being implemented
- `done` — implemented and verified
- `deferred` — valid idea, not the right time
- `rejected` — considered and declined (keep for audit trail)

---

## Backlog

| # | Item | Status | Value | Risk | Source | Notes |
|---|------|--------|-------|------|--------|-------|
| 1 | Fix hardcoded "phi4-mini" label in buildRuntimeContext() | approved | High | Low | improvement-review 2026-05-28 | Model switching exists since 6f3b93a; label is factually wrong for hermes3/llama3.1 |
| 2 | Remove stale "Known gaps" section from runtime-contract.md | approved | Medium | Low | improvement-review 2026-05-28 | All 3 gaps resolved in 0d58f2b; section creates false impression of outstanding debt |
| 3 | Fix Section 3 question numbering in model-contract-test.md | approved | Medium | Low | improvement-review 2026-05-28 | Questions labeled Q2.1–Q2.4 in Section 3 — copy-paste error from renumber |
| 4 | Run Claude (Model A) Section 1 baseline | approved | High | None | improvement-review 2026-05-28 | Cloud column entirely blank; contract has no evidence for cloud route |

---

## Completed

| # | Item | Completed | Commit |
|---|------|-----------|--------|
| — | — | — | — |

---

## Rejected / Deferred

| # | Item | Decision | Reason |
|---|------|----------|--------|
| 1 | Self-improvement skill (AI rewrites own prompts/skills without review) | rejected | Removes proposal/action boundary. Loses audit trail. Revisit only after Hermes→Claude→Pete pipeline is well-established. |
