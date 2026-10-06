# M4 Validation Report — Final Closure

## Baseline

| Field | Value |
|-------|-------|
| Starting commit | `a64f10713a973c5e07b3c6acb243db08a00fd761` |
| Branch | `feature/cordelia-iphone-gateway` |
| Starting working-tree state | Clean |
| Correction pass | Applied post-audit (warmMacMini removal + schema truthfulness + D4/D5 scope fixes) |
| Final closure | D4 fault injection + stale legacy removal; registry denial recording status explicit |
| Secure-clear closure | secureStorage.removeItemWithStatus; clearBraveApiKeySecure uses checked removal |
| Caller-status closure | setBraveApiKey/clearBraveApiKey return results; status gated on actual outcome; system.tsx save/clear updated |
| Save-failure closure | Failed save retains draft; replacement failure preserves prior key; status re-checked on stored=false |

---

## Phase A: Reachable Egress Inventory

Reachable outbound paths categorized by type.

### CAPABILITY EXECUTION — registered, guarded by checkCapabilityOrDeny

| # | Capability ID | Entry Point | Network Path | Resolver |
|---|---|---|---|---|
| 1 | `reasoning` (local) | `aiRouter:routeAI()→tryLocalRoute()→generateLocal()` | `http://<OLLAMA_HOST>/api/chat` | `local_reasoning_resolver` |
| 2 | `reasoning` (cloud) | `aiRouter:routeAI()→cloudRoute()→providerGatewayFetch('/claude')` | Gateway → Anthropic HTTPS | `cloud_reasoning_resolver` |
| 3 | `web.search` | `webSearch.ts:webSearch()→fetch(BRAVE_ENDPOINT)` | `https://api.search.brave.com/…` | `brave_resolver` |
| 4 | `retrieval.embed` | `embeddingService.ts:embedText()→fetch(<OLLAMA_HOST>/api/embeddings)` | `http://<OLLAMA_HOST>/api/embeddings` | `ollama_embed_resolver` |
| 5 | `ollama.status.read` | `readOnlyTools:runTool('ollama.status')→gateway /tools/run` | Gateway → 127.0.0.1:11434 | `gateway_ollama_status_resolver` |
| 6 | `system.info.read` | `readOnlyTools:runTool('system.info')` | Gateway `os.*` in-process | `gateway_system_info_resolver` |
| 7 | `git.status.read` | `readOnlyTools:runTool('git.status')` | Gateway `git -C <REPO>` | `gateway_git_status_resolver` |
| 8 | `git.diff.read` | `readOnlyTools:runTool('git.diff')` | Gateway `git diff` | `gateway_git_diff_resolver` |
| 9 | `github.read.repo` | `readOnlyTools:runTool('github.repo')` | Gateway `gh repo view` → GitHub HTTPS | `gateway_github_repo_resolver` |
| 10 | `github.read.commits` | `readOnlyTools:runTool('github.commits')` | Gateway `gh api …` → GitHub HTTPS | `gateway_github_commits_resolver` |
| 11 | `github.read.issues` | `readOnlyTools:runTool('github.issues')` | Gateway `gh issue list` → GitHub HTTPS | `gateway_github_issues_resolver` |
| 12 | `github.read.pull_requests` | `readOnlyTools:runTool('github.pull_requests')` | Gateway `gh pr list` → GitHub HTTPS | `gateway_github_pull_requests_resolver` |
| 13 | `github.read.actions` | `readOnlyTools:runTool('github.actions')` | Gateway `gh run list` → GitHub HTTPS | `gateway_github_actions_resolver` |

### REGISTERED BUT DENIED — registered, always denied, zero egress

| Capability ID | Denial Reason | Egress |
|---|---|---|
| `git.push` | `candidate_providers: []` — no executable provider | ZERO |
| `github.pr.create` | `candidate_providers: []` — no executable provider | ZERO |

### NON-CAPABILITY PROBES — not capability execution, not registered as capabilities

