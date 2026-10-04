# M3 Validation Report

## Baseline

| Field | Value |
|-------|-------|
| Starting commit | `0dd110255f82c4ce1ff6e8f217ad9cdc2a29b423` |
| Branch | `feature/cordelia-iphone-gateway` |
| Starting working-tree state | Clean |

## Phase A Discovery

### Persistence topology
- **conversationDB**: `privateai_v1.db`, expo-sqlite v16, `<Documents>/SQLite/`
- **toolDB**: `privateai_tools_v1.db`, separate database, same location
- **networkMonitor**: in-memory ring buffers, zero persistence
- **New CP store**: `privateai_controlplane_v1.db`, separate database, same location

### INSERT OR REPLACE reachability
YES — `persistMessage()` uses `INSERT OR REPLACE INTO messages`. Reachable from send path. M3 does not change this.

### Data Protection entitlement
- **File**: `ios/PrivateAI/PrivateAI.entitlements` — empty dict (`<dict/>`)
- **`com.apple.developer.default-data-protection`**: ABSENT
- **Effective class**: Apple default applies — `NSFileProtectionCompleteUntilFirstUserAuthentication` for Documents directory
- **Evidence**: Entitlements file contains no data protection key. expo-sqlite stores in `<Documents>/SQLite/` (from `SQLiteModule.swift:28` → `FileManager.documentDirectory`).

### M1 vocabulary
M1 `RECORD_TYPES` unchanged — 8 canonical types. Interim M2 gate actions stored with `record_kind='interim_gate'` discriminator, keeping `record_type='observation'` (canonical).

### M2 interim-action representation
Discriminated union type in Recorder:
- `record_kind='canonical'` + `record_type=<valid M1 RecordType>` for architecture records
- `record_kind='interim_gate'` + `record_type=null` for temporary M2 gate actions

Invalid combinations (e.g. `canonical` + `null`, or `interim_gate` + `'observation'`) are structurally impossible via TypeScript union types. M1 canonical vocabulary remains locked at exactly 8 types.

## Files added

```
services/controlPlane/identifiers.ts  Identifier minting (D9 session)
services/controlPlane/recorder.ts     Recorder — sole CP writer
tests/m3/run.test.mjs                M3 test harness (31 tests)
M3-VALIDATION-REPORT.md              This file
```

## Modified files

```
services/sendOrchestration.ts         M3 user_statement + interim gate recording
app/(tabs)/index.tsx                  Pass real userMsg.id to orchestration
tests/m0/mocks/expo-sqlite.mjs       Enhanced: in-memory row store + PK enforcement
tests/m0/run.test.mjs                orchParams messageId
tests/m1/run.test.mjs                M1 RECORD_TYPES restored to 8 canonical
tests/m2/run.test.mjs                orchParams messageId
```

## Message-ID linkage

`userMsg.id` (e.g. `1728000000000_user`) is created in `index.tsx:370` and passed to `executeSendOrchestration` via the `messageId` parameter. The orchestration records it as `user_statement.message_id`. Query by that message_id returns the linked user_statement. Test proves: `persisted message id X → user_statement.message_id = X`.

## Recorder API

| Method | Purpose |
|--------|---------|
| `appendRecord(record)` | Sole write — transactional INSERT INTO |
| `queryByRecordId(id)` | Read-only |
| `queryBySessionId/ConversationId/MessageId/RequestId(id)` | Read-only |

Returns `{ status: 'recorded' | 'degraded', record_id?, error? }`.

No `update()`, `delete()`, `replace()`, `upsert()`, `patch()`.

### Transaction implementation
```
BEGIN TRANSACTION → INSERT INTO → COMMIT
on error → ROLLBACK → return degraded
```

### Fault matrix

| Case | Test | Result |
|------|------|--------|
| A. Init failure | Uninitialized Recorder → degraded, zero partial records | PASS |
| B. Append failure | Duplicate PK → degraded, original unchanged | PASS |
| C. Chat continues | Broken Recorder → orchestration completes, no duplicate on next success | PASS |

## Durability

In-memory mock proves records survive Recorder module reset + reinit. This uses the mock's persistent `_databases` Map — **NOT equivalent to actual device restart**. Full device restart durability requires manual on-device verification using a real iOS simulator with expo-sqlite.

**Manual test required for full durability claim**: append record → kill app → relaunch → query by id → record still present. This test cannot be automated in the current Node.js test environment.

## Test results

