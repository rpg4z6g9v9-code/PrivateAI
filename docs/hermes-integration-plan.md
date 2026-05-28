# Hermes Integration Plan

Goal: Use Hermes as a local/private development helper on the Mac mini.
Scope: PrivateAI development assistance only. No runtime code changes.

## Step 1 — Check Hermes on Mac mini

SSH to Mac mini and check if hermes3 is already pulled:

```bash
ssh privateai-macmini
ollama list
```

If not present:
```bash
ollama pull hermes3
```

Verify it runs:
```bash
ollama run hermes3 "What is your role?"
```

## Step 2 — Confirm Ollama is reachable from laptop

The Mac mini Ollama is already configured at 192.168.4.52:11434 with OLLAMA_HOST=0.0.0.0.
Verify from laptop:

```bash
curl http://192.168.4.52:11434/api/tags | python3 -m json.tool | grep name
```

hermes3 should appear in the model list.

## Step 3 — Test Hermes via curl (no tooling needed)

```bash
curl -s http://192.168.4.52:11434/api/chat \
  -d '{
    "model": "hermes3",
    "messages": [{"role": "user", "content": "Summarize this in 3 bullets: [paste log here]"}],
    "stream": false
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['content'])"
```

If this works, Hermes is operational.

## Step 4 — Define roles as reusable prompts

Store role prompts in `docs/hermes-roles/`:

- `log-summarizer.txt` — summarize Metro/device logs into key findings
- `diff-reviewer.txt` — review a git diff for obvious issues (non-security)
- `doc-drafter.txt` — draft or expand a markdown doc from bullet points
- `ui-copy.txt` — suggest label text, button copy, placeholder text
- `checklist.txt` — turn a feature description into a test checklist
- `brainstorm.txt` — generate feature ideas given a constraint

Usage pattern (from laptop terminal):
```bash
cat docs/hermes-roles/log-summarizer.txt <(echo "---") some-log.txt | \
  curl -s http://192.168.4.52:11434/api/chat \
    -d @- ...
```

Or interactively via `ollama run hermes3` on the Mac mini.

## Step 5 — Claude Code workflow integration

When a task is low-risk and doesn't need code edits:

1. Paste context into a Hermes prompt (log, diff, doc stub, feature idea)
2. Get Hermes output
3. Paste result back into Claude Code session for final review or use

Claude Code remains the only agent that edits files and commits.

## Constraints (permanent)

- Hermes has no file system access to the PrivateAI repo
- Hermes has no git credentials
- Hermes has no .env or secret access
- No Hermes output goes directly into production — always reviewed first
- No external integrations (Slack, Telegram, etc.) until explicitly planned

## Current status

- [ ] hermes3 pulled on Mac mini
- [ ] curl test passing
- [ ] Role prompts created
- [ ] First real use (log summarization or doc draft)
