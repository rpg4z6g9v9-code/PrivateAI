# PrivateAI

Privacy-first personal AI assistant with 5 specialized personas, on-device inference, and encrypted local storage.

Your data stays on your device. No cloud backend. No telemetry. No accounts.

## What It Does

PrivateAI gives you a team of AI personas, each with their own expertise, memory, and personality — running on your iPhone with military-grade encryption.

| Persona | Role | Color |
|---------|------|-------|
| **Atlas** | Strategic advisor — frames problems, gives options with tradeoffs | Blue |
| **Vera** | Health monitor — tracks symptoms, medications, patterns over time | Red |
| **Cipher** | Security analyst — threat detection, privacy assessment | Orange |
| **Lumen** | Research specialist — deep knowledge synthesis, pattern recognition | Purple |
| **Atom** | Personal assistant — general-purpose helper | Green |

### Key Features

- **5 AI Personas** with isolated identity, memory, and expertise
- **On-device AI** — Llama 3.2 3B runs locally, zero data leaves your phone
- **Medical memory** — health tracking that never touches the cloud
- **Knowledge graph** — auto-indexes concepts from conversations (SQLite)
- **Shared memory** — goals and profile visible across all personas
- **Voice I/O** — speech input + ElevenLabs text-to-speech per persona
- **Security hardening** — prompt injection shield, output sanitization, data integrity verification
- **AES-256 encryption** — all data encrypted via iOS Keychain (Secure Enclave)
- **Calendar, Reminders, Notes** — on-device connectors inject context into AI conversations
- **Web search** — Tavily integration with query sanitization
- **Offline mode** — force all queries to local AI, $0 cost

## Architecture

```
┌─────────────────────────────────────────────┐
│                  UI Layer                    │
│  index.tsx → Sidebar, Modals, Chat, Input   │
├─────────────────────────────────────────────┤
│              Routing Layer                   │
│  aiRouter.ts → contextIsolation.ts          │
│  kernel.ts (team orchestration)             │
├─────────────────────────────────────────────┤
│             Persona Layer                    │
│  personaPrompts.ts → atomPrompts.ts         │
│  Atlas | Vera | Cipher | Lumen | Atom       │
├─────────────────────────────────────────────┤
│             Memory Layer                     │
│  sharedMemory.ts (global: profile, goals)   │
│  memory.ts (per-persona patterns)           │
│  knowledgeGraph.ts (SQLite concept graph)   │
│  knowledgeBase.ts (per-persona documents)   │
│  medicalMemory.ts (global, on-device only)  │
├─────────────────────────────────────────────┤
│            Security Layer                    │
│  securityGateway.ts (injection, output,     │
│    anomaly, classification, trust boundary) │
│  promptFirewall.ts (external content)       │
│  integrityCheck.ts (SHA-256 checksums)      │
│  secureStorage.ts (AES-256 Keychain)        │
│  dataVault.ts (Face ID biometric gate)      │
├─────────────────────────────────────────────┤
│            Inference Layer                   │
│  claude.ts (cloud — Anthropic API)          │
│  localAI.ts (on-device — Llama 3.2 3B)     │
└─────────────────────────────────────────────┘
```

## Getting Started

### Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18+ | `node -v` |
| Xcode | 15+ | Required for iOS builds |
| CocoaPods | Latest | `pod --version` |

### 1. Clone and Install

```bash
git clone https://github.com/rpg4z6g9v9-code/PrivateAI.git
cd PrivateAI
npm install
```

### 2. Configure API Keys

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```env
# Required — get yours at https://console.anthropic.com/settings/keys
EXPO_PUBLIC_CLAUDE_API_KEY=sk-ant-api03-YOUR_KEY_HERE

# Optional — voice output (https://elevenlabs.io/)
EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_YOUR_KEY_HERE

# Optional — web search (https://tavily.com/)
EXPO_PUBLIC_TAVILY_API_KEY=tvly-YOUR_KEY_HERE
```

### 3. Build and Run

```bash
# Install iOS native dependencies
cd ios && pod install && cd ..

# Run on iOS simulator
npx expo run:ios

# Run on physical device (USB)
npx expo run:ios --device
```

### 4. Local AI (Optional)

Once the app is running, open the sidebar and scroll to **Local AI**:
1. Tap "download llama 3b" (~1.8 GB)
2. Wait for download to complete
3. Toggle "Local (on-device)" mode

All queries now run on your phone with zero cloud calls.

## Project Structure

