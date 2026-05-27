# OpenClaw — Sandbox Reference Notes

**Purpose:** Architecture study only. Reference runtime on Mac mini, isolated from PrivateAI.
**Date:** 2026-05-27
**Status:** Phase 0 complete — gateway started, health confirmed, stopped cleanly.

---

## Phase 0 Checkpoint (2026-05-27)

| Item | Value |
|---|---|
| SSH alias | `privateai-macmini` |
| SSH key | `~/.ssh/privateai_macmini_ed25519` (dedicated, project-only) |
| Mac mini user | `macmini` |
| Mac mini hostname | `MacMinis-Mac-mini.local` |
| Mac mini IP | `192.168.4.52` |
| Node | v24.16.0 (user-local: `~/.local/bin/node`) |
| npm | 11.13.0 |
| OpenClaw CLI | 2026.5.26 (10ad3aa) |
| Homebrew | not installed |
| nvm | not installed |
| Sandbox path | `~/OpenClawSandbox` |
| Gateway mode | `local` (set in `~/.openclaw/openclaw.json`) |
| Gateway bind | loopback only (`127.0.0.1:18789`) |
| Gateway auth | `none` (safe: loopback-only, no external reach) |
| Gateway status | stopped (not installed as daemon) |
| Default model | `openai/gpt-5.5` — no OpenAI key, so agent calls fail gracefully |

**Gateway was started, health-probed (`OK 16ms`), and stopped. No daemon installed.**

### Skills landscape (structural protection)
- 44 skills blocked by missing binaries (all require Homebrew-installed tools: Gmail, Slack, Discord, GitHub, iMessage, 1Password, browser automation, etc.)
- No Homebrew = no dangerous skills can activate
- 13 skills eligible (local/basic only)
- 46 plugins loaded, 0 plugin errors

### Gateway run command (foreground, sandbox-safe)
```bash
ssh privateai-macmini '
  export PATH="$HOME/.local/bin:$PATH"
  cd ~/OpenClawSandbox
  nohup openclaw gateway run --bind loopback --auth none > ~/OpenClawSandbox/gateway.log 2>&1 &
'
```

### Gateway stop
```bash
ssh privateai-macmini 'pkill -9 -f openclaw'
```

### Gateway health check
```bash
ssh privateai-macmini '
  export PATH="$HOME/.local/bin:$PATH"
  openclaw gateway health && openclaw gateway probe
'
```

---

## System Requirements

| Requirement | Version |
|---|---|
| Node.js | 24 (recommended) or 22.19+ minimum |
| npm | bundled with Node |
| OS | macOS (launchd daemon) |

---

## Phase 0 — Sandbox Setup Sequence

Run on Mac mini after SSH is enabled.

### Step 1: Create sandbox directory

```bash
mkdir -p ~/OpenClawSandbox
cd ~/OpenClawSandbox
```

### Step 2: Check Node version

```bash
node --version
npm --version
```

If Node < 22.19, install Node 24 via nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 24
nvm use 24
```

### Step 3: Install OpenClaw (global, npm)

```bash
npm install -g openclaw@latest
openclaw --version
```

### Step 4: Run onboarding

```bash
cd ~/OpenClawSandbox
openclaw onboard
```

**During onboarding — what to do:**
- Workspace: point to `~/OpenClawSandbox`
- Channels: skip all (no Gmail, iMessage, WhatsApp, Slack, Telegram)
- Skills: skip or select demo/read-only only
- Daemon install: yes (launchd user service)
- Permissions requested: document every prompt — stop and report if broad filesystem or shell access is requested

**During onboarding — what NOT to do:**
- Do not connect messaging accounts
- Do not grant shell execution permission
- Do not grant access to real files outside sandbox
- Do not connect GitHub, browser, or any external service

### Step 5: Verify gateway health

```bash
openclaw status
```

Expected: gateway running, port reported, no errors.

Check the local gateway port (likely `localhost:3000` or similar) and confirm it is not exposed to LAN.

### Step 6: Capture config artifacts

After onboarding, collect and document:

```bash
# Where is the config?
ls ~/.openclaw/

# What config files were created?
cat ~/.openclaw/config.yaml   # or equivalent

# Where are logs stored?
ls ~/.openclaw/workspace/

# What skills are installed?
openclaw skills list

# What channels are connected?
openclaw channels list

