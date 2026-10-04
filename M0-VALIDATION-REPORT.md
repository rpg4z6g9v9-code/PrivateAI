# M0 Validation Report

## Baseline

| Field | Value |
|-------|-------|
| Starting commit | `441a96d3c61c3052c308d41df59bb3ca29e5fe4b` |
| Branch | `feature/cordelia-iphone-gateway` |
| Starting working-tree state | Clean |

## Test command

```bash
node --experimental-transform-types --no-warnings \
     --import ./tests/m0/register.mjs \
     --test tests/m0/run.test.mjs
```

## Files added

```
services/sendOrchestration.ts          Behavior-preserving extraction of send orchestration
tests/m0/register.mjs                 Module loader registration
tests/m0/hooks.mjs                    Resolve hooks (@/ paths, RN mocks)
tests/m0/mocks/encrypted-storage.mjs  EncryptedStorage test double
tests/m0/mocks/async-storage.mjs      AsyncStorage test double
tests/m0/mocks/expo-sqlite.mjs        SQLite test double with fault injection
tests/m0/mocks/expo-local-auth.mjs    LocalAuthentication test double
tests/m0/mocks/expo-fs-legacy.mjs     FileSystem test double
tests/m0/mocks/llama-rn.mjs           llama.rn test double
tests/m0/mocks/expo-device.mjs        Device test double
tests/m0/mocks/claude-types.mjs       Type-only module shim
tests/m0/run.test.mjs                 Main test harness (71 tests)
tests/m0/coverage-findings.md         Four coverage gap findings
M0-VALIDATION-REPORT.md               This file
```

## Production code change set

- `app/(tabs)/index.tsx` — modified (14 insertions, 97 deletions)
- `services/sendOrchestration.ts` — new (148 lines)

Inline orchestration (SEARCH_PATTERNS, detectSearchQuery, formatToolContext, tool context building, routeAI call, sanitizeOutput, networkMonitor.logCall) extracted as a behavior-preserving extraction to `services/sendOrchestration.ts`. index.tsx now imports and calls `executeSendOrchestration()`.

**Characterization:** Pre-extraction 55/55 pass. Post-extraction 71/71 pass. R1-R12 and KC-1-KC-5 results identical before and after.

**Pre-commit audit corrections:** Two extraction-fidelity issues found and fixed:
1. `classifyData` was duplicated (index.tsx + orchestration). Fixed: orchestration now accepts precomputed `isSensitive` and `dataClass` from caller. Classification runs exactly once at the baseline location (before try block in index.tsx).
2. `dataSizeBytes` was computed from stripped `ConversationMessage[]` instead of full `Message[]`. Fixed: index.tsx computes `JSON.stringify(newMessages).length` and passes the numeric value to the orchestration.

## Production-Coverage Table