| Path | Endpoint | Classification |
|---|---|---|
| `checkPrivateNode()` → GET `/api/tags` | `http://<OLLAMA_HOST>/api/tags` | Availability probe. Documented in `local_reasoning_resolver.availability_method`. M5 consumes for availability facts. |
| `onboarding.tsx:handleCheckGateway()` → GET `/health` | `providerGatewayFetch('/health')` | Infrastructure probe. First-run only. M5 consumes for availability facts. |

### DEAD / UNREACHABLE — confirmed zero callers

| Code | Status |
|---|---|
| `connectivityChecker.ts` functions | Zero callers in app/ and services/ — dead code |
| `downloadModel` / `downloadLlamaModel` | Zero callers outside `localAI.ts` itself — unreachable |
| `warmMacMini()` | **REMOVED** — was unguarded `POST /api/chat`, now absent from codebase |

**Invariant: there are ZERO reachable capability-class execution paths outside the 13 listed above.**

---

## Production Capability Registry

14 total: 12 executable + 2 denied.

### Executable Capabilities

| ID | Version | Provider (1:1) | Descriptor Boundary |
|---|---|---|---|
| `reasoning` | 1 | `local_reasoning_resolver`, `cloud_reasoning_resolver` | unresolved (local); INTERNET/CLOUD (cloud) |
| `web.search` | 1 | `brave_resolver` | INTERNET/CLOUD |
| `retrieval.embed` | 1 | `ollama_embed_resolver` | unresolved (configurable host) |
| `ollama.status.read` | 1 | `gateway_ollama_status_resolver` | unresolved |
| `system.info.read` | 1 | `gateway_system_info_resolver` | unresolved |
| `git.status.read` | 1 | `gateway_git_status_resolver` | unresolved |
| `git.diff.read` | 1 | `gateway_git_diff_resolver` | unresolved |
| `github.read.repo` | 1 | `gateway_github_repo_resolver` | unresolved |
| `github.read.commits` | 1 | `gateway_github_commits_resolver` | unresolved |
| `github.read.issues` | 1 | `gateway_github_issues_resolver` | unresolved |
| `github.read.pull_requests` | 1 | `gateway_github_pull_requests_resolver` | unresolved |
| `github.read.actions` | 1 | `gateway_github_actions_resolver` | unresolved |

### Denied/Unimplemented Capabilities

| ID | Version | Providers | Reason |
|---|---|---|---|
| `git.push` | 1 | none (empty) | DENIED — write operation, not permitted in V1 |
| `github.pr.create` | 1 | none (empty) | DENIED — write operation, not permitted in V1 |

### No fixture.* capabilities in production registry — CONFIRMED

---

## Provider Descriptors — Cardinality Matrix

**Invariant**: for every contract C and every provider P in `C.candidate_providers`:
`lookupProvider(P).capability_id == C.id`. Verified by cardinality test in M4 suite.

| Provider ID | `capability_id` (matches contract) | `boundary_resolution` |
|---|---|---|
| `local_reasoning_resolver` | `reasoning` | **unresolved** — host is `AsyncStorage[ollama_host_v1]`, M5 resolves |
| `cloud_reasoning_resolver` | `reasoning` | resolved: INTERNET/CLOUD (architecture_rule) |
| `brave_resolver` | `web.search` | resolved: INTERNET/CLOUD (architecture_rule) |
| `ollama_embed_resolver` | `retrieval.embed` | **unresolved** — host is `AsyncStorage[ollama_host_v1]`, M5 resolves |
| `gateway_ollama_status_resolver` | `ollama.status.read` | **unresolved** — gateway host configurable, M5 resolves |
| `gateway_system_info_resolver` | `system.info.read` | **unresolved** |
| `gateway_git_status_resolver` | `git.status.read` | **unresolved** |
| `gateway_git_diff_resolver` | `git.diff.read` | **unresolved** |
| `gateway_github_repo_resolver` | `github.read.repo` | **unresolved** |
| `gateway_github_commits_resolver` | `github.read.commits` | **unresolved** |
| `gateway_github_issues_resolver` | `github.read.issues` | **unresolved** |
| `gateway_github_pull_requests_resolver` | `github.read.pull_requests` | **unresolved** |
| `gateway_github_actions_resolver` | `github.read.actions` | **unresolved** |

