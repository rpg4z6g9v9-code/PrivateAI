# M5 Shadow Mode Candidate Resolution — Final Validation Report

**Date:** 2026-10-06
**Status:** IMPLEMENTATION COMPLETE / READY FOR STAGING GATE
**Scope:** Shadow-only observation; zero authorization/enforcement

---

## Executive Summary

M5 implements **non-executing candidate resolution** for reasoning and retrieval capabilities. The system generates `ShadowResolution` records *before* execution and `ShadowComparisonPayload` records *after* execution, maintaining an append-only durable log in SQLite.

M5 is **purely observational**: shadow results have **zero effect** on routing, capability selection, or authorization decisions. Existing M2 containment gates (`gateSearch`, `gateReasoning`) remain the authoritative enforcement layer.

---

## Final Test Coverage

| Layer | Suite | Count | Status |
|-------|-------|-------|--------|
| M5 | Shadow Mode Candidate Resolution | **195** | ✓ PASS |
| M4 | Capability Registry & Discovery | **106** | ✓ PASS |
| M3 | Recorder Durable Log | **30** | ✓ PASS |
| M2 | Classification & Containment | **62** | ✓ PASS (↑5) |
| M1 | Boundary Resolution | **73** | ✓ PASS |
| M0 | Core Scaffolding | **71** | ✓ PASS |
| **TOTAL** | | **537** | ✓ PASS |

---

## Five Key M5 Corrections

### 1. L6: Request ID Mint at User-Action Boundary
**Files:** `app/(tabs)/index.tsx`, `services/sendOrchestration.ts`

Same `requestId` threads through all downstream capabilities (semantic embedding → reasoning).

**Proof:** Integration A + Direct Capability Caller Audit (12/12 paths)

### 2. L2: M2 Data-Classes Exact (No Manual Reconstruction)
**Files:** `services/embeddingService.ts`, `services/readOnlyTools.ts`, `services/sendOrchestration.ts`

`PayloadClassification.unionClasses` passed directly (not rebuilt via `classifyData`).

**Proof:** Integration B + Production-backed data-classes equality tests

### 3. L1: Shadow Resolution Awaited Before Execution
**Files:** `services/aiRouter.ts`, `services/embeddingService.ts`, `services/readOnlyTools.ts`, `services/tools/webSearch.ts`

All `resolveAndRecordShadow` calls awaited (not fire-and-forget).

**Proof:** L1 tests + Integration D (record visible before next call)

### 4. M4: Canonical Provider IDs via Registry Lookup
**File:** `services/readOnlyTools.ts`

Replaced ad-hoc `gateway_tool_resolver:${capId}` with `lookupProvidersByCapability(capId)[0]?.id`.

**Proof:** Integration C+F (9 providers registered + correctly derived)

### 5. L4: Comparison Recording Observable Status
**File:** `services/controlPlane/candidateResolution.ts`

`recordShadowComparison` returns `'recorded'|'degraded'` (not `Promise<void>`).

**Proof:** Comparison Recording Status tests + Production-backed normal-chat test (5 records)

---

## Zero-Brave Closure: Protected Diagnostic Search

**Issue:** System diagnostic search lacked M2 gateSearch gate → M2 containment gap.

**Fix (system.tsx):** Added gateSearch before webSearch:
```typescript
if (searchGate.action === 'block_search') {
  setSearchError(searchGate.reason);
  return;  // ← ZERO Brave egress
}
```

**M2 Regression (5 new tests):**
- Protected query blocks ✓
- Sensitive query blocks ✓
- Public query allows ✓
- ZERO Brave on block ✓
- Structural verification ✓

**M2: 57 → 62 tests**

---

## Production-Backed Normal-Chat Orchestration

**Setup:** Actual production modules with mocked HTTP/storage.

**Verifies:**
1. **Single requestId** through all 5 records
2. **Five-record provenance:**
   - user_statement
   - candidate_resolution: retrieval.embed
   - candidate_resolution: reasoning
   - candidate_resolution_comparison: retrieval.embed
   - candidate_resolution_comparison: reasoning
3. **M2 data-classes equality** (semantic ≡ reasoning)

**Result:** PASS ✓

---

## Semantic Search Identity

- Accepts `requestId` + `dataClasses` from caller
- Threads to `embedText`
- Creates `retrieval.embed` resolution with correct requestId + classes
- Protected text skips embedding (M2 containment)

**Proof:** Production-backed Identity: semantic search

