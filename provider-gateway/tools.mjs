import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OLLAMA = 'http://127.0.0.1:11434';

export const TOOL_MANIFEST = [
  { name: 'ollama.status', description: 'Read Ollama status and installed models.', tier: 0, readOnly: true },
  { name: 'system.info', description: 'Read basic Mac system information.', tier: 0, readOnly: true },
  { name: 'git.status', description: 'Read PrivateAI Git branch and working-tree status.', tier: 0, readOnly: true },
  { name: 'git.diff', description: 'Read staged and unstaged PrivateAI diffs.', tier: 0, readOnly: true },
  { name: 'github.repo', description: 'Read GitHub repository metadata.', tier: 0, readOnly: true },
  { name: 'github.commits', description: 'Read recent GitHub commits.', tier: 0, readOnly: true },
  { name: 'github.issues', description: 'Read open GitHub issues.', tier: 0, readOnly: true },
  { name: 'github.pull_requests', description: 'Read open GitHub pull requests.', tier: 0, readOnly: true },
  { name: 'github.actions', description: 'Read recent GitHub Actions workflow runs.', tier: 0, readOnly: true },
];

async function git(args) {
  const { stdout } = await execFileAsync(
    '/usr/bin/git',
    ['-C', REPO, ...args],
    { timeout: 5000, maxBuffer: 512 * 1024, encoding: 'utf8' }
  );
  return stdout.trim();
}

async function ollamaStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    return {
      online: true,
      endpoint: OLLAMA,
      models: (data.models ?? []).map(m => ({
        name: m.name,
        size: m.size,
        family: m.details?.family ?? null,
        parameters: m.details?.parameter_size ?? null,
        quantization: m.details?.quantization_level ?? null,
        capabilities: m.capabilities ?? [],
      })),
    };
  } catch (e) {
    return {
      online: false,
      endpoint: OLLAMA,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function systemInfo() {
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    totalMemoryGB: +(os.totalmem() / 1024 ** 3).toFixed(2),
    freeMemoryGB: +(os.freemem() / 1024 ** 3).toFixed(2),
    uptimeSeconds: Math.round(os.uptime()),
    nodeVersion: process.version,
  };
}

async function gitStatus() {
  const branch = await git(['branch', '--show-current']);
  const status = await git(['status', '--short']);
  const latest = await git(['log', '-1', '--oneline']);

  const changes = status
    ? status.split('\n').map(line => {
        const match = line.match(/^(.{2})\s+(.*)$/);
        const code = match?.[1] ?? line.slice(0, 2);
        const file = match?.[2] ?? line.slice(2).trim();

        let status = 'changed';

        if (code === '??') status = 'untracked';
        else if (code.includes('M')) status = 'modified';
        else if (code.includes('A')) status = 'added';
        else if (code.includes('D')) status = 'deleted';
        else if (code.includes('R')) status = 'renamed';

        return { file, status };
      })
    : [];

  return {
    repository: path.basename(REPO),
    branch,
    clean: changes.length === 0,
    changes,
    latestCommit: latest,
  };
}

function capped(text, max = 100000) {
  return {
    text: text.slice(0, max),
    truncated: text.length > max,
  };
}

async function gitDiff() {
  const unstaged = await git(['diff', '--no-ext-diff', '--unified=3']);
  const staged = await git(['diff', '--cached', '--no-ext-diff', '--unified=3']);

  const unstagedFiles = await git(['diff', '--name-status']);
  const stagedFiles = await git(['diff', '--cached', '--name-status']);

  const unstagedStat = await git(['diff', '--stat']);
  const stagedStat = await git(['diff', '--cached', '--stat']);

  return {
    unstagedFiles: unstagedFiles ? unstagedFiles.split('\n') : [],
    stagedFiles: stagedFiles ? stagedFiles.split('\n') : [],
    unstagedStat,
    stagedStat,
    unstaged: capped(unstaged),
    staged: capped(staged),
  };
}


const GH = '/opt/homebrew/bin/gh';

async function gh(args) {
  const { stdout } = await execFileAsync(
    GH,
    args,
    {
      cwd: REPO,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    }
  );

  return stdout.trim();
}

async function githubRepo() {
  const raw = await gh([
    'repo', 'view',
    '--json',
    'nameWithOwner,url,description,isPrivate,defaultBranchRef'
  ]);

  return JSON.parse(raw);
}

async function githubCommits() {
  const raw = await gh([
    'api',
    'repos/{owner}/{repo}/commits?per_page=10'
  ]);

  const rows = JSON.parse(raw);

  return rows.map(commit => ({
    sha: String(commit.sha ?? '').slice(0, 7),
    message: commit.commit?.message?.split('\n')[0] ?? '',
    author: commit.commit?.author?.name ?? null,
    date: commit.commit?.author?.date ?? null,
    url: commit.html_url ?? null,
  }));
}

async function githubIssues() {
  const raw = await gh([
    'issue', 'list',
    '--state', 'open',
    '--limit', '20',
    '--json',
    'number,title,author,updatedAt,url,labels'
  ]);

  return JSON.parse(raw);
}

async function githubPullRequests() {
  const raw = await gh([
    'pr', 'list',
    '--state', 'open',
    '--limit', '20',
    '--json',
    'number,title,author,headRefName,baseRefName,updatedAt,url,isDraft'
  ]);

  return JSON.parse(raw);
}

async function githubActions() {
  const raw = await gh([
    'run', 'list',
    '--limit', '20',
    '--json',
    'databaseId,name,workflowName,status,conclusion,event,headBranch,createdAt,updatedAt,url'
  ]);

  return JSON.parse(raw);
}

export async function runReadOnlyTool(name) {
  switch (name) {
    case 'ollama.status': return ollamaStatus();
    case 'system.info': return systemInfo();
    case 'git.status': return gitStatus();
    case 'git.diff': return gitDiff();
    case 'github.repo': return githubRepo();
    case 'github.commits': return githubCommits();
    case 'github.issues': return githubIssues();
    case 'github.pull_requests': return githubPullRequests();
    case 'github.actions': return githubActions();
    default: throw new Error(`unknown_tool:${name}`);
  }
}
