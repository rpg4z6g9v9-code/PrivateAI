# M1 Validation Report

## Baseline

| Field | Value |
|-------|-------|
| Starting commit | `83d32f68684571d1e6630a85d85859c3b7f53165` |
| Branch | `feature/cordelia-iphone-gateway` |
| Starting working-tree state | Clean |

## Test command

```bash
node --experimental-transform-types --no-warnings \
     --import ./tests/m0/register.mjs \
     --test tests/m1/run.test.mjs
```

## Files added

```
services/controlPlane/types.ts        Schema types (337 lines)
services/controlPlane/validators.ts   Runtime validators (602 lines)
tests/m1/run.test.mjs                M1 test harness (73 tests)
M1-VALIDATION-REPORT.md              This file
```

## Production files changed

**None.** Schema layer is entirely new and unused by production runtime.

## Pre-commit corrections applied

1. **Test command documentation** — corrected to include `--import ./tests/m0/register.mjs`.
2. **Credential-source validation** — integrated into validateCapabilityContract and validateProviderDescriptor.
3. **Lifecycle validators** — all 15 lifecycle types have validators with valid/invalid tests.
4. **Reference array validation** — candidate_providers and evidence_refs element-validated.
5. **Durable evidence semantics** — DurabilityStatus is `persisted | archived` only. `transient` rejected.
6. **Three-way execution/evidence identity** — evidence_id = identity_chain.execution_id = execution.execution_id enforced.
7. **Observation supersession** — Observation has capability_id, scope, verified, supersedes, superseded_by. Validator enforces: supersedes requires verified=true + evidence. Self-supersession rejected. validateSupersessionLineage enforces same capability/scope.
8. **Dependency test strengthened** — checks all import forms: `from 'mod'`, `from './mod'`, `from '@/mod'`, `from '@/services/mod'`. Also verifies no production runtime imports controlPlane.
9. **Extra-field permissiveness** — documented M1 property. Validators use open schema.

## Test results

```
M1: 73 tests, 14 suites, 73 pass, 0 fail — 144ms
M0: 71 tests, 27 suites, 71 pass, 0 fail — 1028ms
TypeScript: PASS
git diff --cached --check: PASS
```

## Validator coverage

| Type | Validator | Valid | Invalid |
|------|-----------|-------|---------|
| CapabilityContract | validateCapabilityContract | A | B, B2, B3 |
| ProviderDescriptor | validateProviderDescriptor | A | B2 |
| PolicyDocument | validatePolicyDocument | A | B, E |
| EvidenceEnvelope | validateEvidenceEnvelope | A | C, C2, C3 |
| TrustedHostConfig | validateTrustedHostConfig | A | — |
| Claim | validateClaim | A | B, B3 |
| SemanticCapabilityRequest | validateSemanticCapabilityRequest | A | — |
| ProposedExecutionPlan | validateProposedExecutionPlan | A | B |
| AuthorizationResult | validateAuthorizationResult | A | B |
| AuthorizedExecutionPlan | validateAuthorizedExecutionPlan | A | B |
| ExecutionResult | validateExecutionResult | A | B |
| VerifiedResult | validateVerifiedResult | A, C2 | B |
| Association | validateAssociation | A | B |
| Observation | validateObservation | A, F | B3, F |
| Correction | validateCorrection | A | B, B3 |
| BoundaryResolution | validateBoundaryResolution | — | B |
| Identifier | validateIdentifier | — | B |
| SupersessionLineage | validateSupersessionLineage | F | F |

## Detailed results

| Check | Result |
|-------|--------|
| Credential-reference rejection | PASS — integrated into CapabilityContract + ProviderDescriptor |
| candidate_providers validation | PASS — malformed ids rejected |
| evidence_refs validation | PASS — in Claim, Observation, Correction |
| VerifiedResult vs EvidenceEnvelope | PASS — independent VerifiedResult; no transient envelope |
| Three-way execution/evidence identity | PASS — evidence_id / identity_chain.execution_id / execution.execution_id |
| Verified supersession with same cap/scope | PASS |
| Unverified supersession | FAIL (rejected) |
| Supersession without evidence | FAIL (rejected) |
| Correction supersession attempt | FAIL (no field; structurally impossible) |
| Self-supersession | FAIL (rejected) |
| Different capability/scope lineage | FAIL (rejected) |
| Dependency rule (4 import forms) | PASS |
| No production imports of controlPlane | PASS |
| Retired terms | 0 |
| TypeScript | PASS |
| git diff --cached --check | PASS |

## Staged files

```
A  M1-VALIDATION-REPORT.md
A  services/controlPlane/types.ts
A  services/controlPlane/validators.ts
A  tests/m1/run.test.mjs
```

4 files, 1540 insertions. No production runtime files modified.

## Final vocabulary corrections

9. **Boundary enum** — `INTERNET_CLOUD` replaced with exact locked vocabulary `INTERNET/CLOUD`. Test proves `INTERNET_CLOUD` is rejected.
10. **Correction supersession rejection** — `validateCorrection` explicitly rejects `supersedes` and `superseded_by` properties. Corrections dispute only, never supersede.
11. **SUPERSEDED lineage** — `validateObservation` enforces: `status=SUPERSEDED` requires `superseded_by != null`.
12. **Observation provenance** — Observation now includes `capability_id`, `scope`, and `verified` fields for supersession lineage enforcement via `validateSupersessionLineage`.

## Remaining schema properties

- Extra-field permissiveness: documented, acceptable for M1 (except Correction, which explicitly rejects supersession fields).

## M1 Verdict

**M1 PASS**