13 total descriptors. All share the same underlying gateway implementation; each has its own truthful `capability_id`.

---

## Boundary Truthfulness

| Provider | Claim | Truthfulness |
|---|---|---|
| `local_reasoning_resolver` | `unresolved` | TRUTHFUL — Ollama host is configurable. M5 will resolve via `AUTO_TRUSTED_CIDR` + D5 declarations. |
| `ollama_embed_resolver` | `unresolved` | TRUTHFUL — same. |
| `cloud_reasoning_resolver` | `INTERNET/CLOUD (architecture_rule)` | TRUTHFUL — gateway always routes through Anthropic API. |
| `brave_resolver` | `INTERNET/CLOUD (architecture_rule)` | TRUTHFUL — Brave Search API is always public internet. |
| All `gateway_*_resolver` | `unresolved` | TRUTHFUL — gateway host is configurable via `secureStorage[providerGatewayBase_v1]`. M5 resolves once declared via D5. |

---

## Contract Validation

All 14 production contracts validated against M1 `validateCapabilityContract`: **ALL PASS**

All 13 provider descriptors validated against M1 `validateProviderDescriptor`: **ALL PASS**

`timeout_ms = 30000` on every contract (D6 declared, not enforced until M8): **ALL PASS**

No credential values in any contract field: **ALL PASS**

Cardinality invariant: every `candidate_provider.capability_id == contract.id`: **ALL PASS**

---

## Egress-to-Registry Matrix

| Egress Path | Capability ID | Resolver | Guard |
|---|---|---|---|
| `generateLocal()` / `streamFromOllama()` | `reasoning` | `local_reasoning_resolver` | `checkCapabilityOrDeny('reasoning')` in `routeAI()` |
| `providerGatewayFetch('/claude')` | `reasoning` | `cloud_reasoning_resolver` | same |
| `fetch(BRAVE_ENDPOINT)` | `web.search` | `brave_resolver` | `checkCapabilityOrDeny('web.search')` in `webSearch()` |
| `fetch(<OLLAMA_HOST>/api/embeddings)` | `retrieval.embed` | `ollama_embed_resolver` | `checkCapabilityOrDeny('retrieval.embed')` in `embedText()` |
| `providerGatewayFetch('/tools/run') {ollama.status}` | `ollama.status.read` | `gateway_ollama_status_resolver` | `checkCapabilityOrDeny(capId)` in `runTool()` |
| `providerGatewayFetch('/tools/run') {system.info}` | `system.info.read` | `gateway_system_info_resolver` | same |
| `providerGatewayFetch('/tools/run') {git.status}` | `git.status.read` | `gateway_git_status_resolver` | same |
| `providerGatewayFetch('/tools/run') {git.diff}` | `git.diff.read` | `gateway_git_diff_resolver` | same |
| `providerGatewayFetch('/tools/run') {github.repo}` | `github.read.repo` | `gateway_github_repo_resolver` | same |
| `providerGatewayFetch('/tools/run') {github.commits}` | `github.read.commits` | `gateway_github_commits_resolver` | same |
| `providerGatewayFetch('/tools/run') {github.issues}` | `github.read.issues` | `gateway_github_issues_resolver` | same |
| `providerGatewayFetch('/tools/run') {github.pull_requests}` | `github.read.pull_requests` | `gateway_github_pull_requests_resolver` | same |
| `providerGatewayFetch('/tools/run') {github.actions}` | `github.read.actions` | `gateway_github_actions_resolver` | same |

No unmapped capability-class egress paths. `warmMacMini` (`POST /api/chat`, unguarded) removed.

---

## Denied/Unimplemented Contracts

