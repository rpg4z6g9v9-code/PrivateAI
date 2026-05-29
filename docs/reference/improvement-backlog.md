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
| 5 | Capability Disclosure v2 — information vs operational distinction | deferred | Medium | Low | Drift #004, 2026-05-28 | Do not implement until Claude + phi4-mini tested for same pattern; if cross-model → contract rule; if Hermes-only → prompt tuning |
| 6 | PrivateAI Creator Mode — local video pipeline | deferred | High | Medium | 2026-05-28 | Hermes→script / local TTS→voice / ffmpeg→assembly / captions / user approves publish. Gate: Hermes must first produce a script Pete would actually publish. Pipeline is Level 3 creation + Level 4 publish. |
| 7 | Mac Mini music generation — local audio pipeline | deferred | High | Low | 2026-05-28 | Hermes→lyrics/concept / Mac Mini→music generation+mastering / user approves. Slots into video pipeline (item #6). "Generate once, use many times" — one theme amortized across all videos/demos. Gate: item #6 pipeline proven first. |
| 8 | Improve local cold-start handling | approved | Medium | Low | 2026-05-28 | ollama ps empty → first request fails → cloud fallback. Node health check (/api/tags) passes even when no model is loaded. Options: (a) warm the selected model on node-online detection, (b) distinguish "node online" from "model ready", (c) retry once before fallback. Investigate after warm-test confirms cold-start is root cause. |

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