# What is the gateway port?
openclaw status
```

---

## What to Observe (Architecture Study Goals)

| Question | Where to look |
|---|---|
| How does the gateway receive input? | config.yaml → channels section |
| How are tools declared? | skills/ directory, YAML manifests |
| How is tool policy enforced? | `tools.sandbox.tools.allow/deny` in config |
| Where are session logs? | `~/.openclaw/workspace/[job]/logs/` |
| What does a session log look like? | per-turn: user message, system prompt, response, tool calls, results |
| How is the "Soul" loaded? | SOUL.md at workspace root |
| How are agents defined? | AGENTS.md at workspace root |

---

## Permission Model (from docs)

OpenClaw enforces tool policy in this hierarchy (each level can only restrict, not grant back):

```
global config
→ per-agent config
→ channel policy
→ sandbox rules
→ plugin availability
```

The model only receives tool schemas for tools that survive all layers.

Sandbox modes:
- `non-main` — group/untrusted sessions run in Docker container, main DM session runs on host
- `all` — all sessions sandboxed
- Default for a single-user setup: on-host (no Docker)

For reference study: configure sandbox mode `all` if Docker is available on Mac mini,
or leave default and rely on no write-capable skills being installed.

---

## What NOT to Install

| Skill / Channel | Reason |
|---|---|
| Gmail / email | write to external account |
| Calendar | write, external |
| WhatsApp / Telegram / iMessage | broad messaging surface |
| GitHub | write access |
| exec / shell skill | destructive, unscoped |
| browser automation | unscoped external surface |
| file skill (outside sandbox) | path traversal risk |
| external skill marketplace | supply chain risk, unvetted |

---

## Documented Security Risks (from research)

| Risk | Notes |
|---|---|
| Shared session scope | Default "main" scope shares session across all DMs — catastrophic if exposed to LAN without auth |
| Prompt injection via channel input | External content in any connected channel can attempt injection |
| Broad shell/file skills | Shell and file tools are write-capable; not safe without explicit sandbox |
| Exposed gateway port | Gateway should only bind to localhost — never expose to LAN or internet without auth |
| Supply chain via skills marketplace | Unvetted external skills can carry arbitrary code |

For sandbox study: ensure gateway binds to `127.0.0.1` only, not `0.0.0.0`.

---

## Comparison to PrivateAI (Study Goal)

| Dimension | OpenClaw | PrivateAI |
|---|---|---|
| Tool exposure to model | Model sees tool schemas; policy suppresses bad calls | Model never sees schemas; only receives results |
| Tool execution | Model requests tool call; runtime executes | App detects intent; executor runs deterministically |
| Logging | Session log per turn, append-only | toolDB append-only, summary metadata only |
| Channel abstraction | Normalized across WhatsApp, Slack, iMessage, etc. | Single channel (iOS chat UI) |
| Permission model | Layered config (global → agent → channel → sandbox) | Tier model in code (0=auto, 1=confirm, 2=opt-in, 3=denied) |
| Security screening | Policy before model call | checkInjection() on external output before prompt injection |
| Sandbox | Docker per session (optional) | App sandbox (iOS) + path restriction in executor |

PrivateAI's advantage: tool isolation is stronger by architecture. Model cannot hallucinate tool calls it was never given schemas for.

---

## OpenClaw Sandbox Guardrails — Post-Phase 0 Addendum

### Phase 0 verified state

- SSH alias `privateai-macmini` works using dedicated key `~/.ssh/privateai_macmini_ed25519`
- Node installed under user-local prefix
- Node: `v24.16.0`
- npm: `11.13.0`
- OpenClaw CLI: `2026.5.26 (10ad3aa)`
- OpenClaw binary: `/Users/macmini/.local/bin/openclaw`
- npm global prefix: `/Users/macmini/.local`
- Sandbox path: `/Users/macmini/OpenClawSandbox`
- No Homebrew present
- No nvm present
- Gateway binds to loopback only: `127.0.0.1:18789`
- Gateway probe confirmed read-only
- Gateway foreground process was killed after health/probe checks
- OpenClaw daemon/LaunchAgent/service is not installed
- Default model is `openai/gpt-5.5`; no key configured; agent calls fail gracefully
- No real accounts, OAuth, credentials, external channels, shell automation, or browser automation were connected or enabled

### Doctor warnings observed and disposition

| Warning | Severity | Disposition |
|---|---|---|
| `gateway.mode` unset | Blocking | Fixed by setting gateway mode to `local` |
| Session store dir missing | Critical | Fixed with `mkdir -p ~/.openclaw/agents/main/sessions` |
| Gateway auth token missing | Advisory | Acceptable for local foreground sandbox using `--auth none` |
| No command owner configured | Advisory | Acceptable because no channels are connected |
| 44 skills missing requirements | Expected | Structurally blocked because they require Homebrew binaries; do not install Homebrew for this sandbox yet |

### Allowed vs blocked OpenClaw capabilities

| Capability / Action | Status | Notes |
|---|---|---|
| Local CLI version checks | Allowed | Read-only verification only |
| `openclaw doctor` | Allowed | Diagnostic only |
| `openclaw gateway status` | Allowed | Diagnostic only |
| Foreground loopback gateway probe | Allowed with care | Bind only to `127.0.0.1`; stop after probe |
| Read-only probe | Allowed | Confirm capability without enabling actions |
| Workspace inside `~/OpenClawSandbox` | Allowed | Required sandbox boundary |
| Local/manual mode | Allowed | No external accounts |
| OpenClaw onboarding | Gated | Only after explicit approval |
| OpenClaw daemon / LaunchAgent / start-at-login | Blocked | Do not install yet |
| `openclaw onboard --install-daemon` | Blocked | Managed startup is out of scope |
| `openclaw gateway install` | Blocked | Persistent service is out of scope |
| Browser automation | Blocked | Do not enable |
| Shell automation through OpenClaw | Blocked | Do not enable |
| OAuth / account linking | Blocked | Do not connect real accounts |
| Email, calendar, messages, contacts | Blocked | No real accounts or personal channels |
| External channels | Blocked | No Slack, Discord, email, browser, or cloud channels |
| API keys / credentials | Blocked | Stop and ask if requested |
| Installing Homebrew | Blocked for now | Would expand system scope |
| Modifying PrivateAI code | Blocked unless separately approved | PrivateAI remains core system |
| Changing PrivateAI config | Blocked unless recovery requires it | Prefer restoring node to match stable app config |

### Rollback notes — document only, do not run

```bash
# Stop any foreground OpenClaw process if one is running.
pkill -f 'openclaw gateway' 2>/dev/null || true

