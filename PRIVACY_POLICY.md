# PrivateAI Privacy Policy

**Last Updated: March 25, 2026**

## Overview

PrivateAI is a privacy-first personal AI assistant. We designed it to keep your data on your device. This policy explains exactly what data we collect, how it's stored, and when (if ever) it leaves your device.

## Data Storage

**All personal data is stored on your device**, encrypted with AES-256 via the iOS Keychain (Secure Enclave). This includes:

- Conversation history
- Memory patterns (what the AI has learned about you)
- Medical health entries (symptoms, medications, visits)
- Knowledge base entries
- Goals and profile information
- Security event logs
- Notes and file references

**We do not operate any servers.** There is no PrivateAI backend, database, or cloud storage. Your data exists only on your device.

## Third-Party Services

PrivateAI connects to the following third-party services **only when you initiate an action**:

### Anthropic (Claude API)
- **What's sent:** Your message, conversation context, and AI persona instructions
- **When:** Every cloud AI request (not during local/offline mode)
- **What's NOT sent:** Medical data (hard-blocked from cloud), API keys, file paths, device identifiers
- **Their privacy policy:** https://www.anthropic.com/privacy

### ElevenLabs (Voice)
- **What's sent:** AI response text for text-to-speech conversion
- **When:** Only when voice output is enabled
- **What's NOT sent:** Your voice input, personal data, medical information
- **Their privacy policy:** https://elevenlabs.io/privacy

### Tavily (Web Search)
- **What's sent:** Search queries (sanitized — personal pronouns and names removed)
- **When:** Only when web search is triggered by your message
- **What's NOT sent:** Medical queries (blocked), conversation history, personal data
- **Their privacy policy:** https://tavily.com/privacy

### Hugging Face (Model Download)
- **What's sent:** A download request for the AI model file
- **When:** Only once, when you choose to download the local AI model
- **What's NOT sent:** Any personal data
- **Their privacy policy:** https://huggingface.co/privacy

## Medical Data

PrivateAI includes an optional health tracking feature. Medical data receives the highest level of protection:

- **Stored:** On-device only, AES-256 encrypted
- **Never sent to cloud:** Medical queries are hard-blocked from all cloud APIs. If the local AI model is not available, medical queries are refused entirely rather than sent to the cloud.
- **Sharing:** You can generate a doctor appointment summary (this explicitly warns you that data will be sent to Claude API). You can share summaries via the iOS share sheet — a confirmation dialog warns you before sharing.
- **Not a medical device:** PrivateAI does not diagnose, prescribe, or provide medical advice. It tracks your self-reported health information for your reference.

## On-Device AI

PrivateAI supports fully offline AI inference using a local language model (Llama 3.2 3B):

- The model runs entirely on your device
- No data leaves your device during local inference
- You can enable "Offline Mode" to force all queries to use local AI

## Biometric Authentication

PrivateAI uses Face ID / Touch ID to protect your data vault:

- Biometric data is handled entirely by iOS — PrivateAI never accesses or stores biometric data
- The vault auto-locks after 5 minutes of inactivity
- Vault unlock state is held in memory only — never written to disk

## Device Permissions

PrivateAI may request the following permissions:

| Permission | Purpose | Data Handling |
|-----------|---------|---------------|
| Microphone | Voice input | Processed on-device via speech recognition |
| Calendar | Schedule-aware AI responses | Read-only, injected into prompt for that turn only, never stored separately |
| Reminders | Task management | Read/write iOS reminders, data stays in iOS system |
| Camera | Image capture for AI analysis | Processed locally when possible |
| Photo Library | Image attachment | Accessed only when you select a photo |
| Face ID | Data vault protection | Handled by iOS, never accessed by PrivateAI |

All permissions are optional. The app functions without them (with reduced features).

## Data Security

- **Encryption at rest:** AES-256 via iOS Keychain (Secure Enclave)
- **Prompt injection protection:** 28-pattern detection shield on all inputs
- **Output sanitization:** 18-pattern filter prevents leakage of API keys, internal architecture, or storage keys
- **External content firewall:** Sanitizes web search results and file content before prompt injection
- **Cloud prompt sanitization:** Strips sensitive information (keys, paths, identifiers) before sending to cloud APIs
- **Data integrity verification:** SHA-256 checksums on critical data stores, verified on app launch
- **Rate limiting:** Anomaly detection locks the session after unusual request volume
- **Network monitoring:** All outbound calls are logged and visible in the Security tab

## Data Deletion

You can delete your data at any time:

- **Conversation history:** Clear via the sidebar "New Chat" button
- **Memory patterns:** Clear via the sidebar memory panel
- **Medical entries:** Delete individual entries in the Medical tab
- **Knowledge base:** Delete individual entries in the sidebar
- **All data:** Uninstalling the app removes all data from your device

## Children's Privacy

PrivateAI is not intended for use by children under 13. We do not knowingly collect data from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date above.

## Contact

For questions about this privacy policy or PrivateAI's data practices, contact: [your-email@example.com]
