# M2 Validation Report

## Baseline

| Field | Value |
|-------|-------|
| Starting commit | `37fd03248f9eb556d9c1a0de8cc852d7e1d07d47` |
| Branch | `feature/cordelia-iphone-gateway` |
| Starting working-tree state | Clean |

## Test commands

```bash
node --experimental-transform-types --no-warnings \
     --import ./tests/m0/register.mjs --test tests/m2/run.test.mjs
node --experimental-transform-types --no-warnings \
     --import ./tests/m0/register.mjs --test tests/m0/run.test.mjs
node --experimental-transform-types --no-warnings \
     --import ./tests/m0/register.mjs --test tests/m1/run.test.mjs
```

## Files added

```
services/controlPlane/classifier.ts           Payload classifier (M2)
services/controlPlane/interimBoundaryGate.ts  Interim boundary gate (TEMPORARY — remove M8)
services/controlPlane/semanticContext.ts       Embedding/retrieval gate (M2)
tests/m2/run.test.mjs                        M2 test harness (57 tests)
M2-VALIDATION-REPORT.md                      This file
```

## Modified runtime files

```
app/(tabs)/index.tsx          M2 embedding gate + summarize wiring + fetchCredential
services/sendOrchestration.ts M2 classifier + gate integration
```

## New runtime files

```
services/controlPlane/classifier.ts           Payload classifier module
services/controlPlane/interimBoundaryGate.ts  Interim boundary gate (TEMPORARY — remove M8)
services/controlPlane/semanticContext.ts       Embedding/retrieval gate module
```

## Modified test files

```
tests/m0/run.test.mjs        KC-1-4 inverted + coverage restored to 71
tests/m1/run.test.mjs        sendOrchestration authorized as controlPlane consumer
```

## Pre-commit audit corrections

Security audit found three blockers, all resolved:

1. **BND-10 summarize bypass** — `handleSummarize` now calls `executeSummarizeOrchestration()`. Old direct `routeAI` path removed. Live summarize performs injection check + payload classification + interim gate.

2. **Protected text reaching Ollama embeddings** — Extracted `gateSemanticContext` (services/controlPlane/semanticContext.ts) classifies current text before embedding/retrieval. Protected text → embedUserMessage NOT called, findRelevantNodes NOT called. Executable test proves callback counts = 0. `index.tsx` calls the extracted helper.

3. **Voice boundary overclaim** — Corrected from "on-device, zero network egress" to "NETWORK-CAPABLE / NOT GUARANTEED ON_DEVICE". See voice section below.

## Classifier architecture

### Module: services/controlPlane/classifier.ts

Extends production `classifyData` with payload-segment classification + protected detection + stored-credential matching. Uses M1 DataClass vocabulary.

### Payload segments

| Segment | Classification |
|---------|---------------|
| current_text | Existing classifyData + protected patterns + stored credential check |
| history | Each ConversationMessage classified individually with index |
| tool_context | Classified after injection screening |
| search_query | Classified before Brave fetch |
| summarize_transcript | Classified before reasoning |

### Protected detectors

13 detectors: anthropic_api_key, openai_api_key, stripe_key, tavily_key, brave_key, github_pat, github_oauth, github_fine_pat, bearer_token, password_assignment, password_value, private_key_block, app_brave_key, app_gateway_token.

### App-stored credential sources

| Storage | Key | Detector |
|---------|-----|----------|
| AsyncStorage | `brave_search_api_key_v1` | app_brave_key |
| secureStorage | `providerGatewayToken_v1` | app_gateway_token |

No credential values in this report, tests, or diagnostics. Tests use fake values only.

## Existing keyword lists preserved

Production MEDICAL/FINANCIAL/PII keywords unchanged. M2 classifier calls existing `classifyData()`. Parity tests prove identical results across full keyword corpus (19 medical, 15 financial, 8 PII terms). No false positives observed.

## Interim boundary gate