```
app/
  (tabs)/
    index.tsx          # Main chat screen
    conversations.tsx  # Conversation history with batch delete
    controlroom.tsx    # System visualization
    dashboard.tsx      # Voice, security, health, knowledge tabs
    medical.tsx        # Medical memory timeline
    security.tsx       # Network monitoring, security events
    map.tsx            # Knowledge graph visualization
  onboarding.tsx       # First-run setup (API key, permissions)
  _layout.tsx          # Root layout with onboarding gate

components/
  chat/
    types.ts                    # Shared types, constants, utilities
    Sidebar.tsx                 # Navigation + settings drawer
    SacredGeometryBackground.tsx # Animated overlay
    MedicalModals.tsx           # Health entry modals
    KnowledgeBaseModal.tsx      # KB paste modal
  PersonaAvatar.tsx             # Persona visual indicator

services/
  # Personas & Prompts
  personaPrompts.ts    # System prompts for all 5 personas
  atomPrompts.ts       # Dynamic identity layer + dev rules

  # Routing & Inference
  aiRouter.ts          # Smart routing (local vs cloud)
  claude.ts            # Anthropic API client
  localAI.ts           # On-device Llama 3.2 3B
  kernel.ts            # Team orchestration logic
  contextIsolation.ts  # Prompt assembly + contamination prevention

  # Memory
  sharedMemory.ts      # Global context (profile, goals)
  memory.ts            # Per-persona conversation patterns
  knowledgeGraph.ts    # SQLite concept graph with auto-indexing
  knowledgeBase.ts     # Per-persona document storage
  medicalMemory.ts     # Health tracking (on-device only)

  # Security
  securityGateway.ts   # Injection shield, output filter, trust boundary
  promptFirewall.ts    # External content sanitization
  integrityCheck.ts    # SHA-256 data integrity verification
  secureStorage.ts     # AES-256 Keychain wrapper
  dataVault.ts         # Face ID biometric gate
  networkMonitor.ts    # Outbound call logging

  # Connectors
  calendarService.ts   # iOS Calendar (read-only)
  remindersService.ts  # iOS Reminders (read/write)
  notesService.ts      # On-device notes
  filesService.ts      # File picker + content extraction
  webSearch.ts         # Tavily with query sanitization
```

## Security

PrivateAI is built around a zero-trust security model:

- **Encryption:** AES-256 via iOS Keychain (Secure Enclave) for all stored data
- **Prompt injection:** 28-pattern detection shield on all user inputs
- **Output sanitization:** 18-pattern filter prevents leakage of API keys and internal architecture
- **External content firewall:** 30 patterns + invisible Unicode stripping + content truncation
- **Cloud prompt sanitization:** Strips keys, file paths, and device identifiers before API calls
- **Data integrity:** SHA-256 checksums on critical stores, verified on app launch
- **Medical data:** Hard-blocked from cloud — refuses query rather than sending to API
- **Biometric gate:** Face ID / Touch ID protects the data vault
- **Rate limiting:** Anomaly detection locks session after unusual activity
- **Network transparency:** Every outbound call logged and visible in Security tab

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for the full privacy policy.

## Medical Data

PrivateAI includes optional health tracking:

- Log symptoms, medications, doctor visits, lab results
- Pattern detection across entries over time
- Appointment summary generation (explicit opt-in — warns before sending to cloud)
- **All medical data stays on-device by default**
- Medical queries are hard-blocked from cloud APIs — if local AI isn't available, the query is refused entirely

**PrivateAI is not a medical device.** It does not diagnose, prescribe, or provide medical advice.

## Contributing

PrivateAI is open source and welcomes contributions.

### Quick Start for Contributors

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Type-check: `npx tsc --noEmit`
5. Test on iOS simulator or device
6. Submit a PR

### Areas Where Help Is Needed

- **App icons and visual design**
- **Swift native modules** — deeper iOS integration (HealthKit, Siri Intents)
- **Test coverage** — unit and integration tests
- **Android testing**
- **Knowledge graph improvements** — richer relationship types, better extraction
- **Additional persona development**

### Guidelines

- Privacy first — never send data to external services without explicit user consent
- Medical data never touches the cloud unless the user explicitly requests it
- All storage must go through `secureStorage.ts` (encrypted)
- Test on a real device before submitting PRs that touch local AI or native features

## Support

PrivateAI is free and open source. If you find it useful, consider supporting development:

[Buy Me a Coffee](https://buymeacoffee.com/privateai)

## License

[MIT](LICENSE)

## Acknowledgments

- [Anthropic](https://anthropic.com) — Claude API
- [Meta](https://llama.meta.com) — Llama 3.2 for on-device inference
- [ElevenLabs](https://elevenlabs.io) — Voice synthesis
- [Tavily](https://tavily.com) — Web search API
- [Expo](https://expo.dev) — React Native framework
- [llama.rn](https://github.com/mybigday/llama.rn) — React Native bindings for llama.cpp
