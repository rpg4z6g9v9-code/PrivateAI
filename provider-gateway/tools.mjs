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

  return {
    repository: path.basename(REPO),
    branch,
    clean: !status,
    changes: status ? status.split('\n') : [],
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

  return {
    unstaged: capped(unstaged),
    staged: capped(staged),
  };
}

export async function runReadOnlyTool(name) {
  switch (name) {
    case 'ollama.status': return ollamaStatus();
    case 'system.info': return systemInfo();
    case 'git.status': return gitStatus();
    case 'git.diff': return gitDiff();
    default: throw new Error(`unknown_tool:${name}`);
  }
}
