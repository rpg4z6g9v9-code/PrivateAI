# Hermes — Local Development Helper

Hermes is a local/private assistant agent running on the Mac mini via Ollama.
It assists with PrivateAI development work. It does not touch PrivateAI runtime code.

## Role boundary

| Task | Agent |
|------|-------|
| Code edits | Claude Code only |
| Commits | Claude Code only |
| Security/routing changes | Claude Code only |
| Final verification | Claude Code only |
| Log summarization | Hermes |
| Diff review (non-critical) | Hermes |
| Doc drafting | Hermes |
| UI copy / labels | Hermes |
| Checklists | Hermes |
| Feature brainstorming | Hermes |
| Project notes / context | Hermes |

Simple rule: **Hermes thinks and summarizes. Claude Code changes the code.**

## What Hermes cannot do

- Modify any PrivateAI source files
- Make git commits
- Access secrets or .env files
- Deploy or run builds
- Connect to Slack, Telegram, or any external service (yet)
- Access the internet

## Model

- Model: `hermes3` (Ollama, Mac mini at 192.168.4.52:11434)
- Fallback: `llama3.1:8b` if hermes3 not loaded
- Provider: local Ollama only — zero data leaves the LAN

## Setup status

See `docs/hermes-integration-plan.md` for setup steps and current state.