| Path | Production File / Symbol | Test Name(s) | Runtime/Structural | What Is Actually Executed |
|------|--------------------------|--------------|---------------------|--------------------------|
| **Send orchestration** | `sendOrchestration.ts` / `executeSendOrchestration` | KC-1, KC-2, KC-5, R7, R9, R10 | **Runtime + egress** | Production orchestration called; classify, tools, route, sanitize all execute |
| Injection check | `securityGateway.ts` / `checkInjection` | R1, R8, Fuzzer (79 payloads) | **Runtime** | Called with 79+ inputs |
| Data classification | `securityGateway.ts` / `classifyData` | R8, KC-1 (via orch), Coverage 3 | **Runtime** | Called with medical/financial/PII terms |
| Output sanitization | `securityGateway.ts` / `sanitizeOutput` | R1, R6, Adversarial (7 payloads) | **Runtime** | Called with credential patterns + adversarial engine outputs |
| AI routing (sensitive) | `aiRouter.ts` / `routeAI` | R9 (via orch + direct) | **Runtime + egress** | Called with isSensitive=true; ZERO cloud egress |
| AI routing (safeMode) | `aiRouter.ts` / `routeAI` | R10 (via orch + direct) | **Runtime + egress** | Called with safeMode=true; ZERO cloud egress |
| AI routing (cloud fallback) | `aiRouter.ts` / `routeAI` | R7, KC-2 | **Runtime + egress** | Non-sensitive triggers cloud; body captured with Cordelia prompt |
| Active cloud prompt | `aiRouter.ts` / `buildSystemPrompt` | R7 | **Runtime + egress** | Cloud /claude body captured; system field contains "You are Cordelia" |
| Active local prompt | `aiRouter.ts` / `buildLocalSystemPrompt` | R7 | **Runtime + egress** | Ollama /api/chat body captured; system message contains "You are Cordelia" |
| Tool detection | `readOnlyTools.ts` / `buildReadOnlyMacToolContext` | KC-5 (via orch), Prod path | **Runtime + egress** | Called; POST /tools/run observed in egress |
| Web search | `tools/webSearch.ts` / `webSearch` | KC-1 (via orch), Prod path | **Runtime + egress** | Called; Brave fetch observed in egress |
| Gateway auth | `provider-gateway/server.mjs` | R5 (5 tests) | **Runtime (HTTP)** | Gateway process started; auth tested via HTTP |
| Gateway tools | `provider-gateway/server.mjs` | R3 (3 tests) | **Runtime (HTTP)** | Unknown tool returns 400 |
| Gateway exec | `provider-gateway/tools.mjs` | R4 (3 tests) | Structural | execFile, fixed paths, no shell |
| Network monitor | `networkMonitor.ts` / `networkMonitor` | R11, Adversarial | **Runtime** | Imported; cleared and verified empty after adversarial |
| Adversarial response | `securityGateway.ts` / `sanitizeOutput` | Adversarial (10 tests) | **Runtime** | 7 adversarial payloads through sanitizeOutput; storage/egress side effects verified zero |
| Send flow (index.tsx) | `index.tsx` / `sendMessageWithText` | R1, R2, KC-4 | Structural | Source verified; calls extracted orchestration |

## R1-R12 Results

| ID | Requirement | Result | Method |
|----|-------------|--------|--------|
| R1 | ReasoningEngine output selects no tool | **PASS** | Structural + adversarial: no parser; 7 adversarial outputs through sanitizeOutput |
| R2 | ReasoningEngine output writes no config | **PASS** | Adversarial: 7 outputs through sanitizeOutput; AsyncStorage + secureStorage verified unchanged |
| R3 | Gateway allowlist fixed; unknown -> 400 | **PASS** | HTTP: 400 for unknown tool |
| R4 | Gateway execFile with fixed args | **PASS** | Structural: fixed paths, arrays, no shell |
| R5 | Gateway bearer auth + timingSafeEqual | **PASS** | HTTP: no-token/wrong-token -> 401; correct -> 200 |
| R6 | Credentials not in model payloads | **PASS** | Structural + runtime: sanitizeOutput redacts |
| R7 | Cordelia in every active prompt | **PASS** | **Egress**: cloud /claude body system="You are Cordelia..."; local /api/chat system message="You are Cordelia..." |
| R8 | History cannot affect decisions | **PASS** | Structural + runtime: detectTools, classifyData on current text only |
| R9 | Sensitive text no cloud egress | **PASS** | **Egress**: orchestration with isSensitive=true; Ollama attempted; ZERO port-8787 egress |
| R10 | safeMode no cloud fallback | **PASS** | **Egress**: orchestration with safeMode=true; Ollama attempted; ZERO port-8787 egress |
| R11 | No write path from output | **PASS** | Adversarial: networkMonitor.clear() then 7 adversarial outputs; zero entries after |
| R12 | Credentials never on iPhone | **PASS** | Structural + HTTP: no keys in source; /health boolean flags only |

## KC-1-KC-5 Results (Characterization)

| ID | Known Conflict | Result | Method |
|----|---------------|--------|----------|
| KC-1 | Sensitive text reaches Brave | **PASS** | **Executable**: orchestration("latest news about my diabetes medication") makes Brave fetch; egress confirms |
| KC-2 | Sensitive history reaches cloud | **PASS** | **Executable**: orchestration with SSN/medical history; cloud /claude body contains "SSN is 123-45-6789" |
| KC-3 | Unclassified toolContext reaches cloud | **PASS** | Structural: orchestration injection-checks but does not classifyData on toolContext |
| KC-4 | Summarize bypasses classification | **PASS** | Structural: handleSummarize hardcodes isSensitive: false (separate from orchestration) |
| KC-5 | Tools execute before authorization | **PASS** | **Executable**: orchestration("check git status and search...") triggers /tools/run + Brave before routeAI |