| Capability | Registration | Providers | Denial Behavior |
|---|---|---|---|
| `git.push` | Registered | `candidate_providers: []` | DENY before execution; recorded via Recorder (interim_gate, source=capability_registry) |
| `github.pr.create` | Registered | `candidate_providers: []` | DENY before execution; recorded |

Tests confirm: zero gateway contact + denial record. **PASS**

---

## Gateway Parity

- `readOnlyTools.ts:runTool()` sends `{ tool }` only — no command, args, URL, shell fields
- App-level registry check BEFORE gateway fetch
- Gateway's own switch-case allowlist remains as second defense layer
- Unknown tool → `null` from `gatewayToolCapabilityId()` → denied before fetch
- `git.push`, `github.pr.create` → denied, zero egress
- Adversarial names (`git.status; rm -rf /`, `http://evil.example.com`) → null → denied

**PASS**

---

## warmMacMini Removal

**Removed**: `warmMacMini()` function and its fire-and-forget invocation from `checkPrivateNode()`.

- Was: `POST http://<OLLAMA_HOST>/api/chat` with `{model, messages:[{role:'user',content:'hi'}], stream:false}`, 120s timeout
- Reachable via `checkPrivateNode()` on every node online transition, called from `index.tsx`
- Was NOT guarded by `checkCapabilityOrDeny('reasoning')`
- This was a real model inference call (not a probe) — same endpoint as the `reasoning` capability
- Adding a guard in `localAI.ts` was not possible (M1 invariant: localAI must not import controlPlane)

**Resolution**: removed entirely. First real user-request will warm Ollama naturally.

**Proof**: `SRC_LOCAL.includes('warmMacMini') === false` — verified by structural test in M4 suite.

---

## D4 Brave Key Migration

**Protocol** (`services/controlPlane/braveKeyMigration.ts`):

1. Check `secureStorage[brave_search_api_key_secure_v1]` — if present → return it
2. Read legacy `AsyncStorage[brave_search_api_key_v1]`
3. Copy to secureStorage
4. Verify read-back matches
5. ONLY after verification: remove legacy key
6. Failure → preserve legacy key (never delete only usable copy)

**No-Settings migration**: `getBraveApiKeySecure()` performs inline migration (step 2–6) when secureStorage is empty. Migration no longer depends on the user opening Settings. First `web.search` credential read completes migration if legacy key exists.

**Fault semantics** (deterministically verified by fault-injection tests):

| Fault | Trigger | Status | Key available? | Legacy preserved? |
|---|---|---|---|---|
| Fault A | `secureStorage.setItem` fails | `migration_failed` | false | YES — legacy untouched |
| Fault B | `secureStorage.getItem` readback → null/mismatch | `migration_failed` | false | YES — legacy untouched |
| Fault C | `AsyncStorage.removeItem` fails | `migrated_legacy_cleanup_failed` | true | YES — cleanup incomplete, safe to retry |

Note: `secureStorage.getItem` swallows EncryptedStorage exceptions internally (returns `null`), so Fault B is triggered via the `!readback` branch (null return) rather than a rethrown exception. Behavior is identical: legacy preserved.

**`setBraveApiKeySecure()` return type**: `Promise<BraveKeySetResult { stored: boolean; legacyRemoved: boolean }>`
- `stored=true, legacyRemoved=true` — full success: key written, legacy cleaned up
- `stored=false, legacyRemoved=false` — setItem failed: nothing written, nothing removed
- `stored=true, legacyRemoved=false` — write succeeded but legacy removal failed (partial; stale key may persist)

**`clearBraveApiKeySecure()` return type**: `Promise<BraveKeyClearResult { secureCleared: boolean; legacyCleared: boolean }>`
- Each store removal is independent; partial failures are reported
- `secureCleared=true` — `EncryptedStorage.removeItem` completed without error; key is removed from the encrypted store
- `secureCleared=false` — `EncryptedStorage.removeItem` threw; key may still be present; retry is safe and idempotent
- `legacyCleared=false` — `AsyncStorage.removeItem` threw; legacy key may persist

