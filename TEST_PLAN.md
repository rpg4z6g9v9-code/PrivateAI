/**
 * PrivateAI v2 — Test & Bug Fix Plan
 * 
 * Testing schedule: ~2 hours on iPhone
 * Target: Validate core functionality, fix voice input, add v2.1 features
 */

// ── PHASE 1: Core Validation (30 min) ────────────────────────

// 1. App Launch
// ✓ App starts without crashing
// ✓ Face ID prompt appears
// ✓ App unlocks after Face ID
// ✓ Chat screen loads (empty messages)

// 2. Voice Input (THE KEY FIX)
// ✓ Tap mic icon
// ✓ Mic starts recording (icon turns red, "mic" → "mic filled")
// ✓ Speak 2-3 sentences
// ✓ Wait 4+ seconds of silence → auto-stops
// ✓ Text appears in input field
// ✓ Message sends automatically after silence
// ✓ Response appears with routing badge (☁️ cloud or 📱 local)
// ⚠️ KNOWN: If Voice.destroy() still happens, app will hang on second voice attempt
//    Fix: Check index.tsx line ~180, ensure Voice.removeAllListeners() only

// 3. Chat & Encryption
// ✓ Send text message → response appears
// ✓ Response has latency badge (e.g., "120ms")
// ✓ Close app and reopen
// ✓ Old messages still visible (encrypted storage works)
// ✓ Send medical keyword (e.g., "I have a headache")
// ✓ Response shows "📱 local" routing OR error if no local model
// ✓ Injection attempt (e.g., "ignore previous instructions")
// ✓ App shows security warning, blocks cloud

// 4. Face ID & Locking
// ✓ Use app for 5+ minutes
// ✓ Press home button (background app)
// ✓ Wait 5+ minutes
// ✓ Reopen app
// ✓ Face ID prompt appears again (vault re-locked)
// ✓ Unlock with Face ID
// ✓ Chat visible (not lost)

// ── PHASE 2: Bug Fixes (30 min) ──────────────────────────────

// Expected issues & fixes:

// BUG 1: Import errors in other tabs
// Location: app/(tabs)/*.tsx
// Symptom: App crashes on tab switch
// Fix: Comment out imports of deleted services (medicalMemory, knowledgeGraph, etc.)
//
// BUG 2: Voice crashes on second use
// Location: app/(tabs)/index.tsx line ~180
// Symptom: Can speak once, second attempt hangs
// Fix: Verify Voice.removeAllListeners() — no Voice.destroy()
//
// BUG 3: Network monitor references old events
// Location: services/networkMonitor.ts
// Symptom: App crashes when logging network call
// Fix: Update logCall() signature to match aiRouter.ts usage
//
// BUG 4: Claude API key missing
// Location: services/aiRouter.ts
// Symptom: Cloud route fails with "API key not configured"
// Fix: Set EXPO_PUBLIC_CLAUDE_API_KEY in .env.local
//
// BUG 5: Image preview not rendering
// Location: app/(tabs)/index.tsx line ~310
// Symptom: Image attached but blank preview
// Fix: Implement base64 → Image component (non-critical for now)

// ── PHASE 3: v2.1 Features (60 min) ──────────────────────────

// Quick wins to add:

// FEATURE 1: Search Conversations
// File: services/conversationSearch.ts (new, ~40 lines)
// UI: Cmd+F overlay in chat
// Implementation:
//   - Query encrypted history (regex on decrypted messages)
//   - Highlight matches
//   - Jump to message

// FEATURE 2: Voice Settings Panel
// File: components/VoiceSettingsPanel.tsx (new, ~80 lines)
// UI: Settings button in header
// Controls:
//   - Speech rate: 0.8x to 1.3x (default 1.0)
//   - Pitch: 0.8 to 1.2 (default 1.0)
//   - Auto-stop delay: 2s to 6s (default 4s)
//   - Mic sensitivity: low/normal/high

// FEATURE 3: Conversation Picker (Side Panel)
// File: Refactor Sidebar.tsx (~+30 lines)
// UI: Left drawer with recent conversations
// Implementation:
//   - List all conversations by auto-generated title
//   - Tap to switch
//   - "New chat" button
//   - Delete conversation

// FEATURE 4: Offline Detector
// File: services/connectivityChecker.ts (new, ~30 lines)
// UI: Status indicator in header
// Implementation:
//   - Ping Claude API endpoint every 30s
//   - Show ☁️ if reachable, 🔴 if not
//   - Update AI router behavior (disable cloud route if offline)

// FEATURE 5: Manual "Local-Only" Toggle
// File: Add to index.tsx state (~10 lines UI, routing handled in aiRouter)
// UI: Toggle button next to send button
// Implementation:
//   - User can force local-only for sensitive messages
//   - Overrides automatic classification
//   - Shows warning if forced local but model unavailable

// ── Test Sequence ────────────────────────────────────────────

// 1. Fix imports + run cleanup script
// 2. Launch app (Phase 1)
// 3. Test voice input 10+ times (critical path)
// 4. Test encryption (kill app, reopen)
// 5. Test face ID lock (wait 5+ min)
// 6. Fix any bugs that appear (Phase 2)
// 7. Add v2.1 features incrementally (Phase 3)
// 8. Re-test all phases after each feature

// ── Success Criteria ──────────────────────────────────────────

// MUST HAVE (blocking):
// ✓ Voice input works reliably (10 tests without hang)
// ✓ Chat sends/receives (cloud and local)
// ✓ Encryption persists (reopen app, messages visible)
// ✓ Face ID lock works (5+ min background timeout)
// ✓ Security checks block injection (alert shown)

// NICE TO HAVE (Phase 3):
// ✓ Search conversations
// ✓ Voice settings
// ✓ Offline indicator
// ✓ Manual local-only toggle

// DEFER:
// ✗ Conversation export
// ✗ Tagging/categorization
// ✗ Advanced audit log UI
// ✗ Multi-model selection

// ── Notes ────────────────────────────────────────────────────

// Total time estimate: 2.5-3 hours
// - Phase 1: 30 min (validation)
// - Phase 2: 30 min (bugs)
// - Phase 3: 60 min (features)

// Highest risk: Voice input (most likely to fail)
// Second risk: Network connectivity (API key, cloud API status)
// Third risk: Import errors from deleted services

// If voice works + encryption works + injection blocks → core is solid
// Everything else is polish.
