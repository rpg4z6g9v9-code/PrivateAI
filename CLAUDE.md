# PrivateAI — Claude Code Guidelines

## Core rules
- Prefer the smallest safe fix
- Verify UI changes on device before considering them complete
- Run `npx tsc --noEmit` after every code change
- Remove debug logs after fixes are confirmed on device
- Never commit .env, secrets, or .claude/settings.local.json
- Use git tags for stable milestones before adding features
- Keep changes scoped to what was asked — do not refactor adjacent code

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

## Routing
- Private node: Ollama/phi4-mini at 192.168.4.43:11434
- Cloud fallback: Claude API (claude-sonnet-4-6)
- Node check happens before every send — routing uses local var, not React state

## iOS interaction notes
- Nested modals fight touch responders: close first modal, 100ms delay, open second
- Swipeable inside ScrollView causes gesture conflicts — avoid
- Pressable is more reliable than TouchableOpacity inside modals
- Test gesture interactions on physical device, not simulator

## Stable rollback tags
- `stable-routing-v1` — routing + node health
- `stable-conversation-system-v1` — persistence + retrieval
- `stable-memory-workspace-v1` — full memory lifecycle
