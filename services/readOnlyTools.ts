import { providerGatewayUrl } from './providerGateway';

export type ReadOnlyMacTool =
  | 'ollama.status'
  | 'system.info'
  | 'git.status'
  | 'git.diff'
  | 'github.repo'
  | 'github.commits'
  | 'github.issues'
  | 'github.pull_requests'
  | 'github.actions';

type ToolRunResponse = {
  ok?: boolean;
  tool?: string;
  duration_ms?: number;
  result?: unknown;
  error?: string;
};

function detectTools(text: string): ReadOnlyMacTool[] {
  const tools = new Set<ReadOnlyMacTool>();
  const q = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');

  // General self/system health.
  if (
    /\bcheck yourself\b/.test(q) ||
    /\bcheck your system\b/.test(q) ||
    /\bsystem (status|health|info|information)\b/.test(q) ||
    /\bmac (status|health|info|information)\b/.test(q)
  ) {
    tools.add('system.info');
    tools.add('ollama.status');
    tools.add('git.status');
  }

  // Ollama / local-AI inspection.
  if (
    /\bollama\b/.test(q) ||
    /\bprivate node\b/.test(q) ||
    /\blocal models?\b/.test(q) ||
    /\bwhich models?\b/.test(q)
  ) {
    tools.add('ollama.status');
  }

  // Git state.
  if (
    /\bgit status\b/.test(q) ||
    /\brepo(?:sitory)? status\b/.test(q) ||
    /\bworking tree\b/.test(q) ||
    /\bwhat branch\b/.test(q)
  ) {
    tools.add('git.status');
  }

  // Code changes.
  if (
    /\bgit diff\b/.test(q) ||
    /\bwhat(?:'s| is| has)?\s*(?:change|changed|changes)\s+in\s+(?:privateai|the repo|the repository|the code|the project)\b/.test(q) ||
    /\bshow (?:me )?(?:the )?(?:code|repo|repository) changes\b/.test(q)
  ) {
    tools.add('git.status');
    tools.add('git.diff');
  }


  // GitHub overview.
  if (
    /\bwhat(?:'s| is) on github\b/.test(q) ||
    /\bgithub (?:status|overview|summary)\b/.test(q) ||
    /\bcheck github\b/.test(q)
  ) {
    tools.add('github.repo');
    tools.add('github.commits');
    tools.add('github.issues');
    tools.add('github.pull_requests');
    tools.add('github.actions');
  }

  // Remote GitHub commits.
  if (
    /\bgithub commits?\b/.test(q) ||
    /\brecent commits? on github\b/.test(q) ||
    /\bremote commits?\b/.test(q)
  ) {
    tools.add('github.commits');
  }

  // Issues.
  if (
    /\bopen issues?\b/.test(q) ||
    /\bgithub issues?\b/.test(q) ||
    /\bany issues?\b/.test(q)
  ) {
    tools.add('github.issues');
  }

  // Pull requests.
  if (
    /\bpull requests?\b/.test(q) ||
    /\bprs?\b/.test(q) ||
    /\bopen prs?\b/.test(q)
  ) {
    tools.add('github.pull_requests');
  }

  // GitHub Actions / CI.
  if (
    /\bgithub actions?\b/.test(q) ||
    /\bci (?:status|pass|passed|fail|failed)\b/.test(q) ||
    /\bdid (?:ci|the build) pass\b/.test(q) ||
    /\bworkflow runs?\b/.test(q)
  ) {
    tools.add('github.actions');
  }

  return [...tools];
}

function cap(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated]`;
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function formatToolResult(
  tool: ReadOnlyMacTool,
  result: unknown
): string {
  const isGitHubListTool =
    tool === 'github.commits' ||
    tool === 'github.issues' ||
    tool === 'github.pull_requests' ||
    tool === 'github.actions';

  const r = record(result) ?? (isGitHubListTool ? {} : null);

  if (!r) return `${tool}: no structured result`;

  switch (tool) {
    case 'ollama.status': {
      const models = Array.isArray(r.models)
        ? r.models
            .map((m: any) => {
              const name = m?.name ?? 'unknown';
              const params = m?.parameters ? ` ${m.parameters}` : '';
              return `${name}${params}`;
            })
            .join(', ')
        : 'none reported';

      return [
        `Ollama status: ${r.online === true ? 'ONLINE' : 'OFFLINE'}.`,
        `Endpoint: ${r.endpoint ?? 'unknown'}.`,
        `Installed models: ${models}.`,
      ].join(' ');
    }

    case 'system.info':
      return [
        `Mac system: platform=${r.platform ?? 'unknown'},`,
        `release=${r.release ?? 'unknown'},`,
        `architecture=${r.architecture ?? 'unknown'},`,
        `CPU cores=${r.cpuCount ?? 'unknown'},`,
        `memory=${r.totalMemoryGB ?? 'unknown'} GB total / ${r.freeMemoryGB ?? 'unknown'} GB free,`,
        `uptime=${r.uptimeSeconds ?? 'unknown'} seconds,`,
        `Node=${r.nodeVersion ?? 'unknown'}.`,
      ].join(' ');

    case 'git.status': {
      const changes = Array.isArray(r.changes)
        ? r.changes.map((change: any) =>
            `${String(change.status ?? 'changed').toUpperCase()}: ${change.file ?? 'unknown'}`
          )
        : [];

      return [
        'CURRENT GIT WORKING TREE:',
        `Repository: ${r.repository ?? 'unknown'}.`,
        `Branch: ${r.branch ?? 'unknown'}.`,
        `Working tree: ${r.clean === true ? 'CLEAN' : 'HAS UNCOMMITTED CHANGES'}.`,
        `Current uncommitted files: ${changes.length ? changes.join('; ') : 'none'}.`,
        '',
        'COMMIT HISTORY REFERENCE:',
        `Latest committed revision: ${r.latestCommit ?? 'unknown'}.`,
        'The latest commit is historical reference only. Do not describe it as part of the current uncommitted changes.',
      ].join('\n');
    }

    case 'git.diff': {
      const unstaged = record(r.unstaged);
      const staged = record(r.staged);

      const unstagedText = String(unstaged?.text ?? '').trim();
      const stagedText = String(staged?.text ?? '').trim();

      const unstagedFiles = Array.isArray(r.unstagedFiles)
        ? r.unstagedFiles.join('; ')
        : 'none';

      const stagedFiles = Array.isArray(r.stagedFiles)
        ? r.stagedFiles.join('; ')
        : 'none';

      return [
        'CURRENT UNCOMMITTED GIT DIFF:',
        `Tracked unstaged files: ${unstagedFiles || 'none'}.`,
        `Unstaged summary: ${String(r.unstagedStat ?? '').trim() || 'none'}.`,
        `Tracked staged files: ${stagedFiles || 'none'}.`,
        `Staged summary: ${String(r.stagedStat ?? '').trim() || 'none'}.`,
        'Note: new/untracked files are reported by git.status and are not included in a normal git diff until staged.',
        '',
        'PATCH DETAILS:',
        unstagedText ? cap(unstagedText, 5000) : '(no unstaged patch)',
        stagedText ? cap(stagedText, 3000) : '(no staged patch)',
      ].join('\n');
    }
    case 'github.repo': {
      const defaultBranch =
        record(r.defaultBranchRef)?.name ?? 'unknown';

      return [
        'REMOTE GITHUB REPOSITORY:',
        `Repository: ${r.nameWithOwner ?? 'unknown'}.`,
        `Visibility: ${r.isPrivate === true ? 'private' : 'public'}.`,
        `Default branch: ${defaultBranch}.`,
        `Description: ${r.description ?? 'none'}.`,
        `URL: ${r.url ?? 'unknown'}.`,
      ].join('\n');
    }

    case 'github.commits': {
      const commits = Array.isArray(result) ? result : [];

      if (!commits.length) {
        return 'REMOTE GITHUB COMMITS: none returned.';
      }

      return [
        'REMOTE GITHUB COMMITS (newest first):',
        ...commits.slice(0, 10).map((c: any) =>
          `${c.sha ?? 'unknown'} — ${c.message ?? ''} — ${c.author ?? 'unknown'} — ${c.date ?? 'unknown'}`
        ),
      ].join('\n');
    }

    case 'github.issues': {
      const issues = Array.isArray(result) ? result : [];

      if (!issues.length) {
        return 'REMOTE GITHUB OPEN ISSUES: none.';
      }

      return [
        'REMOTE GITHUB OPEN ISSUES:',
        ...issues.map((i: any) =>
          `#${i.number ?? '?'} ${i.title ?? ''} — ${i.url ?? ''}`
        ),
      ].join('\n');
    }

    case 'github.pull_requests': {
      const prs = Array.isArray(result) ? result : [];

      if (!prs.length) {
        return 'REMOTE GITHUB OPEN PULL REQUESTS: none.';
      }

      return [
        'REMOTE GITHUB OPEN PULL REQUESTS:',
        ...prs.map((pr: any) =>
          `#${pr.number ?? '?'} ${pr.title ?? ''} — ${pr.headRefName ?? '?'} -> ${pr.baseRefName ?? '?'}${pr.isDraft ? ' — DRAFT' : ''}`
        ),
      ].join('\n');
    }

    case 'github.actions': {
      const runs = Array.isArray(result) ? result : [];

      if (!runs.length) {
        return [
          'REMOTE GITHUB ACTIONS CHECK: SUCCESS.',
          'Workflow runs found: 0.',
          'No GitHub Actions workflow run exists to classify as passed or failed.',
        ].join('\n');
      }

      return [
        'REMOTE GITHUB ACTIONS (newest first):',
        ...runs.slice(0, 10).map((run: any) =>
          `${run.workflowName ?? run.name ?? 'workflow'} — status=${run.status ?? 'unknown'} — conclusion=${run.conclusion ?? 'unknown'} — branch=${run.headBranch ?? 'unknown'} — ${run.createdAt ?? ''}`
        ),
      ].join('\n');
    }


  }
}