TEMPORARY — REMOVE IN M8. Does NOT produce authorization records, read PolicyDocument, create evidence, or choose providers.

| Classification | Reasoning | Search |
|---------------|-----------|--------|
| public/internal | proceed | allow |
| sensitive | local-only | block |
| protected | refuse (D7) | block |

## Test results

```
M2: 57 tests, 17 suites, 57 pass, 0 fail — 220ms
M0: 71 tests, 27 suites, 71 pass, 0 fail — 708ms
M1: 73 tests, 14 suites, 73 pass, 0 fail — 121ms
TypeScript: PASS
git diff --check: PASS
```

## KC-1-KC-5 results

| KC | Status | Method | Result |
|----|--------|--------|--------|
| KC-1 | INVERTED | Executable egress + structural | Sensitive search → ZERO Brave. Gate before webSearch. |
| KC-2 | INVERTED | Executable egress + structural | Sensitive history → ZERO cloud. classifyPayload before routeAI. |
| KC-3 | INVERTED | Executable egress | Sensitive tool result → /tools/run executes, ZERO /claude. Protected tool result → /tools/run executes, reasoning refused, ZERO reasoning egress. |
| KC-4 | INVERTED | Executable egress | Sensitive summarize → ZERO cloud. Protected → ZERO engine. Injection → refused. |
| KC-5 | UNCHANGED | Structural | Tools execute before authorization (transitional). |

## R1-R12 results

All 12 PASS. No changes to R1-R12 semantics.

## Egress matrix

| # | Scenario | Brave | Ollama embed | Ollama reason | Claude | Result |
|---|----------|-------|-------------|---------------|--------|--------|
| A | sensitive search | ZERO | - | - | - | PASS |
| B | sensitive history | - | - | - | ZERO | PASS |
| C | sensitive toolContext | - | - | local-only | ZERO | PASS |
| D | protected toolContext | - | - | ZERO | ZERO | PASS |
| E | sensitive summarize | - | - | - | ZERO | PASS |
| F | protected summarize | - | - | ZERO | ZERO | PASS |
| G | protected current text | ZERO | ZERO | ZERO | ZERO | PASS |
| H | KC-5 transitional | - | - | - | - | PASS |

## Live summarize path

`handleSummarize` at `index.tsx` calls `executeSummarizeOrchestration()`. Old direct `routeAI({ isSensitive: false })` path removed. Verified structurally: no `isSensitive: false` in summarize block; `executeSummarizeOrchestration` present.

## Protected embedding containment

Extracted `gateSemanticContext` (services/controlPlane/semanticContext.ts) called by `index.tsx`. Executable tests prove:
- Protected text: embedUserMessage callback count = 0, findRelevantNodes callback count = 0
- Ordinary text: both callbacks called normally
- Sensitive non-protected text: embedding behavior preserved (per locked plan)
- Structural supplement: gateSemanticContext call precedes streaming placeholder in index.tsx

## Voice transcription boundary

**NETWORK-CAPABLE / NOT GUARANTEED ON_DEVICE**

Evidence:
- Uses Apple `SFSpeechRecognizer` via `@react-native-voice/voice` v3.2.4
- `requiresOnDeviceRecognition` is NOT set to `true` in `Voice.m`
- `supportsOnDeviceRecognition` is NOT checked before recognition
- Apple may transparently use server-side recognition
- No M2 voice runtime change applied
- Policy handling deferred to M6 per locked plan

Unknown #6 is RESOLVED AS A BOUNDARY FINDING, not resolved as ON_DEVICE.

## M2 scope confirmation

- No Authorizer: confirmed
- No Policy Store: confirmed
- No Recorder: confirmed
- No capability authorization: confirmed
- No ALLOW/DENY/ASK runtime decisions: confirmed
- No M3 identifier runtime: confirmed
- No M8 execution reordering: confirmed
- InterimBoundaryGate marked TEMPORARY — REMOVE IN M8

## M2 Verdict

**M2 PASS**
