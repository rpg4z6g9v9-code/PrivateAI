# PrivateAI — Claude Code Guidelines

PrivateAI is an Expo/React Native app with local-first AI routing.
Goals: local/private inference by default · secure routing boundaries · predictable send flow · deterministic verification workflow.

## Core rules
- Prefer the smallest safe fix — keep blast radius small
- Prefer additive changes over rewrites
- Verify UI changes on device before considering them complete
- Run `npx tsc --noEmit` after every code change
- Remove debug logs after fixes are confirmed on device
- Never commit .env, secrets, or .claude/settings.local.json
- Use git tags for stable milestones before adding features
- Keep changes scoped to what was asked — do not refactor adjacent code
- Do not add orchestration prematurely
- Use explicit cleanup paths (finally blocks, catch cleanup, ref resets)

## Build and test
```bash
# Build + install on device
npx expo run:ios --device "00008150-001965C41AF0401C"

# Dev server (JS-only changes)
npx expo start --dev-client --clear

# Type check
npx tsc --noEmit
```

## Architecture — key files
- `app/(tabs)/index.tsx` — main chat UI, send flow, history modal
- `services/aiRouter.ts` — routing logic (local-first, cloud fallback)
- `services/localAI.ts` — Ollama client + XHR streaming + node health check
- `services/conversationDB.ts` — SQLite persistence (expo-sqlite v16 async API)
- `services/securityGateway.ts` — injection detection + output sanitization
- `security/fuzzer/` — 109-payload test suite, pre-commit hook on securityGateway.ts

## Architecture invariants
- `messages` table = immutable history (never mutate for metadata)
- `conversations` table = mutable metadata (title, archived)
- ACTIVE === LOADED today — document before breaking this
- archive != delete (soft delete only, always recoverable)
- Sensitive data never routes to cloud — enforced in aiRouter.ts

## Send flow invariants — must never silently break
- `sendingRef.current = false` always resets in `finally`
- `streamingMsgIdRef.current = null` cleared in both success and catch paths
- `checkInjection(toolContext)` called before `routeAI()` on every send
- Conversation history filtered to user/assistant roles only before model send
- Conversation history capped at 10 messages before model send
- Double-submit guard uses `sendingRef` (synchronous ref), not React state

## Routing
- Private node: Ollama/phi4-mini at 192.168.4.52:11434
- Cloud fallback: Claude API (claude-sonnet-4-6)
- Node check happens before every send — routing uses local var, not React state

## iOS interaction notes
- Nested modals fight touch responders: close first modal, 100ms delay, open second
- Swipeable inside ScrollView causes gesture conflicts — avoid
- Pressable is more reliable than TouchableOpacity inside modals
- Test gesture interactions on physical device, not simulator

## Verification rules
- All findings require evidence: cite file + line + reasoning
- Use PASS / FAIL / NEEDS_INFO verdicts
- Include COMPACT_SUMMARY in every agent report
- Escalate only for meaningful risks — not style issues
- See AGENTS.md for full pipeline and protocol list

## Memory strategy
- Save decisions, not conversations
- Decisions → docs/reference/*.md or this file
- Workflows → AGENTS.md
- Operating rules → MEMORY.md (auto-memory)
- Commit messages → what changed and why
- Do not preserve verbose logs or temporary debugging output

## Stable rollback tags
- `stable-routing-v1` — routing + node health
- `stable-conversation-system-v1` — persistence + retrieval
- `stable-memory-workspace-v1` — full memory lifecycle
- `stable-websearch-gateway-v1` — web search + toolDB
- `stable-websearch-gateway-v2` — IP migration, injection guard, phi4-mini fix
- `stable-websearch-gateway-v2.1` — VERSION_TAG alignment, formatToolContext sentinel fix
