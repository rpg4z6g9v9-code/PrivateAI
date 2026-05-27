# OpenClaw — Sandbox Reference Notes

**Purpose:** Architecture study only. Reference runtime on Mac mini, isolated from PrivateAI.
**Date:** 2026-05-26
**Status:** SSH not yet enabled on Mac mini — blocked at Phase 0 setup step.

---

## Blocker

Mac mini at `192.168.4.52` is reachable (ping OK, Ollama on :11434 works) but SSH port 22 is closed.

**To unblock:**
Mac mini → System Settings → General → Sharing → Remote Login → enable

Once enabled, all commands below can run via:
```bash
ssh 192.168.4.52
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

## Sources

- [Install · OpenClaw](https://docs.openclaw.ai/install)
- [GitHub — openclaw/openclaw](https://github.com/openclaw/openclaw)
- [Sandboxing · OpenClaw](https://docs.openclaw.ai/gateway/sandboxing)
- [Security · OpenClaw](https://docs.openclaw.ai/gateway/security)
- [Configuration reference · OpenClaw](https://docs.openclaw.ai/gateway/configuration-reference)
- [Getting started · OpenClaw](https://docs.openclaw.ai/start/getting-started)
- [openclaw — npm](https://www.npmjs.com/package/openclaw)
- [OpenClaw Full Setup Guide (GitHub Gist)](https://gist.github.com/oEdyb/e0b4a2a65555e48834695c712c49693f)