**`secureStorage.removeItemWithStatus(key): Promise<boolean>`** (new additive API in `secureStorage.ts`):
- Returns `true` if `EncryptedStorage.removeItem` completed without error
- Returns `false` (catches internally, logs non-secret failure description) if it threw
- Existing `secureStorage.removeItem` (void, error-silenced) unchanged for all other callers

**Caller status propagation** (`webSearch.ts → system.tsx`):

`setBraveApiKey(key): Promise<BraveKeySetResult>`:
- `_sessionStatus = 'configured'` if `result.stored === true`
- `stored=false`: re-checks actual credential availability via `getBraveApiKeySecure()` — prior key present → `'configured'`; no key → `'unavailable'`
- Returns `BraveKeySetResult` to caller

`clearBraveApiKey(): Promise<BraveKeyClearResult>`:
- `_sessionStatus = 'unavailable'` ONLY if `secureCleared && legacyCleared`
- Partial clear: re-checks actual key availability via `getBraveApiKeySecure()`; sets `'configured'` if key still present
- Returns `BraveKeyClearResult` to caller

`system.tsx saveKey`:
- Awaits result: `const result = await setBraveApiKey(k)`
- `setKeyDraft('••••••••')` ONLY inside `if (result.stored)` — failed save leaves draft visible for retry
- `setKeySaved(true)` (green 'saved' flash) ONLY when `result.stored && result.legacyRemoved` (full success)
- `stored=true, legacyRemoved=false`: draft masked (key stored), but no 'saved' flash (cleanup incomplete)
- `stored=false`: draft retained, no flash, status reflects actual availability (old key or unavailable)

`system.tsx clearKey`:
- Awaits result: `const result = await clearBraveApiKey()`
- `setKeyDraft('')` ONLY when `result.secureCleared && result.legacyCleared` (full clear)
- Partial/failed clear: input not blanked; `setWebSearchStatus(getWebSearchStatus())` reflects actual availability

**Save/clear outcome table**:

| Scenario | `stored` | `legacyRemoved` | `_sessionStatus` | UI draft | UI flash |
|---|---|---|---|---|---|
| Full save success | `true` | `true` | `configured` | masked | ✓ saved |
| Partial cleanup | `true` | `false` | `configured` | masked | — |
| First-time save failure | `false` | `false` | `unavailable` | **retained** | — |
| Replacement failure (old key present) | `false` | `false` | `configured` (re-checked) | **retained** | — |

| Scenario | `secureCleared` | `legacyCleared` | `_sessionStatus` | UI draft |
|---|---|---|---|---|
| Full clear success | `true` | `true` | `unavailable` | blanked |
| Secure removal fault | `false` | any | `configured` (re-checked) | retained |
| Legacy removal fault | `true` | `false` | `configured` (re-checked) | retained |

**Caller audit**:
- `webSearch.ts:setBraveApiKey()` — returns `BraveKeySetResult`; `configured` only if `stored=true`; on failure, re-checks prior key
- `webSearch.ts:clearBraveApiKey()` — returns `BraveKeyClearResult`; `unavailable` only on full clear
- No caller claims full success when the underlying result reports partial or failed operation

**Stale-key resurrection prevention**:
- `setBraveApiKeySecure()` writes new key to secureStorage AND removes legacy AsyncStorage key
- `clearBraveApiKeySecure()` removes both stores; each result field accurately reports outcome
- After successful set (`stored=true, legacyRemoved=true`), stale legacy key cannot resurrect

**D4 tests**: 26: no-Settings migration (3), fault injection migrateBraveKey (3 A/B/C), fault injection getBraveApiKeySecure (3 A/B/C), setBraveApiKeySecure result (2 + 1 stale-key), clearBraveApiKeySecure result (3 — full success, EncryptedStorage fault+retry, AsyncStorage fault), migrateBraveKey standalone (4), R2 structural (1), no-log (1), already-secure/idempotent (2). **ALL PASS**

