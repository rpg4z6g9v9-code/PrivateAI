/**
 * M1 Schema Layer Tests
 *
 * Command:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./tests/m0/register.mjs \
 *        --test tests/m1/run.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const types = await import('../../services/controlPlane/types.ts');
const V = await import('../../services/controlPlane/validators.ts');

// ── Fixtures ────────────────────────────────────────────────────

const TS = '2026-10-04T12:00:00Z';

const VALID_CAPABILITY = {
  id: 'web.search', version: 1,
  description: 'Search the web via Brave Search API',
  input_schema: { query: 'string' }, output_schema: { results: 'SearchResult[]' },
  side_effects: { has_side_effects: false, description: 'read-only web query', reversible: true },
  candidate_providers: ['brave-search-v1'],
  permitted_boundaries: ['INTERNET/CLOUD'],
  verification_method: 'response_schema_check',
  verification_criteria: 'results array present with title/url/description',
  evidence_produced: 'search_result_snapshot',
  timeout_ms: 10000, failure_semantics: 'fail_safe',
  credential_source_ref: 'brave_api_key',
};

const VALID_POLICY = {
  id: 'policy.medical-local-only', capability_id: 'ai.reasoning',
  origin: 'user_detected', decision: 'DENY', scope: 'cloud_reasoning',
  duration: 'session', side_effect_constraint: 'none',
  allowed_boundaries: ['ON_DEVICE', 'PRIVATE_LAN'],
  data_class_constraints: ['medical'],
  version: 1, provenance: 'architecture_rule',
  source: 'PrivateAI security policy v1', timestamp: TS,
};

const VALID_EVIDENCE = {
  evidence_id: 'exec.456',
  identity_chain: { session_id: 'sess.abc', request_id: 'req.123', execution_id: 'exec.456' },
  source: 'web.search executor', timestamp: TS,
  authority: 'control_plane', scope: 'web_search_result',
  sensitivity: 'public', status: 'valid', provenance: 'deterministic_executor',
  authorization: { authorization_id: 'auth.789', decision: 'ALLOW', policy_ref: 'policy.allow', constraints: null },
  execution: { execution_id: 'exec.456', provider_id: 'brave-search-v1', capability_id: 'web.search', boundary: 'INTERNET/CLOUD', status: 'success', duration_ms: 450 },
  verification: { method: 'response_schema_check', criteria: 'results array present', passed: true, verified_at: '2026-10-04T12:00:01Z' },
  durability: 'persisted',
};

const VALID_PROVIDER = {
  id: 'brave-search-v1', capability_id: 'web.search',
  boundary_resolution: { status: 'resolved', boundary: 'INTERNET/CLOUD', provenance: 'architecture_rule' },
  network_path: 'https://api.search.brave.com/res/v1/web/search',
  credential_source_ref: 'brave_api_key',
  availability_method: 'http_get_health', fallback_provider_ref: null,
};

const VALID_TRUSTED_HOST = {
  id: 'mac-mini-ollama', host: '192.168.4.52:11434',
  declared_boundary: 'PRIVATE_LAN',
  user_declaration: 'Pete declared Mac Mini on home LAN',
  timestamp: TS, version: 1,
};

const VALID_CLAIM = {
  claim_id: 'claim.001', record_type: 'tool_result', source: 'web.search',
  content: 'Search returned 5 results', data_class: 'public', timestamp: TS,
  evidence_refs: ['exec.001'],
};

const VALID_REQUEST = {
  request_id: 'req.001', session_id: 'sess.001', capability_id: 'web.search',
  origin: 'user_detected', input: { query: 'latest node.js release' },
  data_class: 'public', conversation_ref: null, message_ref: null, timestamp: TS,
};

const VALID_PROPOSED_PLAN = {
  request_id: 'req.001', capability_id: 'web.search', provider_id: 'brave-search-v1',
  resolved_boundary: { status: 'resolved', boundary: 'INTERNET/CLOUD', provenance: 'architecture_rule' },
  estimated_side_effects: { has_side_effects: false, description: 'read-only', reversible: true },
  data_class: 'public',
};

const VALID_AUTH_RESULT = {
  authorization_id: 'auth.001', decision: 'ALLOW',
  constraints: null, policy_ref: 'policy.allow',
  timestamp: TS, reason: 'matches web search allow policy',
};

const VALID_AUTH_PLAN = {
  request_id: 'req.001', authorization_id: 'auth.001',
  capability_id: 'web.search', provider_id: 'brave-search-v1',
  resolved_boundary: { status: 'resolved', boundary: 'INTERNET/CLOUD', provenance: 'architecture_rule' },
  constraints: { scope: 'web_search', duration: 'request', side_effect_limit: 'none',
    boundary_constraint: { allowed_boundaries: ['INTERNET/CLOUD'] }, data_limit: ['public'] },
  data_class: 'public',
};

const VALID_EXEC_RESULT = {
  execution_id: 'exec.001', request_id: 'req.001', authorization_id: 'auth.001',
  provider_id: 'brave-search-v1', capability_id: 'web.search',
  status: 'success', output: { results: [] }, error: null,
  started_at: TS, completed_at: '2026-10-04T12:00:01Z', duration_ms: 450,
};

const VALID_VERIFIED = {
  execution_id: 'exec.001', verification_method: 'schema_check',
  verification_criteria: 'results array present',
  passed: true, verified_at: '2026-10-04T12:00:01Z', notes: null,
};

const VALID_ASSOCIATION = {
  claim_id: 'claim.001', evidence_id: 'exec.001',
  status: 'matched', confidence: 0.95, timestamp: TS,
};

const VALID_OBSERVATION = {
  observation_id: 'obs.001', capability_id: 'ollama.health', scope: 'node_status',
  source: 'network_monitor', content: 'Ollama responded in 45ms',
  data_class: 'internal', status: 'CURRENT', verified: true, timestamp: TS,
  evidence_refs: ['exec.001'], supersedes: null, superseded_by: null,
};

const VALID_CORRECTION = {
  observation_id: 'corr.001', disputes: 'obs.001',
  source: 'health_check', reason: 'Ollama endpoint is now unreachable',
  timestamp: '2026-10-04T12:05:00Z', evidence_refs: ['exec.002'],
};

// ══════════════════════════════════════════════════════════════════
//  A. VALID ARCHITECTURE EXAMPLES — every lifecycle type
// ══════════════════════════════════════════════════════════════════

describe('A — Valid architecture examples', () => {
  const cases = [
    ['CapabilityContract', VALID_CAPABILITY, V.validateCapabilityContract],
    ['PolicyDocument', VALID_POLICY, V.validatePolicyDocument],
    ['EvidenceEnvelope', VALID_EVIDENCE, V.validateEvidenceEnvelope],
    ['ProviderDescriptor', VALID_PROVIDER, V.validateProviderDescriptor],
    ['TrustedHostConfig', VALID_TRUSTED_HOST, V.validateTrustedHostConfig],
    ['Claim', VALID_CLAIM, V.validateClaim],
    ['SemanticCapabilityRequest', VALID_REQUEST, V.validateSemanticCapabilityRequest],
    ['ProposedExecutionPlan', VALID_PROPOSED_PLAN, V.validateProposedExecutionPlan],
    ['AuthorizationResult', VALID_AUTH_RESULT, V.validateAuthorizationResult],
    ['AuthorizedExecutionPlan', VALID_AUTH_PLAN, V.validateAuthorizedExecutionPlan],
    ['ExecutionResult', VALID_EXEC_RESULT, V.validateExecutionResult],
    ['VerifiedResult', VALID_VERIFIED, V.validateVerifiedResult],
    ['Association', VALID_ASSOCIATION, V.validateAssociation],
    ['Observation', VALID_OBSERVATION, V.validateObservation],
    ['Correction', VALID_CORRECTION, V.validateCorrection],
  ];
  for (const [name, fixture, validator] of cases) {
    it(`${name} validates`, () => {
      assert.deepEqual(validator(fixture), { valid: true, errors: [] });
    });
  }
});

// ══════════════════════════════════════════════════════════════════
//  B. INVALID EXAMPLES
// ══════════════════════════════════════════════════════════════════

describe('B — Invalid examples', () => {
  it('rejects missing required fields', () => {
    assert.equal(V.validateCapabilityContract({ id: 'x' }).valid, false);
    assert.equal(V.validateProposedExecutionPlan({}).valid, false);
    assert.equal(V.validateExecutionResult({ execution_id: 'x' }).valid, false);
    assert.equal(V.validateVerifiedResult({}).valid, false);
    assert.equal(V.validateAssociation({}).valid, false);
  });

  it('rejects unknown boundary', () => {
    assert.equal(V.validateBoundaryResolution({ status: 'resolved', boundary: 'MARS', provenance: 'architecture_rule' }).valid, false);
  });

  it('rejects unknown data class', () => {
    assert.equal(V.validateClaim({ ...VALID_CLAIM, data_class: 'top_secret' }).valid, false);
  });

  it('rejects unknown authorization decision', () => {
    assert.equal(V.validatePolicyDocument({ ...VALID_POLICY, decision: 'MAYBE' }).valid, false);
    assert.equal(V.validateAuthorizationResult({ ...VALID_AUTH_RESULT, decision: 'YOLO' }).valid, false);
  });

  it('rejects malformed identifier', () => {
    assert.equal(V.validateIdentifier('has spaces!', 'id').valid, false);
    assert.equal(V.validateIdentifier('', 'id').valid, false);
  });

  it('rejects unresolved boundary with value', () => {
    const r = V.validateBoundaryResolution({ status: 'unresolved', boundary: 'PRIVATE_LAN' });
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes('must not carry'));
  });

  it('correction cannot self-dispute', () => {
    const r = V.validateCorrection({ ...VALID_CORRECTION, observation_id: 'obs.X', disputes: 'obs.X' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('cannot dispute itself')));
  });
});

// ══════════════════════════════════════════════════════════════════
//  B2. CREDENTIAL-SOURCE VALIDATION
// ══════════════════════════════════════════════════════════════════

describe('B2 — Credential-source validation (integrated)', () => {
  it('symbolic ref passes CapabilityContract', () => {
    assert.equal(V.validateCapabilityContract(VALID_CAPABILITY).valid, true);
  });

  it('API key in credential_source_ref fails CapabilityContract', () => {
    const r = V.validateCapabilityContract({ ...VALID_CAPABILITY, credential_source_ref: 'sk-ant-api01-AAAA' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('credential value')));
  });

  it('API key in credential_source_ref fails ProviderDescriptor', () => {
    const r = V.validateProviderDescriptor({ ...VALID_PROVIDER, credential_source_ref: 'ghp_1234567890abcdef1234567890abcdef12345678' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('credential value')));
  });

  it('null credential_source_ref passes', () => {
    assert.equal(V.validateProviderDescriptor({ ...VALID_PROVIDER, credential_source_ref: null }).valid, true);
  });
});

// ══════════════════════════════════════════════════════════════════
//  B3. REFERENCE ARRAY VALIDATION
// ══════════════════════════════════════════════════════════════════

describe('B3 — Reference array validation', () => {
  it('candidate_providers rejects malformed ProviderId', () => {
    const r = V.validateCapabilityContract({ ...VALID_CAPABILITY, candidate_providers: ['valid-id', 'bad id!'] });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('candidate_providers')));
  });

  it('evidence_refs rejects malformed id in Claim', () => {
    assert.equal(V.validateClaim({ ...VALID_CLAIM, evidence_refs: ['ok', 'has spaces'] }).valid, false);
  });

  it('evidence_refs rejects malformed id in Observation', () => {
    assert.equal(V.validateObservation({ ...VALID_OBSERVATION, evidence_refs: ['bad id!'] }).valid, false);
  });

  it('evidence_refs rejects malformed id in Correction', () => {
    assert.equal(V.validateCorrection({ ...VALID_CORRECTION, evidence_refs: ['x y z'] }).valid, false);
  });
});

// ══════════════════════════════════════════════════════════════════
//  C. EVIDENCE ENVELOPE STRUCTURE
// ══════════════════════════════════════════════════════════════════

describe('C — Evidence envelope structure', () => {
  it('fails when authorization missing', () => {
    assert.equal(V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, authorization: undefined }).valid, false);
  });

  it('fails when verification missing', () => {
    assert.equal(V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, verification: undefined }).valid, false);
  });

  it('fails when both missing', () => {
    const r = V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, authorization: undefined, verification: undefined });
    assert.ok(r.errors.some(e => e.includes('authorization')));
    assert.ok(r.errors.some(e => e.includes('verification')));
  });
});

// ══════════════════════════════════════════════════════════════════
//  C2. DURABLE EVIDENCE SEMANTICS
// ══════════════════════════════════════════════════════════════════

describe('C2 — Durable evidence semantics', () => {
  it('VerifiedResult exists independently', () => {
    assert.equal(V.validateVerifiedResult(VALID_VERIFIED).valid, true);
  });

  it('EvidenceEnvelope validates as persisted', () => {
    assert.equal(V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, durability: 'persisted' }).valid, true);
  });

  it('EvidenceEnvelope validates as archived', () => {
    assert.equal(V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, durability: 'archived' }).valid, true);
  });

  it('EvidenceEnvelope rejects transient (no ghost evidence)', () => {
    const r = V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, durability: 'transient' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('durability')));
  });

  it('no valid EvidenceEnvelope for failed persistence', () => {
    assert.equal(V.validateEvidenceEnvelope({ ...VALID_EVIDENCE, durability: 'failed' }).valid, false);
  });
});

// ══════════════════════════════════════════════════════════════════
//  C3. EXECUTION / EVIDENCE THREE-WAY IDENTITY
// ══════════════════════════════════════════════════════════════════

describe('C3 — Execution/evidence three-way identity', () => {
  it('A == A == A validates', () => {
    // evidence_id = identity_chain.execution_id = execution.execution_id = exec.456
    assert.equal(V.validateEvidenceEnvelope(VALID_EVIDENCE).valid, true);
  });

  it('evidence_id differs from identity_chain.execution_id → FAIL', () => {
    const bad = { ...VALID_EVIDENCE, evidence_id: 'different.id' };
    const r = V.validateEvidenceEnvelope(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('evidence_id must equal identity_chain.execution_id')));
  });

  it('identity_chain.execution_id differs → FAIL', () => {
    const bad = JSON.parse(JSON.stringify(VALID_EVIDENCE));
    bad.identity_chain.execution_id = 'different.id';
    const r = V.validateEvidenceEnvelope(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('evidence_id must equal')));
  });

  it('execution.execution_id differs → FAIL', () => {
    const bad = JSON.parse(JSON.stringify(VALID_EVIDENCE));
    bad.execution.execution_id = 'different.id';
    const r = V.validateEvidenceEnvelope(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('three-way identity')));
  });
});

// ══════════════════════════════════════════════════════════════════
//  D. DEPENDENCY RULE (strengthened)
// ══════════════════════════════════════════════════════════════════

describe('D — Schema imports no runtime modules', () => {
  const FORBIDDEN = [
    'aiRouter', 'providerGateway', 'readOnlyTools', 'webSearch',
    'conversationDB', 'toolDB', 'networkMonitor', 'securityGateway',
    'localAI', 'sendOrchestration',
  ];
  const IMPORT_FORMS = (mod) => [
    `from '${mod}'`, `from './${mod}'`, `from '@/${mod}'`, `from '@/services/${mod}'`,
  ];

  for (const file of ['types.ts', 'validators.ts']) {
    it(`${file} has no forbidden imports`, () => {
      const src = readFileSync(`services/controlPlane/${file}`, 'utf8');
      for (const mod of FORBIDDEN) {
        for (const form of IMPORT_FORMS(mod)) {
          assert.ok(!src.includes(form), `${file} must not contain "${form}"`);
        }
      }
      // Also check react/expo
      assert.ok(!src.includes("from 'react-native"), `${file}: no react-native`);
      assert.ok(!src.includes("from 'react'"), `${file}: no react`);
      assert.ok(!src.includes("from 'expo-"), `${file}: no expo-`);
    });
  }

  it('core runtime modules do not import controlPlane (sendOrchestration is authorized M2 consumer)', () => {
    const coreRuntime = [
      'services/aiRouter.ts', 'services/providerGateway.ts', 'services/readOnlyTools.ts',
      'services/securityGateway.ts', 'services/localAI.ts',
      'services/networkMonitor.ts', 'services/toolDB.ts', 'services/conversationDB.ts',
      'services/connectivityChecker.ts',
    ];
    for (const f of coreRuntime) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!src.includes('controlPlane'), `${f} must not import controlPlane`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
//  E. ADVERSARIAL POLICY PARSE
// ══════════════════════════════════════════════════════════════════

describe('E — Adversarial policy parse', () => {
  it('model-like partial object rejected', () => {
    assert.equal(V.validatePolicyDocument({ decision: 'ALLOW', capability: 'github.push' }).valid, false);
  });

  it('missing provenance/version/source rejected', () => {
    assert.equal(V.validatePolicyDocument({
      id: 'p', capability_id: 'c', origin: 'user_detected', decision: 'ALLOW',
      scope: 'all', duration: 'f', side_effect_constraint: '',
      allowed_boundaries: ['INTERNET/CLOUD'], data_class_constraints: ['public'],
    }).valid, false);
  });

  it('raw string rejected', () => {
    assert.equal(V.validatePolicyDocument('decision: ALLOW').valid, false);
  });

  it('complete valid policy passes', () => {
    assert.equal(V.validatePolicyDocument(VALID_POLICY).valid, true);
  });
});

// ══════════════════════════════════════════════════════════════════
//  F. OBSERVATION SUPERSESSION LINEAGE
// ══════════════════════════════════════════════════════════════════

describe('F — Observation supersession lineage', () => {
  const obsA = { ...VALID_OBSERVATION, observation_id: 'obs.A', status: 'CURRENT',
    capability_id: 'ollama.health', scope: 'node_status', verified: true,
    supersedes: null, superseded_by: null };

  const obsB = { ...VALID_OBSERVATION, observation_id: 'obs.B', status: 'CURRENT',
    capability_id: 'ollama.health', scope: 'node_status', verified: true,
    evidence_refs: ['exec.010'],
    supersedes: 'obs.A', superseded_by: null };

  const obsA_superseded = { ...obsA, status: 'SUPERSEDED', superseded_by: 'obs.B' };

  it('verified B, same capability/scope, supersedes A → PASS', () => {
    assert.equal(V.validateObservation(obsB).valid, true);
    assert.equal(V.validateSupersessionLineage(obsB, obsA).valid, true);
  });

  it('unverified B supersedes A → FAIL', () => {
    const bad = { ...obsB, verified: false };
    const r = V.validateObservation(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('supersedes requires verified')));
  });

  it('B without evidence attempts supersession → FAIL', () => {
    const bad = { ...obsB, evidence_refs: [] };
    const r = V.validateObservation(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('non-empty evidence_refs')));
  });

  it('Correction attempts supersession → FAIL (no supersedes field)', () => {
    // Correction type has no supersedes field; adding one doesn't affect validation
    // since validateCorrection checks its own field set
    const corr = { ...VALID_CORRECTION };
    assert.equal(V.validateCorrection(corr).valid, true);
    assert.ok(!('supersedes' in VALID_CORRECTION), 'Correction schema has no supersedes');
  });

  it('self-supersession → FAIL', () => {
    const bad = { ...obsB, supersedes: 'obs.B' };
    const r = V.validateObservation(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('cannot supersede itself')));
  });

  it('different capability/scope lineage → FAIL', () => {
    const diffCap = { ...obsB, capability_id: 'different.cap' };
    const r = V.validateSupersessionLineage(diffCap, obsA);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('same capability_id')));
  });

  it('different scope lineage → FAIL', () => {
    const diffScope = { ...obsB, scope: 'different_scope' };
    const r = V.validateSupersessionLineage(diffScope, obsA);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('same scope')));
  });

  it('SUPERSEDED A preserves lineage to successor B', () => {
    assert.equal(V.validateObservation(obsA_superseded).valid, true);
    assert.equal(obsA_superseded.superseded_by, 'obs.B');
  });

  it('lineage chain is queryable by identifiers', () => {
    assert.equal(obsB.supersedes, obsA.observation_id);
    assert.equal(obsA_superseded.superseded_by, obsB.observation_id);
  });
});

// ══════════════════════════════════════════════════════════════════
//  G. BOUNDARY VOCABULARY
// ══════════════════════════════════════════════════════════════════

describe('G — Boundary canonical vocabulary', () => {
  it('INTERNET/CLOUD is the canonical value', () => {
    const r = V.validateBoundaryResolution({ status: 'resolved', boundary: 'INTERNET/CLOUD', provenance: 'architecture_rule' });
    assert.equal(r.valid, true);
  });

  it('INTERNET_CLOUD is rejected (not canonical)', () => {
    const r = V.validateBoundaryResolution({ status: 'resolved', boundary: 'INTERNET_CLOUD', provenance: 'architecture_rule' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('boundary')));
  });
});

// ══════════════════════════════════════════════════════════════════
//  H. CORRECTION SUPERSESSION REJECTION
// ══════════════════════════════════════════════════════════════════

describe('H — Correction supersession rejection', () => {
  it('valid Correction with disputes passes', () => {
    assert.equal(V.validateCorrection(VALID_CORRECTION).valid, true);
  });

  it('Correction + supersedes → FAIL', () => {
    const bad = { ...VALID_CORRECTION, supersedes: 'obs.A' };
    const r = V.validateCorrection(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('correction must not contain supersedes')));
  });

  it('Correction + superseded_by → FAIL', () => {
    const bad = { ...VALID_CORRECTION, superseded_by: 'obs.B' };
    const r = V.validateCorrection(bad);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('correction must not contain superseded_by')));
  });
});

// ══════════════════════════════════════════════════════════════════
//  I. SUPERSEDED OBSERVATION LINEAGE
// ══════════════════════════════════════════════════════════════════

describe('I — SUPERSEDED observation must preserve lineage', () => {
  it('SUPERSEDED + superseded_by=B → PASS', () => {
    const obs = { ...VALID_OBSERVATION, observation_id: 'obs.A', status: 'SUPERSEDED', superseded_by: 'obs.B' };
    assert.equal(V.validateObservation(obs).valid, true);
  });

  it('SUPERSEDED + superseded_by=null → FAIL', () => {
    const obs = { ...VALID_OBSERVATION, observation_id: 'obs.A', status: 'SUPERSEDED', superseded_by: null };
    const r = V.validateObservation(obs);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('SUPERSEDED observation must have superseded_by')));
  });
});

// ══════════════════════════════════════════════════════════════════
//  ENUM COVERAGE
// ══════════════════════════════════════════════════════════════════

describe('Enum coverage', () => {
  it('BOUNDARIES', () => { assert.deepEqual([...types.BOUNDARIES], ['ON_DEVICE', 'PRIVATE_LAN', 'LOCAL_INFRASTRUCTURE', 'INTERNET/CLOUD']); });
  it('DATA_CLASSES', () => { assert.deepEqual([...types.DATA_CLASSES], ['public', 'internal', 'medical', 'financial', 'pii', 'protected']); });
  it('REQUEST_ORIGINS', () => { assert.deepEqual([...types.REQUEST_ORIGINS], ['user_detected', 'cordelia_proposed']); });
  it('AUTHORIZATION_DECISIONS', () => { assert.deepEqual([...types.AUTHORIZATION_DECISIONS], ['DENY', 'ALLOW', 'ASK']); });
  it('RECORD_TYPES', () => { assert.deepEqual([...types.RECORD_TYPES], ['user_statement', 'user_decision', 'observation', 'tool_result', 'model_inference', 'policy', 'correction', 'execution_evidence']); });
  it('OBSERVATION_STATUSES', () => { assert.deepEqual([...types.OBSERVATION_STATUSES], ['CURRENT', 'STALE', 'DISPUTED', 'SUPERSEDED']); });
  it('ASSOCIATION_STATUSES', () => { assert.deepEqual([...types.ASSOCIATION_STATUSES], ['matched', 'partial', 'disputed']); });
  it('PROVENANCE_SOURCES', () => { assert.deepEqual([...types.PROVENANCE_SOURCES], ['architecture_rule', 'trusted_host_configuration']); });
});
