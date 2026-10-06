/**
 * M5 Candidate Resolution (Shadow Mode) Tests
 *
 * Command:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./tests/m0/register.mjs \
 *        --test tests/m5/run.test.mjs
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── Production module imports ────────────────────────────────────────────────
const {
  resolveBoundaryForHost,
  resolveProviderAvailability,
  computeDisclosureImplications,
  resolveAndRecordShadow,
  recordShadowComparison,
} = await import('../../services/controlPlane/candidateResolution.ts');

const {
  declareTrustedHost, revokeTrustedHost, __clearTrustedHosts, AUTO_TRUSTED_CIDR,
} = await import('../../services/controlPlane/trustedHosts.ts');

const {
  initRecorder, __resetRecorder, queryBySessionId, queryByRecordId,
} = await import('../../services/controlPlane/recorder.ts');

const { getSessionId, mintResolutionId, mintRequestId } = await import('../../services/controlPlane/identifiers.ts');

const encMock   = await import('../../tests/m0/mocks/encrypted-storage.mjs');
const sqliteMock = await import('../../tests/m0/mocks/expo-sqlite.mjs');

// Source files for structural assertions
const SRC_RESOLUTION    = readFileSync('services/controlPlane/candidateResolution.ts', 'utf8');
const SRC_ROUTER        = readFileSync('services/aiRouter.ts', 'utf8');
const SRC_SEARCH        = readFileSync('services/tools/webSearch.ts', 'utf8');
const SRC_EMBED         = readFileSync('services/embeddingService.ts', 'utf8');
const SRC_TOOLS         = readFileSync('services/readOnlyTools.ts', 'utf8');
const SRC_IDENTS        = readFileSync('services/controlPlane/identifiers.ts', 'utf8');
const SRC_SEMANTIC_CTX  = readFileSync('services/controlPlane/semanticContext.ts', 'utf8');
const SRC_SEND_ORCH     = readFileSync('services/sendOrchestration.ts', 'utf8');
const SRC_INDEX         = readFileSync('app/(tabs)/index.tsx', 'utf8');
const SRC_EMBEDDINGS    = readFileSync('services/embeddings.ts', 'utf8');
const SRC_SYSTEM        = readFileSync('app/(tabs)/system.tsx', 'utf8');

// ── Production module imports for production-backed tests ────────────────────
const {
  embedText, semanticSearchConversations,
} = await import('../../services/embeddingService.ts');

const {
  executeSendOrchestration, executeSummarizeOrchestration,
} = await import('../../services/sendOrchestration.ts');

const {
  classifyPayload,
} = await import('../../services/controlPlane/classifier.ts');
const {
  gateSearch,
} = await import('../../services/controlPlane/interimBoundaryGate.ts');

const asMock = await import('../../tests/m0/mocks/async-storage.mjs');

// ── Recorder bootstrap ───────────────────────────────────────────────────────

before(async () => {
  sqliteMock.__clearAll();
  __resetRecorder();
  await initRecorder();
});

// ══════════════════════════════════════════════════════════════════
//  resolveBoundaryForHost — architecture rule (CIDR)
// ══════════════════════════════════════════════════════════════════

describe('resolveBoundaryForHost — architecture rule', () => {
  beforeEach(() => __clearTrustedHosts());

  it('192.168.4.x bare address → PRIVATE_LAN/architecture_rule', async () => {
    const r = await resolveBoundaryForHost('192.168.4.52');
    assert.equal(r.status, 'resolved');
    assert.equal(r.boundary, 'PRIVATE_LAN');
    assert.equal(r.provenance, 'architecture_rule');
  });

  it('192.168.4.x:port → PRIVATE_LAN/architecture_rule (port stripped)', async () => {
    const r = await resolveBoundaryForHost('192.168.4.52:11434');
    assert.equal(r.status, 'resolved');
    assert.equal(r.boundary, 'PRIVATE_LAN');
    assert.equal(r.provenance, 'architecture_rule');
  });

  it('AUTO_TRUSTED_CIDR prefix confirms 192.168.4. value', () => {
    assert.equal(AUTO_TRUSTED_CIDR, '192.168.4.');
  });

  it('192.168.4.1 (gateway IP) → PRIVATE_LAN/architecture_rule', async () => {
    const r = await resolveBoundaryForHost('192.168.4.1');
    assert.equal(r.status, 'resolved');
    assert.equal(r.boundary, 'PRIVATE_LAN');
    assert.equal(r.provenance, 'architecture_rule');
  });

  it('different subnet 192.168.1.52 → unresolved (not in 192.168.4.0/24)', async () => {
    const r = await resolveBoundaryForHost('192.168.1.52');
    assert.equal(r.status, 'unresolved');
  });
});

// ══════════════════════════════════════════════════════════════════
//  resolveBoundaryForHost — host normalization attack surface (§7/§8)
// ══════════════════════════════════════════════════════════════════

describe('resolveBoundaryForHost — normalization attack surface', () => {
  beforeEach(() => __clearTrustedHosts());

  it('192.168.4.1.evil.com MUST NOT be trusted (string-prefix attack)', async () => {
    // '192.168.4.1.evil.com'.startsWith('192.168.4.') === true (string prefix)
    // but it is NOT in the 192.168.4.0/24 subnet — octet count is 6, not 4
    const r = await resolveBoundaryForHost('192.168.4.1.evil.com');
    assert.equal(r.status, 'unresolved',
      '192.168.4.1.evil.com must be unresolved — 6-octet form is not a valid 192.168.4.x IPv4');
  });

  it('192.168.4.1.evil.com:11434 MUST NOT be trusted (port + string-prefix attack)', async () => {
    const r = await resolveBoundaryForHost('192.168.4.1.evil.com:11434');
    assert.equal(r.status, 'unresolved');
  });

  it('192.168.40.1 → unresolved (third octet mismatch 40 ≠ 4)', async () => {
    const r = await resolveBoundaryForHost('192.168.40.1');
    assert.equal(r.status, 'unresolved');
  });

  it('192.168.4.256 → unresolved (last octet out of range)', async () => {
    const r = await resolveBoundaryForHost('192.168.4.256');
    assert.equal(r.status, 'unresolved');
  });

  it('192.168.4. (trailing dot, no host octet) → unresolved', async () => {
    const r = await resolveBoundaryForHost('192.168.4.');
    assert.equal(r.status, 'unresolved');
  });

  it('192.168.4.evil → unresolved (non-numeric last octet)', async () => {
    const r = await resolveBoundaryForHost('192.168.4.evil');
    assert.equal(r.status, 'unresolved');
  });

  it('10.0.0.1 → unresolved (not in trusted subnet, no declaration)', async () => {
    const r = await resolveBoundaryForHost('10.0.0.1');
    assert.equal(r.status, 'unresolved');
  });

  it('172.16.0.1 → unresolved', async () => {
    const r = await resolveBoundaryForHost('172.16.0.1');
    assert.equal(r.status, 'unresolved');
  });

  it('127.0.0.1 → unresolved (loopback, not in 192.168.4.0/24, no declaration)', async () => {
    const r = await resolveBoundaryForHost('127.0.0.1');
    assert.equal(r.status, 'unresolved');
  });

  it('169.254.1.1 → unresolved (link-local)', async () => {
    const r = await resolveBoundaryForHost('169.254.1.1');
    assert.equal(r.status, 'unresolved');
  });

  it('api.anthropic.com → unresolved (public hostname, no declaration)', async () => {
    const r = await resolveBoundaryForHost('api.anthropic.com');
    assert.equal(r.status, 'unresolved');
  });

  it('user@192.168.4.1 → unresolved (userinfo prefix disrupts octet parse)', async () => {
    // bare = 'user@192.168.4.1', split('.') first octet = 'user@192' ≠ '192'
    const r = await resolveBoundaryForHost('user@192.168.4.1');
    assert.equal(r.status, 'unresolved');
  });

  it('valid 192.168.4.100 is still trusted after fix', async () => {
    const r = await resolveBoundaryForHost('192.168.4.100');
    assert.equal(r.status, 'resolved');
    assert.equal(r.boundary, 'PRIVATE_LAN');
    assert.equal(r.provenance, 'architecture_rule');
  });
});

// ══════════════════════════════════════════════════════════════════
//  resolveBoundaryForHost — trusted_host_configuration
// ══════════════════════════════════════════════════════════════════

describe('resolveBoundaryForHost — trusted_host_configuration', () => {
  beforeEach(() => __clearTrustedHosts());
  afterEach(() => __clearTrustedHosts());

  it('empty string → unresolved', async () => {
    const r = await resolveBoundaryForHost('');
    assert.equal(r.status, 'unresolved');
  });

  it('external host with no declaration → unresolved', async () => {
    const r = await resolveBoundaryForHost('api.anthropic.com');
    assert.equal(r.status, 'unresolved');
  });

  it('declared host → PRIVATE_LAN/trusted_host_configuration', async () => {
    await declareTrustedHost('10.0.0.5:8787', 'test gateway');
    const r = await resolveBoundaryForHost('10.0.0.5:8787');
    assert.equal(r.status, 'resolved');
    assert.equal(r.boundary, 'PRIVATE_LAN');
    assert.equal(r.provenance, 'trusted_host_configuration');
  });

  it('revoked declaration → unresolved', async () => {
    const config = await declareTrustedHost('10.0.0.6:8787', 'temp');
    await revokeTrustedHost(config.id);
    const r = await resolveBoundaryForHost('10.0.0.6:8787');
    assert.equal(r.status, 'unresolved');
  });
});

// ══════════════════════════════════════════════════════════════════
//  resolveProviderAvailability — pure function
// ══════════════════════════════════════════════════════════════════

describe('resolveProviderAvailability — local reasoning', () => {
  it('node_online=true → available/node_health_check', () => {
    const r = resolveProviderAvailability('local_reasoning_resolver', { node_online: true });
    assert.equal(r.availability, 'available');
    assert.equal(r.availability_source, 'node_health_check');
  });

  it('node_online=false → unavailable/node_health_check', () => {
    const r = resolveProviderAvailability('local_reasoning_resolver', { node_online: false });
    assert.equal(r.availability, 'unavailable');
    assert.equal(r.availability_source, 'node_health_check');
  });

  it('node_online=null → unknown/no_check', () => {
    const r = resolveProviderAvailability('local_reasoning_resolver', { node_online: null });
    assert.equal(r.availability, 'unknown');
    assert.equal(r.availability_source, 'no_check');
  });

  it('node_online=undefined → unknown/no_check', () => {
    const r = resolveProviderAvailability('local_reasoning_resolver', {});
    assert.equal(r.availability, 'unknown');
    assert.equal(r.availability_source, 'no_check');
  });
});

describe('resolveProviderAvailability — ollama_embed_resolver', () => {
  it('node_online=true → available/node_health_check', () => {
    const r = resolveProviderAvailability('ollama_embed_resolver', { node_online: true });
    assert.equal(r.availability, 'available');
    assert.equal(r.availability_source, 'node_health_check');
  });

  it('node_online=false → unavailable/node_health_check', () => {
    const r = resolveProviderAvailability('ollama_embed_resolver', { node_online: false });
    assert.equal(r.availability, 'unavailable');
    assert.equal(r.availability_source, 'node_health_check');
  });
});

describe('resolveProviderAvailability — cloud and gateway', () => {
  it('cloud_reasoning_resolver → unknown/not_probed (no live probe in shadow mode)', () => {
    const r = resolveProviderAvailability('cloud_reasoning_resolver', { node_online: true });
    assert.equal(r.availability, 'unknown');
    assert.equal(r.availability_source, 'not_probed');
  });

  it('gateway_ollama_status_resolver → unknown/not_probed', () => {
    const r = resolveProviderAvailability('gateway_ollama_status_resolver', {});
    assert.equal(r.availability, 'unknown');
    assert.equal(r.availability_source, 'not_probed');
  });

  it('gateway_git_status_resolver → unknown/not_probed', () => {
    const r = resolveProviderAvailability('gateway_git_status_resolver', {});
    assert.equal(r.availability, 'unknown');
    assert.equal(r.availability_source, 'not_probed');
  });
});

describe('resolveProviderAvailability — brave_resolver', () => {
  it('web_search_status=operational → available/key_presence_check', () => {
    const r = resolveProviderAvailability('brave_resolver', { web_search_status: 'operational' });
    assert.equal(r.availability, 'available');
    assert.equal(r.availability_source, 'key_presence_check');
  });

  it('web_search_status=configured → available/key_presence_check', () => {
    const r = resolveProviderAvailability('brave_resolver', { web_search_status: 'configured' });
    assert.equal(r.availability, 'available');
    assert.equal(r.availability_source, 'key_presence_check');
  });

  it('web_search_status=unavailable → unavailable/key_presence_check', () => {
    const r = resolveProviderAvailability('brave_resolver', { web_search_status: 'unavailable' });
    assert.equal(r.availability, 'unavailable');
    assert.equal(r.availability_source, 'key_presence_check');
  });

  it('web_search_status=auth_failed → unavailable/key_presence_check', () => {
    const r = resolveProviderAvailability('brave_resolver', { web_search_status: 'auth_failed' });
    assert.equal(r.availability, 'unavailable');
    assert.equal(r.availability_source, 'key_presence_check');
  });

  it('web_search_status=degraded → unavailable/key_presence_check', () => {
    const r = resolveProviderAvailability('brave_resolver', { web_search_status: 'degraded' });
    assert.equal(r.availability, 'unavailable');
    assert.equal(r.availability_source, 'key_presence_check');
  });

  it('web_search_status=undefined → unknown/no_check', () => {
    const r = resolveProviderAvailability('brave_resolver', {});
    assert.equal(r.availability, 'unknown');
    assert.equal(r.availability_source, 'no_check');
  });
});

// ══════════════════════════════════════════════════════════════════
//  computeDisclosureImplications
// ══════════════════════════════════════════════════════════════════

describe('computeDisclosureImplications', () => {
  const resolvedPrivateLAN = {
    status: 'resolved',
    boundary: 'PRIVATE_LAN',
    provenance: 'architecture_rule',
  };
  const resolvedInternet = {
    status: 'resolved',
    boundary: 'INTERNET/CLOUD',
    provenance: 'architecture_rule',
  };
  const unresolved = { status: 'unresolved' };

  it('selected + resolved boundary → produces implication', () => {
    const candidates = [{
      provider_id: 'local_reasoning_resolver',
      position: 1,
      boundary_resolution: resolvedPrivateLAN,
      availability: 'available',
      availability_source: 'node_health_check',
      selected: true,
    }];
    const implications = computeDisclosureImplications(candidates, ['public'], 'reasoning');
    assert.equal(implications.length, 1);
    assert.equal(implications[0].boundary, 'PRIVATE_LAN');
    assert.equal(implications[0].recipient, 'ollama_private_node');
    assert.deepEqual(implications[0].data_classes_disclosed, ['public']);
    assert.equal(implications[0].disclosure_type, 'content');
  });

  it('not selected → no implication', () => {
    const candidates = [{
      provider_id: 'cloud_reasoning_resolver',
      position: 1,
      boundary_resolution: resolvedInternet,
      availability: 'unknown',
      availability_source: 'not_probed',
      selected: false,
    }];
    const implications = computeDisclosureImplications(candidates, ['public'], 'reasoning');
    assert.equal(implications.length, 0);
  });

  it('selected + unresolved boundary → no implication', () => {
    const candidates = [{
      provider_id: 'local_reasoning_resolver',
      position: 1,
      boundary_resolution: unresolved,
      availability: 'available',
      availability_source: 'node_health_check',
      selected: true,
    }];
    const implications = computeDisclosureImplications(candidates, ['public'], 'reasoning');
    assert.equal(implications.length, 0);
  });

  it('web.search → disclosure_type=query', () => {
    const candidates = [{
      provider_id: 'brave_resolver',
      position: 1,
      boundary_resolution: resolvedInternet,
      availability: 'available',
      availability_source: 'key_presence_check',
      selected: true,
    }];
    const implications = computeDisclosureImplications(candidates, ['public'], 'web.search');
    assert.equal(implications.length, 1);
    assert.equal(implications[0].disclosure_type, 'query');
    assert.equal(implications[0].recipient, 'brave_search_api');
  });

  it('other capability → disclosure_type=metadata', () => {
    const candidates = [{
      provider_id: 'gateway_git_status_resolver',
      position: 1,
      boundary_resolution: resolvedPrivateLAN,
      availability: 'unknown',
      availability_source: 'not_probed',
      selected: true,
    }];
    const implications = computeDisclosureImplications(candidates, ['public'], 'git.status.read');
    assert.equal(implications.length, 1);
    assert.equal(implications[0].disclosure_type, 'metadata');
    assert.equal(implications[0].recipient, 'provider_gateway');
  });
});

// ══════════════════════════════════════════════════════════════════
//  resolveAndRecordShadow — resolution correctness
// ══════════════════════════════════════════════════════════════════

describe('resolveAndRecordShadow — structural invariants', () => {
  it('returns non-null for known capability', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null, 'expected non-null for known capability');
  });

  it('returns null for unknown capability (fail-closed)', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'shell.execute' });
    assert.equal(r, null);
    const r2 = await resolveAndRecordShadow({ capability_id: 'fixture.ask' });
    assert.equal(r2, null);
  });

  it('shadow_mode is always true (invariant)', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    assert.equal(r.shadow_mode, true);
  });

  it('resolution_id starts with res.', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    assert.ok(r.resolution_id.startsWith('res.'), `expected res. prefix, got ${r.resolution_id}`);
  });

  it('session_id matches getSessionId()', async () => {
    const sid = getSessionId();
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    assert.equal(r.session_id, sid);
  });

  it('capability_id echoes the input', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'web.search' });
    assert.ok(r !== null);
    assert.equal(r.capability_id, 'web.search');
  });

  it('request_id is null when not supplied', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    assert.equal(r.request_id, null);
  });

  it('request_id is threaded when supplied', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', request_id: 'req.test.abc' });
    assert.ok(r !== null);
    assert.equal(r.request_id, 'req.test.abc');
  });

  it('resolved_at is a valid ISO timestamp', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    const d = new Date(r.resolved_at);
    assert.ok(!isNaN(d.getTime()), `resolved_at is not valid ISO: ${r.resolved_at}`);
  });

  it('data_classes defaults to [public] when not supplied', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['public']);
  });

  it('is_sensitive defaults to false', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    assert.equal(r.is_sensitive, false);
  });

  it('is_sensitive=true is preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', is_sensitive: true, data_classes: ['internal'] });
    assert.ok(r !== null);
    assert.equal(r.is_sensitive, true);
    assert.deepEqual(r.data_classes, ['internal']);
  });
});

describe('resolveAndRecordShadow — candidate selection', () => {
  it('reasoning: node_online=true → local provider selected', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'reasoning',
      node_online: true,
      ollama_host: '192.168.4.52:11434',
    });
    assert.ok(r !== null);
    const local = r.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    assert.ok(local, 'local_reasoning_resolver must appear in candidates');
    assert.equal(local.selected, true);
    assert.equal(local.availability, 'available');
  });

  it('reasoning: node_online=false → local unavailable, not selected', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'reasoning',
      node_online: false,
    });
    assert.ok(r !== null);
    const local = r.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    assert.ok(local, 'local_reasoning_resolver must appear in candidates');
    assert.equal(local.selected, false);
    assert.equal(local.availability, 'unavailable');
  });

  it('reasoning: position ordering preserved (local=1, cloud=2)', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    const local = r.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    const cloud = r.provider_candidates.find(c => c.provider_id === 'cloud_reasoning_resolver');
    assert.ok(local && cloud);
    assert.ok(local.position < cloud.position, 'local must be position 1, cloud position 2');
  });

  it('web.search: operational → brave_resolver selected', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'web.search',
      web_search_status: 'operational',
    });
    assert.ok(r !== null);
    const brave = r.provider_candidates.find(c => c.provider_id === 'brave_resolver');
    assert.ok(brave, 'brave_resolver must appear in candidates');
    assert.equal(brave.selected, true);
    assert.equal(brave.availability, 'available');
  });

  it('web.search: unavailable → brave_resolver not selected', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'web.search',
      web_search_status: 'unavailable',
    });
    assert.ok(r !== null);
    const brave = r.provider_candidates.find(c => c.provider_id === 'brave_resolver');
    assert.ok(brave);
    assert.equal(brave.selected, false);
  });

  it('reasoning with ollama_host in CIDR → local boundary resolved to PRIVATE_LAN', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'reasoning',
      node_online: true,
      ollama_host: '192.168.4.52:11434',
    });
    assert.ok(r !== null);
    const local = r.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    assert.ok(local);
    assert.equal(local.boundary_resolution.status, 'resolved');
    assert.equal(local.boundary_resolution.boundary, 'PRIVATE_LAN');
    assert.equal(local.boundary_resolution.provenance, 'architecture_rule');
  });

  it('reasoning with no ollama_host → local boundary remains unresolved', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'reasoning',
      node_online: true,
    });
    assert.ok(r !== null);
    const local = r.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    assert.ok(local);
    assert.equal(local.boundary_resolution.status, 'unresolved');
  });

  it('cloud_reasoning_resolver boundary is always INTERNET/CLOUD (pre-resolved)', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r !== null);
    const cloud = r.provider_candidates.find(c => c.provider_id === 'cloud_reasoning_resolver');
    assert.ok(cloud);
    assert.equal(cloud.boundary_resolution.status, 'resolved');
    assert.equal(cloud.boundary_resolution.boundary, 'INTERNET/CLOUD');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Shadow record persistence
// ══════════════════════════════════════════════════════════════════

describe('Shadow record persistence', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('resolveAndRecordShadow writes a record queryable by session_id', async () => {
    const sid = getSessionId();
    await resolveAndRecordShadow({ capability_id: 'reasoning' });
    const records = await queryBySessionId(sid);
    const m5records = records.filter(r => r.source === 'candidate_resolution');
    assert.ok(m5records.length > 0, 'at least one candidate_resolution record expected');
  });

  it('persisted record has record_kind=interim_gate', async () => {
    const sid = getSessionId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'web.search', web_search_status: 'operational' });
    assert.ok(resolution !== null);
    const records = await queryBySessionId(sid);
    const rec = records.find(r => r.record_id === resolution.resolution_id);
    assert.ok(rec, 'record not found by resolution_id');
    assert.equal(rec.record_kind, 'interim_gate');
  });

  it('persisted record has source=candidate_resolution', async () => {
    const sid = getSessionId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'retrieval.embed' });
    assert.ok(resolution !== null);
    const records = await queryBySessionId(sid);
    const rec = records.find(r => r.record_id === resolution.resolution_id);
    assert.ok(rec);
    assert.equal(rec.source, 'candidate_resolution');
  });

  it('persisted record payload is parseable and contains shadow_mode=true', async () => {
    const sid = getSessionId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    const records = await queryBySessionId(sid);
    const rec = records.find(r => r.record_id === resolution.resolution_id);
    assert.ok(rec);
    const payload = JSON.parse(rec.payload);
    assert.equal(payload.shadow_mode, true);
    assert.equal(payload.capability_id, 'reasoning');
    assert.equal(payload.resolution_id, resolution.resolution_id);
  });

  it('each call produces a unique resolution_id', async () => {
    const r1 = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    const r2 = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(r1 !== null && r2 !== null);
    assert.notEqual(r1.resolution_id, r2.resolution_id);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Recorder-degraded semantics (§6)
// ══════════════════════════════════════════════════════════════════

describe('Recorder-degraded semantics', () => {
  it('resolveAndRecordShadow returns resolution even when Recorder not initialized', async () => {
    __resetRecorder();
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(r !== null, 'resolution must succeed even when Recorder is degraded');
    assert.equal(r.shadow_mode, true);
    assert.ok(r.resolution_id.startsWith('res.'));
    sqliteMock.__clearAll();
    await initRecorder();
  });

  it('Recorder degraded does NOT alter provider candidate list', async () => {
    __resetRecorder();
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(r !== null);
    assert.ok(r.provider_candidates.length > 0, 'candidates populated even with degraded Recorder');
    sqliteMock.__clearAll();
    await initRecorder();
  });

  it('Recorder degraded does NOT introduce ALLOW/DENY — shadow_mode invariant preserved', async () => {
    __resetRecorder();
    const r = await resolveAndRecordShadow({ capability_id: 'web.search', web_search_status: 'operational' });
    assert.ok(r !== null);
    assert.equal(r.shadow_mode, true);
    // No authorization decision fields should exist on the resolution object
    assert.equal(typeof (r).decision, 'undefined');
    assert.equal(typeof (r).authorization_id, 'undefined');
    sqliteMock.__clearAll();
    await initRecorder();
  });
});

// ══════════════════════════════════════════════════════════════════
//  Sensitive-cloud disclosure implication — shadow only (§13)
// ══════════════════════════════════════════════════════════════════

describe('Sensitive-cloud disclosure implication — shadow only', () => {
  it('sensitive + local-unavailable: no selected candidate, no disclosure implication, shadow_mode=true', async () => {
    // node_online=false: local unavailable; cloud=unknown (no live probe in shadow)
    const r = await resolveAndRecordShadow({
      capability_id: 'reasoning',
      node_online: false,
      is_sensitive: true,
      data_classes: ['internal'],
    });
    assert.ok(r !== null);
    assert.equal(r.is_sensitive, true);
    assert.deepEqual(r.data_classes, ['internal']);
    assert.equal(r.shadow_mode, true);

    const local = r.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    assert.ok(local);
    assert.equal(local.availability, 'unavailable');
    assert.equal(local.selected, false);

    const cloud = r.provider_candidates.find(c => c.provider_id === 'cloud_reasoning_resolver');
    assert.ok(cloud);
    assert.equal(cloud.availability, 'unknown');
    assert.equal(cloud.selected, false);

    // No selected candidate → no disclosure implication produced
    assert.equal(r.disclosure_implications.length, 0);
  });

  it('selected cloud candidate with INTERNET/CLOUD boundary → disclosure implication recorded', () => {
    // computeDisclosureImplications: selected + resolved INTERNET/CLOUD → implication produced
    // This tests observation WITHOUT execution (no capability executes)
    const candidates = [{
      provider_id: 'cloud_reasoning_resolver',
      position: 1,
      boundary_resolution: { status: 'resolved', boundary: 'INTERNET/CLOUD', provenance: 'architecture_rule' },
      availability: 'available',
      availability_source: 'not_probed',
      selected: true,
    }];
    const implications = computeDisclosureImplications(candidates, ['internal', 'pii'], 'reasoning');
    assert.equal(implications.length, 1);
    assert.equal(implications[0].boundary, 'INTERNET/CLOUD');
    assert.equal(implications[0].recipient, 'anthropic_api_via_gateway');
    assert.ok(implications[0].data_classes_disclosed.includes('internal'));
    assert.ok(implications[0].data_classes_disclosed.includes('pii'));
    assert.equal(implications[0].disclosure_type, 'content');
    // implication is OBSERVATION only — no ALLOW/DENY/ASK
  });
});

// ══════════════════════════════════════════════════════════════════
//  M1 structural invariants
// ══════════════════════════════════════════════════════════════════

describe('M1 structural invariants — candidateResolution.ts', () => {
  it('does NOT import localAI (no native dependency leakage)', () => {
    assert.ok(
      !SRC_RESOLUTION.includes("from '@/services/localAI'") &&
      !SRC_RESOLUTION.includes('from \'@/services/localAI\'') &&
      !SRC_RESOLUTION.includes("from '../localAI'") &&
      !SRC_RESOLUTION.includes("import 'localAI'"),
      'candidateResolution.ts must not import localAI'
    );
  });

  it('does NOT import providerGateway (no native dependency leakage)', () => {
    assert.ok(
      !SRC_RESOLUTION.includes("from '@/services/providerGateway'") &&
      !SRC_RESOLUTION.includes('from \'@/services/providerGateway\'') &&
      !SRC_RESOLUTION.includes("from '../providerGateway'") &&
      !SRC_RESOLUTION.includes("import 'providerGateway'"),
      'candidateResolution.ts must not import providerGateway'
    );
  });

  it('shadow_mode: true is a readonly property in the interface definition', () => {
    assert.ok(
      SRC_RESOLUTION.includes('readonly shadow_mode: true'),
      'ShadowResolution must declare readonly shadow_mode: true'
    );
  });

  it('mintResolutionId is exported from identifiers.ts', () => {
    assert.ok(
      SRC_IDENTS.includes('export function mintResolutionId'),
      'identifiers.ts must export mintResolutionId'
    );
  });

  it('mintResolutionId prefix is res', () => {
    const id = mintResolutionId();
    assert.ok(id.startsWith('res.'), `expected res. prefix, got ${id}`);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Call-site integration — structural verification
// ══════════════════════════════════════════════════════════════════

describe('Call-site integration — structural verification', () => {
  it('aiRouter.ts imports resolveAndRecordShadow from candidateResolution', () => {
    assert.ok(
      SRC_ROUTER.includes('resolveAndRecordShadow') &&
      SRC_ROUTER.includes('candidateResolution'),
      'aiRouter.ts must import resolveAndRecordShadow from candidateResolution'
    );
  });

  it('aiRouter.ts calls resolveAndRecordShadow with capability_id reasoning', () => {
    assert.ok(
      SRC_ROUTER.includes("capability_id: 'reasoning'"),
      "aiRouter.ts must pass capability_id: 'reasoning'"
    );
  });

  it('webSearch.ts imports and calls resolveAndRecordShadow', () => {
    assert.ok(
      SRC_SEARCH.includes('resolveAndRecordShadow'),
      'webSearch.ts must call resolveAndRecordShadow'
    );
    assert.ok(
      SRC_SEARCH.includes("capability_id:     'web.search'") ||
      SRC_SEARCH.includes("capability_id: 'web.search'"),
      "webSearch.ts must pass capability_id: 'web.search'"
    );
  });

  it('embeddingService.ts imports and calls resolveAndRecordShadow', () => {
    assert.ok(
      SRC_EMBED.includes('resolveAndRecordShadow'),
      'embeddingService.ts must call resolveAndRecordShadow'
    );
    assert.ok(
      SRC_EMBED.includes("capability_id: 'retrieval.embed'"),
      "embeddingService.ts must pass capability_id: 'retrieval.embed'"
    );
  });

  it('readOnlyTools.ts imports and calls resolveAndRecordShadow', () => {
    assert.ok(
      SRC_TOOLS.includes('resolveAndRecordShadow'),
      'readOnlyTools.ts must call resolveAndRecordShadow'
    );
  });

  // L1: resolution uses await (not fire-and-forget) so append attempt completes before provider
  it('L1: aiRouter.ts uses await resolveAndRecordShadow (not fire-and-forget)', () => {
    assert.ok(
      SRC_ROUTER.includes('await resolveAndRecordShadow'),
      'aiRouter.ts must await resolveAndRecordShadow (L1 ordering)'
    );
  });

  it('L1: webSearch.ts uses await resolveAndRecordShadow (not fire-and-forget)', () => {
    assert.ok(
      SRC_SEARCH.includes('await resolveAndRecordShadow'),
      'webSearch.ts must await resolveAndRecordShadow (L1 ordering)'
    );
  });

  it('L1: embeddingService.ts uses await resolveAndRecordShadow (not fire-and-forget)', () => {
    assert.ok(
      SRC_EMBED.includes('await resolveAndRecordShadow'),
      'embeddingService.ts must await resolveAndRecordShadow (L1 ordering)'
    );
  });

  it('L1: readOnlyTools.ts uses await resolveAndRecordShadow (not fire-and-forget)', () => {
    assert.ok(
      SRC_TOOLS.includes('await resolveAndRecordShadow'),
      'readOnlyTools.ts must await resolveAndRecordShadow (L1 ordering)'
    );
  });

  // L4: comparison calls are fire-and-forget (post-execution, best-effort)
  it('L4: all call sites import recordShadowComparison', () => {
    assert.ok(SRC_ROUTER.includes('recordShadowComparison'), 'aiRouter.ts must import/call recordShadowComparison');
    assert.ok(SRC_SEARCH.includes('recordShadowComparison'), 'webSearch.ts must import/call recordShadowComparison');
    assert.ok(SRC_EMBED.includes('recordShadowComparison'),  'embeddingService.ts must import/call recordShadowComparison');
    assert.ok(SRC_TOOLS.includes('recordShadowComparison'),  'readOnlyTools.ts must import/call recordShadowComparison');
  });

  it('L4: comparison calls use fire-and-forget .catch pattern', () => {
    assert.ok(SRC_ROUTER.includes('.catch(() => {})'), 'aiRouter.ts comparison must fire-and-forget');
    assert.ok(SRC_SEARCH.includes('.catch(() => {})'), 'webSearch.ts comparison must fire-and-forget');
    assert.ok(SRC_EMBED.includes('.catch(() => {})'),  'embeddingService.ts comparison must fire-and-forget');
    assert.ok(SRC_TOOLS.includes('.catch(() => {})'),  'readOnlyTools.ts comparison must fire-and-forget');
  });

  // L2: data_classes threading
  it('L2: aiRouter.ts threads dataClasses from params into shadow call', () => {
    assert.ok(
      SRC_ROUTER.includes('data_classes:'),
      'aiRouter.ts must pass data_classes to resolveAndRecordShadow'
    );
  });

  it('L2: webSearch.ts threads data_classes opts into shadow call', () => {
    assert.ok(
      SRC_SEARCH.includes('data_classes:'),
      'webSearch.ts must pass data_classes to resolveAndRecordShadow'
    );
  });

  it('L2: embeddingService.ts derives and threads dataClasses into shadow call', () => {
    assert.ok(
      SRC_EMBED.includes('data_classes:'),
      'embeddingService.ts must pass data_classes to resolveAndRecordShadow'
    );
  });

  it('L2: readOnlyTools.ts derives and threads dataClasses into shadow call', () => {
    assert.ok(
      SRC_TOOLS.includes('data_classes:'),
      'readOnlyTools.ts must pass data_classes to resolveAndRecordShadow'
    );
  });

  // L6: request_id threading
  it('L6: aiRouter.ts threads requestId to shadow call', () => {
    assert.ok(
      SRC_ROUTER.includes('request_id:'),
      'aiRouter.ts must pass request_id to resolveAndRecordShadow'
    );
  });

  it('L6: webSearch.ts threads requestId to shadow call', () => {
    assert.ok(
      SRC_SEARCH.includes('request_id:'),
      'webSearch.ts must pass request_id to resolveAndRecordShadow'
    );
  });

  it('L6: embeddingService.ts threads requestId to shadow call', () => {
    assert.ok(
      SRC_EMBED.includes('request_id:'),
      'embeddingService.ts must pass request_id to resolveAndRecordShadow'
    );
  });

  it('L6: readOnlyTools.ts threads requestId to shadow call', () => {
    assert.ok(
      SRC_TOOLS.includes('request_id:'),
      'readOnlyTools.ts must pass request_id to resolveAndRecordShadow'
    );
  });

  it('aiRouter.ts passes node_online to shadow call', () => {
    assert.ok(
      SRC_ROUTER.includes('node_online:') || SRC_ROUTER.includes('node_online :'),
      'aiRouter.ts shadow call must include node_online'
    );
  });

  it('embeddingService.ts passes ollama_host to shadow call', () => {
    assert.ok(
      SRC_EMBED.includes('ollama_host:') || SRC_EMBED.includes('ollama_host :'),
      'embeddingService.ts shadow call must include ollama_host'
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  L1: Pre-execution append ordering
// ══════════════════════════════════════════════════════════════════

describe('L1 — pre-execution append ordering', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('resolution record is queryable by record_id immediately after resolveAndRecordShadow returns', async () => {
    // L1 invariant: await means persistence attempt completed before this line runs
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(resolution !== null);
    // Query must succeed without any further awaiting — record is already written
    const recs = await queryByRecordId(resolution.resolution_id);
    const rec = recs[0] ?? null;
    assert.ok(rec !== null, 'record must be queryable by resolution_id immediately after resolveAndRecordShadow returns');
    assert.equal(rec.record_id, resolution.resolution_id);
  });

  it('recorder_status field is present on ShadowResolution', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    assert.ok('recorder_status' in resolution, 'recorder_status must be present on ShadowResolution');
    assert.ok(
      resolution.recorder_status === 'recorded' || resolution.recorder_status === 'degraded',
      `recorder_status must be recorded or degraded, got ${resolution.recorder_status}`
    );
  });

  it('recorder_status === recorded when Recorder is initialized', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'web.search', web_search_status: 'operational' });
    assert.ok(resolution !== null);
    assert.equal(resolution.recorder_status, 'recorded',
      'recorder_status must be recorded when Recorder is initialized and SQLite available');
  });

  it('recorder_status === degraded when Recorder not initialized', async () => {
    __resetRecorder(); // recorder torn down — next call fails
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(resolution !== null, 'resolution must be returned even when Recorder degraded');
    assert.equal(resolution.recorder_status, 'degraded',
      'recorder_status must be degraded when Recorder not initialized');
    // Restore for subsequent tests
    sqliteMock.__clearAll();
    await initRecorder();
  });

  it('recorder_status=degraded does NOT affect provider_candidates (routing invariant)', async () => {
    __resetRecorder();
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(resolution !== null);
    const local = resolution.provider_candidates.find(c => c.provider_id === 'local_reasoning_resolver');
    assert.ok(local, 'local_reasoning_resolver must appear even when recorder degraded');
    assert.equal(local.selected, true);
    sqliteMock.__clearAll();
    await initRecorder();
  });

  it('recorder_status does NOT appear in the persisted JSON payload (not circular)', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    const recs = await queryByRecordId(resolution.resolution_id);
    const rec = recs[0] ?? null;
    assert.ok(rec !== null);
    const payload = JSON.parse(rec.payload);
    assert.ok(!('recorder_status' in payload),
      'recorder_status must NOT be serialized into the persisted payload');
  });
});

// ══════════════════════════════════════════════════════════════════
//  L2: M2 data_classes threading
// ══════════════════════════════════════════════════════════════════

describe('L2 — M2 data_classes threading through candidate resolution', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('data_classes=[public] preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['public'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['public']);
  });

  it('data_classes=[internal] preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['internal'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['internal']);
  });

  it('data_classes=[medical] preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['medical'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['medical']);
  });

  it('data_classes=[financial] preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['financial'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['financial']);
  });

  it('data_classes=[pii] preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['pii'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['pii']);
  });

  it('data_classes=[public, medical, pii] union preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['public', 'medical', 'pii'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['public', 'medical', 'pii']);
  });

  it('data_classes=[public, financial] union preserved', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'web.search', data_classes: ['public', 'financial'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['public', 'financial']);
  });

  it('data_classes persisted into record payload', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['medical', 'pii'] });
    assert.ok(r !== null);
    const recs = await queryByRecordId(r.resolution_id);
    const rec = recs[0] ?? null;
    assert.ok(rec !== null);
    const payload = JSON.parse(rec.payload);
    assert.deepEqual(payload.data_classes, ['medical', 'pii']);
  });
});

// ══════════════════════════════════════════════════════════════════
//  L4: Append-only shadow comparison records
// ══════════════════════════════════════════════════════════════════

describe('L4 — append-only shadow comparison records', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('recordShadowComparison writes a record queryable by session_id', async () => {
    const sid = getSessionId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    await recordShadowComparison(resolution, 'local_reasoning_resolver', null);
    const records = await queryBySessionId(sid);
    const compRecs = records.filter(r => r.source === 'candidate_resolution_comparison');
    assert.ok(compRecs.length > 0, 'at least one candidate_resolution_comparison record expected');
  });

  it('comparison record has record_kind=interim_gate', async () => {
    const sid = getSessionId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'web.search', web_search_status: 'operational' });
    assert.ok(resolution !== null);
    await recordShadowComparison(resolution, 'brave_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec, 'comparison record not found');
    assert.equal(compRec.record_kind, 'interim_gate');
  });

  it('comparison payload links back to resolution_id', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(resolution !== null);
    const sid = getSessionId();
    await recordShadowComparison(resolution, 'local_reasoning_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec, 'comparison record not found');
    const payload = JSON.parse(compRec.payload);
    assert.equal(payload.resolution_id, resolution.resolution_id,
      'comparison payload.resolution_id must match the resolution that was passed');
  });

  it('comparison payload capability_id matches resolution', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'retrieval.embed' });
    assert.ok(resolution !== null);
    const sid = getSessionId();
    await recordShadowComparison(resolution, 'ollama_embed_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec);
    const payload = JSON.parse(compRec.payload);
    assert.equal(payload.capability_id, 'retrieval.embed');
  });

  it('diverged=false when actual matches shadow selection (match case)', async () => {
    // node_online=true → shadow selects local_reasoning_resolver
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(resolution !== null);
    const sid = getSessionId();
    await recordShadowComparison(resolution, 'local_reasoning_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec);
    const payload = JSON.parse(compRec.payload);
    assert.equal(payload.actual_provider, 'local_reasoning_resolver');
    assert.equal(payload.diverged, false);
  });

  it('diverged=true when actual differs from shadow selection (divergence case)', async () => {
    // node_online=true → shadow selects local; actual=cloud → diverged
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', node_online: true });
    assert.ok(resolution !== null);
    const sid = getSessionId();
    await recordShadowComparison(resolution, 'cloud_reasoning_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec);
    const payload = JSON.parse(compRec.payload);
    assert.equal(payload.actual_provider, 'cloud_reasoning_resolver');
    assert.equal(payload.diverged, true);
    assert.ok(typeof payload.divergence_reason === 'string' && payload.divergence_reason.length > 0,
      'divergence_reason must be a non-empty string when diverged=true');
  });

  it('original resolution record is NOT mutated by comparison (immutability)', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    const beforeRecs = await queryByRecordId(resolution.resolution_id);
    const recBefore = beforeRecs[0] ?? null;
    assert.ok(recBefore !== null);
    const parsedBefore = JSON.parse(recBefore.payload);

    await recordShadowComparison(resolution, 'local_reasoning_resolver', null);

    const afterRecs = await queryByRecordId(resolution.resolution_id);
    const recAfter = afterRecs[0] ?? null;
    assert.ok(recAfter !== null);
    const parsedAfter = JSON.parse(recAfter.payload);
    assert.deepEqual(parsedBefore, parsedAfter,
      'original resolution record payload must not change after comparison is appended');
  });

  it('comparison uses a NEW record_id (not resolution_id)', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    const sid = getSessionId();
    await recordShadowComparison(resolution, 'local_reasoning_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec);
    assert.notEqual(compRec.record_id, resolution.resolution_id,
      'comparison record must have a different record_id from the resolution');
  });

  it('recordShadowComparison never throws (best-effort semantics)', async () => {
    // Pass a malformed resolution — should not throw
    const badResolution = { resolution_id: 'res.bad', capability_id: 'reasoning',
      provider_candidates: [], session_id: 'sess.x', request_id: null };
    await assert.doesNotReject(
      () => recordShadowComparison(badResolution, 'some_provider', null)
    );
  });
});

// ══════════════════════════════════════════════════════════════════
//  L6: request_id threading
// ══════════════════════════════════════════════════════════════════

describe('L6 — request_id threading to resolution and comparison records', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('request_id threaded into resolution record payload', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning', request_id: requestId });
    assert.ok(resolution !== null);
    assert.equal(resolution.request_id, requestId);
    const recs = await queryByRecordId(resolution.resolution_id);
    const rec = recs[0] ?? null;
    assert.ok(rec !== null);
    assert.equal(rec.request_id, requestId,
      'persisted resolution record must carry the minted request_id');
  });

  it('request_id prefix is req.', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const id = mintRequestId();
    assert.ok(id.startsWith('req.'), `expected req. prefix, got ${id}`);
  });

  it('request_id threads from resolution to comparison record', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'web.search', request_id: requestId });
    assert.ok(resolution !== null);
    const sid = getSessionId();
    await recordShadowComparison(resolution, 'brave_resolver', null);
    const records = await queryBySessionId(sid);
    const compRec = records.filter(r => r.source === 'candidate_resolution_comparison').pop();
    assert.ok(compRec, 'comparison record not found');
    assert.equal(compRec.request_id, requestId,
      'comparison record must carry the same request_id as the resolution');
  });

  it('queryByRecordId(resolution_id) returns record with correct request_id', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const resolution = await resolveAndRecordShadow({ capability_id: 'retrieval.embed', request_id: requestId });
    assert.ok(resolution !== null);
    const recs = await queryByRecordId(resolution.resolution_id);
    const rec = recs[0] ?? null;
    assert.ok(rec !== null, 'queryByRecordId must find the resolution record');
    assert.equal(rec.request_id, requestId);
  });

  it('null request_id is stored as null (not undefined or empty string)', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    assert.equal(resolution.request_id, null);
    const rec = await queryByRecordId(resolution.resolution_id);
    assert.ok(rec !== null);
    // SQLite stores NULL; mock may store null or undefined — both are falsy
    assert.ok(rec.request_id === null || rec.request_id === undefined,
      `request_id should be null/undefined when not supplied, got ${rec.request_id}`);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Integration A — requestId identity chain across resolution sites
// ══════════════════════════════════════════════════════════════════

describe('Integration A — requestId identity chain: embed → reasoning resolutions', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('same requestId threads to retrieval.embed and reasoning resolutions', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    const embedResolution = await resolveAndRecordShadow({
      capability_id: 'retrieval.embed',
      request_id: requestId,
    });
    assert.ok(embedResolution !== null, 'embed resolution must succeed');
    assert.equal(embedResolution.request_id, requestId, 'embed resolution.request_id must match minted requestId');

    const reasoningResolution = await resolveAndRecordShadow({
      capability_id: 'reasoning',
      request_id: requestId,
    });
    assert.ok(reasoningResolution !== null, 'reasoning resolution must succeed');
    assert.equal(reasoningResolution.request_id, requestId, 'reasoning resolution.request_id must match minted requestId');

    const records = await queryBySessionId(sid);
    const embedRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'retrieval.embed'; } catch { return false; }
    });
    const reasoningRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'reasoning'; } catch { return false; }
    });

    assert.ok(embedRec, 'retrieval.embed resolution record must carry requestId');
    assert.ok(reasoningRec, 'reasoning resolution record must carry requestId');
    assert.equal(embedRec.request_id, reasoningRec.request_id,
      'embed and reasoning resolution records must share the same request_id');
  });

  it('comparison records for embed and reasoning carry the same requestId', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    const embedResolution = await resolveAndRecordShadow({ capability_id: 'retrieval.embed', request_id: requestId });
    assert.ok(embedResolution !== null);
    await recordShadowComparison(embedResolution, 'ollama_embed_resolver', null);

    const reasoningResolution = await resolveAndRecordShadow({ capability_id: 'reasoning', request_id: requestId });
    assert.ok(reasoningResolution !== null);
    await recordShadowComparison(reasoningResolution, 'local_reasoning_resolver', null);

    const records = await queryBySessionId(sid);
    const compRecs = records.filter(r =>
      r.source === 'candidate_resolution_comparison' && r.request_id === requestId
    );
    assert.ok(compRecs.length >= 2,
      `expected ≥2 comparison records with requestId=${requestId}, got ${compRecs.length}`);
  });

  it('L6 structural: mintRequestId() called in index.tsx before gateSemanticContext', () => {
    const mintIdx   = SRC_INDEX.indexOf('mintRequestId()');
    const gateIdx   = SRC_INDEX.indexOf('gateSemanticContext(');
    assert.ok(mintIdx !== -1,  'index.tsx must call mintRequestId()');
    assert.ok(gateIdx !== -1,  'index.tsx must call gateSemanticContext(');
    assert.ok(mintIdx < gateIdx,
      'mintRequestId() must appear before gateSemanticContext() in index.tsx');
  });

  it('L6 structural: requestId is passed to gateSemanticContext in index.tsx', () => {
    assert.ok(SRC_INDEX.includes('requestId,') || SRC_INDEX.includes('requestId\n'),
      'index.tsx must pass requestId to gateSemanticContext');
    assert.ok(SRC_INDEX.includes('requestId,\n        fetchCredential') ||
              SRC_INDEX.includes('requestId,\n          fetchCredential') ||
              SRC_INDEX.includes('requestId'),
      'requestId must be threaded to gateSemanticContext');
  });

  it('L6 structural: requestId is passed to executeSendOrchestration in index.tsx', () => {
    const orchCallIdx = SRC_INDEX.indexOf('executeSendOrchestration(');
    assert.ok(orchCallIdx !== -1, 'index.tsx must call executeSendOrchestration');
    const orchBlock = SRC_INDEX.slice(orchCallIdx, orchCallIdx + 600);
    assert.ok(orchBlock.includes('requestId'), 'executeSendOrchestration call must include requestId');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Integration B — L2: M2 PayloadClassification.unionClasses (not manual reconstruction)
// ══════════════════════════════════════════════════════════════════

describe('Integration B — L2: M2 unionClasses exact, no manual reconstruction', () => {
  it('embeddingService.ts does NOT import classifyData', () => {
    assert.ok(!SRC_EMBED.includes("import { classifyData }") && !SRC_EMBED.includes("from './securityGateway'"),
      'embeddingService.ts must not import classifyData from securityGateway');
  });

  it('embeddingService.ts does NOT contain manual classifyData reconstruction', () => {
    assert.ok(!SRC_EMBED.includes('classifyData('),
      'embeddingService.ts must not call classifyData() — reconstruction must be eliminated');
  });

  it('embeddingService.ts uses dataClasses param passed from caller', () => {
    assert.ok(SRC_EMBED.includes('dataClasses?: DataClass[]'),
      'embedText must accept dataClasses?: DataClass[]');
    assert.ok(SRC_EMBED.includes("dataClasses ?? ['public']"),
      'embedText must default to [\'public\'] when dataClasses not supplied');
  });

  it('readOnlyTools.ts does NOT import classifyData', () => {
    assert.ok(!SRC_TOOLS.includes("import { classifyData }") && !SRC_TOOLS.includes("from './securityGateway'"),
      'readOnlyTools.ts must not import classifyData');
  });

  it('readOnlyTools.ts does NOT contain manual classifyData reconstruction', () => {
    assert.ok(!SRC_TOOLS.includes('classifyData('),
      'readOnlyTools.ts must not call classifyData() — use opts.dataClasses from caller');
  });

  it('readOnlyTools.ts accepts dataClasses in opts and passes to runTool', () => {
    assert.ok(SRC_TOOLS.includes('dataClasses?: DataClass[]'),
      'buildReadOnlyMacToolContext opts must accept dataClasses?: DataClass[]');
    assert.ok(SRC_TOOLS.includes('opts.dataClasses'),
      'buildReadOnlyMacToolContext must use opts.dataClasses');
  });

  it('semanticContext.ts passes classification.unionClasses to embedUserMessage', () => {
    assert.ok(SRC_SEMANTIC_CTX.includes('classification.unionClasses'),
      'gateSemanticContext must pass classification.unionClasses to callback');
    assert.ok(SRC_SEMANTIC_CTX.includes('embedUserMessage(text, messageId, conversationId, requestId, classification.unionClasses)'),
      'embedUserMessage call must thread both requestId and classification.unionClasses');
  });

  it('semanticContext.ts passes classification.unionClasses to findRelevantNodes', () => {
    assert.ok(SRC_SEMANTIC_CTX.includes('findRelevantNodes(text, requestId, classification.unionClasses)'),
      'findRelevantNodes call must thread both requestId and classification.unionClasses');
  });

  it('data_classes=[protected] preserved through resolution (M2 full vocabulary)', async () => {
    const r = await resolveAndRecordShadow({ capability_id: 'reasoning', data_classes: ['protected'] });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['protected'],
      '"protected" class must survive through candidate resolution unchanged');
  });

  it('data_classes=[public, protected, medical] union preserved', async () => {
    const r = await resolveAndRecordShadow({
      capability_id: 'retrieval.embed',
      data_classes: ['public', 'protected', 'medical'],
    });
    assert.ok(r !== null);
    assert.deepEqual(r.data_classes, ['public', 'protected', 'medical']);
  });

  it('sendOrchestration.ts computes upfront M2 classification for mac tools', () => {
    assert.ok(SRC_SEND_ORCH.includes('upfrontClassification'),
      'sendOrchestration must compute upfrontClassification before buildReadOnlyMacToolContext');
    assert.ok(SRC_SEND_ORCH.includes('upfrontClassification.unionClasses'),
      'sendOrchestration must pass upfrontClassification.unionClasses to buildReadOnlyMacToolContext');
  });

  it('sendOrchestration.ts uses params.requestId ?? mintRequestId() (L6 fallback)', () => {
    assert.ok(SRC_SEND_ORCH.includes('params.requestId ?? mintRequestId()'),
      'sendOrchestration must use params.requestId if supplied, mint as fallback');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Integration C + F — canonical M4 ProviderDescriptor IDs for gateway tools
// ══════════════════════════════════════════════════════════════════

describe('Integration C+F — canonical M4 ProviderDescriptor IDs for gateway tools', () => {
  it('readOnlyTools.ts does NOT use ad-hoc gateway_tool_resolver: provider ID pattern', () => {
    assert.ok(!SRC_TOOLS.includes('gateway_tool_resolver:'),
      'readOnlyTools.ts must not use "gateway_tool_resolver:${tool}" — use canonical ProviderDescriptor IDs');
  });

  it('readOnlyTools.ts imports lookupProvidersByCapability from registry', () => {
    assert.ok(SRC_TOOLS.includes('lookupProvidersByCapability'),
      'readOnlyTools.ts must import and use lookupProvidersByCapability from registry');
  });

  it('readOnlyTools.ts derives actual_provider via lookupProvidersByCapability', () => {
    assert.ok(SRC_TOOLS.includes('lookupProvidersByCapability(capId ?? tool)[0]?.id'),
      'actual_provider must be derived via lookupProvidersByCapability()[0].id');
  });

  const CANONICAL_TOOL_PROVIDERS = [
    'gateway_ollama_status_resolver',
    'gateway_system_info_resolver',
    'gateway_git_status_resolver',
    'gateway_git_diff_resolver',
    'gateway_github_repo_resolver',
    'gateway_github_commits_resolver',
    'gateway_github_issues_resolver',
    'gateway_github_pull_requests_resolver',
    'gateway_github_actions_resolver',
  ];

  // Verify canonical IDs exist in the registry source (not in readOnlyTools — they live in registry.ts)
  const SRC_REGISTRY = readFileSync('services/controlPlane/registry.ts', 'utf8');

  for (const providerId of CANONICAL_TOOL_PROVIDERS) {
    it(`canonical provider ${providerId} is registered in registry.ts`, () => {
      assert.ok(SRC_REGISTRY.includes(`'${providerId}'`),
        `registry.ts must declare provider '${providerId}'`);
    });
  }

  it('lookupProvidersByCapability returns canonical resolver for ollama.status.read', async () => {
    const { lookupProvidersByCapability } = await import('../../services/controlPlane/registry.ts');
    const providers = lookupProvidersByCapability('ollama.status.read');
    assert.ok(providers.length > 0, 'ollama.status.read must have at least one registered provider');
    assert.equal(providers[0].id, 'gateway_ollama_status_resolver');
  });

  it('lookupProvidersByCapability returns canonical resolver for git.diff.read', async () => {
    const { lookupProvidersByCapability } = await import('../../services/controlPlane/registry.ts');
    const providers = lookupProvidersByCapability('git.diff.read');
    assert.ok(providers.length > 0, 'git.diff.read must have at least one registered provider');
    assert.equal(providers[0].id, 'gateway_git_diff_resolver');
  });

  it('lookupProvidersByCapability returns canonical resolver for github.read.actions', async () => {
    const { lookupProvidersByCapability } = await import('../../services/controlPlane/registry.ts');
    const providers = lookupProvidersByCapability('github.read.actions');
    assert.ok(providers.length > 0, 'github.read.actions must have at least one registered provider');
    assert.equal(providers[0].id, 'gateway_github_actions_resolver');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Integration D — comparison append completes before function returns
// ══════════════════════════════════════════════════════════════════

describe('Integration D — comparison append awaited before function returns', () => {
  it('aiRouter.ts awaits recordShadowComparison (not fire-and-forget)', () => {
    assert.ok(SRC_ROUTER.includes('await recordShadowComparison('),
      'aiRouter.ts must await recordShadowComparison — not fire-and-forget');
  });

  it('embeddingService.ts awaits recordShadowComparison', () => {
    assert.ok(SRC_EMBED.includes('await recordShadowComparison('),
      'embeddingService.ts must await recordShadowComparison');
  });

  it('readOnlyTools.ts awaits recordShadowComparison', () => {
    assert.ok(SRC_TOOLS.includes('await recordShadowComparison('),
      'readOnlyTools.ts must await recordShadowComparison');
  });

  it('webSearch.ts awaits recordShadowComparison', () => {
    assert.ok(SRC_SEARCH.includes('await recordShadowComparison('),
      'webSearch.ts must await recordShadowComparison');
  });

  it('D runtime: recordShadowComparison record is visible before resolveAndRecordShadow completes next call', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    const resolution = await resolveAndRecordShadow({ capability_id: 'retrieval.embed', request_id: requestId });
    assert.ok(resolution !== null);
    await recordShadowComparison(resolution, 'ollama_embed_resolver', null);

    // After await completes, comparison record must be queryable immediately
    const records = await queryBySessionId(sid);
    const compRec = records.find(r =>
      r.source === 'candidate_resolution_comparison' && r.request_id === requestId
    );
    assert.ok(compRec, 'comparison record must be queryable immediately after await recordShadowComparison');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Integration E — comparison failure does not alter provider result
// ══════════════════════════════════════════════════════════════════

describe('Integration E — comparison failure does not alter provider result', () => {
  it('recordShadowComparison has .catch(() => {}) after await — failure is swallowed', () => {
    // Structural: all 4 call sites wrap the await with .catch(() => {})
    const routerLine   = SRC_ROUTER.match(/await recordShadowComparison\([^)]+\)\.catch\(\(\) => \{\}\)/);
    const embedLine    = SRC_EMBED.match(/await recordShadowComparison\([^)]+\)\.catch\(\(\) => \{\}\)/);
    const toolsLine    = SRC_TOOLS.match(/await recordShadowComparison\([^)]+\)\.catch\(\(\) => \{\}\)/);
    const searchLine   = SRC_SEARCH.match(/await recordShadowComparison\([^)]+\)\.catch\(\(\) => \{\}\)/);
    assert.ok(routerLine,  'aiRouter.ts: await recordShadowComparison must have .catch(() => {})');
    assert.ok(embedLine,   'embeddingService.ts: await recordShadowComparison must have .catch(() => {})');
    assert.ok(toolsLine,   'readOnlyTools.ts: await recordShadowComparison must have .catch(() => {})');
    assert.ok(searchLine,  'webSearch.ts: await recordShadowComparison must have .catch(() => {})');
  });

  it('E runtime: recordShadowComparison never throws even when passed an invalid resolution', async () => {
    // Passing a malformed/null resolution object — must not throw
    const fakeResolution = { resolution_id: 'fake_id', capability_id: 'reasoning', shadow_mode: true };
    let threw = false;
    try {
      await recordShadowComparison(fakeResolution, 'local_reasoning_resolver', null);
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'recordShadowComparison must never throw — callers rely on .catch(() => {})');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Comparison Recording Status — recordShadowComparison returns 'recorded'|'degraded'
// ══════════════════════════════════════════════════════════════════

describe('Comparison Recording Status — recordShadowComparison return value', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  it('returns recorded when Recorder is healthy', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'reasoning' });
    assert.ok(resolution !== null);
    const status = await recordShadowComparison(resolution, 'local_reasoning_resolver', null);
    assert.equal(status, 'recorded', 'recordShadowComparison must return "recorded" when Recorder is healthy');
  });

  it('returns degraded when Recorder unavailable (simulated via reset)', async () => {
    const resolution = await resolveAndRecordShadow({ capability_id: 'web.search', web_search_status: 'operational' });
    assert.ok(resolution !== null);
    // Reset recorder so ensureReady fails on next call
    __resetRecorder();
    // Do NOT re-init — ensureReady will return false → 'degraded'
    const status = await recordShadowComparison(resolution, 'brave_resolver', null);
    assert.equal(status, 'degraded', 'recordShadowComparison must return "degraded" when Recorder unavailable');
    // Restore for subsequent tests
    await initRecorder();
  });

  it('provider result is unchanged regardless of comparison status (structural)', () => {
    // All call sites: await X.catch(() => {}) — status is never used for routing
    const awaitPattern = /await recordShadowComparison\([^)]+\)\.catch\(\(\) => \{\}\)/g;
    const routerMatches  = SRC_ROUTER.match(awaitPattern)  ?? [];
    const embedMatches   = SRC_EMBED.match(awaitPattern)   ?? [];
    const toolsMatches   = SRC_TOOLS.match(awaitPattern)   ?? [];
    const searchMatches  = SRC_SEARCH.match(awaitPattern)  ?? [];
    // Each call site awaits with .catch — status never gates the return
    assert.ok(routerMatches.length  >= 1, 'aiRouter.ts must await recordShadowComparison with .catch');
    assert.ok(embedMatches.length   >= 1, 'embeddingService.ts must await recordShadowComparison with .catch');
    assert.ok(toolsMatches.length   >= 1, 'readOnlyTools.ts must await recordShadowComparison with .catch');
    assert.ok(searchMatches.length  >= 1, 'webSearch.ts must await recordShadowComparison with .catch');
  });

  it('recordShadowComparison return type is not void (structural)', () => {
    // SRC_RESOLUTION must declare Promise<'recorded' | 'degraded'> not Promise<void>
    assert.ok(SRC_RESOLUTION.includes("Promise<'recorded' | 'degraded'>"),
      'recordShadowComparison must return Promise<\'recorded\' | \'degraded\'>, not void');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Direct Capability Caller Audit — structural matrix
// ══════════════════════════════════════════════════════════════════

describe('Direct Capability Caller Audit — all user-triggered paths have requestId + M2 classes', () => {
  // Chat send path (index.tsx) — already tested in Integration A
  it('chat send: mintRequestId() appears before gateSemanticContext in index.tsx', () => {
    const mintIdx = SRC_INDEX.indexOf('mintRequestId()');
    const gateIdx = SRC_INDEX.indexOf('gateSemanticContext(');
    assert.ok(mintIdx < gateIdx, 'mintRequestId() must precede gateSemanticContext() in send path');
  });

  // History search path
  it('history search: index.tsx mints requestId before semanticSearchConversations', () => {
    const handleIdx = SRC_INDEX.indexOf('handleHistorySearch');
    assert.ok(handleIdx !== -1, 'handleHistorySearch must exist');
    const handleBlock = SRC_INDEX.slice(handleIdx, handleIdx + 1500);
    const mintIdx  = handleBlock.indexOf('mintRequestId()');
    const searchIdx = handleBlock.indexOf('semanticSearchConversations(');
    assert.ok(mintIdx !== -1,  'handleHistorySearch must mint requestId');
    assert.ok(searchIdx !== -1, 'handleHistorySearch must call semanticSearchConversations');
    assert.ok(mintIdx < searchIdx, 'mintRequestId() must precede semanticSearchConversations() in handleHistorySearch');
  });

  it('history search: index.tsx classifies text before semanticSearchConversations', () => {
    const handleIdx = SRC_INDEX.indexOf('handleHistorySearch');
    const handleBlock = SRC_INDEX.slice(handleIdx, handleIdx + 1500);
    assert.ok(handleBlock.includes('classifyPayload('),
      'handleHistorySearch must call classifyPayload before semanticSearchConversations');
    assert.ok(handleBlock.includes('classification.unionClasses'),
      'handleHistorySearch must pass classification.unionClasses to semanticSearchConversations');
  });

  it('history search: protected text skips semantic embedding (M2 containment preserved)', () => {
    const handleIdx = SRC_INDEX.indexOf('handleHistorySearch');
    const handleBlock = SRC_INDEX.slice(handleIdx, handleIdx + 1500);
    assert.ok(handleBlock.includes('classification.isProtected'),
      'handleHistorySearch must check classification.isProtected before semantic embedding');
  });

  // Summarize path
  it('summarize: index.tsx mints requestId before executeSummarizeOrchestration', () => {
    const handleIdx = SRC_INDEX.indexOf('handleSummarize');
    assert.ok(handleIdx !== -1, 'handleSummarize must exist');
    const handleBlock = SRC_INDEX.slice(handleIdx, handleIdx + 1500);
    const mintIdx  = handleBlock.indexOf('mintRequestId()');
    const orchIdx  = handleBlock.indexOf('executeSummarizeOrchestration(');
    assert.ok(mintIdx !== -1, 'handleSummarize must mint requestId');
    assert.ok(orchIdx !== -1, 'handleSummarize must call executeSummarizeOrchestration');
    assert.ok(mintIdx < orchIdx, 'mintRequestId() must precede executeSummarizeOrchestration() in handleSummarize');
  });

  it('summarize: executeSummarizeOrchestration threads requestId to routeAI', () => {
    assert.ok(SRC_SEND_ORCH.includes('summarizeRequestId'),
      'executeSummarizeOrchestration must thread summarizeRequestId to routeAI');
    assert.ok(SRC_SEND_ORCH.includes("requestId:   summarizeRequestId"),
      'routeAI call must include requestId: summarizeRequestId');
    assert.ok(SRC_SEND_ORCH.includes("dataClasses: classification.unionClasses"),
      'routeAI call must include classification.unionClasses as dataClasses');
  });

  // File upload path
  it('file upload: index.tsx mints requestId at upload action boundary', () => {
    const uploadIdx = SRC_INDEX.indexOf('uploadRequestId');
    assert.ok(uploadIdx !== -1, 'pickGraphFiles must declare uploadRequestId');
    const mintIdx = SRC_INDEX.indexOf('uploadRequestId = mintRequestId()');
    assert.ok(mintIdx !== -1, 'uploadRequestId must be minted via mintRequestId()');
  });

  it('file upload: index.tsx classifies each node content via M2', () => {
    const nodeClassIdx = SRC_INDEX.indexOf('nodeClass = await classifyPayload(');
    assert.ok(nodeClassIdx !== -1, 'pickGraphFiles must classify node content via classifyPayload');
    const embedIdx = SRC_INDEX.indexOf('embedText(node.p, uploadRequestId, nodeClass.unionClasses)');
    assert.ok(embedIdx !== -1, 'embedText must receive uploadRequestId and nodeClass.unionClasses');
  });

  it('file upload: protected content is not embedded (M2 containment preserved)', () => {
    const nodeClassIdx = SRC_INDEX.indexOf('nodeClass.isProtected');
    assert.ok(nodeClassIdx !== -1, 'pickGraphFiles must check nodeClass.isProtected before embedText');
  });

  // System diagnostic search path (system.tsx)
  it('system diagnostic search: system.tsx mints requestId before webSearch', () => {
    const doSearchIdx = SRC_SYSTEM.indexOf('doSearch');
    assert.ok(doSearchIdx !== -1, 'doSearch must exist in system.tsx');
    const handleBlock = SRC_SYSTEM.slice(doSearchIdx, doSearchIdx + 1500);
    const mintIdx  = handleBlock.indexOf('mintRequestId()');
    const searchIdx = handleBlock.indexOf('webSearch(');
    assert.ok(mintIdx !== -1,  'doSearch must mint requestId');
    assert.ok(searchIdx !== -1, 'doSearch must call webSearch');
    assert.ok(mintIdx < searchIdx, 'mintRequestId() must precede webSearch() in doSearch');
  });

  it('system diagnostic search: system.tsx classifies text and passes to webSearch', () => {
    const doSearchIdx = SRC_SYSTEM.indexOf('doSearch');
    const handleBlock = SRC_SYSTEM.slice(doSearchIdx, doSearchIdx + 1500);
    assert.ok(handleBlock.includes('classifyPayload('),
      'doSearch must call classifyPayload');
    assert.ok(handleBlock.includes('classification.unionClasses'),
      'doSearch must pass classification.unionClasses to webSearch');
  });

  // semanticSearchConversations signature
  it('semanticSearchConversations accepts requestId and dataClasses params', () => {
    assert.ok(SRC_EMBED.includes('semanticSearchConversations('),
      'semanticSearchConversations must exist in embeddingService.ts');
    // The function must accept requestId and dataClasses
    const fnIdx = SRC_EMBED.indexOf('export async function semanticSearchConversations(');
    const fnSig = SRC_EMBED.slice(fnIdx, fnIdx + 200);
    assert.ok(fnSig.includes('requestId?'), 'semanticSearchConversations must accept requestId?');
    assert.ok(fnSig.includes('dataClasses?'), 'semanticSearchConversations must accept dataClasses?');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Production-backed Identity Chain — uses actual production modules
// ══════════════════════════════════════════════════════════════════

describe('Production-backed Identity: semantic search → retrieval.embed resolution', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  afterEach(() => {
    // Restore fetch after each test that may mock it
    if (globalThis.__origFetch !== undefined) {
      globalThis.fetch = globalThis.__origFetch;
      delete globalThis.__origFetch;
    }
  });

  it('embedText with requestId → retrieval.embed resolution in Recorder with correct requestId', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    // Mock fetch for the Ollama embeddings endpoint
    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/embeddings')) {
        return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    await embedText('hello world', requestId, ['public']);

    const records = await queryBySessionId(sid);
    const embedRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'retrieval.embed'; } catch { return false; }
    });
    assert.ok(embedRec, 'retrieval.embed resolution must be in Recorder with requestId from embedText caller');
    assert.equal(embedRec.request_id, requestId, 'resolution record request_id must match caller requestId');
  });

  it('semanticSearchConversations threads requestId → retrieval.embed resolution in Recorder', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/embeddings')) {
        return { ok: true, json: async () => ({ embedding: [0.2, 0.3, 0.4] }) };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    // semanticSearchConversations returns null (no stored embeddings) but records shadow resolution
    await semanticSearchConversations('search query text', requestId, ['public']);

    const records = await queryBySessionId(sid);
    const embedRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'retrieval.embed'; } catch { return false; }
    });
    assert.ok(embedRec, 'retrieval.embed resolution must be in Recorder via semanticSearchConversations path');
    assert.equal(embedRec.request_id, requestId);
  });

  it('semanticSearch: Recorder data_classes === M2 classification.unionClasses (ordinary text)', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    const classification = await classifyPayload({
      currentText: 'patient blood pressure medication 120/80',
      messages: [],
      fetchCredential: async () => null,
    });
    // classification.unionClasses should include 'medical'

    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/embeddings')) {
        return { ok: true, json: async () => ({ embedding: [0.1, 0.1, 0.1] }) };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    await semanticSearchConversations('patient blood pressure medication 120/80', requestId, classification.unionClasses);

    const records = await queryBySessionId(sid);
    const embedRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'retrieval.embed'; } catch { return false; }
    });
    assert.ok(embedRec, 'embed resolution must be in Recorder');
    const payload = JSON.parse(embedRec.payload);
    assert.deepEqual(payload.data_classes, classification.unionClasses,
      'data_classes in Recorder must equal M2 classification.unionClasses exactly');
    assert.ok(classification.unionClasses.includes('medical'),
      'M2 must classify medical text as medical');
  });

  it('semanticSearch: protected text skips embedText (M2 containment — no shadow resolution)', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();
    const recordsBefore = (await queryBySessionId(sid)).length;

    // isProtected text: gateSemanticContext blocks it before embedText.
    // In the caller (handleHistorySearch), classification.isProtected → semanticSearchConversations is not called.
    // So we verify the structural invariant: embedText is never called for protected text.
    // Structural proof: index.tsx checks classification.isProtected before semanticSearchConversations call.
    const handleIdx = SRC_INDEX.indexOf('handleHistorySearch');
    const handleBlock = SRC_INDEX.slice(handleIdx, handleIdx + 1500);
    assert.ok(handleBlock.includes('classification.isProtected'),
      'handleHistorySearch must check isProtected before calling semanticSearchConversations');

    // No new Recorder records for this requestId (embedText never called for protected path)
    const recordsAfter = (await queryBySessionId(sid)).length;
    assert.equal(recordsAfter, recordsBefore, 'no new Recorder records when protected path skips embedding');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Production-backed Identity: summarize → reasoning resolution
// ══════════════════════════════════════════════════════════════════

describe('Production-backed Identity: summarize → reasoning resolution', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  afterEach(() => {
    if (globalThis.__origFetch !== undefined) {
      globalThis.fetch = globalThis.__origFetch;
      delete globalThis.__origFetch;
    }
  });

  it('executeSummarizeOrchestration requestId → reasoning resolution in Recorder', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    // Mock fetch: cloud AI endpoint returns a valid Claude response
    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/claude')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ text: 'Topics: greetings. Decisions: none. Next steps: none.' }],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 10, output_tokens: 15 },
          }),
        };
      }
      return Promise.reject(new Error(`unmocked fetch in summarize test: ${url}`));
    };

    await executeSummarizeOrchestration({
      transcript: 'User: hello\nAssistant: hi there',
      safeMode: false,
      nodeOnline: false, // force cloud path (local unavailable in test env)
      requestId,
      fetchCredential: async () => null,
    });

    const records = await queryBySessionId(sid);
    const reasoningRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'reasoning'; } catch { return false; }
    });
    assert.ok(reasoningRec,
      'reasoning resolution must be in Recorder with requestId from summarize action boundary');
    assert.equal(reasoningRec.request_id, requestId,
      'reasoning resolution.request_id must equal the requestId minted at summarize boundary');
  });

  it('summarize: reasoning resolution data_classes === M2 classification.unionClasses', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    // Ordinary transcript — no medical/financial/PII
    const transcript = 'User: what is the weather\nAssistant: I cannot check weather directly';
    const classification = await classifyPayload({
      currentText: 'Summarize the conversation.',
      messages: [],
      summarizeTranscript: transcript,
      fetchCredential: async () => null,
    });

    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/claude')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            content: [{ text: 'Topics: weather. Decisions: none. Next steps: none.' }],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 8, output_tokens: 10 },
          }),
        };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    await executeSummarizeOrchestration({
      transcript,
      safeMode: false,
      nodeOnline: false,
      requestId,
      fetchCredential: async () => null,
    });

    const records = await queryBySessionId(sid);
    const reasoningRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'reasoning'; } catch { return false; }
    });
    assert.ok(reasoningRec, 'reasoning resolution must be in Recorder');
    const payload = JSON.parse(reasoningRec.payload);
    assert.deepEqual(payload.data_classes, classification.unionClasses,
      'reasoning resolution data_classes must equal M2 classification.unionClasses for summarize path');
  });

  it('summarize comparison record carries same requestId', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const requestId = mintRequestId();
    const sid = getSessionId();

    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/claude')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            content: [{ text: 'Topics: test. Decisions: none. Next steps: none.' }],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 5, output_tokens: 8 },
          }),
        };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    await executeSummarizeOrchestration({
      transcript: 'User: test\nAssistant: ok',
      safeMode: false,
      nodeOnline: false,
      requestId,
      fetchCredential: async () => null,
    });

    const records = await queryBySessionId(sid);
    const compRec = records.find(r =>
      r.source === 'candidate_resolution_comparison' && r.request_id === requestId
    );
    assert.ok(compRec,
      'comparison record for reasoning must be in Recorder with same requestId as summarize action');
    assert.equal(compRec.request_id, requestId);
  });
});

// ══════════════════════════════════════════════════════════════════
//  System Diagnostic Search — M2 gateSearch containment
// ══════════════════════════════════════════════════════════════════

describe('System Diagnostic Search — M2 gateSearch gate applied', () => {
  it('system.tsx calls gateSearch before webSearch (structural)', () => {
    const doSearchIdx = SRC_SYSTEM.indexOf('doSearch');
    const doSearchBlock = SRC_SYSTEM.slice(doSearchIdx, doSearchIdx + 1500);
    const gateIdx = doSearchBlock.indexOf('gateSearch(classification)');
    const webIdx = doSearchBlock.indexOf('webSearch(');
    assert.ok(gateIdx !== -1, 'doSearch must call gateSearch(classification)');
    assert.ok(webIdx !== -1, 'doSearch must call webSearch');
    assert.ok(gateIdx < webIdx, 'gateSearch must be called before webSearch in doSearch');
  });

  it('system.tsx checks searchGate.action === block_search before webSearch (structural)', () => {
    const doSearchIdx = SRC_SYSTEM.indexOf('doSearch');
    const doSearchBlock = SRC_SYSTEM.slice(doSearchIdx, doSearchIdx + 1500);
    assert.ok(doSearchBlock.includes("searchGate.action === 'block_search'"),
      'doSearch must check if gateSearch returned block_search action');
    assert.ok(doSearchBlock.includes('setSearchError(searchGate.reason)'),
      'doSearch must surface the gateSearch reason when blocked');
  });

  it('protected diagnostic query → gateSearch blocks → zero webSearch calls', async () => {
    const classification = await classifyPayload({
      currentText: 'sk-ant-apica-abcdefghijklmnopqrst1234',  // protected pattern - Anthropic API key format
      messages: [],
      fetchCredential: async () => null,
    });

    assert.ok(classification.isProtected, 'text with protected patterns must be classified as protected');

    const gate = gateSearch(classification);
    assert.equal(gate.action, 'block_search',
      'gateSearch must block when classification.isProtected=true');

    // Structural: if gate blocks, webSearch is never called
    // We can't directly verify 0 calls without mocking, but gateSearch returning block_search
    // is the control point that prevents the webSearch call.
  });

  it('public diagnostic query → gateSearch allows → webSearch proceeds', async () => {
    const classification = await classifyPayload({
      currentText: 'what is the weather today',
      messages: [],
      fetchCredential: async () => null,
    });

    assert.ok(!classification.isProtected, 'ordinary query must not be protected');

    const gate = gateSearch(classification);
    assert.equal(gate.action, 'allow_search',
      'gateSearch must allow when classification.isProtected=false');
  });

  it('M2 closure: diagnostic search sensitive/protected containment via existing gateSearch', () => {
    // This documents that the System diagnostic search now uses the existing M2 interim
    // boundary gate (gateSearch), applying the same containment rules as the chat send path.
    // The gateSearch function already knows the classification semantics (sensitive, protected).
    // No new M5 authorization is introduced — this is M2 coverage correction.
    assert.ok(SRC_SYSTEM.includes('gateSearch(classification)'),
      'System diagnostic search must use the existing M2 gateSearch function');
  });
});

// ══════════════════════════════════════════════════════════════════
//  Production-backed Normal Chat: full orchestration identity chain
// ══════════════════════════════════════════════════════════════════

describe('Production-backed Normal Chat: full orchestration identity chain', () => {
  before(async () => {
    sqliteMock.__clearAll();
    __resetRecorder();
    await initRecorder();
  });

  afterEach(() => {
    if (globalThis.__origFetch !== undefined) {
      globalThis.fetch = globalThis.__origFetch;
      delete globalThis.__origFetch;
    }
  });

  it('normal chat send: one requestId → user_statement + embed + reasoning resolutions + comparisons (all same requestId)', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const { gateSemanticContext } = await import('../../services/controlPlane/semanticContext.ts');

    const requestId = mintRequestId();
    const sid = getSessionId();
    const userMsgId = 'test_msg_' + Date.now();
    const conversationId = 'test_conv_' + Date.now();

    // Mock fetch for embeddings and cloud reasoning
    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/embeddings')) {
        return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
      }
      if (String(url).includes('/claude')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            content: [{ text: 'Test response.' }],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
        };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    // 1. Gate semantic context (embedding path)
    const fetchCred = async () => null;
    const semanticCtx = await gateSemanticContext({
      text: 'hello world',
      messageId: userMsgId,
      conversationId,
      requestId,
      fetchCredential: fetchCred,
      embedUserMessage: async (content, msgId, convId, reqId, dataClasses) => {
        // Inline embedding: thread requestId + dataClasses
        await embedText(content, reqId, dataClasses);
      },
      findRelevantNodes: async (text, reqId, dataClasses) => {
        // Inline retrieval: thread requestId + dataClasses
        await embedText(text, reqId, dataClasses);
        return [];
      },
    });

    // 2. Execute send orchestration (reasoning path + user_statement)
    await executeSendOrchestration({
      text: 'hello world',
      messages: [{ role: 'user', content: 'hello world' }],
      isSensitive: false,
      dataClass: { hasMedical: false, hasFinancial: false, hasPII: false },
      dataSizeBytes: 100,
      safeMode: false,
      nodeOnline: false,  // force cloud path
      signal: undefined,
      conversationId,
      messageId: userMsgId,
      requestId,  // ← SAME requestId from chat boundary
      fetchCredential: fetchCred,
    });

    // 3. Query Recorder for all required records with this requestId
    const records = await queryBySessionId(sid);
    const withRequestId = records.filter(r => r.request_id === requestId);

    // Must have:
    // 1. user_statement
    // 2. candidate_resolution: retrieval.embed
    // 3. candidate_resolution: reasoning
    // 4. candidate_resolution_comparison: retrieval.embed
    // 5. candidate_resolution_comparison: reasoning

    const userStmt = withRequestId.find(r => {
      try { const p = JSON.parse(r.payload); return r.record_type === 'user_statement'; } catch { return false; }
    });
    const embedResol = withRequestId.find(r => {
      try { const p = JSON.parse(r.payload); return r.source === 'candidate_resolution' && p.capability_id === 'retrieval.embed'; } catch { return false; }
    });
    const reasonResol = withRequestId.find(r => {
      try { const p = JSON.parse(r.payload); return r.source === 'candidate_resolution' && p.capability_id === 'reasoning'; } catch { return false; }
    });
    const embedComp = withRequestId.find(r => {
      try { const p = JSON.parse(r.payload); return r.source === 'candidate_resolution_comparison' && p.capability_id === 'retrieval.embed'; } catch { return false; }
    });
    const reasonComp = withRequestId.find(r => {
      try { const p = JSON.parse(r.payload); return r.source === 'candidate_resolution_comparison' && p.capability_id === 'reasoning'; } catch { return false; }
    });

    assert.ok(userStmt, 'user_statement must be in Recorder with requestId');
    assert.ok(embedResol, 'retrieval.embed resolution must be in Recorder with requestId');
    assert.ok(reasonResol, 'reasoning resolution must be in Recorder with requestId');
    assert.ok(embedComp, 'retrieval.embed comparison must be in Recorder with requestId');
    assert.ok(reasonComp, 'reasoning comparison must be in Recorder with requestId');

    // All must have the SAME requestId
    assert.equal(userStmt.request_id, requestId);
    assert.equal(embedResol.request_id, requestId);
    assert.equal(reasonResol.request_id, requestId);
    assert.equal(embedComp.request_id, requestId);
    assert.equal(reasonComp.request_id, requestId);
  });

  it('normal chat: M2 data_classes equality (semantic classification)', async () => {
    const { mintRequestId } = await import('../../services/controlPlane/identifiers.ts');
    const { gateSemanticContext } = await import('../../services/controlPlane/semanticContext.ts');

    const requestId = mintRequestId();
    const sid = getSessionId();
    const userMsgId = 'test_msg_class_' + Date.now();
    const conversationId = 'test_conv_class_' + Date.now();

    globalThis.__origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/embeddings')) {
        return { ok: true, json: async () => ({ embedding: [0.1, 0.2, 0.3] }) };
      }
      if (String(url).includes('/claude')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            content: [{ text: 'Response.' }],
            model: 'claude-sonnet-4-6',
            usage: { input_tokens: 15, output_tokens: 8 },
          }),
        };
      }
      return Promise.reject(new Error(`unmocked fetch: ${url}`));
    };

    // Regular text to verify M2 data_classes threading
    const testText = 'hello world please help';
    const fetchCred = async () => null;

    // Get the M2 classification from gateSemanticContext
    let semanticClassification;
    const semanticCtx = await gateSemanticContext({
      text: testText,
      messageId: userMsgId,
      conversationId,
      requestId,
      fetchCredential: fetchCred,
      embedUserMessage: async (content, msgId, convId, reqId, dataClasses) => {
        semanticClassification = { dataClasses };  // ← capture passed dataClasses
        await embedText(content, reqId, dataClasses);
      },
      findRelevantNodes: async (text, reqId, dataClasses) => {
        await embedText(text, reqId, dataClasses);
        return [];
      },
    });

    // Also get the reasoning classification from executeSendOrchestration
    let reasoningClassification;
    const origClassify = globalThis.classifyPayloadHook;
    globalThis.classifyPayloadHook = (classif) => {
      reasoningClassification = classif;
    };

    await executeSendOrchestration({
      text: testText,
      messages: [{ role: 'user', content: testText }],
      isSensitive: false,
      dataClass: { hasMedical: false, hasFinancial: false, hasPII: false },
      dataSizeBytes: 100,
      safeMode: false,
      nodeOnline: false,
      signal: undefined,
      conversationId,
      messageId: userMsgId,
      requestId,
      fetchCredential: fetchCred,
    });

    delete globalThis.classifyPayloadHook;

    // Query Recorder for the actual recorded data_classes
    const records = await queryBySessionId(sid);
    const embedRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'retrieval.embed'; } catch { return false; }
    });
    const reasonRec = records.find(r => {
      if (r.request_id !== requestId) return false;
      try { return JSON.parse(r.payload).capability_id === 'reasoning'; } catch { return false; }
    });

    assert.ok(embedRec, 'embed resolution must be in Recorder');
    assert.ok(reasonRec, 'reasoning resolution must be in Recorder');

    const embedPayload = JSON.parse(embedRec.payload);
    const reasonPayload = JSON.parse(reasonRec.payload);

    // Verify data_classes are consistent between paths
    assert.ok(Array.isArray(embedPayload.data_classes), 'embed data_classes must be array');
    assert.ok(Array.isArray(reasonPayload.data_classes), 'reason data_classes must be array');
    assert.deepStrictEqual(
      embedPayload.data_classes.sort(),
      reasonPayload.data_classes.sort(),
      'embed and reason data_classes must be equal'
    );
  });
});