---

## Summarize Identity & Classification

- Mints `requestId` at summarize boundary
- Classifies transcript via M2
- Creates `reasoning` resolution + comparison with correct requestId + classes
- Protected transcript refuses reasoning (M2 gateReasoning)

**Proof:** Production-backed Identity: summarize

---

## File Upload Identity

- Mints `uploadRequestId` at action boundary
- Classifies each node via M2
- Protected nodes skip embedding
- Non-protected nodes embedded with correct requestId + classes

**Proof:** Direct Capability Caller Audit (file upload)

---

## Comparison Recording Semantics

- Returns `'recorded'` when Recorder healthy
- Returns `'degraded'` when Recorder unavailable
- Never throws (best-effort `.catch(() => {})`)
- Provider result unchanged regardless of status

**Proof:** Comparison Recording Status tests + Integration E

---

## Append-Only Invariant

- Resolutions: write-once, immutable
- Comparisons: new `record_id` (not resolution_id)
- No updates to existing records
- Ordered per session

**Proof:** L4 tests + structural verification

---

## D5 Normalization: Provider Availability & Boundary

**Status:** Unresolved gateway boundary documented, non-blocking:

- `cloud_reasoning_resolver`: pre-resolved to INTERNET/CLOUD ✓
- `brave_resolver`: resolves via key presence ✓
- Gateway tools: boundary unresolved (no safe probe)

Routing logic unaffected (Rule 1: sensitive→local, Rule 2: safe_mode→local, Rule 3: local-first).

---

## Scope Verification

**M5 Contains:**
- ✓ Shadow resolution + comparison
- ✓ Append-only Recorder
- ✓ M2 gate integration
- ✓ Request ID threading
- ✓ Data-class equality proofs
- ✓ Canonical provider IDs

**M5 Does NOT Contain:**
- ✗ Authorization (ALLOW/DENY/ASK)
- ✗ Policy storage/evaluation
- ✗ Human approval flow
- ✗ M6+ authorization
- ✗ M8 enforcement
- ✗ Verifier/EvidenceEnvelope
- ✗ Cordelia proposal system

**Existing M2 (Preserved):**
- ✓ gateSearch (blocks protected/sensitive search)
- ✓ gateReasoning (blocks protected reasoning)
- ✓ Protected embedding containment

---

## Changed File Inventory

### Runtime (11)
1. app/(tabs)/index.tsx
2. app/(tabs)/system.tsx
3. services/aiRouter.ts
4. services/claude.ts
5. services/controlPlane/identifiers.ts
6. services/controlPlane/semanticContext.ts
7. services/embeddingService.ts
8. services/embeddings.ts
9. services/readOnlyTools.ts
10. services/sendOrchestration.ts
11. services/tools/webSearch.ts

### New Runtime (1)
12. services/controlPlane/candidateResolution.ts

### Tests (2)
13. tests/m0/run.test.mjs
14. tests/m2/run.test.mjs (diagnostic search regression)

### New Test (1)
15. tests/m5/run.test.mjs (195 tests)

### Documentation (1)
16. M5-VALIDATION-REPORT.md

---

## KC-5 Transitional Status

**Confirmed:** Tools execute before authorization (gateReasoning).

**Intentional & documented** as transitional. M6+ will formalize.

**Proof:** sendOrchestration.ts has buildReadOnlyMacToolContext before gateReasoning.

---

## Final Status

### ✓ PASS
- 537/537 tests
- TypeScript: no errors
- git diff: no violations
- L6 + L2 + L1 + M4 + L4: all complete
- requestId threading: verified
- M2 data-classes equality: verified
- Protected/sensitive containment: verified
- Comparison recording: observable
- Append-only: verified
- M2 diagnostic-search regression: added (62/62)
- Production-backed normal-chat: validated

### ✗ OUT OF SCOPE
- Authorization decisions
- Policy evaluation
- M6+ constructs

### ⚠ ARCHITECTURAL LIMITATIONS
- Gateway tool boundaries unknown (no safe probe)
- Live availability unknown in shadow (by design)
- Non-user paths without requestId (future-threadable)

---

## Verdict

**M5 IS READY FOR STAGING GATE**

All requirements met. All tests passing. All boundaries respected. Shadow-only preserved. M2 intact. Diagnostic search regression added. Production-backed proofs validated.

**Ready:** YES

---

Report Generated: 2026-10-06
Status: COMPLETE
Authorization: SHADOW-ONLY