# Remove OpenClaw global package from the user-local npm prefix.
export PATH="$HOME/.local/bin:$PATH"
npm uninstall -g openclaw 2>/dev/null || true

# Remove OpenClaw sandbox workspace.
rm -rf "$HOME/OpenClawSandbox"

# Optional: remove OpenClaw runtime state only if explicitly approved.
# rm -rf "$HOME/.openclaw"

# Confirm no OpenClaw daemon/LaunchAgent exists.
launchctl list | grep -i openclaw || true
ls "$HOME/Library/LaunchAgents" 2>/dev/null | grep -i openclaw || true
```

### PrivateAI recovery principle

Keep the PrivateAI app configuration stable and restore the node to match it, especially around:

- `phi4-mini`
- `nomic-embed-text`
- Ollama LAN binding via `OLLAMA_HOST=0.0.0.0:11434`
- Brave-backed `web.search`
- System panel visibility
- toolDB summary-only logging
- toolContext passing through `securityGateway`

When recovering from drift, prefer restoring the Mac mini node state to match the known-good PrivateAI app config before changing PrivateAI code or configuration.

### Required PrivateAI smoke-test checkpoint before deeper OpenClaw onboarding

Before any deeper OpenClaw onboarding, run a PrivateAI smoke test and record the results here.

Minimum checks:

1. Confirm Mac mini is reachable at `192.168.4.52`
2. Confirm Ollama is bound for LAN access with `OLLAMA_HOST=0.0.0.0:11434`
3. Confirm installed models include `phi4-mini` and `nomic-embed-text`
4. Confirm PrivateAI local route still works through `phi4-mini`
5. Confirm Brave-backed `web.search` still works
6. Confirm System panel still shows: node, memory, operations, recovery, configuration
7. Confirm toolDB still logs summaries only
8. Confirm toolContext still passes through `securityGateway` before prompt injection
9. Confirm `file.read` remains unimplemented and reference-only via `docs/reference/file-read-contract.md`
10. Confirm OpenClaw remains reference-only and contained inside `~/OpenClawSandbox`

Do not proceed to deeper OpenClaw onboarding until this smoke test is clean or any drift has been explicitly reviewed.

---

## Sources

- [Install · OpenClaw](https://docs.openclaw.ai/install)
- [GitHub — openclaw/openclaw](https://github.com/openclaw/openclaw)
- [Sandboxing · OpenClaw](https://docs.openclaw.ai/gateway/sandboxing)
- [Security · OpenClaw](https://docs.openclaw.ai/gateway/security)
- [Configuration reference · OpenClaw](https://docs.openclaw.ai/gateway/configuration-reference)
- [Getting started · OpenClaw](https://docs.openclaw.ai/start/getting-started)
- [openclaw — npm](https://www.npmjs.com/package/openclaw)
- [OpenClaw Full Setup Guide (GitHub Gist)](https://gist.github.com/oEdyb/e0b4a2a65555e48834695c712c49693f)

---

## PrivateAI Smoke Test Summary — 2026-05-27

### Result

PrivateAI smoke test is closed as **PASS for routing and infrastructure**.

One item is recorded as a **non-blocking model behavior note**:

- Exact app prompt compliance did not return the exact requested token.
- This is not treated as route drift because routing was independently confirmed by logs, System panel, app badge, and machine-side Ollama checks.

### Machine-side checks

| Check | Result | Notes |
|---|---|---|
| Mac mini SSH alias `privateai-macmini` | PASS | Connected as `macmini` |
| Mac mini node identity | PASS | `MacMinis-Mac-mini.local` |
| Ping / ICMP | NON-BLOCKING | ICMP appears blocked, but SSH and APIs work |
| Ollama process | PASS | Ollama app/server running |
| Ollama LAN API | PASS | `/api/version` returned `0.24.0` |
| `phi4-mini` installed | PASS | Present in model list |
| `nomic-embed-text` installed | PASS | Present in model list |
| `phi4-mini` generation | PASS | Returned `PRIVATEAI_PHI4_MINI_OK` in machine-side API check |
| `nomic-embed-text` embedding | PASS | Returned 768-dimensional embedding |
| OpenClaw sandbox path | PASS | `~/OpenClawSandbox` exists |
| OpenClaw daemon / LaunchAgent | PASS | Not installed / not detected |
| OpenClaw gateway process | PASS | Not running |

### App/UI checks

| Check | Result | Notes |
|---|---|---|
| PrivateAI app opens with existing stable config | PASS | No config changes made |
| Private/local route visible | PASS | App shows private node |
| Private node online | PASS | Logs show `[PrivateNode] online` |
| Router local | PASS | Logs show `[Router] Routing: local` |
| Model | PASS | System panel shows `phi4-mini` |
| Host | PASS | System panel shows `192.168.4.52:11434` |
| System panel: system | PASS | Visible |
| System panel: memory | PASS | Visible |
| System panel: operations | PASS | Visible |
| System panel: recovery | PASS | Visible |
| System panel: configuration | PASS | Visible |
| Brave-backed `web.search` configured | PASS | System panel shows configured |
| Brave-backed `web.search` runs | PASS | Completed entries visible |
| API key exposure | PASS | No key or secret exposed in screenshots |
| toolDB summary-only logging | PASS | Operation summaries visible, no full raw sensitive payloads observed |
| toolContext/securityGateway path | PASS | `checkInjection(toolContext)` confirmed in `app/(tabs)/index.tsx` |
| `file.read` status | PASS | No executor exists; contract remains reference-only |
| OpenClaw containment | PASS | Remains reference-only inside `~/OpenClawSandbox` |

### Exact-response retest note

Observed app retest:

```
Observed prompt:
PRIVATE_LOCAL_ROUTE_OK

