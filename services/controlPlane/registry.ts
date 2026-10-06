/**
 * Control Plane — Capability Registry (M4)
 *
 * Production versioned registry of all reachable execution/egress capabilities.
 * Read-only at runtime — no mutation interface for model/tool/recorder/orchestration code.
 *
 * Fail-closed: unknown/unregistered capability lookup returns null.
 * Denied capabilities are registered but have no executable provider (candidate_providers = []).
 *
 * Fixture capabilities (fixture.*) must NEVER appear in this registry.
 * Production only.
 */

import type { CapabilityContract, ProviderDescriptor } from './types';
import { appendRecord } from './recorder';
import { getSessionId, mintRequestId } from './identifiers';
import { ensureReady } from './recorder';

// ── V1 executor timeout (D6 DECLARED, not yet enforced — M8 enforces) ─────────

export const DECLARED_TIMEOUT_MS = 30_000;

// ── Production Capability Contracts ─────────────────────────────────────────

const _contracts: CapabilityContract[] = [
  // ── reasoning ──────────────────────────────────────────────────────────────
  {
    id: 'reasoning' as CapabilityContract['id'],
    version: 1,
    description: 'AI inference — generate a response from conversation context. Routes to local Ollama (PRIVATE_LAN) or cloud Anthropic via gateway (INTERNET/CLOUD) based on sensitivity and availability.',
    input_schema: {
      messages: 'ConversationMessage[]',
      system_prompt: 'string',
      max_tokens: 'number',
      model: 'string',
      isSensitive: 'boolean',
      safeMode: 'boolean',
    },
    output_schema: {
      text: 'string',
      route: '"local" | "cloud"',
      model: 'string',
      latency: 'number',
      tokens: '{ input: number; output: number } | undefined',
    },
    side_effects: {
      has_side_effects: false,
      description: 'none — inference only, no persistent state written by model',
      reversible: true,
    },
    candidate_providers: [
      'local_reasoning_resolver' as ProviderDescriptor['id'],
      'cloud_reasoning_resolver' as ProviderDescriptor['id'],
    ],
    permitted_boundaries: ['PRIVATE_LAN', 'INTERNET/CLOUD'],
    verification_method: 'output_text_non_empty',
    verification_criteria: 'Response text must be a non-empty string with no injection pattern detected',
    evidence_produced: 'user_statement record (M3 Recorder, canonical)',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1] (cloud path only)',
  },

  // ── web.search ─────────────────────────────────────────────────────────────
  {
    id: 'web.search' as CapabilityContract['id'],
    version: 1,
    description: 'Web search via Brave Search API. Device connects directly to Brave endpoint. Requires API key in secureStorage (post-D4).',
    input_schema: { query: 'string' },
    output_schema: {
      query: 'string',
      results: 'SearchResult[]',
      duration_ms: 'number',
      callId: 'string',
      error: 'string | undefined',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — query is sent to Brave Search API over INTERNET/CLOUD',
      reversible: true,
    },
    candidate_providers: ['brave_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['INTERNET/CLOUD'],
    verification_method: 'http_response_ok',
    verification_criteria: 'HTTP 200 from Brave endpoint with non-empty results array',
    evidence_produced: 'tool_result (toolDB logToolComplete)',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[brave_search_api_key_secure_v1]',
  },

  // ── retrieval.embed ────────────────────────────────────────────────────────
  {
    id: 'retrieval.embed' as CapabilityContract['id'],
    version: 1,
    description: 'Semantic embedding via nomic-embed-text model on the private Ollama node. Used for conversation search and note retrieval. Fire-and-forget; never blocks send flow.',
    input_schema: {
      text: 'string',
      model: '"nomic-embed-text:latest"',
      host: 'string (from AsyncStorage[ollama_host_v1])',
    },
    output_schema: { embedding: 'number[] | null' },
    side_effects: {
      has_side_effects: false,
      description: 'none — read-only inference on private node',
      reversible: true,
    },
    candidate_providers: ['ollama_embed_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['PRIVATE_LAN'],
    verification_method: 'embedding_vector_non_empty',
    verification_criteria: 'Returned number[] must have length > 0',
    evidence_produced: 'none (best-effort, silent failure)',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: null,
  },

  // ── ollama.status.read ─────────────────────────────────────────────────────
  {
    id: 'ollama.status.read' as CapabilityContract['id'],
    version: 1,
    description: 'Read Ollama status from the GATEWAY host loopback (127.0.0.1:11434). This is the gateway\'s local Ollama, NOT the iPhone-configured Ollama host. Parameterless gateway tool.',
    input_schema: { tool: '"ollama.status"' },
    output_schema: {
      online: 'boolean',
      endpoint: 'string',
      models: 'OllamaModel[]',
      error: 'string | undefined',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — queries gateway-loopback Ollama',
      reversible: true,
    },
    candidate_providers: ['gateway_ollama_status_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['PRIVATE_LAN', 'LOCAL_INFRASTRUCTURE'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and non-null result field',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── system.info.read ───────────────────────────────────────────────────────
  {
    id: 'system.info.read' as CapabilityContract['id'],
    version: 1,
    description: 'Read basic Mac system information from the gateway host. Returns: platform, release, architecture, cpuCount, totalMemoryGB, freeMemoryGB, uptimeSeconds, nodeVersion. Parameterless gateway tool.',
    input_schema: { tool: '"system.info"' },
    output_schema: {
      platform: 'string',
      release: 'string',
      architecture: 'string',
      cpuCount: 'number',
      totalMemoryGB: 'number',
      freeMemoryGB: 'number',
      uptimeSeconds: 'number',
      nodeVersion: 'string',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — reads OS metrics on gateway host',
      reversible: true,
    },
    candidate_providers: ['gateway_system_info_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['PRIVATE_LAN', 'LOCAL_INFRASTRUCTURE'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and non-null result with expected system fields',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── git.status.read ────────────────────────────────────────────────────────
  {
    id: 'git.status.read' as CapabilityContract['id'],
    version: 1,
    description: 'Read PrivateAI git branch and working-tree status from gateway host. Runs git -C <REPO> on the gateway host filesystem. Parameterless gateway tool.',
    input_schema: { tool: '"git.status"' },
    output_schema: {
      repository: 'string',
      branch: 'string',
      clean: 'boolean',
      changes: '{ file: string; status: string }[]',
      latestCommit: 'string',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — git status commands on gateway host',
      reversible: true,
    },
    candidate_providers: ['gateway_git_status_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['PRIVATE_LAN', 'LOCAL_INFRASTRUCTURE'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and branch field in result',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── git.diff.read ──────────────────────────────────────────────────────────
  {
    id: 'git.diff.read' as CapabilityContract['id'],
    version: 1,
    description: 'Read staged and unstaged git diffs from gateway host. Runs git diff commands. Parameterless gateway tool.',
    input_schema: { tool: '"git.diff"' },
    output_schema: {
      unstagedFiles: 'string[]',
      stagedFiles: 'string[]',
      unstagedStat: 'string',
      stagedStat: 'string',
      unstaged: '{ text: string; truncated: boolean }',
      staged: '{ text: string; truncated: boolean }',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — git diff commands on gateway host',
      reversible: true,
    },
    candidate_providers: ['gateway_git_diff_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['PRIVATE_LAN', 'LOCAL_INFRASTRUCTURE'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and result with diff fields',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── github.read.repo ───────────────────────────────────────────────────────
  {
    id: 'github.read.repo' as CapabilityContract['id'],
    version: 1,
    description: 'Read GitHub repository metadata via gh CLI on gateway host. Calls GitHub API (INTERNET/CLOUD). Parameterless gateway tool.',
    input_schema: { tool: '"github.repo"' },
    output_schema: {
      nameWithOwner: 'string',
      url: 'string',
      description: 'string | null',
      isPrivate: 'boolean',
      defaultBranchRef: '{ name: string }',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — GitHub API read via gh CLI',
      reversible: true,
    },
    candidate_providers: ['gateway_github_repo_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['INTERNET/CLOUD'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and result with nameWithOwner',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── github.read.commits ────────────────────────────────────────────────────
  {
    id: 'github.read.commits' as CapabilityContract['id'],
    version: 1,
    description: 'Read recent GitHub commits via gh CLI. Returns up to 10 commits. Parameterless gateway tool.',
    input_schema: { tool: '"github.commits"' },
    output_schema: {
      result: '{ sha: string; message: string; author: string; date: string; url: string }[]',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — GitHub API read',
      reversible: true,
    },
    candidate_providers: ['gateway_github_commits_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['INTERNET/CLOUD'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and array result',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── github.read.issues ─────────────────────────────────────────────────────
  {
    id: 'github.read.issues' as CapabilityContract['id'],
    version: 1,
    description: 'Read open GitHub issues via gh CLI. Returns up to 20 issues. Parameterless gateway tool.',
    input_schema: { tool: '"github.issues"' },
    output_schema: {
      result: '{ number: number; title: string; url: string }[]',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — GitHub API read',
      reversible: true,
    },
    candidate_providers: ['gateway_github_issues_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['INTERNET/CLOUD'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and array result',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── github.read.pull_requests ──────────────────────────────────────────────
  {
    id: 'github.read.pull_requests' as CapabilityContract['id'],
    version: 1,
    description: 'Read open GitHub pull requests via gh CLI. Returns up to 20 PRs. Parameterless gateway tool.',
    input_schema: { tool: '"github.pull_requests"' },
    output_schema: {
      result: '{ number: number; title: string; headRefName: string; baseRefName: string; isDraft: boolean }[]',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — GitHub API read',
      reversible: true,
    },
    candidate_providers: ['gateway_github_pull_requests_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['INTERNET/CLOUD'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and array result',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── github.read.actions ────────────────────────────────────────────────────
  {
    id: 'github.read.actions' as CapabilityContract['id'],
    version: 1,
    description: 'Read recent GitHub Actions workflow runs via gh CLI. Returns up to 20 runs. Parameterless gateway tool.',
    input_schema: { tool: '"github.actions"' },
    output_schema: {
      result: '{ workflowName: string; status: string; conclusion: string; headBranch: string; createdAt: string }[]',
    },
    side_effects: {
      has_side_effects: true,
      description: 'read_only — GitHub API read',
      reversible: true,
    },
    candidate_providers: ['gateway_github_actions_resolver' as ProviderDescriptor['id']],
    permitted_boundaries: ['INTERNET/CLOUD'],
    verification_method: 'tool_response_ok_field',
    verification_criteria: 'Gateway JSON response has ok=true and array result',
    evidence_produced: 'none',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
  },

  // ── git.push — DENIED/UNIMPLEMENTED ───────────────────────────────────────
  {
    id: 'git.push' as CapabilityContract['id'],
    version: 1,
    description: 'DENIED/UNIMPLEMENTED — git push operation. Not available in Control Plane V1. Any request must be denied before execution.',
    input_schema: {},
    output_schema: {},
    side_effects: {
      has_side_effects: true,
      description: 'write — would mutate remote repository. Never permitted.',
      reversible: false,
    },
    candidate_providers: [],  // NO executable provider — denied
    permitted_boundaries: [],
    verification_method: 'denied',
    verification_criteria: 'This capability must never execute. Zero provider contacts.',
    evidence_produced: 'registry_denial record (interim_gate, source=capability_registry)',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: null,
  },

  // ── github.pr.create — DENIED/UNIMPLEMENTED ───────────────────────────────
  {
    id: 'github.pr.create' as CapabilityContract['id'],
    version: 1,
    description: 'DENIED/UNIMPLEMENTED — GitHub pull request creation. Not available in Control Plane V1. Any request must be denied before execution.',
    input_schema: {},
    output_schema: {},
    side_effects: {
      has_side_effects: true,
      description: 'write — would create a PR on GitHub. Never permitted.',
      reversible: false,
    },
    candidate_providers: [],  // NO executable provider — denied
    permitted_boundaries: [],
    verification_method: 'denied',
    verification_criteria: 'This capability must never execute. Zero provider contacts.',
    evidence_produced: 'registry_denial record (interim_gate, source=capability_registry)',
    timeout_ms: DECLARED_TIMEOUT_MS,
    failure_semantics: 'fail_safe',
    credential_source_ref: null,
  },
];

// ── Production Provider Descriptors ─────────────────────────────────────────

const _providers: ProviderDescriptor[] = [
  {
    id: 'local_reasoning_resolver' as ProviderDescriptor['id'],
    capability_id: 'reasoning' as CapabilityContract['id'],
    boundary_resolution: {
      // Host is configurable (AsyncStorage[ollama_host_v1]). M5 resolves the actual
      // runtime boundary once the host is known. Architecture rule applies for
      // 192.168.4.0/24 (AUTO_TRUSTED_CIDR) but that resolution is M5 scope.
      status: 'unresolved',
    },
    network_path: 'http://<AsyncStorage[ollama_host_v1]>/api/chat  (default: 192.168.4.52:11434)',
    credential_source_ref: null,
    availability_method: 'http_get /api/tags with 5s timeout (checkPrivateNode)',
    fallback_provider_ref: 'cloud_reasoning_resolver' as ProviderDescriptor['id'],
  },
  {
    id: 'cloud_reasoning_resolver' as ProviderDescriptor['id'],
    capability_id: 'reasoning' as CapabilityContract['id'],
    boundary_resolution: {
      status: 'resolved',
      boundary: 'INTERNET/CLOUD',
      provenance: 'architecture_rule',
    },
    network_path: 'providerGatewayFetch(\'/claude\') → gateway → https://api.anthropic.com',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'brave_resolver' as ProviderDescriptor['id'],
    capability_id: 'web.search' as CapabilityContract['id'],
    boundary_resolution: {
      status: 'resolved',
      boundary: 'INTERNET/CLOUD',
      provenance: 'architecture_rule',
    },
    network_path: 'fetch(https://api.search.brave.com/res/v1/web/search) with 10s timeout',
    credential_source_ref: 'secureStorage[brave_search_api_key_secure_v1]',
    availability_method: 'key_present_check (getBraveApiKeySecure)',
    fallback_provider_ref: null,
  },
  {
    id: 'ollama_embed_resolver' as ProviderDescriptor['id'],
    capability_id: 'retrieval.embed' as CapabilityContract['id'],
    boundary_resolution: {
      // Host is configurable (AsyncStorage[ollama_host_v1]). M5 resolves the actual
      // runtime boundary once the host is known.
      status: 'unresolved',
    },
    network_path: 'fetch(http://<AsyncStorage[ollama_host_v1]>/api/embeddings) (default: 192.168.4.52:11434)',
    credential_source_ref: null,
    availability_method: 'best_effort (null on failure)',
    fallback_provider_ref: null,
  },
  // ── Gateway tool resolvers (one per capability — truthful 1:1 cardinality) ──
  // All share the same underlying gateway implementation and network path.
  // Separate descriptors so each descriptor's capability_id matches exactly one contract.
  {
    id: 'gateway_ollama_status_resolver' as ProviderDescriptor['id'],
    capability_id: 'ollama.status.read' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'ollama.status\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_system_info_resolver' as ProviderDescriptor['id'],
    capability_id: 'system.info.read' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'system.info\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_git_status_resolver' as ProviderDescriptor['id'],
    capability_id: 'git.status.read' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'git.status\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_git_diff_resolver' as ProviderDescriptor['id'],
    capability_id: 'git.diff.read' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'git.diff\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_github_repo_resolver' as ProviderDescriptor['id'],
    capability_id: 'github.read.repo' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'github.repo\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_github_commits_resolver' as ProviderDescriptor['id'],
    capability_id: 'github.read.commits' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'github.commits\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_github_issues_resolver' as ProviderDescriptor['id'],
    capability_id: 'github.read.issues' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'github.issues\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_github_pull_requests_resolver' as ProviderDescriptor['id'],
    capability_id: 'github.read.pull_requests' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'github.pull_requests\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
  {
    id: 'gateway_github_actions_resolver' as ProviderDescriptor['id'],
    capability_id: 'github.read.actions' as CapabilityContract['id'],
    boundary_resolution: { status: 'unresolved' },
    network_path: 'providerGatewayFetch(\'/tools/run\') → {tool:\'github.actions\'} → provider-side execution',
    credential_source_ref: 'secureStorage[providerGatewayToken_v1]',
    availability_method: 'providerGatewayFetch /health with 5s timeout',
    fallback_provider_ref: null,
  },
];

// ── Immutable production registries (built once at module load) ──────────────

const _capabilityMap = new Map<string, CapabilityContract>(
  _contracts.map(c => [String(c.id), c])
);
const _providerMap = new Map<string, ProviderDescriptor>(
  _providers.map(p => [String(p.id), p])
);

// Pre-computed: which provider IDs have a registered descriptor?
const _registeredProviderIds = new Set<string>(_providers.map(p => String(p.id)));

// ── Gateway tool → capability ID mapping ─────────────────────────────────────

const GATEWAY_TOOL_TO_CAPABILITY: Record<string, string> = {
  'ollama.status':       'ollama.status.read',
  'system.info':         'system.info.read',
  'git.status':          'git.status.read',
  'git.diff':            'git.diff.read',
  'github.repo':         'github.read.repo',
  'github.commits':      'github.read.commits',
  'github.issues':       'github.read.issues',
  'github.pull_requests':'github.read.pull_requests',
  'github.actions':      'github.read.actions',
  // Denied — in registry, no provider
  'git.push':            'git.push',
  'github.pr.create':    'github.pr.create',
};

/**
 * Resolve gateway tool name to its registered capability ID.
 * Returns null if this tool name is not in the known mapping.
 */
export function gatewayToolCapabilityId(toolName: string): string | null {
  return GATEWAY_TOOL_TO_CAPABILITY[toolName] ?? null;
}

// ── Public registry API ──────────────────────────────────────────────────────

/** Look up a capability contract by ID. Returns null if not found (fail closed). */
export function lookupCapability(id: string): CapabilityContract | null {
  return _capabilityMap.get(id) ?? null;
}

/** List all registered production capabilities (including denied ones). */
export function listCapabilities(): CapabilityContract[] {
  return [..._capabilityMap.values()];
}

/** True if the capability ID is known to the registry (registered OR denied). */
export function isRegisteredCapability(id: string): boolean {
  return _capabilityMap.has(id);
}

/**
 * True if the capability is registered AND at least one of its candidate_providers
 * has a registered ProviderDescriptor. Denied capabilities return false (no providers).
 */
export function hasExecutableProvider(id: string): boolean {
  const contract = _capabilityMap.get(id);
  if (!contract) return false;
  return (contract.candidate_providers as string[]).some(pid => _registeredProviderIds.has(pid));
}

/** Look up a provider descriptor by ID. Returns null if not found. */
export function lookupProvider(id: string): ProviderDescriptor | null {
  return _providerMap.get(id) ?? null;
}

/**
 * Returns all provider descriptors for a given capability ID.
 * Resolved via the capability contract's candidate_providers list,
 * so shared providers (e.g. gateway_tool_resolver) are correctly returned
 * for every capability that lists them as a candidate.
 */
export function lookupProvidersByCapability(capabilityId: string): ProviderDescriptor[] {
  const contract = _capabilityMap.get(capabilityId);
  if (!contract) return [];
  return (contract.candidate_providers as string[])
    .map(pid => _providerMap.get(pid))
    .filter((p): p is ProviderDescriptor => p !== undefined);
}

// ── Registry denial recording ────────────────────────────────────────────────

export type DenialReason = 'unregistered_capability' | 'denied_capability';

/**
 * Recording outcome for a registry denial attempt.
 * 'recorded' — interim_gate record durably written to Recorder DB.
 * 'degraded' — Recorder unavailable or append failed; denial still enforced, no fake provenance.
 */
export type RecordingStatus = 'recorded' | 'degraded';

/**
 * Result returned by checkCapabilityOrDeny.
 * allowed: false → caller must not execute.
 * recording: status of denial record ('recorded'|'degraded') when denied; null when allowed.
 */
export interface RegistryGateResult {
  allowed: boolean;
  recording: RecordingStatus | null;
}

/**
 * Record a registry denial via the M3 Recorder.
 * Uses interim_gate record_kind with source='capability_registry'.
 * Distinguishable from M2 interim_boundary_gate (source='interim_boundary_gate').
 * Returns 'recorded' if the interim_gate record was durably written, 'degraded' otherwise.
 * Never throws. Denial is enforced by caller regardless of recording status.
 */
export async function recordRegistryDenial(
  capabilityId: string,
  reason: DenialReason,
  conversationId?: string | null,
): Promise<RecordingStatus> {
  try {
    const ready = await ensureReady();
    if (!ready) return 'degraded'; // recorder not initialized — deny still enforced

    const sessionId = getSessionId();
    const recordId = mintRequestId();
    const result = await appendRecord({
      record_id: recordId,
      record_kind: 'interim_gate',
      record_type: null,
      session_id: sessionId,
      conversation_id: conversationId ?? null,
      message_id: null,
      request_id: recordId,
      timestamp: Date.now(),
      source: 'capability_registry',
      payload: JSON.stringify({ reason, capability_id: capabilityId }),
    });
    return result.status; // 'recorded' or 'degraded' (commit fault)
  } catch {
    return 'degraded'; // appendRecord threw — deny still enforced
  }
}

/**
 * Pre-execution capability check.
 * Returns RegistryGateResult:
 *   allowed=true, recording=null — capability is registered and has an executable provider.
 *   allowed=false, recording=RecordingStatus — denied; recording reports whether the denial
 *     was durably recorded ('recorded') or Recorder was unavailable ('degraded').
 * Caller must NOT execute if allowed is false.
 */
export async function checkCapabilityOrDeny(
  capabilityId: string,
  conversationId?: string | null,
): Promise<RegistryGateResult> {
  if (!isRegisteredCapability(capabilityId)) {
    const recording = await recordRegistryDenial(capabilityId, 'unregistered_capability', conversationId);
    return { allowed: false, recording };
  }
  if (!hasExecutableProvider(capabilityId)) {
    const recording = await recordRegistryDenial(capabilityId, 'denied_capability', conversationId);
    return { allowed: false, recording };
  }
  return { allowed: true, recording: null };
}