async function runTool(
  tool: ReadOnlyMacTool,
  timeoutMs = tool.startsWith('github.') ? 15000 : 7000
): Promise<ToolRunResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(providerGatewayUrl('/tools/run'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool }),
      signal: controller.signal,
    });

    const data: ToolRunResponse = await response.json();

    if (!response.ok) {
      return {
        tool,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return data;
  } catch (error) {
    return {
      tool,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function buildReadOnlyMacToolContext(
  userText: string
): Promise<string | undefined> {
  const tools = detectTools(userText);

  if (tools.length === 0) return undefined;

  const blocks: string[] = [];

  for (const tool of tools) {
    const response = await runTool(tool);

    if (response.error) {
      blocks.push(
        `${tool}: unavailable (${response.error})`
      );
      continue;
    }

    blocks.push(formatToolResult(tool, response.result));
  }

  const context = [
    'AUTHORITATIVE READ-ONLY MAC TOOL FACTS FOR THIS TURN:',
    'Use these concrete facts in the answer.',
    'Do not replace them with a generic status message.',
    'Do not claim anything was checked unless it appears below.',
    'If a requested check failed, state that it could not be checked.',
    'A successful check that returns zero records is NOT a failed check. Report that zero records were found.',
    '',
    ...blocks,
  ].join('\n');

  return context;
}