```
M3: 30 tests, 13 suites, 30 pass, 0 fail — 5212ms (includes 5s readiness timeout test)
M2: 57 tests, 17 suites, 57 pass, 0 fail — 177ms
M1: 73 tests, 14 suites, 73 pass, 0 fail — 120ms
M0: 71 tests, 27 suites, 71 pass, 0 fail — 688ms
TypeScript: PASS
git diff --check: PASS
```

## M3 exit gate

| # | Requirement | Result |
|---|-------------|--------|
| 1 | Data Protection resolved | PASS — entitlement absent, Apple default applies |
| 2 | user_statement linked to session/conversation/message | PASS — real userMsg.id |
| 3 | D9 session semantics | PASS — module-level singleton |
| 4 | Query-by-any-id | PASS — 5 query methods |
| 5 | Recorder: append/query only | PASS |
| 6 | No mutation path | PASS — 1 INSERT INTO, 0 UPDATE/DELETE/REPLACE |
| 7 | Fault injection: A/B/C | PASS — all three cases |
| 8 | R11: model output zero records | PASS |
| 9 | Interim gate actions distinct from M6 authorization | PASS — record_kind='interim_gate' |
| 10 | Messages/reload unchanged | PASS |
| 11 | toolDB/networkMonitor unchanged | PASS |
| 12 | M2/M1/M0 regressions | PASS — 57/73/71 |
| 13 | TypeScript | PASS |
| 14 | No M4+ runtime | PASS |

## Recorder readiness lifecycle

`initRecorder()` shares one promise across concurrent callers (`_initPromise` singleton). `ensureReady()` awaits with 5s timeout, returns false on failure/timeout. Orchestration calls `ensureReady()` before `appendRecord()`.

**Startup race — successful**: Paused `openDatabaseAsync` via mock hook → started `initRecorder()` (not awaited) → started `executeSendOrchestration` concurrently → verified zero records while init unresolved → released init → send completed → exactly ONE user_statement with correct message_id → same init promise reused (no second initialization).

**Startup race — failed**: Paused `openDatabaseAsync` → started init → failed the open → send ran against failed state → `ensureReady()` returned false → recorderStatus=degraded → ZERO user_statement → ZERO fabricated interim record → no hidden second init attempt.

**Timeout**: `READY_TIMEOUT_MS = 5000`. The failed-init race test exercises the actual timeout (test takes ~5.2s). If init remains unresolved past timeout, ensureReady returns false and send proceeds degraded.

## Transaction implementation

`BEGIN TRANSACTION → INSERT INTO → COMMIT`. On any error after BEGIN: `ROLLBACK → return degraded`.
Mock SQLite double models: BEGIN (snapshot), COMMIT (publish or fault-inject failure), ROLLBACK (discard staged). COMMIT fault test proves: INSERT staged but COMMIT fails → ROLLBACK → zero committed records → later success → exactly one record.

## Real SQLite Process-Restart Durability

**Target**: iOS Simulator, iPhone 17 Pro Max (D6A32F8B), iOS 26.x
**Bundle**: com.chowmein97sorganization.privateai
**DB path**: `<AppData>/Documents/SQLite/privateai_controlplane_v1.db`
**Container**: 17EEF1E4 (unchanged throughout)

**Pre-restart record**: `record_id=req.1791144046047.2.3rpllg`, `record_kind=canonical`, `record_type=user_statement`, `session_id=sess.1791143324665.1.7nlrjd`, `message_id=1791144045428_user`, `source=send_orchestration`

**Message-id linkage**: `conversationDB.messages.id` = `cp_records.message_id` = `1791144045428_user` — MATCH

**Termination**: `simctl terminate` — process confirmed gone
**Relaunch**: `simctl launch` — new PID, same data container

**Post-restart**: Same record_id, record_kind, record_type, session_id, conversation_id, message_id, timestamp, source — all fields identical. user_statement count for message_id = 1 (no duplicate). Total CP records = 2 (unchanged).

**PRAGMA integrity_check**: `ok` (pre and post restart)

**Onboarding after relaunch**: Normal chat screen (onboarding preserved)

**D9 restart check**: PASS
- Pre-restart session_id: `sess.1791143324665.1.7nlrjd`
- Post-restart session_id: `sess.1791144349288.1.a8mhou`
- Session_ids DIFFERENT after app relaunch (D9 confirmed)
- conversation_id: `default` in both (same conversation, different session)

## M3 Verdict

**M3 ALL GATES PASS** (automated + device durability + D9)
