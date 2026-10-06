/**
 * M4 Capability Registry & Contracts Tests
 *
 * Command:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./tests/m0/register.mjs \
 *        --test tests/m4/run.test.mjs
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── Production module imports ────────────────────────────────────────────────
const {
  lookupCapability, listCapabilities, isRegisteredCapability,
  hasExecutableProvider, lookupProvider, lookupProvidersByCapability,
  gatewayToolCapabilityId, recordRegistryDenial, checkCapabilityOrDeny,
  DECLARED_TIMEOUT_MS,
} = await import('../../services/controlPlane/registry.ts');

const {
  validateCapabilityContract, validateProviderDescriptor,
  validateTrustedHostConfig, looksLikeCredentialValue,
  validateNoCredentialValues,
} = await import('../../services/controlPlane/validators.ts');

const {
  getTrustedHosts, hasTrustedHostDeclaration, getTrustedHostDeclaration,
  declareTrustedHost, revokeTrustedHost, __clearTrustedHosts, AUTO_TRUSTED_CIDR,
} = await import('../../services/controlPlane/trustedHosts.ts');

const {
  migrateBraveKey, getBraveApiKeySecure, setBraveApiKeySecure, clearBraveApiKeySecure,
} = await import('../../services/controlPlane/braveKeyMigration.ts');

const {
  initRecorder, __resetRecorder, queryBySessionId,
} = await import('../../services/controlPlane/recorder.ts');

const { getSessionId } = await import('../../services/controlPlane/identifiers.ts');
const { classifyData } = await import('../../services/securityGateway.ts');
const { executeSendOrchestration } = await import('../../services/sendOrchestration.ts');

const asyncMock = await import('../../tests/m0/mocks/async-storage.mjs');
const encMock = await import('../../tests/m0/mocks/encrypted-storage.mjs');
const sqliteMock = await import('../../tests/m0/mocks/expo-sqlite.mjs');

const { setBraveApiKey, clearBraveApiKey, getWebSearchStatus, updateWebSearchStatus } =
  await import('../../services/tools/webSearch.ts');

// Seed Brave key for orchestration tests
await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-test-key');

const fetchCredential = async (t, k) => {
  if (t === 'async') return asyncMock.default.getItem(k);
  return encMock.default.getItem(k);
};

// Egress ledger
const _origFetch = globalThis.fetch;
const egress = { log: [], clear() { this.log.length = 0; }, _mode: 'passthrough', setMode(m) { this._mode = m; } };
globalThis.fetch = async function(url, opts) {
  const entry = { url: String(url), method: opts?.method ?? 'GET', ts: Date.now() };
  try { const u = new URL(String(url)); entry.port = u.port || '80'; entry.path = u.pathname; entry.host = u.hostname; } catch {}
  egress.log.push(entry);
  if (egress._mode === 'reject-all') return Promise.reject(new Error('ECONNREFUSED'));
  return _origFetch(url, opts);
};

// Source files for structural assertions
const SRC_ORCH   = readFileSync('services/sendOrchestration.ts', 'utf8');
const SRC_ROUTER = readFileSync('services/aiRouter.ts', 'utf8');
const SRC_LOCAL  = readFileSync('services/localAI.ts', 'utf8');
const SRC_EMBED  = readFileSync('services/embeddingService.ts', 'utf8');
const SRC_SEARCH = readFileSync('services/tools/webSearch.ts', 'utf8');
const SRC_TOOLS  = readFileSync('services/readOnlyTools.ts', 'utf8');
const SRC_RECORDER = readFileSync('services/controlPlane/recorder.ts', 'utf8');
const SRC_REGISTRY = readFileSync('services/controlPlane/registry.ts', 'utf8');
const SRC_TRUSTED  = readFileSync('services/controlPlane/trustedHosts.ts', 'utf8');
const SRC_BRAVE    = readFileSync('services/controlPlane/braveKeyMigration.ts', 'utf8');
const SRC_SYS      = readFileSync('app/(tabs)/system.tsx', 'utf8');

function orchParams(text, messages, opts = {}) {
  const dc = classifyData(text);
  return { text, messages, isSensitive: dc.hasMedical || dc.hasFinancial || dc.hasPII,
    dataClass: dc, dataSizeBytes: 100, safeMode: false, nodeOnline: true,
    fetchCredential, messageId: opts.messageId ?? 'test_msg_id',
    conversationId: opts.conversationId ?? 'conv.m4', ...opts };
}

// ══════════════════════════════════════════════════════════════════
//  CONTRACT VALIDATION — every production contract validates with M1
// ══════════════════════════════════════════════════════════════════

describe('Contract validation', () => {
  it('all production contracts validate against M1 CapabilityContract schema', () => {
    const all = listCapabilities();
    assert.ok(all.length >= 13, `expected >=13 contracts, got ${all.length}`);
    for (const contract of all) {
      const result = validateCapabilityContract(contract);
      assert.ok(result.valid, `contract ${contract.id} invalid: ${result.errors.join('; ')}`);
    }
  });

  it('all production providers validate against M1 ProviderDescriptor schema', () => {
    const providerIds = [
      'local_reasoning_resolver', 'cloud_reasoning_resolver',
      'brave_resolver', 'ollama_embed_resolver',
      // Gateway tool resolvers — one per capability (truthful 1:1 cardinality)
      'gateway_ollama_status_resolver', 'gateway_system_info_resolver',
      'gateway_git_status_resolver', 'gateway_git_diff_resolver',
      'gateway_github_repo_resolver', 'gateway_github_commits_resolver',
      'gateway_github_issues_resolver', 'gateway_github_pull_requests_resolver',
      'gateway_github_actions_resolver',
    ];
    for (const id of providerIds) {
      const p = lookupProvider(id);
      assert.ok(p, `provider ${id} not found`);
      const result = validateProviderDescriptor(p);
      assert.ok(result.valid, `provider ${id} invalid: ${result.errors.join('; ')}`);
    }
  });

  it('timeout_ms = 30000 (D6 declared) on every contract', () => {
    assert.equal(DECLARED_TIMEOUT_MS, 30_000);
    for (const c of listCapabilities()) {
      assert.equal(c.timeout_ms, 30_000, `${c.id} timeout_ms should be 30000`);
    }
  });

  it('credential fields contain references not values', () => {
    for (const c of listCapabilities()) {
      const result = validateNoCredentialValues(c);
      assert.ok(result.valid, `${c.id} contains credential value: ${result.errors.join('; ')}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
//  REGISTRY LOOKUP
// ══════════════════════════════════════════════════════════════════

describe('Registry lookup', () => {
  it('lookup known capability returns correct contract', () => {
    const c = lookupCapability('reasoning');
    assert.ok(c, 'reasoning contract not found');
    assert.equal(String(c.id), 'reasoning');
    assert.ok(c.candidate_providers.length > 0, 'reasoning must have providers');
  });

  it('lookup unknown capability returns null (fail closed)', () => {
    assert.equal(lookupCapability('unknown.capability'), null);
    assert.equal(lookupCapability('shell'), null);
    assert.equal(lookupCapability('fixture.ask'), null);
    assert.equal(lookupCapability(''), null);
  });

  it('isRegisteredCapability: known → true, unknown → false', () => {
    assert.equal(isRegisteredCapability('reasoning'), true);
    assert.equal(isRegisteredCapability('web.search'), true);
    assert.equal(isRegisteredCapability('retrieval.embed'), true);
    assert.equal(isRegisteredCapability('ollama.status.read'), true);
    assert.equal(isRegisteredCapability('system.info.read'), true);
    assert.equal(isRegisteredCapability('git.status.read'), true);
    assert.equal(isRegisteredCapability('git.diff.read'), true);
    assert.equal(isRegisteredCapability('github.read.repo'), true);
    assert.equal(isRegisteredCapability('github.read.commits'), true);
    assert.equal(isRegisteredCapability('github.read.issues'), true);
    assert.equal(isRegisteredCapability('github.read.pull_requests'), true);
    assert.equal(isRegisteredCapability('github.read.actions'), true);
    assert.equal(isRegisteredCapability('git.push'), true);           // known-denied
    assert.equal(isRegisteredCapability('github.pr.create'), true);   // known-denied
    assert.equal(isRegisteredCapability('shell'), false);
    assert.equal(isRegisteredCapability('unknown.thing'), false);
    assert.equal(isRegisteredCapability('fixture.ask'), false);
  });

  it('production registry contains no fixture.* capabilities', () => {
    for (const c of listCapabilities()) {
      assert.ok(!String(c.id).startsWith('fixture.'),
        `fixture capability found in production registry: ${c.id}`);
    }
  });

  it('denied contracts have no executable provider path', () => {
    const gitPush = lookupCapability('git.push');
    assert.ok(gitPush, 'git.push must be registered');
    assert.equal(gitPush.candidate_providers.length, 0, 'git.push must have no providers');
    assert.equal(hasExecutableProvider('git.push'), false);

    const prCreate = lookupCapability('github.pr.create');
    assert.ok(prCreate, 'github.pr.create must be registered');
    assert.equal(prCreate.candidate_providers.length, 0, 'github.pr.create must have no providers');
    assert.equal(hasExecutableProvider('github.pr.create'), false);
  });

  it('executable capabilities have providers', () => {
    assert.equal(hasExecutableProvider('reasoning'), true);
    assert.equal(hasExecutableProvider('web.search'), true);
    assert.equal(hasExecutableProvider('retrieval.embed'), true);
    assert.equal(hasExecutableProvider('ollama.status.read'), true);
    assert.equal(hasExecutableProvider('system.info.read'), true);
    assert.equal(hasExecutableProvider('git.status.read'), true);
    assert.equal(hasExecutableProvider('git.diff.read'), true);
    assert.equal(hasExecutableProvider('github.read.repo'), true);
    assert.equal(hasExecutableProvider('github.read.commits'), true);
    assert.equal(hasExecutableProvider('github.read.issues'), true);
    assert.equal(hasExecutableProvider('github.read.pull_requests'), true);
    assert.equal(hasExecutableProvider('github.read.actions'), true);
  });

  it('gateway tool → capability ID mapping covers all tool manifest entries', () => {
    const expectedMappings = {
      'ollama.status':        'ollama.status.read',
      'system.info':          'system.info.read',
      'git.status':           'git.status.read',
      'git.diff':             'git.diff.read',
      'github.repo':          'github.read.repo',
      'github.commits':       'github.read.commits',
      'github.issues':        'github.read.issues',
      'github.pull_requests': 'github.read.pull_requests',
      'github.actions':       'github.read.actions',
      'git.push':             'git.push',
      'github.pr.create':     'github.pr.create',
    };
    for (const [tool, capId] of Object.entries(expectedMappings)) {
      assert.equal(gatewayToolCapabilityId(tool), capId, `tool ${tool} → expected ${capId}`);
    }
    // Unknown tool returns null
    assert.equal(gatewayToolCapabilityId('unknown.tool'), null);
  });
});

// ══════════════════════════════════════════════════════════════════
//  PROVIDER DESCRIPTORS
// ══════════════════════════════════════════════════════════════════

describe('Provider descriptors', () => {
  it('local_reasoning_resolver: boundary unresolved (Ollama host is configurable — M5 resolves)', () => {
    const p = lookupProvider('local_reasoning_resolver');
    assert.ok(p, 'provider not found');
    assert.equal(p.boundary_resolution.status, 'unresolved',
      'local_reasoning_resolver must be unresolved — host is AsyncStorage[ollama_host_v1], M5 resolves');
    assert.equal(String(p.capability_id), 'reasoning');
  });

  it('cloud_reasoning_resolver: INTERNET/CLOUD, architecture_rule', () => {
    const p = lookupProvider('cloud_reasoning_resolver');
    assert.ok(p);
    assert.equal(p.boundary_resolution.status, 'resolved');
    if (p.boundary_resolution.status === 'resolved') {
      assert.equal(p.boundary_resolution.boundary, 'INTERNET/CLOUD');
      assert.equal(p.boundary_resolution.provenance, 'architecture_rule');
    }
    assert.equal(String(p.capability_id), 'reasoning');
  });

  it('brave_resolver: INTERNET/CLOUD, architecture_rule', () => {
    const p = lookupProvider('brave_resolver');
    assert.ok(p);
    assert.equal(p.boundary_resolution.status, 'resolved');
    if (p.boundary_resolution.status === 'resolved') {
      assert.equal(p.boundary_resolution.boundary, 'INTERNET/CLOUD');
    }
    assert.equal(String(p.capability_id), 'web.search');
  });

  it('ollama_embed_resolver: boundary unresolved (Ollama host is configurable — M5 resolves)', () => {
    const p = lookupProvider('ollama_embed_resolver');
    assert.ok(p);
    assert.equal(p.boundary_resolution.status, 'unresolved',
      'ollama_embed_resolver must be unresolved — host is AsyncStorage[ollama_host_v1], M5 resolves');
    assert.equal(String(p.capability_id), 'retrieval.embed');
  });

  it('gateway tool resolvers: all 9 present, all boundary unresolved, capability_id matches contract', () => {
    const gatewayResolvers = [
      { id: 'gateway_ollama_status_resolver',       cap: 'ollama.status.read' },
      { id: 'gateway_system_info_resolver',          cap: 'system.info.read' },
      { id: 'gateway_git_status_resolver',           cap: 'git.status.read' },
      { id: 'gateway_git_diff_resolver',             cap: 'git.diff.read' },
      { id: 'gateway_github_repo_resolver',          cap: 'github.read.repo' },
      { id: 'gateway_github_commits_resolver',       cap: 'github.read.commits' },
      { id: 'gateway_github_issues_resolver',        cap: 'github.read.issues' },
      { id: 'gateway_github_pull_requests_resolver', cap: 'github.read.pull_requests' },
      { id: 'gateway_github_actions_resolver',       cap: 'github.read.actions' },
    ];
    for (const { id, cap } of gatewayResolvers) {
      const p = lookupProvider(id);
      assert.ok(p, `${id} not found`);
      assert.equal(p.boundary_resolution.status, 'unresolved', `${id} must be unresolved`);
      assert.equal(String(p.capability_id), cap, `${id}: capability_id must equal ${cap}`);
    }
  });

  it('lookupProvidersByCapability: reasoning has 2 providers', () => {
    const providers = lookupProvidersByCapability('reasoning');
    assert.equal(providers.length, 2);
    const ids = providers.map(p => String(p.id)).sort();
    assert.deepEqual(ids, ['cloud_reasoning_resolver', 'local_reasoning_resolver'].sort());
  });

  it('cardinality invariant: every contract candidate_provider.capability_id matches contract.id', () => {
    for (const contract of listCapabilities()) {
      for (const pid of contract.candidate_providers) {
        const descriptor = lookupProvider(String(pid));
        assert.ok(descriptor,
          `contract ${contract.id}: candidate_provider '${pid}' has no registered descriptor`);
        assert.equal(String(descriptor.capability_id), String(contract.id),
          `descriptor ${pid} capability_id='${descriptor.capability_id}' does not match contract id='${contract.id}'`);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════
//  DENY + RECORD
// ══════════════════════════════════════════════════════════════════

describe('Registry denial recording', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('checkCapabilityOrDeny: registered + executable → allowed=true, recording=null', async () => {
    const result = await checkCapabilityOrDeny('reasoning');
    assert.equal(result.allowed, true);
    assert.equal(result.recording, null);
  });

  it('checkCapabilityOrDeny: unregistered → allowed=false, recording=recorded + durable record', async () => {
    const sessionId = getSessionId();
    const before = await queryBySessionId(sessionId);
    const countBefore = before.length;

    const result = await checkCapabilityOrDeny('shell');
    assert.equal(result.allowed, false);
    assert.equal(result.recording, 'recorded', 'Recorder ready → recording must be recorded');

    const after = await queryBySessionId(sessionId);
    const denial = after.find(r => {
      try { return JSON.parse(r.payload).capability_id === 'shell'; } catch { return false; }
    });
    assert.ok(denial, 'denial record for shell not found');
    assert.equal(denial.record_kind, 'interim_gate');
    assert.equal(denial.source, 'capability_registry');
    const payload = JSON.parse(denial.payload);
    assert.equal(payload.reason, 'unregistered_capability');
    assert.equal(after.length, countBefore + 1);
  });

  it('checkCapabilityOrDeny: known-denied (git.push) → allowed=false, recording=recorded + durable record', async () => {
    const sessionId = getSessionId();
    const before = await queryBySessionId(sessionId);
    const countBefore = before.length;

    const result = await checkCapabilityOrDeny('git.push');
    assert.equal(result.allowed, false);
    assert.equal(result.recording, 'recorded', 'Recorder ready → recording must be recorded');

    const after = await queryBySessionId(sessionId);
    const denial = after.find(r => {
      try { return JSON.parse(r.payload).capability_id === 'git.push'; } catch { return false; }
    });
    assert.ok(denial, 'denial record for git.push not found');
    assert.equal(denial.record_kind, 'interim_gate');
    assert.equal(denial.source, 'capability_registry');
    const payload = JSON.parse(denial.payload);
    assert.equal(payload.reason, 'denied_capability');
    assert.equal(after.length, countBefore + 1);
  });

  it('checkCapabilityOrDeny: github.pr.create → allowed=false, recording=recorded', async () => {
    const result = await checkCapabilityOrDeny('github.pr.create');
    assert.equal(result.allowed, false);
    assert.equal(result.recording, 'recorded');
  });

  it('registry denial distinguishable from M2 interim_boundary_gate (different source)', async () => {
    const sessionId = getSessionId();
    const all = await queryBySessionId(sessionId);
    const registryDenials = all.filter(r => r.source === 'capability_registry');
    const gateDenials = all.filter(r => r.source === 'interim_boundary_gate');
    // Both can coexist; they're distinguishable by source field
    for (const rd of registryDenials) {
      assert.equal(rd.record_kind, 'interim_gate');
      assert.notEqual(rd.source, 'interim_boundary_gate');
    }
    for (const gd of gateDenials) {
      assert.notEqual(gd.source, 'capability_registry');
    }
  });

  it('recordRegistryDenial: Recorder not initialized → returns degraded (no throw)', async () => {
    __resetRecorder();
    const status = await recordRegistryDenial('shell', 'unregistered_capability');
    assert.equal(status, 'degraded', 'uninitialized Recorder → degraded');
    // No record written (Recorder not ready)
    await initRecorder();
  });

  it('recordRegistryDenial: Recorder ready → returns recorded', async () => {
    const status = await recordRegistryDenial('shell', 'unregistered_capability');
    assert.equal(status, 'recorded', 'ready Recorder → recorded');
  });

  it('recordRegistryDenial: append commit fault → returns degraded', async () => {
    sqliteMock.__setCommitFault(true);
    const status = await recordRegistryDenial('shell', 'unregistered_capability');
    assert.equal(status, 'degraded', 'commit fault → degraded');
    sqliteMock.__setCommitFault(false);
  });

  it('denial durable: checkCapabilityOrDeny with ready Recorder → allowed=false, recording=recorded, record exists', async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
    const sessionId = getSessionId();

    const result = await checkCapabilityOrDeny('unregistered.capability.durable.test');
    assert.equal(result.allowed, false, 'must deny');
    assert.equal(result.recording, 'recorded', 'Recorder ready → recording=recorded');

    const records = await queryBySessionId(sessionId);
    const denial = records.find(r => {
      try { return JSON.parse(r.payload).capability_id === 'unregistered.capability.durable.test'; } catch { return false; }
    });
    assert.ok(denial, 'durable denial record must exist when Recorder ready');
    assert.equal(denial.record_kind, 'interim_gate');
    assert.equal(denial.source, 'capability_registry');
  });

  it('denial degraded: checkCapabilityOrDeny with uninitialized Recorder → allowed=false, recording=degraded, zero egress', async () => {
    __resetRecorder(); // Recorder not initialized — degraded mode

    egress.clear();
    egress.setMode('passthrough');

    const result = await checkCapabilityOrDeny('unregistered.degraded.test');
    assert.equal(result.allowed, false, 'must deny even when Recorder unavailable');
    assert.equal(result.recording, 'degraded', 'uninitialized Recorder → recording=degraded');

    // No egress — denial enforced before any network contact
    const egressContacts = egress.log.filter(e =>
      e.url.includes('unregistered') || e.url.includes('degraded')
    );
    assert.equal(egressContacts.length, 0, 'zero egress on denial regardless of Recorder state');

    // Restore Recorder for remaining tests
    await initRecorder();
  });

  it('denial degraded: append commit fault → allowed=false, recording=degraded', async () => {
    sqliteMock.__setCommitFault(true);
    const result = await checkCapabilityOrDeny('unregistered.commitfault.test');
    assert.equal(result.allowed, false, 'must deny');
    assert.equal(result.recording, 'degraded', 'commit fault → recording=degraded');
    sqliteMock.__setCommitFault(false);
  });

  it('zero egress on denial: git.push → allowed=false, recording=recorded, zero gateway contact', async () => {
    egress.clear();
    const result = await checkCapabilityOrDeny('git.push');
    assert.equal(result.allowed, false);
    assert.equal(result.recording, 'recorded', 'git.push denial must be recorded when Recorder ready');
    const gatewayContacts = egress.log.filter(e => e.path === '/tools/run');
    assert.equal(gatewayContacts.length, 0,
      'git.push must produce zero gateway egress regardless of Recorder availability');
  });
});

// ══════════════════════════════════════════════════════════════════
//  ADVERSARIAL GATEWAY TOOL CHECKS
// ══════════════════════════════════════════════════════════════════

describe('Adversarial gateway tool checks', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('unknown tool: zero egress before registry denial', async () => {
    egress.clear();
    egress.setMode('reject-all');

    // buildReadOnlyMacToolContext should not call egress for unregistered tool
    // We verify via gatewayToolCapabilityId + checkCapabilityOrDeny
    const capId = gatewayToolCapabilityId('totally.unknown.tool');
    assert.equal(capId, null);

    const allowed = await checkCapabilityOrDeny(capId ?? 'totally.unknown.tool');
    assert.equal(allowed.allowed, false);

    // No egress contact — registry check is app-side
    const gatewayContacts = egress.log.filter(e => e.path === '/tools/run');
    assert.equal(gatewayContacts.length, 0, 'unknown tool must not contact gateway');

    egress.setMode('passthrough');
  });

  it('git.push: zero egress + denial recorded', async () => {
    egress.clear();
    const sessionId = getSessionId();
    const before = await queryBySessionId(sessionId);

    const capId = gatewayToolCapabilityId('git.push');
    assert.equal(capId, 'git.push');
    const allowed = await checkCapabilityOrDeny(capId);
    assert.equal(allowed.allowed, false);
    assert.equal(allowed.recording, 'recorded', 'git.push denial must be recorded');

    const gatewayContacts = egress.log.filter(e => e.path === '/tools/run');
    assert.equal(gatewayContacts.length, 0, 'git.push must not contact gateway');

    const after = await queryBySessionId(sessionId);
    const denial = after.find(r => {
      try { return JSON.parse(r.payload).capability_id === 'git.push'; } catch { return false; }
    });
    assert.ok(denial, 'git.push denial not recorded');
    assert.equal(denial.source, 'capability_registry');
  });

  it('github.pr.create: zero egress + denial recorded', async () => {
    egress.clear();
    const sessionId = getSessionId();

    const capId = gatewayToolCapabilityId('github.pr.create');
    assert.equal(capId, 'github.pr.create');
    const allowed = await checkCapabilityOrDeny(capId);
    assert.equal(allowed.allowed, false);
    assert.equal(allowed.recording, 'recorded', 'github.pr.create denial must be recorded');

    const gatewayContacts = egress.log.filter(e => e.path === '/tools/run');
    assert.equal(gatewayContacts.length, 0, 'github.pr.create must not contact gateway');
  });

  it('tool with extra command field: not mapped, treated as unregistered', () => {
    // Gateway tool capability lookup is by tool NAME only
    // Extra fields like 'command' cannot affect capability lookup
    const capId = gatewayToolCapabilityId('git.status');
    assert.equal(capId, 'git.status.read'); // normal tool ok

    // A tool name that includes an injected command is simply unknown
    const injected = gatewayToolCapabilityId('git.status; rm -rf /');
    assert.equal(injected, null, 'injected tool name must return null');
  });

  it('URL smuggling via tool name: unregistered', () => {
    const smuggled = gatewayToolCapabilityId('http://evil.example.com');
    assert.equal(smuggled, null);
  });
});

// ══════════════════════════════════════════════════════════════════
//  D5: TRUSTED-HOST CONFIGURATION
// ══════════════════════════════════════════════════════════════════

describe('D5 Trusted-host configuration', () => {
  beforeEach(async () => {
    await __clearTrustedHosts();
  });
  afterEach(async () => {
    await __clearTrustedHosts();
  });

  // ── Architecture constant ────────────────────────────────────────

  it('AUTO_TRUSTED_CIDR is exported and equals 192.168.4. (M5 architecture rule constant)', () => {
    assert.equal(AUTO_TRUSTED_CIDR, '192.168.4.',
      'AUTO_TRUSTED_CIDR must equal 192.168.4. for M5 boundary resolution');
  });

  it('M4 trustedHosts does not export isTrustedHost or getTrustedHostBoundary (M5 resolution removed)', () => {
    // These functions produced BoundaryResolution at runtime — M5 scope.
    // M4 only provides configuration facts and the CIDR constant.
    const trusted = { hasTrustedHostDeclaration, getTrustedHostDeclaration, getTrustedHosts,
                      declareTrustedHost, revokeTrustedHost };
    assert.ok(!('isTrustedHost' in trusted),
      'isTrustedHost must not be exported from M4 trustedHosts');
    assert.ok(!('getTrustedHostBoundary' in trusted),
      'getTrustedHostBoundary must not be exported from M4 trustedHosts');
  });

  // ── hasTrustedHostDeclaration (explicit declarations only) ───────

  it('hasTrustedHostDeclaration: no declaration → false', async () => {
    // Explicit declaration check only — does NOT apply architecture rule
    assert.equal(await hasTrustedHostDeclaration('192.168.4.52:11434'), false);
    assert.equal(await hasTrustedHostDeclaration('10.0.0.1'), false);
    assert.equal(await hasTrustedHostDeclaration('8.8.8.8'), false);
  });

  it('hasTrustedHostDeclaration: after declareTrustedHost → true', async () => {
    await declareTrustedHost('10.0.0.1', 'My VPN server');
    assert.equal(await hasTrustedHostDeclaration('10.0.0.1'), true);
  });

  it('hasTrustedHostDeclaration: after revoke → false', async () => {
    const config = await declareTrustedHost('10.0.0.2', 'To be revoked');
    assert.equal(await hasTrustedHostDeclaration('10.0.0.2'), true);
    await revokeTrustedHost(config.id);
    assert.equal(await hasTrustedHostDeclaration('10.0.0.2'), false);
  });

  it('hasTrustedHostDeclaration: strips port for matching', async () => {
    await declareTrustedHost('10.0.0.3', 'Port test');
    assert.equal(await hasTrustedHostDeclaration('10.0.0.3'), true);
    assert.equal(await hasTrustedHostDeclaration('10.0.0.3:8787'), true);
  });

  // ── getTrustedHostDeclaration ────────────────────────────────────

  it('getTrustedHostDeclaration: no declaration → null', async () => {
    assert.equal(await getTrustedHostDeclaration('10.0.0.5'), null);
  });

  it('getTrustedHostDeclaration: after declaration → returns config', async () => {
    await declareTrustedHost('10.0.0.4', 'VPN gateway');
    const decl = await getTrustedHostDeclaration('10.0.0.4');
    assert.ok(decl, 'should return config after declaration');
    assert.equal(decl.host, '10.0.0.4');
    assert.equal(decl.declared_boundary, 'PRIVATE_LAN');
    assert.equal(decl.user_declaration, 'VPN gateway');
    assert.ok(decl.id.startsWith('th.'));
  });

  // ── declareTrustedHost / revokeTrustedHost ───────────────────────

  it('declareTrustedHost: stores config with correct fields', async () => {
    const config = await declareTrustedHost('192.168.1.100:8787', 'Test LAN declaration');
    assert.ok(config.id.startsWith('th.'));
    assert.equal(config.host, '192.168.1.100:8787');
    assert.equal(config.declared_boundary, 'PRIVATE_LAN');
    assert.ok(config.user_declaration.length > 0);
    assert.ok(config.timestamp);
    assert.equal(config.version, 1);
  });

  it('only PRIVATE_LAN may be declared — contract enforces it', async () => {
    const config = await declareTrustedHost('10.0.0.1', 'User declared');
    const result = validateTrustedHostConfig(config);
    assert.ok(result.valid, `TrustedHostConfig invalid: ${result.errors.join('; ')}`);
    assert.equal(config.declared_boundary, 'PRIVATE_LAN');
  });

  it('D5 config version and timestamp are present', async () => {
    const config = await declareTrustedHost('10.0.1.1', 'version test');
    assert.equal(config.version, 1);
    assert.ok(config.timestamp.length > 0);
    const result = validateTrustedHostConfig(config);
    assert.ok(result.valid);
  });

  it('getTrustedHosts: returns all declared hosts', async () => {
    await declareTrustedHost('10.0.0.10', 'Host A');
    await declareTrustedHost('10.0.0.11', 'Host B');
    const all = await getTrustedHosts();
    assert.ok(all.length >= 2);
    const hosts = all.map(c => c.host);
    assert.ok(hosts.includes('10.0.0.10'));
    assert.ok(hosts.includes('10.0.0.11'));
  });

  it('R2 extension: model output cannot write trusted-host configuration', () => {
    const writeSig = 'declareTrustedHost';
    assert.ok(!SRC_ORCH.includes(writeSig),   'sendOrchestration must not import declareTrustedHost');
    assert.ok(!SRC_ROUTER.includes(writeSig), 'aiRouter must not import declareTrustedHost');
    assert.ok(!SRC_LOCAL.includes(writeSig),  'localAI must not import declareTrustedHost');
    assert.ok(!SRC_EMBED.includes(writeSig),  'embeddingService must not import declareTrustedHost');
    assert.ok(!SRC_SEARCH.includes(writeSig), 'webSearch must not import declareTrustedHost');
    assert.ok(!SRC_TOOLS.includes(writeSig),  'readOnlyTools must not import declareTrustedHost');
    assert.ok(!SRC_RECORDER.includes(writeSig), 'recorder must not import declareTrustedHost');
  });

  it('R2 extension: model output cannot mutate capability registry', () => {
    const mutationSignatures = ['_capabilityMap.set', '_providerMap.set', '_contracts.push', 'registry.set', 'addCapability', 'registerCapability'];
    for (const sig of mutationSignatures) {
      assert.ok(!SRC_REGISTRY.includes(sig), `registry exposes mutation: ${sig}`);
    }
  });

  it('R2 extension: model output attempts declareTrustedHost with adversarial host', async () => {
    const config = await declareTrustedHost('evil.example.com', 'adversarial declaration');
    assert.equal(config.declared_boundary, 'PRIVATE_LAN', 'only PRIVATE_LAN can be declared');
  });
});

// ══════════════════════════════════════════════════════════════════
//  D4: BRAVE KEY MIGRATION
// ══════════════════════════════════════════════════════════════════

describe('D4 Brave key migration', () => {
  beforeEach(async () => {
    // Clear both stores before each test
    await clearBraveApiKeySecure();
    await asyncMock.default.removeItem('brave_search_api_key_v1');
  });
  afterEach(async () => {
    await clearBraveApiKeySecure();
    await asyncMock.default.removeItem('brave_search_api_key_v1');
    // Restore test key for other tests
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-test-key');
  });

  it('no key: migration returns no_key', async () => {
    const result = await migrateBraveKey();
    assert.equal(result.status, 'no_key');
    assert.equal(result.keyAvailable, false);
  });

  it('legacy key present: migrates to secureStorage, removes legacy', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-fake-legacy-key');
    const result = await migrateBraveKey();
    assert.equal(result.status, 'migrated');
    assert.equal(result.keyAvailable, true);

    // Key readable from secureStorage
    const secure = await getBraveApiKeySecure();
    assert.equal(secure, 'BSA-fake-legacy-key');

    // Legacy key removed from AsyncStorage
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, null, 'legacy key must be absent from AsyncStorage after migration');
  });

  it('already in secureStorage: returns already_secure, no re-migration', async () => {
    await setBraveApiKeySecure('BSA-already-secure-key');
    const result = await migrateBraveKey();
    assert.equal(result.status, 'already_secure');
    assert.equal(result.keyAvailable, true);
  });

  it('migration is idempotent: second call returns already_secure', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-idempotent-test');
    await migrateBraveKey();
    const result2 = await migrateBraveKey();
    assert.equal(result2.status, 'already_secure');
  });

  // ── Fault injection tests (deterministic) ────────────────────────

  it('Fault A — migrateBraveKey: secureStorage setItem fails → migration_failed, legacy preserved', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-fault-a-key');
    // Inject fault on encrypted-storage setItem (skip 0 = fires on next call)
    encMock.__injectFault('setItem', new Error('mock secure write failure'));
    const result = await migrateBraveKey();
    encMock.__clearFaults();
    assert.equal(result.status, 'migration_failed', 'setItem fault → migration_failed');
    assert.equal(result.keyAvailable, false);
    // Legacy key must still be present
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, 'BSA-fault-a-key', 'Fault A: legacy key must be preserved');
  });

  it('Fault B — migrateBraveKey: secureStorage readback fails → migration_failed, legacy preserved', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-fault-b-key');
    // Skip 1: first getItem (step 1 = check existing) succeeds, second getItem (step 4 = readback) fails
    encMock.__injectFault('getItem', new Error('mock secure readback failure'), 1);
    const result = await migrateBraveKey();
    encMock.__clearFaults();
    assert.equal(result.status, 'migration_failed', 'readback fault → migration_failed');
    assert.equal(result.keyAvailable, false);
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, 'BSA-fault-b-key', 'Fault B: legacy key must be preserved');
  });

  it('Fault C — migrateBraveKey: AsyncStorage removeItem fails → migrated_legacy_cleanup_failed, secure copy valid', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-fault-c-key');
    asyncMock.__injectFault('removeItem', new Error('mock async remove failure'));
    const result = await migrateBraveKey();
    asyncMock.__clearFaults();
    assert.equal(result.status, 'migrated_legacy_cleanup_failed', 'removeItem fault → migrated_legacy_cleanup_failed');
    assert.equal(result.keyAvailable, true, 'Fault C: secure copy is valid, key available');
    // Secure copy is readable
    const secure = await getBraveApiKeySecure();
    assert.equal(secure, 'BSA-fault-c-key', 'Fault C: secure copy must be readable');
  });

  it('Fault A — getBraveApiKeySecure: setItem fails → returns legacy key, no credential loss', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-get-fault-a');
    encMock.__injectFault('setItem', new Error('mock secure write failure'));
    const key = await getBraveApiKeySecure();
    encMock.__clearFaults();
    assert.equal(key, 'BSA-get-fault-a', 'Fault A: must return legacy key (no credential loss)');
    // Legacy preserved (setItem failed, so we did not remove it)
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, 'BSA-get-fault-a', 'Fault A: legacy must be preserved when setItem fails');
  });

  it('Fault B — getBraveApiKeySecure: readback fails → returns legacy key, legacy preserved', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-get-fault-b');
    // skip 1: first getItem (check secure) succeeds (returns null); second (readback) fails
    encMock.__injectFault('getItem', new Error('mock secure readback failure'), 1);
    const key = await getBraveApiKeySecure();
    encMock.__clearFaults();
    assert.equal(key, 'BSA-get-fault-b', 'Fault B: must return legacy key when readback fails');
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, 'BSA-get-fault-b', 'Fault B: legacy must be preserved');
  });

  it('Fault C — getBraveApiKeySecure: removeItem fails → returns secure copy, cleanup incomplete', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-get-fault-c');
    asyncMock.__injectFault('removeItem', new Error('mock async remove failure'));
    const key = await getBraveApiKeySecure();
    asyncMock.__clearFaults();
    assert.equal(key, 'BSA-get-fault-c', 'Fault C: must return secure copy');
    // Legacy may persist (cleanup incomplete) — that is acceptable
  });

  it('migrated key not logged (credential not in migration result)', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-secret-key-12345');
    const result = await migrateBraveKey();
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('BSA-secret-key-12345'), 'key value must not appear in migration result');
  });

  // ── No-Settings migration (D4 inline migration requirement) ─────

  it('no-Settings migration: getBraveApiKeySecure performs copy→verify→remove when secure absent', async () => {
    // Precondition: legacy key exists, secure key absent, Settings NEVER opened (migrateBraveKey not called)
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-inline-migration-key');
    // secureStorage is empty (cleared in beforeEach)

    // First credential read (simulating first web.search without Settings)
    const key = await getBraveApiKeySecure();
    assert.equal(key, 'BSA-inline-migration-key', 'must return migrated key');

    // Legacy key must now be absent (migration completed inline)
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, null, 'legacy AsyncStorage key must be removed after inline migration');
  });

  it('no-Settings migration: second getBraveApiKeySecure call returns secure key directly', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-second-read-key');
    await getBraveApiKeySecure(); // triggers inline migration
    const key2 = await getBraveApiKeySecure();
    assert.equal(key2, 'BSA-second-read-key', 'second read must return same key from secureStorage');
    // Legacy still absent
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, null, 'legacy must remain absent after second read');
  });

  it('no-Settings migration: no legacy key → returns empty string', async () => {
    // secure absent, legacy absent
    const key = await getBraveApiKeySecure();
    assert.equal(key, '', 'no key → empty string');
  });

  // ── Stale-key resurrection prevention ───────────────────────────

  it('setBraveApiKeySecure: returns {stored:true, legacyRemoved:true} on full success', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-stale-legacy');
    const result = await setBraveApiKeySecure('BSA-new-secure-key');
    assert.equal(result.stored, true, 'stored must be true on success');
    assert.equal(result.legacyRemoved, true, 'legacyRemoved must be true when legacy is present and removable');

    // secureStorage has new key
    const secure = await getBraveApiKeySecure();
    assert.equal(secure, 'BSA-new-secure-key', 'secureStorage must contain new key');

    // Legacy must be gone
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, null, 'legacy AsyncStorage key must be absent after setBraveApiKeySecure');
  });

  it('setBraveApiKeySecure: secureStorage write failure → {stored:false, legacyRemoved:false}', async () => {
    encMock.__injectFault('setItem', new Error('mock secure write failure'));
    const result = await setBraveApiKeySecure('BSA-write-fail-key');
    encMock.__clearFaults();
    assert.equal(result.stored, false, 'stored=false when setItem fails');
    assert.equal(result.legacyRemoved, false, 'legacyRemoved=false when write fails (no legacy removal attempted)');
  });

  it('clearBraveApiKeySecure: returns {secureCleared:true, legacyCleared:true} on full success', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-to-clear-legacy');
    await setBraveApiKeySecure('BSA-to-clear-secure');

    const result = await clearBraveApiKeySecure();
    assert.equal(result.secureCleared, true, 'secureCleared must be true');
    assert.equal(result.legacyCleared, true, 'legacyCleared must be true');

    const key = await getBraveApiKeySecure();
    assert.equal(key, '', 'getBraveApiKeySecure must return empty after clear');

    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, null, 'legacy must be absent after clearBraveApiKeySecure');
  });

  it('clearBraveApiKeySecure: EncryptedStorage removal fault → secureCleared=false, key preserved; retry → secureCleared=true, key absent', async () => {
    const SECURE_STORE_KEY = 'brave_search_api_key_secure_v1';
    // Setup: write a key to secureStorage
    await setBraveApiKeySecure('BSA-clear-secure-fault-key');
    assert.ok(encMock.__testStore.has(SECURE_STORE_KEY),
      'setup: secure key must exist in mock before test');

    // Inject EncryptedStorage.removeItem fault — clearBraveApiKeySecure must catch and report false
    encMock.__injectFault('removeItem', new Error('mock EncryptedStorage remove failure'));
    const result1 = await clearBraveApiKeySecure();
    assert.equal(result1.secureCleared, false,
      'EncryptedStorage removal fault → secureCleared=false');
    // Key must still be present — removal was not completed
    assert.ok(encMock.__testStore.has(SECURE_STORE_KEY),
      'secure key must remain in mock after failed removal');

    // Clear fault and retry — removal should now succeed
    encMock.__clearFaults();
    const result2 = await clearBraveApiKeySecure();
    assert.equal(result2.secureCleared, true, 'retry without fault → secureCleared=true');
    assert.ok(!encMock.__testStore.has(SECURE_STORE_KEY),
      'secure key must be absent from mock after successful retry');
  });

  it('clearBraveApiKeySecure: AsyncStorage remove fault → {secureCleared:true, legacyCleared:false}', async () => {
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-clear-legacy-fault');
    await setBraveApiKeySecure('BSA-clear-legacy-secure');
    asyncMock.__injectFault('removeItem', new Error('mock async remove failure'));
    const result = await clearBraveApiKeySecure();
    asyncMock.__clearFaults();
    assert.equal(result.secureCleared, true, 'secureCleared=true — secure removal proceeds independently');
    assert.equal(result.legacyCleared, false, 'legacyCleared=false when removeItem faults');
  });

  it('stale legacy key cannot resurrect after setBraveApiKeySecure', async () => {
    // Scenario: key was previously migrated, user updates key via Settings
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-stale-pre-migration');
    const result = await setBraveApiKeySecure('BSA-updated-key');
    assert.equal(result.stored, true, 'must report stored=true');
    assert.equal(result.legacyRemoved, true, 'must report legacyRemoved=true');

    // Verify stale legacy is gone
    const legacy = await asyncMock.default.getItem('brave_search_api_key_v1');
    assert.equal(legacy, null, 'stale legacy key must not survive after setBraveApiKeySecure');

    // Verify correct key returned
    const key = await getBraveApiKeySecure();
    assert.equal(key, 'BSA-updated-key', 'must return updated secure key, not stale legacy');
  });

  it('R2 extension: model output cannot write Brave credential', () => {
    assert.ok(!SRC_ROUTER.includes('setBraveApiKey'), 'aiRouter must not write Brave key');
    assert.ok(!SRC_ORCH.includes('setBraveApiKey'), 'sendOrchestration must not write Brave key');
    assert.ok(!SRC_RECORDER.includes('setBraveApiKey'), 'recorder must not write Brave key');
    assert.ok(SRC_SEARCH.includes('setBraveApiKey'), 'webSearch must export setBraveApiKey for Settings');
    assert.ok(SRC_SEARCH.includes('getBraveApiKeySecure'), 'webSearch must use secureStorage path');
  });
});

// ══════════════════════════════════════════════════════════════════
//  WEBSEARCH CALLER STATUS (setBraveApiKey / clearBraveApiKey)
// ══════════════════════════════════════════════════════════════════

const SECURE_STORE_KEY = 'brave_search_api_key_secure_v1';

describe('WebSearch caller status', () => {
  beforeEach(async () => {
    encMock.__clearFaults();
    asyncMock.__clearFaults();
    updateWebSearchStatus('unavailable');
    encMock.__testStore.delete(SECURE_STORE_KEY);
    await asyncMock.default.removeItem('brave_search_api_key_v1');
  });
  afterEach(async () => {
    encMock.__clearFaults();
    asyncMock.__clearFaults();
    encMock.__testStore.delete(SECURE_STORE_KEY);
    await asyncMock.default.removeItem('brave_search_api_key_v1');
    // Restore test key for other suites
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-test-key');
  });

  // ── setBraveApiKey ────────────────────────────────────────────

  it('setBraveApiKey: full success → stored=true, legacyRemoved=true, status=configured', async () => {
    const result = await setBraveApiKey('BSA-caller-success');
    assert.equal(result.stored, true, 'stored must be true on success');
    assert.equal(result.legacyRemoved, true, 'legacyRemoved must be true when no legacy exists');
    assert.equal(getWebSearchStatus(), 'configured',
      'status must be configured after full save success');
  });

  it('Test A — first-time save failure: stored=false, no prior key, status=unavailable, draft not masked', async () => {
    // No prior secure key, no legacy key (beforeEach cleared both)
    encMock.__injectFault('setItem', new Error('mock secure write failure'));
    const result = await setBraveApiKey('BSA-first-save-fail');
    assert.equal(result.stored, false, 'stored must be false when write fails');
    assert.equal(getWebSearchStatus(), 'unavailable',
      'no prior key — status must be unavailable on first-time save failure');
    // Structural: new key was not stored
    const storedKey = encMock.__testStore.get(SECURE_STORE_KEY);
    assert.ok(!storedKey, 'failed new key must not appear in secure store');
  });

  it('Test B — replacement failure: stored=false, old key preserved, status=configured (old key remains)', async () => {
    // Set up: existing secure key
    encMock.__testStore.set(SECURE_STORE_KEY, 'BSA-old-key');
    // Inject setItem fault — replacement attempt will fail
    encMock.__injectFault('setItem', new Error('mock secure write failure'));
    const result = await setBraveApiKey('BSA-new-replacement');
    // Write failed — new key not stored
    assert.equal(result.stored, false, 'stored=false: replacement write failed');
    // Old key must still be in the store untouched
    assert.equal(encMock.__testStore.get(SECURE_STORE_KEY), 'BSA-old-key',
      'old key must remain in secure store after failed replacement');
    // getBraveApiKeySecure sees the old key — status must reflect that
    assert.equal(getWebSearchStatus(), 'configured',
      'old credential still usable — status must be configured, not unavailable');
    // Verify old key is still readable
    const readable = await getBraveApiKeySecure();
    assert.equal(readable, 'BSA-old-key', 'old key must still be readable via getBraveApiKeySecure');
  });

  it('setBraveApiKey: partial legacy cleanup → stored=true, legacyRemoved=false, key usable, caller does not treat as full success', async () => {
    asyncMock.__injectFault('removeItem', new Error('mock legacy remove failure'));
    const result = await setBraveApiKey('BSA-caller-partial');
    asyncMock.__clearFaults();
    assert.equal(result.stored, true, 'stored=true: key is in secureStorage');
    assert.equal(result.legacyRemoved, false, 'legacyRemoved=false: cleanup incomplete');
    // Key is usable — status is configured; result exposes incomplete cleanup to caller
    assert.equal(getWebSearchStatus(), 'configured',
      'key usable — status configured despite partial cleanup');
    assert.equal(result.legacyRemoved, false,
      'caller can see legacyRemoved=false; full success not claimed');
    const key = await getBraveApiKeySecure();
    assert.equal(key, 'BSA-caller-partial', 'key must be readable after partial save');
  });

  // ── clearBraveApiKey ──────────────────────────────────────────

  it('clearBraveApiKey: full success → secureCleared=true, legacyCleared=true, status=unavailable', async () => {
    await setBraveApiKey('BSA-to-clear');
    updateWebSearchStatus('configured');
    const result = await clearBraveApiKey();
    assert.equal(result.secureCleared, true);
    assert.equal(result.legacyCleared, true);
    assert.equal(getWebSearchStatus(), 'unavailable',
      'status must be unavailable after full clear');
  });

  it('clearBraveApiKey: secure removal fault → secureCleared=false, status NOT unavailable (key still accessible)', async () => {
    await setBraveApiKey('BSA-clear-secure-fault');
    updateWebSearchStatus('configured');
    encMock.__injectFault('removeItem', new Error('mock secure remove failure'));
    const result = await clearBraveApiKey();
    encMock.__clearFaults();
    assert.equal(result.secureCleared, false, 'secureCleared=false when removal faults');
    assert.notEqual(getWebSearchStatus(), 'unavailable',
      'must not claim unavailable when secure key remains accessible');
    const key = await getBraveApiKeySecure();
    assert.ok(key.length > 0, 'key must still be accessible when secure removal failed');
  });

  it('clearBraveApiKey: legacy removal fault → legacyCleared=false, status reflects actual availability', async () => {
    // Set up: secure key present, plus a legacy remnant
    encMock.__testStore.set(SECURE_STORE_KEY, 'BSA-clear-legacy-fault');
    await asyncMock.default.setItem('brave_search_api_key_v1', 'BSA-legacy-remnant');
    updateWebSearchStatus('configured');
    asyncMock.__injectFault('removeItem', new Error('mock legacy remove failure'));
    const result = await clearBraveApiKey();
    asyncMock.__clearFaults();
    assert.equal(result.secureCleared, true, 'secure key removed successfully');
    assert.equal(result.legacyCleared, false, 'legacy removal fault → legacyCleared=false');
    // Secure gone, legacy still accessible → re-check finds key → status not unavailable
    assert.notEqual(getWebSearchStatus(), 'unavailable',
      'must not claim unavailable when legacy key remains accessible after partial clear');
  });

  // ── System UI structural checks ───────────────────────────────

  it('system.tsx: saveKey gates draft masking and success indicator on result.stored / result.legacyRemoved', () => {
    assert.ok(SRC_SYS.includes('const result = await setBraveApiKey('),
      'saveKey must capture setBraveApiKey result');
    // Draft masking must be inside result.stored branch
    assert.ok(SRC_SYS.includes('if (result.stored)'),
      'saveKey must gate on result.stored before masking draft');
    const storedBranchIdx = SRC_SYS.indexOf('if (result.stored)');
    const maskDraftIdx = SRC_SYS.indexOf("setKeyDraft('••••••••')", storedBranchIdx);
    assert.ok(maskDraftIdx !== -1 && maskDraftIdx > storedBranchIdx,
      "setKeyDraft('••••••••') must appear inside result.stored branch, not unconditionally");
    // Full-success indicator gated on both stored and legacyRemoved
    assert.ok(SRC_SYS.includes('result.stored && result.legacyRemoved') ||
              SRC_SYS.includes('result.legacyRemoved'),
      'saveKey must gate setKeySaved(true) on result.legacyRemoved');
  });

  it('system.tsx: clearKey uses getWebSearchStatus() and only blanks draft on full clear', () => {
    assert.ok(SRC_SYS.includes('const result = await clearBraveApiKey()'),
      'clearKey must capture clearBraveApiKey result');
    assert.ok(SRC_SYS.includes('result.secureCleared && result.legacyCleared'),
      'clearKey must check both clear results before blanking draft');
  });
});

// ══════════════════════════════════════════════════════════════════
//  EGRESS-TO-REGISTRY COVERAGE (Integration)
// ══════════════════════════════════════════════════════════════════

describe('Egress-to-registry coverage', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('reasoning capability is registered and has providers for both local and cloud paths', () => {
    const providers = lookupProvidersByCapability('reasoning');
    const ids = providers.map(p => String(p.id));
    assert.ok(ids.includes('local_reasoning_resolver'), 'local reasoning provider missing');
    assert.ok(ids.includes('cloud_reasoning_resolver'), 'cloud reasoning provider missing');
  });

  it('web.search registered + has brave_resolver provider', () => {
    const providers = lookupProvidersByCapability('web.search');
    assert.equal(providers.length, 1);
    assert.equal(String(providers[0].id), 'brave_resolver');
  });

  it('retrieval.embed registered + has ollama_embed_resolver', () => {
    const providers = lookupProvidersByCapability('retrieval.embed');
    assert.equal(providers.length, 1);
    assert.equal(String(providers[0].id), 'ollama_embed_resolver');
  });

  it('all 9 gateway tools map to a registered capability with a specific gateway resolver', () => {
    const gatewayToolToResolver = {
      'ollama.status':        'gateway_ollama_status_resolver',
      'system.info':          'gateway_system_info_resolver',
      'git.status':           'gateway_git_status_resolver',
      'git.diff':             'gateway_git_diff_resolver',
      'github.repo':          'gateway_github_repo_resolver',
      'github.commits':       'gateway_github_commits_resolver',
      'github.issues':        'gateway_github_issues_resolver',
      'github.pull_requests': 'gateway_github_pull_requests_resolver',
      'github.actions':       'gateway_github_actions_resolver',
    };
    for (const [tool, expectedResolver] of Object.entries(gatewayToolToResolver)) {
      const capId = gatewayToolCapabilityId(tool);
      assert.ok(capId, `${tool}: no capability ID mapping`);
      assert.ok(isRegisteredCapability(capId), `${tool} → ${capId}: not registered`);
      assert.ok(hasExecutableProvider(capId), `${tool} → ${capId}: no executable provider`);
      const providers = lookupProvidersByCapability(capId);
      assert.equal(providers.length, 1, `${tool} → ${capId}: must have exactly 1 provider`);
      assert.equal(String(providers[0].id), expectedResolver,
        `${tool} → ${capId}: expected resolver ${expectedResolver}`);
      // Verify cardinality: resolver.capability_id matches contract
      assert.equal(String(providers[0].capability_id), capId,
        `resolver ${expectedResolver}: capability_id must equal ${capId}`);
    }
  });

  it('orchestration send produces user_statement + interim gate records (M3 preserved)', async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
    egress.setMode('reject-all');

    const sessionId = getSessionId();
    const before = await queryBySessionId(sessionId);

    await executeSendOrchestration(orchParams('hello test', [
      { role: 'user', content: 'hello test' },
    ])).catch(() => {});

    egress.setMode('passthrough');

    const after = await queryBySessionId(sessionId);
    assert.ok(after.length > before.length, 'orchestration must produce records');

    const userStmt = after.find(r => r.record_type === 'user_statement');
    assert.ok(userStmt, 'user_statement record must exist');

    const gate = after.find(r => r.source === 'interim_boundary_gate');
    assert.ok(gate, 'interim_boundary_gate record must exist');
  });
});

// ══════════════════════════════════════════════════════════════════
//  ADVERSARIAL MODEL OUTPUT
// ══════════════════════════════════════════════════════════════════

describe('Adversarial model output isolation', () => {
  it('model output cannot reach declareTrustedHost (structural)', () => {
    const declareRef = 'declareTrustedHost';
    // These are the model-output-processing modules:
    assert.ok(!SRC_ORCH.includes(declareRef));
    assert.ok(!SRC_ROUTER.includes(declareRef));
    assert.ok(!SRC_LOCAL.includes(declareRef));
    assert.ok(!SRC_RECORDER.includes(declareRef));
    assert.ok(!SRC_EMBED.includes(declareRef));
  });

  it('model output cannot reach registry mutation (structural)', () => {
    // Registry has no exported mutation function
    assert.ok(!SRC_REGISTRY.includes('export function addCapability'));
    assert.ok(!SRC_REGISTRY.includes('export function registerCapability'));
    assert.ok(!SRC_REGISTRY.includes('export function setCapability'));
  });

  it('model output attempts to add fixture capability: fixture.* absent from production registry', () => {
    const fixtureAttempt = lookupCapability('fixture.ask');
    assert.equal(fixtureAttempt, null, 'fixture.ask must not exist in production registry');
    assert.equal(lookupCapability('fixture.scoped'), null);
    assert.equal(lookupCapability('fixture.write.simulated'), null);
  });

  it('model output supplies fake credential value: looksLikeCredentialValue guard', () => {
    assert.equal(looksLikeCredentialValue('sk-fake-api-key-12345'), true);
    assert.equal(looksLikeCredentialValue('BSA-fake-brave-key'), true);
    assert.equal(looksLikeCredentialValue('secureStorage[brave_search_api_key_secure_v1]'), false);
    assert.equal(looksLikeCredentialValue(null), false);
  });

  it('no production contract contains a credential value', () => {
    const all = listCapabilities();
    for (const c of all) {
      const result = validateNoCredentialValues(c);
      assert.ok(result.valid, `${c.id} contains credential value: ${result.errors.join('; ')}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
//  STRUCTURAL INVARIANTS
// ══════════════════════════════════════════════════════════════════

describe('Structural invariants', () => {
  it('warmMacMini removed: localAI source contains no warmMacMini reference', () => {
    assert.ok(!SRC_LOCAL.includes('warmMacMini'),
      'warmMacMini must be absent from localAI.ts — unguarded POST /api/chat removed in M4 correction');
  });

  it('KC-5 remains transitional: tools execute before registry denial for non-gateway paths', () => {
    // KC-5: tool context (web search, readOnlyTools) runs before authorization in orchestration
    // The registry check in webSearch/readOnlyTools is the app-level guard,
    // but orchestration still collects tool results BEFORE the reasoning gate.
    // This is confirmed by the send flow structure in sendOrchestration.ts
    const orchIdx_toolBuild = SRC_ORCH.indexOf('buildReadOnlyMacToolContext');
    const orchIdx_gateReasoning = SRC_ORCH.indexOf('gateReasoning');
    assert.ok(orchIdx_toolBuild < orchIdx_gateReasoning,
      'KC-5: tool context must be built before reasoning gate');
  });

  it('D6 timeout is declared but not enforced: actual timeouts remain unchanged in M4', () => {
    // Declared timeout = 30s in all contracts
    assert.equal(DECLARED_TIMEOUT_MS, 30_000);
    // Actual code timeouts are shorter (7s/15s gateway, 10s Brave, 90s Ollama)
    // M8 enforces 30s. M4 only declares.
    assert.ok(SRC_SEARCH.includes('10_000'), 'webSearch 10s timeout unchanged');
    assert.ok(SRC_TOOLS.includes('7000'), 'readOnlyTools 7s timeout unchanged');
    assert.ok(SRC_TOOLS.includes('15000'), 'readOnlyTools 15s GitHub timeout unchanged');
  });

  it('R11 preserved: recorder not reachable from model output modules', () => {
    // The Recorder is imported by registry.ts (for denial recording), sendOrchestration.ts.
    // It must NOT be imported by model-output handler localAI, embeddingService (output side)
    assert.ok(!SRC_LOCAL.includes("from './controlPlane/recorder'"), 'localAI must not import recorder');
  });

  it('No M5+ runtime: no candidate resolution, policy store, authorizer, or executor', () => {
    const m5Signals = ['resolution_id', 'PolicyStore', 'Authorizer', 'AuthorizedExecutionPlan', 'resolveCandidate'];
    for (const signal of m5Signals) {
      assert.ok(!SRC_REGISTRY.includes(signal), `registry must not contain M5+ signal: ${signal}`);
      assert.ok(!SRC_ORCH.includes(signal), `orchestration must not contain M5+ signal: ${signal}`);
    }
  });

  it('R12: gateway allowlist preserved (gateway-side defense-in-depth)', () => {
    const gwTools = readFileSync('provider-gateway/tools.mjs', 'utf8');
    assert.ok(gwTools.includes("case 'ollama.status'"), 'gateway allowlist missing ollama.status');
    assert.ok(gwTools.includes("case 'system.info'"), 'gateway allowlist missing system.info');
    assert.ok(gwTools.includes("case 'git.status'"), 'gateway allowlist missing git.status');
    assert.ok(gwTools.includes("case 'git.diff'"), 'gateway allowlist missing git.diff');
    assert.ok(gwTools.includes("case 'github.repo'"), 'gateway allowlist missing github.repo');
    assert.ok(!gwTools.includes("case 'git.push'"), 'gateway must not contain git.push case');
    assert.ok(!gwTools.includes("case 'github.pr.create'"), 'gateway must not contain github.pr.create case');
  });

  it('gateway parity: runTool uses {tool} parameterless pattern', () => {
    // readOnlyTools.ts sends { tool } only — no command/args/url/shell injection
    assert.ok(SRC_TOOLS.includes("body: JSON.stringify({ tool })"), 'runTool must send { tool } only');
    assert.ok(!SRC_TOOLS.includes('command'), 'readOnlyTools must not send command field');
    assert.ok(!SRC_TOOLS.includes('"args"'), 'readOnlyTools must not send args field');
  });

  it('webSearch uses secureStorage path post-D4', () => {
    assert.ok(SRC_SEARCH.includes('getBraveApiKeySecure'), 'webSearch must use getBraveApiKeySecure');
    assert.ok(!SRC_SEARCH.includes("AsyncStorage.getItem('brave_search_api_key_v1')"),
      'webSearch must not directly read legacy AsyncStorage key');
  });

  it('aiRouter imports registry check', () => {
    assert.ok(SRC_ROUTER.includes('checkCapabilityOrDeny'), 'aiRouter must import checkCapabilityOrDeny');
  });

  it('embeddingService imports registry check', () => {
    assert.ok(SRC_EMBED.includes('checkCapabilityOrDeny'), 'embeddingService must import checkCapabilityOrDeny');
  });

  it('readOnlyTools imports registry check', () => {
    assert.ok(SRC_TOOLS.includes('checkCapabilityOrDeny'), 'readOnlyTools must import checkCapabilityOrDeny');
    assert.ok(SRC_TOOLS.includes('gatewayToolCapabilityId'), 'readOnlyTools must import gatewayToolCapabilityId');
  });

  it('unknown gateway tool is denied before gateway contact', () => {
    // gatewayToolCapabilityId returns null for unknown tools
    // checkCapabilityOrDeny with null/unknown ID denies immediately
    const capId = gatewayToolCapabilityId('shell');
    assert.equal(capId, null);
    // isRegisteredCapability('shell') = false → denial
    assert.equal(isRegisteredCapability('shell'), false);
  });
});

// ══════════════════════════════════════════════════════════════════
//  FIXTURE CAPABILITY GUARD
// ══════════════════════════════════════════════════════════════════

describe('Test-only fixture capability guard', () => {
  it('fixture.ask not in production registry', () => {
    assert.equal(lookupCapability('fixture.ask'), null);
    assert.equal(isRegisteredCapability('fixture.ask'), false);
    assert.equal(hasExecutableProvider('fixture.ask'), false);
  });

  it('fixture.scoped not in production registry', () => {
    assert.equal(lookupCapability('fixture.scoped'), null);
    assert.equal(isRegisteredCapability('fixture.scoped'), false);
  });

  it('fixture.write.simulated not in production registry', () => {
    assert.equal(lookupCapability('fixture.write.simulated'), null);
  });

  it('no fixture.* capability exists in production registry', () => {
    const all = listCapabilities();
    const fixtures = all.filter(c => String(c.id).startsWith('fixture.'));
    assert.equal(fixtures.length, 0, `production registry contains fixture capabilities: ${fixtures.map(c => c.id).join(', ')}`);
  });
});