**WebSearch caller status tests** (new suite, 10 tests):
- `setBraveApiKey` full success → `stored=true`, `legacyRemoved=true`, `status=configured`
- Test A: `setBraveApiKey` first-time save failure (no prior key) → `stored=false`, `status=unavailable`, new value not in store
- Test B: `setBraveApiKey` replacement failure (prior key exists) → `stored=false`, old key preserved and readable, `status=configured`
- `setBraveApiKey` partial legacy cleanup → `stored=true`, `legacyRemoved=false`, key usable, no full-success claim
- `clearBraveApiKey` full success → both true, `status=unavailable`
- `clearBraveApiKey` secure fault → `secureCleared=false`, status NOT unavailable (key still accessible)
- `clearBraveApiKey` legacy fault → `legacyCleared=false`, status reflects actual availability
- system.tsx structural: `setKeyDraft('••••••••')` inside `if (result.stored)` — not unconditional
- system.tsx structural: `saveKey` gates `setKeySaved(true)` on `result.stored && result.legacyRemoved`
- system.tsx structural: `clearKey` gates `setKeyDraft('')` on `result.secureCleared && result.legacyCleared`

**ALL PASS**

---

## D5 Trusted-Host Configuration

**M4 scope** (`services/controlPlane/trustedHosts.ts`):

- Persistence: `secureStorage[cp_trusted_hosts_v1]` JSON array of `TrustedHostConfig`
- Architecture constant: `AUTO_TRUSTED_CIDR = '192.168.4.'` — exported for M5 to consume
- Read API: `getTrustedHosts()`, `hasTrustedHostDeclaration(host)`, `getTrustedHostDeclaration(host)`
- Write API (Settings-only): `declareTrustedHost(host, userDeclaration)`, `revokeTrustedHost(id)`

**M5 scope (NOT implemented here)**:
- Runtime host → BoundaryResolution (combining `AUTO_TRUSTED_CIDR` + explicit declarations + actual host)
- `isTrustedHost()` and `getTrustedHostBoundary()` are NOT exported from M4

**Separation enforced**:
- `hasTrustedHostDeclaration(host)`: checks explicit declarations only — does NOT apply architecture rule
- `getTrustedHostDeclaration(host)`: returns `TrustedHostConfig | null` — no BoundaryResolution produced
- M5 will combine `AUTO_TRUSTED_CIDR` + `getTrustedHostDeclaration()` + runtime host → BoundaryResolution

**Write authority**: `declareTrustedHost` not imported by sendOrchestration, aiRouter, localAI, recorder, embeddingService, webSearch, readOnlyTools. **PASS**

**Settings UI**: D5 section in `system.tsx` — declare/revoke controls. `getTrustedHostBoundary` import removed (was unused).

**D5 tests**: 13 tests covering constant, M5 separation, hasTrustedHostDeclaration, getTrustedHostDeclaration, declare/revoke, R2 structural. **ALL PASS**

---

## Registry Denial Recording

- `record_kind = 'interim_gate'`
- `record_type = null`
- `source = 'capability_registry'`
- `payload = { reason: 'unregistered_capability' | 'denied_capability', capability_id }`

Distinguishable from M2 `interim_boundary_gate` records and future M6 authorization records.

**`checkCapabilityOrDeny()` return type**: `Promise<RegistryGateResult>` (was `Promise<boolean>`)
```typescript
export type RecordingStatus = 'recorded' | 'degraded';
export interface RegistryGateResult {
  allowed: boolean;
  recording: RecordingStatus | null;  // null when allowed; RecordingStatus when denied
}
```

**`recordRegistryDenial()` return type**: `Promise<RecordingStatus>` (was `Promise<void>`)
- Returns `'recorded'` when Recorder is ready and `appendRecord` COMMIT succeeds
- Returns `'degraded'` when: Recorder uninitialized; `appendRecord` COMMIT faults; `appendRecord` throws
- Never throws. Denial enforcement is always via the `allowed` field — independent of recording status.

**Recording outcomes verified by fault-injection tests**:

| Scenario | `allowed` | `recording` | Durable record? |
|---|---|---|---|
| Capability registered + executable | `true` | `null` | N/A |
| Unregistered capability, Recorder ready | `false` | `'recorded'` | YES |
| Denied capability (git.push), Recorder ready | `false` | `'recorded'` | YES |
| Recorder uninitialized | `false` | `'degraded'` | NO |
| Recorder COMMIT fault (`__setCommitFault(true)`) | `false` | `'degraded'` | NO |

**Zero egress regardless of Recorder state**: denied capability never contacts network. **PASS**
**No fake provenance**: degraded Recorder does not convert denial to allow. **PASS**

**Call sites updated** (all 4 changed `!result` → `!result.allowed`):
- `aiRouter.ts:routeAI()` — `reasoningAllowed.allowed`
- `embeddingService.ts:embedText()` — `allowed.allowed`
- `readOnlyTools.ts:runTool()` — `allowed.allowed`
- `webSearch.ts:webSearch()` — `allowed.allowed`

---

## M1 Dependency Invariant

`localAI.ts` does NOT import `controlPlane` — M1 invariant preserved. `warmMacMini` removal was the only fix needed; no import change required.

M4-authorized call-site consumers (aiRouter, readOnlyTools, embeddingService, webSearch) are correctly exempted in M1 test.

Remaining forbidden: providerGateway, securityGateway, localAI, networkMonitor, toolDB, conversationDB, connectivityChecker. All verified by M1 test. **PASS**

---

## R2 Extension Summary

| Threat | Defense | Status |
|---|---|---|
| Model output writes Brave credential | `setBraveApiKey` not in aiRouter/orchestration/recorder | PASS |
| Model output mutates registry | Registry has no exported mutation function | PASS |
| Model output writes trusted-host config | `declareTrustedHost` not in any model-output path | PASS |
| Model output adds fixture capability | Registry is immutable at runtime | PASS |
| Model output supplies credential value | `looksLikeCredentialValue` guard in validators | PASS |
| Model output invokes synthetic inference | `warmMacMini` removed; no unguarded /api/chat path | PASS |

---

## Unresolved Issues

