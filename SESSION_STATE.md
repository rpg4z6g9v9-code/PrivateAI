# SESSION_STATE.md — PrivateAI Checkpoint

**Date:** 2026-05-26
**Tag candidate:** `stable-websearch-gateway-v1`
**TypeScript:** clean (`npx tsc --noEmit` passes)

---

## Current Stable State

### Infrastructure
- Private node: Mac Mini at `192.168.4.43:11434`, phi4-mini:latest
- Ollama LAN binding: `OLLAMA_HOST=0.0.0.0` — LaunchAgent written at `~/Library/LaunchAgents/com.ollama.ollama.plist`
- Cloud fallback: Claude API (`claude-sonnet-4-20250514`) via `EXPO_PUBLIC_CLAUDE_API_KEY`
- Routing: local-first, cloud fallback, transition-only logs

### Capability State Model (shared truth in `services/tools/webSearch.ts`)
```
unavailable  → no Brave key stored
configured   → key stored, not yet tested this session
operational  → last search succeeded
degraded     → last search failed (network/timeout/server — retryable)
auth_failed  → 401/403 — key invalid, needs reconfiguration
```
Single source (`_sessionStatus`), three consumers: router, System panel, runtime grounding.

### Runtime Grounding (`services/aiRouter.ts`)
- Section: `## Runtime state — canonical` — authority framing
- Declares confirmed capabilities and unavailables
- web.search included/excluded/qualified based on live status
- Prohibits XML tool narration, prohibits speculation about missing data

---

## Completed Changes (this session)

### Runtime grounding / capability state
- `services/aiRouter.ts`: `buildRuntimeContext()` with canonical authority framing
- `services/aiRouter.ts`: `Capabilities` interface with `WebSearchStatus` (not boolean)
- `services/aiRouter.ts`: `resolveCapabilities()` — AsyncStorage fallback on cold start
- `services/claude.ts`: `toolContext?: string` added to `AIRouteParams`

### web.search orchestration
- `services/tools/webSearch.ts` (new): Brave Search API executor, Tier 0
- `services/toolDB.ts` (new): append-only `privateai_tools_v1.db`, WAL mode
- `app/(tabs)/index.tsx`: `detectSearchQuery()`, `formatToolContext()`, pre-send execution
- `services/tools/webSearch.ts`: `WebSearchStatus` type, `_sessionStatus` session tracking
- `services/tools/webSearch.ts`: HTTP error classification (401/403 → `auth_failed`, other → `degraded`)
- `services/tools/webSearch.ts`: `clearBraveApiKey()`, `setBraveApiKey()` updates session status

### System panel / configuration UX
- `app/(tabs)/system.tsx` (new): route, model, node, memory, operations, tool history, configuration
- `app/(tabs)/system.tsx`: section index strip, `KeyboardAvoidingView`, scroll indicator
- `app/(tabs)/system.tsx`: `web.search` status row with color coding (green/orange/red/magenta/dim)
- `app/(tabs)/system.tsx`: Brave key input + save + clear (clear visible when key configured)
- `app/(tabs)/index.tsx`: `≡` sheet renamed "Navigation", System + Finance nav buttons added
- `app/(tabs)/index.tsx`: `useFocusEffect` cleanup — history modal auto-dismissed on navigation
- `app/(tabs)/_layout.tsx`: `system` screen registered in Stack

### Cloud fallback diagnostics
- `services/aiRouter.ts`: `cloudRoute()` — fetch wrapped in try/catch with failure classification
- Network failure → user-facing: "Cloud request failed — check internet connection."
- HTTP 401/403 → "key unauthorized — check API key"
- HTTP 429 → "rate limited — try again shortly"
- Response body logged (first 300 chars) on non-200 for diagnostics
- `[Cloud] Request starting` / `[Cloud] HTTP XXX (XXms)` / `[Cloud] Success — XXms, N tokens out`

### Private node binding / logging
- `services/localAI.ts`: `_lastNodeOnline` module-level tracker
- `checkPrivateNode()`: transition-only logging — fires once on state change, silent while stable
- Infrastructure fix: `OLLAMA_HOST=0.0.0.0` + LaunchAgent (Mac Mini side)

### Gateway architecture docs
- `docs/gateway-architecture.md` (new): runtime state, channels, capability tiers, permission model, progression sequence
- `docs/architecture-blueprint.md` (new): system of record rule, tool execution rule, provenance rule
- `docs/privateai-tool-layer.md` (new): tool layer design

---

## Verified Behavior (on device)

| Behavior | Status |
|---|---|
| Cloud route works when node offline | ✓ verified |
| Node health badge updates correctly | ✓ verified |
| web.search intent detection fires | ✓ verified |
| Tool calls logged in System → operations | ✓ verified |
| Brave key save/clear updates status immediately | ✓ verified |
| Runtime grounding reflects actual web.search status | ✓ verified |
| Assistant reports degraded state honestly | ✓ verified |
| Assistant does not hallucinate search results | ✓ verified |
| System panel reachable via ≡ → System | ✓ verified |
| Keyboard avoidance in System configuration | ✓ verified |
| Node offline → online transition logged once | ✓ (pending retest after LaunchAgent fix) |

---

## Known Issues

| Issue | Severity | Notes |
|---|---|---|
| Node binding required manual fix each Mac restart | Fixed | LaunchAgent written — needs one more reboot test |
| `<search>` XML narration sometimes appears | Low | Prompt instruction added to suppress; monitor |
| Ambiguous search intent threshold | Low | Some queries may over-trigger; tune patterns if confirmed in stress test |
| `web.search` status stale across app restarts | Low | `_sessionStatus` resets to `unavailable` on process restart; recovers on first route check |

---

## Do-Not-Do List

- Do not add `file.read` until this checkpoint is tagged and stress-tested
- Do not add new tools until web.search cycle (degraded → recovery) is validated
- Do not change runtime grounding unless a concrete assistant behavior failure appears
- Do not redesign UI surfaces
- Do not add onboarding, coach marks, or tutorial flows
- Do not connect any write-capable tool (email, calendar, shell, file.write)
- Do not merge OpenClaw or any external agent framework

---

## Next Stress Tests (before new features)

1. Long session: 10+ searches — verify operations panel stays readable
2. Degraded recovery: clear key → search → restore key → search — verify status transitions
3. Node transition: go offline mid-session → cloud route → come back online → local route resumes
4. Ambiguous intent: messages near the search pattern threshold — tune if false positives appear
5. Mac restart: confirm LaunchAgent survives reboot, OLLAMA_HOST=0.0.0.0 persists

---

## Next Feature Candidate (after stress tests pass)

`file.read` (sandboxed)
- Tier 0, read-only
- Scoped to app Documents directory only
- Same path: intent detect → executor → toolContext injection → logged in toolDB
- No write access
- No arbitrary path traversal

Do not start until `stable-websearch-gateway-v1` is tagged and at least 3 stress tests above are completed.

---

## Rollback

Current last stable tag: `stable-memory-workspace-v1`
Proposed new tag: `stable-websearch-gateway-v1`

Tag after commit is confirmed clean on device.