## Egress Ledger Coverage

| Endpoint | Intercepted | Evidence |
|----------|-------------|----------|
| Ollama (port 11434) | **YES** | R9/R10/R7: fetch captured with body content (system prompt inspected) |
| Provider gateway /claude (port 8787) | **YES** | R7/KC-2: body captured with system prompt + messages array |
| Brave Search (api.search.brave.com) | **YES** | KC-1/KC-5: fetch captured with query parameter |
| Provider gateway /tools/run | **YES** | KC-5: POST with body `{tool}` captured |

Body content captured for `/claude` and `/api/chat` paths. Ledger records: url, host, port, path, method, ts, bodySize, bodyKeys, bodyContent.

## Injection fuzzer findings

79 payloads through production `checkInjection`. 37 differ from mock (server.js has 47+5+26 patterns vs production 16).

## Four coverage-check findings

Documented in `tests/m0/coverage-findings.md`. No changes from prior run.

## TypeScript result

```
npx tsc --noEmit — PASS (no errors)
```

## Whitespace check

```
git diff --check                            PASS (tracked)
git diff --no-index --check on 14 files     PASS (all untracked files clean)
```

## Final git status

```
 M app/(tabs)/index.tsx
?? M0-VALIDATION-REPORT.md
?? services/sendOrchestration.ts
?? tests/
```

## M0 File Inventory

```
PRODUCTION (1 modified, 1 new):
  app/(tabs)/index.tsx                    Modified: calls extracted orchestration
  services/sendOrchestration.ts           New: behavior-preserving extraction

TEST INFRASTRUCTURE (13 new):
  tests/m0/register.mjs
  tests/m0/hooks.mjs
  tests/m0/run.test.mjs
  tests/m0/coverage-findings.md
  tests/m0/mocks/encrypted-storage.mjs
  tests/m0/mocks/async-storage.mjs
  tests/m0/mocks/expo-sqlite.mjs
  tests/m0/mocks/expo-local-auth.mjs
  tests/m0/mocks/expo-fs-legacy.mjs
  tests/m0/mocks/llama-rn.mjs
  tests/m0/mocks/expo-device.mjs
  tests/m0/mocks/claude-types.mjs

REPORT (1 new):
  M0-VALIDATION-REPORT.md
```

## Production diff summary

`app/(tabs)/index.tsx`: 14 insertions, 97 deletions
- Added import of `executeSendOrchestration`, `detectSearchQuery`, `formatToolContext` from `sendOrchestration.ts`
- Removed inline `SEARCH_PATTERNS`, `detectSearchQuery()`, `formatToolContext()`
- Replaced inline tool-context building + routeAI + sanitizeOutput + networkMonitor.logCall with `executeSendOrchestration()` call
- Passes precomputed `isSensitive`, `dataClass`, and `dataSizeBytes` to orchestration
- Post-orchestration code uses `orchResult.reply` and `orchResult.result`

`services/sendOrchestration.ts`: New file (148 lines)
- Behavior-preserving extraction of send orchestration logic
- Exports: `executeSendOrchestration`, `detectSearchQuery`, `formatToolContext`, `SEARCH_PATTERNS`

## M0 Verdict

**M0 PASS**

1. Test command: 71 tests, 71 pass, 0 fail (976ms)
2. Send path executable: YES (executeSendOrchestration tested in KC-1, KC-2, KC-5, R7, R9, R10)
3. R1-R12: ALL PASS (R7 via active-prompt egress; R9/R10 via egress; R1/R2/R11 via adversarial)
4. KC-1-KC-5: ALL PASS (KC-1, KC-2, KC-5 executable; KC-3, KC-4 structural)
5. Injection fuzzer: 79 payloads through production checkInjection
6. Four coverage findings: documented
7. TypeScript: PASS
8. Whitespace: PASS (tracked + all untracked)
9. No M1 work: YES
10. Diff is M0-only: YES