Observed response:
Understood. Your route is confirmed as local (phi4-mini via Ollama on private node). How can I assist you today?
```

Disposition:

- Exact prompt response: `FAIL / NON-BLOCKING MODEL BEHAVIOR NOTE`
- Route badge shown: `private node`
- Drift found: `NO`
- Code/config changed during test: `NO`

This is not treated as route drift because the local route is independently confirmed by:

- App logs
- System panel
- Private node badge
- Machine-side Ollama generation
- Machine-side embedding check
- Successful `web.search` operations

### Version label follow-up

The recovery panel displays `stable-memory-workspace-v1`.

Disposition:

- Not drift.
- Cosmetic truth-alignment follow-up only.
- `aiRouter.ts` contains a hardcoded `VERSION_TAG = 'stable-memory-workspace-v1'`.
- Git tag remains `stable-websearch-gateway-v2` at commit `928e76f`.
- Do not update this during the smoke-test closeout.

### Final smoke-test status

- Drift found: `NO`
- PrivateAI code changed: `NO`
- PrivateAI config changed: `NO`
- OpenClaw daemon/LaunchAgent/gateway install enabled: `NO`
- Shell/browser automation enabled: `NO`
- Real accounts/OAuth/credentials/external channels connected: `NO`

PrivateAI remains the core system.

OpenClaw remains reference-only and contained inside `~/OpenClawSandbox`.

Do not proceed into deeper OpenClaw onboarding unless explicitly approved after this smoke-test summary is reviewed.
