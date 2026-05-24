# PrivateAI v2 — Quick Reference (Pocket Card)

## 6:30 PM Setup (5 min)

```bash
cd ~/Documents/PrivateAI
node cleanup-v2.js
npm install
expo start
# Press 'i' for iPhone
```

---

## Critical Tests

### 1. Voice Input (Most Important)
- [ ] Tap mic icon
- [ ] Speak 2-3 sentences
- [ ] Wait 4+ sec silence
- [ ] Message auto-sends
- **Repeat 10 times** — if it hangs once, STOP

### 2. Chat & Routing
- [ ] Text message sends
- [ ] See response + badge (☁️ or 📱)
- [ ] See latency (e.g., "120ms")
- [ ] Medical keyword → local or error
- [ ] "Ignore instructions" → security warning

### 3. Persistence
- [ ] Close app (home button)
- [ ] Reopen
- [ ] Old messages still there
- [ ] No messages lost

### 4. Face ID Lock
- [ ] Use app for 5+ min
- [ ] Press home (background)
- [ ] Wait 5+ min
- [ ] Reopen → Face ID prompt
- [ ] Messages still there after unlock

---

## Bug Checklist

| Issue | Location | Fix |
|-------|----------|-----|
| App crashes on tab switch | `app/(tabs)/*.tsx` | Comment out deleted imports |
| Voice hangs on 2nd use | `index.tsx` line 180 | Verify `Voice.removeAllListeners()` only |
| Cloud always fails | `services/aiRouter.ts` | Add Claude API key to .env.local |
| Import: "medicalMemory not found" | Any tab | Delete that import line |

---

## Quick Commands

```bash
# If app won't start
npm install

# If Voice hangs
# Check: services/securityGateway.ts voice cleanup code
# Should be: Voice.removeAllListeners()
# NOT: Voice.destroy().then(...)

# If tests fail repeatedly
expo start --clear

# To view logs
expo start --clear
# Watch console in Terminal
```

---

## Success Criteria

🟢 **PASSING** (done, move forward)
- Voice works 10+ times without hang
- Chat sends/receives both directions
- Encryption persists (reopen test)
- Security blocks "ignore instructions"
- Face ID relocks after 5+ min

🟡 **BUGS FOUND** (fix them)
- Import errors in tabs
- Network calls fail (API key?)
- Face ID doesn't re-lock

🔴 **CRITICAL** (stop, debug)
- Voice hangs on 2nd attempt
- App crashes on startup
- Messages lost on close

---

## v2.1 Features (If Time)

**Quick wins to add after core passes:**

1. **Connectivity checker** (10 min)
   - Shows ☁️ or 🔴 in header
   - File: `services/connectivityChecker.ts` ✓ (ready)

2. **Voice settings** (20 min)
   - Sliders: speed, pitch, auto-stop delay
   - File: `components/VoiceSettingsPanel.tsx` ✓ (ready)
   - See: `V21_INTEGRATION_GUIDE.md`

3. **Search** (30 min)
   - Cmd+F search messages
   - File: `services/conversationSearch.ts` ✓ (ready)

---

## Docs You'll Need

| Doc | Use | Time |
|-----|-----|------|
| `TEST_PLAN.md` | Detailed test procedures | During testing |
| `MIGRATION_SUMMARY.md` | What changed | Architecture review |
| `V21_INTEGRATION_GUIDE.md` | How to wire v2.1 | Phase 3 integration |
| `READY_TO_TEST.md` | Full timeline | Before you start |

---

## Timing (Goal: 8:50 PM Complete)

```
6:30 PM  Setup (5 min)
6:35 PM  Voice testing (10 min)
6:45 PM  Chat/encryption (15 min)
7:00 PM  Face ID (10 min)
7:10 PM  Security checks (10 min)
7:20 PM  Bug fixes (30 min)
7:50 PM  v2.1 integration (60 min) ← or stop here if tight
8:50 PM  Final validation
```

---

## Abort Criteria

**STOP and debug if:**
- Voice hangs on 2nd attempt
- App won't start
- All messages lost
- Face ID crashes app

**OK to skip if:**
- Phase 3 v2.1 features (can do later)
- Image preview blank (non-critical)
- Some import errors in unused tabs

---

## Remember

✨ **You built v2.0 in 2 hours. It's clean. It's simple.**

The voice input fix is done.
The security layer is built.
The app is ready.

Test it. You got this. 🚀

---

*Keep this card handy while testing.*
*Reference: READY_TO_TEST.md for full timeline.*