1. **Gateway host unresolved** (Unknown #1): all 9 gateway resolvers have `boundary_resolution: {status: 'unresolved'}`. Must be declared via D5 and resolved by M5 before M8 enforcement applies.
2. **Local Ollama host unresolved**: `local_reasoning_resolver` and `ollama_embed_resolver` are `unresolved`. M5 resolves via `AUTO_TRUSTED_CIDR` + D5 declarations.
3. **KC-5 remains transitional**: tool context executes before reasoning gate in orchestration. M4 adds registry checks at each call site; reordering is KC-5 scope, not M4.

---

## Explicit No-M5+ Scope Statement

M4 does NOT implement:
- Candidate resolution or `resolution_id` runtime
- `isTrustedHost()` / `getTrustedHostBoundary()` runtime resolution
- Provider ordering or availability probe orchestration
- Policy Store
- Authorizer
- ALLOW/DENY/ASK runtime authorization
- Human ASK approval
- Authorized execution plan
- Executor enforcement
- 30-second timeout enforcement (declared only; M8 enforces)
- Verifier or VerifiedResult runtime
- Durable EvidenceEnvelope
- Claim matching, observations, or corrections
- Cordelia capability proposals

---

## Test Results

```
M4:  106 tests, 12 suites, 106 pass, 0 fail
M3:  30 tests, 13 suites, 30 pass, 0 fail — regression PASS
M2:  57 tests, 17 suites, 57 pass, 0 fail — regression PASS
M1:  73 tests, 14 suites, 73 pass, 0 fail — regression PASS
M0:  71 tests, 27 suites, 71 pass, 0 fail — regression PASS
TypeScript: PASS (npx tsc --noEmit)
git diff --check: PASS
```

---

## Files Changed

### Modified

```
services/aiRouter.ts                       M4 registry check in routeAI()
services/embeddingService.ts               M4 registry check in embedText()
services/readOnlyTools.ts                  M4 registry check in runTool()
services/tools/webSearch.ts               D4 Brave key — secureStorage path + registry check
services/localAI.ts                        warmMacMini removed (unguarded POST /api/chat)
app/(tabs)/system.tsx                      D4 migration trigger + D5 trusted-host Settings UI
tests/m1/run.test.mjs                      M4 authorized consumers exempted from forbidden list
```

### New

```
services/controlPlane/registry.ts          Production registry: 14 contracts, 13 descriptors
services/controlPlane/trustedHosts.ts      D5 trusted-host config substrate (M4 scope only)
services/controlPlane/braveKeyMigration.ts D4 Brave key migration (inline + standalone)
tests/m4/run.test.mjs                      106 tests, 12 suites
tests/m0/mocks/encrypted-storage.mjs       Fault injection: __injectFault(op, error, skipCount), __clearFaults()
tests/m0/mocks/async-storage.mjs           Fault injection: same pattern
services/secureStorage.ts                  Added removeItemWithStatus(key): Promise<boolean>
M4-VALIDATION-REPORT.md                   This report
```

---

## M4 Exit Gate

| # | Requirement | Result |
|---|---|---|
| 1 | Every reachable capability-class execution path guarded by `checkCapabilityOrDeny` | PASS — 13 paths, all guarded; warmMacMini (POST /api/chat) removed |
| 2 | No reachable capability-class egress is unmapped | PASS |
| 3 | Unknown/unregistered capability denied before execution + recorded | PASS |
| 4 | Known-denied capability (git.push, github.pr.create) → zero egress + recorded | PASS |
| 5 | Provider descriptor cardinality truthful: every descriptor.capability_id == contract.id | PASS — 13 descriptors, 13 match |
| 6 | Ollama provider boundaries truthful: unresolved (configurable host) | PASS |
| 7 | D5 M4/M5 separation: M4 exports config facts only, no BoundaryResolution production | PASS |
| 8 | D4 migration: no Settings dependency; inline migration in getBraveApiKeySecure | PASS |
| 9 | D4 stale-key prevention: setBraveApiKeySecure removes legacy; clearBraveApiKeySecure removes both | PASS |
| 9a | D4 fault injection: Fault A/B/C deterministically verified for migrateBraveKey + getBraveApiKeySecure | PASS |
| 9b | D4 return types: setBraveApiKeySecure → BraveKeySetResult; clearBraveApiKeySecure → BraveKeyClearResult | PASS |
| 9c | D4 secure-clear: secureStorage.removeItemWithStatus; secureCleared accurately reflects EncryptedStorage outcome | PASS |
| 9d | D4 secure-clear fault+retry: EncryptedStorage fault → secureCleared=false key present; retry → secureCleared=true key absent | PASS |
| 9e | D4 caller status: setBraveApiKey gates 'configured' on stored=true; re-checks prior key on stored=false | PASS |
| 9e2 | D4 save-failure: first-time failure → unavailable; replacement failure → old key preserved + configured | PASS |
| 9e3 | D4 save-failure UI: draft retained on stored=false; masking gated on result.stored | PASS |
| 9f | D4 caller status: system.tsx saveKey/clearKey gate UI success indicators on actual result fields | PASS |
| 10 | Recorder degraded: denial enforced, zero egress, no fake provenance | PASS |
| 10a | Recording status explicit: checkCapabilityOrDeny returns RegistryGateResult {allowed, recording} | PASS |
| 10b | recordRegistryDenial returns RecordingStatus ('recorded'|'degraded'); all 4 call sites updated | PASS |
| 10c | Degraded recording verified: uninitialized Recorder → 'degraded'; COMMIT fault → 'degraded' | PASS |
| 11 | M1 invariant: localAI.ts does not import controlPlane | PASS |
| 12 | M0–M3 regression baselines met | PASS |
| 13 | TypeScript clean | PASS |
| 14 | git diff --check clean | PASS |

```
M4 COMMIT READY
```
