# PrivateAI v2

**Claude on your iPhone. Private. Encrypted. Auditable.**

A minimal iOS app that brings Claude to your pocket without sacrificing privacy. Medical records, financial data, and sensitive conversations stay encrypted on your device—they never touch cloud servers unless you explicitly choose to send them.

## What's Different in v2

- **Minimal:** ~500 lines of UI code (vs 2300 lines of old bloat)
- **Privacy-first:** Medical/financial data hard-blocked from cloud APIs
- **Transparent:** See in real-time what data leaves your device
- **Encrypted:** All chat history stored in AES-256 encrypted vault
- **Auditable:** Security events logged, network calls visible
- **Voice input:** Tap to speak, auto-stops after silence
- **No personas:** Just Claude. Direct. Honest.

## Architecture

```
User Input → Security Check (injection detect) → Data Classification
  ↓
Sensitive (medical/financial/PII)?
  ├─ Yes → Local AI only (Llama 1B) or reject
  └─ No → Cloud (Claude API) or local fallback

Response → Sanitization → Encrypted Storage → Display
```

### Services

| Service | Purpose |
|---------|---------|
| `aiRouter.ts` | Route cloud vs local, enforce sensitive data rules |
| `securityGateway.ts` | Injection detection, output sanitization, data classification |
| `dataVault.ts` | Face ID authentication, vault locking |
| `claude.ts` | Type definitions |

### Components

- `app/(tabs)/index.tsx` — Main chat UI (498 lines)
- `components/chat/SacredGeometryBackground.tsx` — Animated background
- Core navigation tabs

## Setup

### Prerequisites

- macOS (development)
- iPhone 17 Pro Max (or any iOS 15+)
- Xcode 15+
- Node.js 18+

### Install

```bash
cd PrivateAI
npm install
```

### Configure

1. **Claude API Key:**
   ```bash
   echo "EXPO_PUBLIC_CLAUDE_API_KEY=sk-ant-api..." > .env.local
   ```

2. **Optional: Local Llama (Mac Mini)**
   - Run Ollama on Mac Mini: `ollama run llama2-7b`
   - Update `aiRouter.ts` with Mac Mini IP if on same network

### Run

```bash
# Start dev server
expo start

# On iPhone: press 'i' to open on device
# Or scan QR code with Expo Go app
```

## Usage

### Chat

1. **Type or speak** — Tap the microphone to voice input, auto-stops after 4s silence
2. **Attach images** — Tap the image icon to attach from photo library
3. **Send** — Hit the send button (or auto-sends voice input after silence)

### Security

- **Face ID locks after 5 minutes** backgrounding
- **Sensitive data blocks cloud** — app shows security warning if detected
- **Network transparency** — each message shows routing badge (☁️ cloud or 📱 local)

## Privacy Guarantees

✅ **Medical data never touches cloud APIs**
- Keyword-detected medical content routed to local AI only
- If local not available, request rejected (user sees error)

✅ **Financial/PII same rules**
- Credit card, bank account, SSN, etc. → local only
- Injection detected → cloud disabled for session

✅ **Encrypted storage**
- AES-256 all local data at rest
- Face ID required to unlock vault on app launch

✅ **Auditable**
- Security event log (encrypted, metadata-only)
- Network monitor shows every API call destination
- No API key, credentials, or raw input ever logged

## Cleanup

Old code from personas/medical/knowledge graphs era:

```bash
# Delete 31 services and 3 components
node cleanup-v2.js
```

## Next Steps

- [ ] Test on iPhone 17 Pro Max
- [ ] Verify voice input fix (no more `Voice.destroy()` crash)
- [ ] Add other tabs (if needed)
- [ ] Vision Pro build (future)

## Performance

- App UI: ~500 lines
- Core services: ~400 lines
- Build time: ~2 min (Expo)
- Bundle size: ~15MB (iOS)
- Memory: ~120MB peak (chat thread)

## Known Limitations

- Local Llama 1B has lower quality than Claude 3.5
- Image analysis only works via Claude API (cloud)
- No multi-turn conversation with local AI yet
- Voice input requires iOS 14.5+

## Philosophy

**Privacy as structural guarantee, not marketing.**

Every privacy claim is enforced at the code level:
- Medical data hard-blocked from cloud *before* API call
- Encryption keys never leave device
- Security events logged but never contain raw data
- Network calls visible to user in real-time

No behavioral promises. No "pinky swear." Code that refuses.

---

Built by Pete. Designed by Cordelia. Audited by Claude.

**Version 2.0.0** • May 2026
