import { providerGatewayUrl } from './providerGateway';

export type ReadOnlyMacTool =
  | 'ollama.status'
  | 'system.info'
  | 'git.status'
  | 'git.diff';

type ToolRunResponse = {
  ok?: boolean;
  tool?: string;
  duration_ms?: number;
  result?: unknown;
  error?: string;
};

function detectTools(text: string): ReadOnlyMacTool[] {
  const tools = new Set<ReadOnlyMacTool>();
  const q = text.toLowerCase();

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
  const r = record(result);

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
  }
}

async function runTool(
  tool: ReadOnlyMacTool,
  timeoutMs = 7000
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

  return [
    'AUTHORITATIVE READ-ONLY MAC TOOL FACTS FOR THIS TURN:',
    'Use these concrete facts in the answer.',
    'Do not replace them with a generic status message.',
    'Do not claim anything was checked unless it appears below.',
    'If a requested check failed, state that it could not be checked.',
    '',
    ...blocks,
  ].join('\n');
}
