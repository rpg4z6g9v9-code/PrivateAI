# file.read — Design Contract

**Status:** Design only. Not yet implemented.
**Date:** 2026-05-26
**Gate:** Do not implement until `stable-websearch-gateway-v1` stress tests are complete.

---

## 1. Purpose

`file.read` will be a read-only, sandboxed tool for reading user-approved files.

Tier 0: auto-approved, read-only. Same toolContext pattern as `web.search`.

The model receives a bounded, screened summary of file content — not a raw dump.

---

## 2. Hard Constraints

- Sandboxed path only — scoped to app Documents directory
- No arbitrary filesystem access
- No path traversal (no `../`, no absolute paths outside sandbox, no symlink following)
- No hidden recursive reads
- No directory walking unless separately approved as a distinct tool
- No raw full-file prompt injection
- No file content stored in toolDB

Sandbox boundary is enforced in the executor in code, not in the prompt.
A prompt instruction saying "only read safe files" is not enforcement.

---

## 3. Execution Pipeline

```
user intent detected
→ extract requested path
→ sandbox path check (reject immediately if outside allowed dir)
→ read file metadata (name, size, type)
→ read bounded content slice (max chars, from start)
→ mark truncated: yes / no
→ checkInjection(slice)
    → hit: replace slice with safe sentinel, log security event
    → clean: pass through
→ formatToolContext(slice, metadata)
→ inject safe bounded toolContext into system prompt
→ log metadata only to toolDB
```

This is the same contract as `web.search`:
```
external/untrusted content → security check → safe toolContext → model prompt
```

File content is external/untrusted even when it comes from the user's own device.

---

## 4. Content Limits

| Parameter | Value |
|---|---|
| Default max injected chars | 2000 |
| Truncation marker | `[truncated — file is N bytes, showing first 2000 chars]` |
| Minimum slice | 1 char (empty file handled as a distinct case) |

Never pass raw unbounded file content into the prompt.
If a file exceeds the limit, inject the first 2000 chars only, with the truncation marker.

Future: configurable limit per file type (text vs binary), but default is 2000.

---

## 5. Logging Policy

### toolDB stores

| Field | Example |
|---|---|
| tool_name | `file.read` |
| input_summary | `filename: "notes.txt" (4200 bytes)` |
| status | `completed` / `failed` |
| duration_ms | `12` |
| result_summary | `read 2000 of 4200 bytes · truncated: yes` |
| error in result_summary | `path_denied` / `file_not_found` / etc. |

### toolDB does NOT store

- File contents
- Credentials or secrets
- PII snippets
- Raw document text
- Full file paths that expose internal directory structure

---

## 6. Failure States

| State | Condition |
|---|---|
| `path_denied` | Path is outside sandbox, contains traversal, or is a symlink to restricted location |
| `file_not_found` | File does not exist at requested path |
| `file_too_large` | File exceeds a hard size ceiling (e.g. >5MB) — read refused entirely |
| `injection_detected` | `checkInjection()` fired on content slice — safe sentinel injected instead |
| `read_error` | IO error during read (permissions, corruption, etc.) |

All failure states are logged to toolDB. The model receives an honest sentinel for each:
```
[file.read: path_denied — access outside sandbox not allowed]
[file.read: file_not_found — "example.txt" does not exist]
[file.read: injection_detected — content filtered]
```

---

## 7. Implementation Timing

This is a design contract only.

**Do not implement** until:
1. `stable-websearch-gateway-v1` tag is applied ✓
2. At least 3 of 5 stress test scenarios pass on device
3. `web.search` degraded-recovery cycle is validated

When implementation starts, this document is the spec. If the implementation deviates from any constraint above, update this document first and get explicit approval before proceeding.

---

## Relationship to web.search

`file.read` inherits the same pipeline contract established by `web.search`:

| Step | web.search | file.read |
|---|---|---|
| Intent detection | `detectSearchQuery()` | `detectFileReadQuery()` |
| Executor | `webSearch()` | `fileRead()` |
| toolDB log | `logToolStart/Complete/Fail` | same |
| Security check | `checkInjection(toolContext)` | `checkInjection(slice)` |
| Prompt injection | `formatToolContext()` | `formatToolContext()` |
| Content limit | 5 results · title/url/desc | 2000 chars · truncated marker |
| Raw content in DB | never | never |
