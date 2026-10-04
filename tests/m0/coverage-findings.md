# M0 Coverage Findings

Four factual coverage gaps documented from reading production source.
No fixes applied — documentation only.

## 1. Exact system.info executor contents

**Source:** `provider-gateway/tools.mjs`, `systemInfo()` function (line 66)

The system.info tool returns exactly these fields from Node.js `os` and `process`:

| Field | Source |
|-------|--------|
| platform | `os.platform()` |
| release | `os.release()` |
| architecture | `os.arch()` |
| cpuCount | `os.cpus().length` |
| totalMemoryGB | `+(os.totalmem() / 1024 ** 3).toFixed(2)` |
| freeMemoryGB | `+(os.freemem() / 1024 ** 3).toFixed(2)` |
| uptimeSeconds | `Math.round(os.uptime())` |
| nodeVersion | `process.version` |

No user data, no credentials, no network info. Pure hardware/OS telemetry.

## 2. Exact gh argument arrays

**Source:** `provider-gateway/tools.mjs`

All `gh` calls use `execFileAsync(GH, args, ...)` where `GH = '/opt/homebrew/bin/gh'`.

| Tool | Arguments |
|------|-----------|
| github.repo | `['repo', 'view', '--json', 'nameWithOwner,url,description,isPrivate,defaultBranchRef']` |
| github.commits | `['api', 'repos/{owner}/{repo}/commits?per_page=10']` |
| github.issues | `['issue', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,author,updatedAt,url,labels']` |
| github.pull_requests | `['pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,author,headRefName,baseRefName,updatedAt,url,isDraft']` |
| github.actions | `['run', 'list', '--limit', '20', '--json', 'databaseId,name,workflowName,status,conclusion,event,headBranch,createdAt,updatedAt,url']` |

All arrays are fixed string literals. No user input interpolated into arguments.
The `cwd` is set to `REPO` (project root). Timeout is 10000ms.

## 3. Exact production classification keyword lists

**Source:** `services/securityGateway.ts`, lines 49-53

**MEDICAL_KEYWORDS** (1 regex):
`symptom`, `medication`, `prescri(ption|bed)`, `doctor`, `physician`, `diagnosis`, `pain`, `health`, `headache`, `fever`, `anxiety`, `depression`, `allergy`, `diabetes`, `asthma`, `dosage`, `surgery`, `therapy`, `treatment`

**FINANCIAL_KEYWORDS** (1 regex):
`credit card`, `bank account`, `routing number`, `ssn`, `account number`, `balance`, `mortgage`, `loan`, `investment`, `stock`, `salary`, `bitcoin`, `crypto`, `wallet`, `payment`

**PII_KEYWORDS** (1 regex):
`phone number`, `email address`, `home address`, `zip code`, `driver license`, `passport`, `ssn`, `date of birth`, `full name`

Notable gaps vs server.js mock:
- No `blood pressure`, `heart rate`, `migraine`, `fatigue`, `nausea`, `pharmacy`, `hospital`, `clinic` in production MEDICAL (server.js mock has these)
- Production uses `\b` word boundaries — case insensitive

## 4. Exact toolDB behavior when write fails

**Source:** `services/toolDB.ts`

### Null-db guard (silent no-op)
All write functions (`logToolStart`, `logToolComplete`, `logToolFail`) and the read function (`getRecentToolCalls`) check `if (!db) return;` at the top. If `initToolDB()` was never called or the database open failed, all operations silently no-op. No error, no log, no indication of data loss.

### SQL error propagation (unhandled)
The three write functions (`logToolStart`, `logToolComplete`, `logToolFail`) have **no try/catch** around their `db.runAsync()` calls. If the SQL operation fails (disk full, schema mismatch, WAL corruption), the error propagates as an unhandled promise rejection to the caller.

Contrast: `initToolDB()` has no try/catch either but creates the table with `IF NOT EXISTS`. `getRecentToolCalls()` returns `[]` when db is null but also has no try/catch for the actual query.

### Practical impact
- A failed `logToolStart` propagates to the web search executor (`webSearch.ts` line 94), which **does** await it. A SQL failure there would cause the entire web search to fail, not just the logging.
- `logToolComplete` and `logToolFail` are also awaited in webSearch.ts. SQL errors in the tool log can crash the tool executor.
