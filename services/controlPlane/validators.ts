/**
 * Control Plane V1 — Validators (M1)
 *
 * Runtime validation for Control Plane schema types.
 * No external dependencies. No production runtime imports.
 *
 * Known M1 property: validators accept unknown extra fields (open schema).
 * Extra fields cannot override or substitute required security fields.
 */

import {
  BOUNDARIES, DATA_CLASSES, REQUEST_ORIGINS, AUTHORIZATION_DECISIONS,
  RECORD_TYPES, OBSERVATION_STATUSES, ASSOCIATION_STATUSES, PROVENANCE_SOURCES,
} from './types';

// ── Helpers ─────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult { return { valid: true, errors: [] }; }
function fail(...errors: string[]): ValidationResult { return { valid: false, errors }; }
function collect(results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap(r => r.errors);
  return errors.length ? fail(...errors) : ok();
}

function isNonEmptyString(v: unknown, field: string): ValidationResult {
  return typeof v === 'string' && v.length > 0 ? ok() : fail(`${field}: must be a non-empty string`);
}

function isString(v: unknown, field: string): ValidationResult {
  return typeof v === 'string' ? ok() : fail(`${field}: must be a string`);
}

function isNumber(v: unknown, field: string): ValidationResult {
  return typeof v === 'number' && !Number.isNaN(v) ? ok() : fail(`${field}: must be a number`);
}

function isBoolean(v: unknown, field: string): ValidationResult {
  return typeof v === 'boolean' ? ok() : fail(`${field}: must be a boolean`);
}

function isObject(v: unknown, field: string): ValidationResult {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? ok() : fail(`${field}: must be an object`);
}

function isOneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): ValidationResult {
  return (allowed as readonly string[]).includes(v as string) ? ok() : fail(`${field}: must be one of [${allowed.join(', ')}], got "${String(v)}"`);
}

function isArrayOf<T extends string>(v: unknown, allowed: readonly T[], field: string): ValidationResult {
  if (!Array.isArray(v)) return fail(`${field}: must be an array`);
  const bad = v.filter(x => !(allowed as readonly string[]).includes(x));
  return bad.length ? fail(`${field}: unknown values [${bad.join(', ')}]`) : ok();
}

function isISO8601(v: unknown, field: string): ValidationResult {
  if (typeof v !== 'string') return fail(`${field}: must be a string`);
  if (Number.isNaN(Date.parse(v))) return fail(`${field}: must be a valid ISO 8601 timestamp`);
  return ok();
}

function hasFields(obj: unknown, fields: string[], context: string): ValidationResult {
  if (!obj || typeof obj !== 'object') return fail(`${context}: must be an object`);
  const missing = fields.filter(f => !(f in (obj as Record<string, unknown>)));
  return missing.length ? fail(`${context}: missing required fields [${missing.join(', ')}]`) : ok();
}

function isNullOr(v: unknown, check: (v: unknown, f: string) => ValidationResult, field: string): ValidationResult {
  if (v === null) return ok();
  return check(v, field);
}

// ── Identifier Validation ───────────────────────────────────────

const ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export function validateIdentifier(v: unknown, field: string): ValidationResult {
  if (typeof v !== 'string' || v.length === 0) return fail(`${field}: must be a non-empty string`);
  if (!ID_PATTERN.test(v)) return fail(`${field}: contains invalid characters`);
  return ok();
}

function validateIdArray(v: unknown, field: string): ValidationResult {
  if (!Array.isArray(v)) return fail(`${field}: must be an array`);
  return collect(v.map((el, i) => validateIdentifier(el, `${field}[${i}]`)));
}

// ── Credential-value guard ──────────────────────────────────────

const CREDENTIAL_PATTERNS = [
  /^sk-/, /^sk_/, /^tvly-/, /^BSA-/,
  /^ghp_/, /^gho_/, /^github_pat_/,
  /^[A-Za-z0-9+/]{40,}={0,2}$/,
];

export function looksLikeCredentialValue(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return CREDENTIAL_PATTERNS.some(p => p.test(v));
}

function validateCredentialRef(v: unknown, field: string): ValidationResult {
  if (v === null) return ok();
  if (typeof v !== 'string') return fail(`${field}: must be a string or null`);
  if (looksLikeCredentialValue(v)) return fail(`${field}: appears to contain a credential value, not a reference`);
  return ok();
}

export function validateNoCredentialValues(obj: unknown, path = ''): ValidationResult {
  if (typeof obj === 'string') {
    if (looksLikeCredentialValue(obj)) return fail(`${path}: appears to contain a credential value`);
    return ok();
  }
  if (Array.isArray(obj)) {
    return collect(obj.map((item, i) => validateNoCredentialValues(item, `${path}[${i}]`)));
  }
  if (obj && typeof obj === 'object') {
    return collect(Object.entries(obj as Record<string, unknown>).map(
      ([k, v]) => validateNoCredentialValues(v, path ? `${path}.${k}` : k)
    ));
  }
  return ok();
}

// ── Boundary Resolution ─────────────────────────────────────────

export function validateBoundaryResolution(v: unknown, field: string): ValidationResult {
  const f = hasFields(v, ['status'], field);
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  if (obj.status === 'unresolved') {
    if ('boundary' in obj) return fail(`${field}: unresolved boundary must not carry a boundary value`);
    return ok();
  }
  if (obj.status === 'resolved') {
    return collect([
      isOneOf(obj.boundary, BOUNDARIES, `${field}.boundary`),
      isOneOf(obj.provenance, PROVENANCE_SOURCES, `${field}.provenance`),
    ]);
  }
  return fail(`${field}.status: must be 'resolved' or 'unresolved'`);
}

// ── Side Effect Classification ──────────────────────────────────

export function validateSideEffects(v: unknown, field: string): ValidationResult {
  const f = hasFields(v, ['has_side_effects', 'description', 'reversible'], field);
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    isBoolean(obj.has_side_effects, `${field}.has_side_effects`),
    isString(obj.description, `${field}.description`),
    isBoolean(obj.reversible, `${field}.reversible`),
  ]);
}

// ── Authorization Constraints ───────────────────────────────────

export function validateConstraints(v: unknown, field: string): ValidationResult {
  const f = hasFields(v, ['scope', 'duration', 'side_effect_limit', 'boundary_constraint', 'data_limit'], field);
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  const results = [
    isString(obj.scope, `${field}.scope`),
    isString(obj.duration, `${field}.duration`),
    isString(obj.side_effect_limit, `${field}.side_effect_limit`),
    isArrayOf(obj.data_limit, DATA_CLASSES, `${field}.data_limit`),
  ];
  const bc = obj.boundary_constraint;
  if (!bc || typeof bc !== 'object') {
    results.push(fail(`${field}.boundary_constraint: must be an object`));
  } else {
    results.push(isArrayOf((bc as Record<string, unknown>).allowed_boundaries, BOUNDARIES, `${field}.boundary_constraint.allowed_boundaries`));
  }
  return collect(results);
}

// ── 6. Capability Contract ──────────────────────────────────────

export function validateCapabilityContract(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'id', 'version', 'description', 'input_schema', 'output_schema',
    'side_effects', 'candidate_providers', 'permitted_boundaries',
    'verification_method', 'verification_criteria', 'evidence_produced',
    'timeout_ms', 'failure_semantics', 'credential_source_ref',
  ], 'CapabilityContract');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.id, 'id'),
    isNumber(obj.version, 'version'),
    isNonEmptyString(obj.description, 'description'),
    isObject(obj.input_schema, 'input_schema'),
    isObject(obj.output_schema, 'output_schema'),
    validateSideEffects(obj.side_effects, 'side_effects'),
    validateIdArray(obj.candidate_providers, 'candidate_providers'),
    isArrayOf(obj.permitted_boundaries, BOUNDARIES, 'permitted_boundaries'),
    isNonEmptyString(obj.verification_method, 'verification_method'),
    isNonEmptyString(obj.verification_criteria, 'verification_criteria'),
    isNonEmptyString(obj.evidence_produced, 'evidence_produced'),
    isNumber(obj.timeout_ms, 'timeout_ms'),
    isOneOf(obj.failure_semantics, ['fail_safe', 'fail_open', 'retry'] as const, 'failure_semantics'),
    validateCredentialRef(obj.credential_source_ref, 'credential_source_ref'),
  ]);
}

// ── 7. Provider Descriptor ──────────────────────────────────────

export function validateProviderDescriptor(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'id', 'capability_id', 'boundary_resolution', 'network_path',
    'credential_source_ref', 'availability_method', 'fallback_provider_ref',
  ], 'ProviderDescriptor');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.id, 'id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    validateBoundaryResolution(obj.boundary_resolution, 'boundary_resolution'),
    isNonEmptyString(obj.network_path, 'network_path'),
    validateCredentialRef(obj.credential_source_ref, 'credential_source_ref'),
    isNonEmptyString(obj.availability_method, 'availability_method'),
    isNullOr(obj.fallback_provider_ref, validateIdentifier, 'fallback_provider_ref'),
  ]);
}

// ── 8. Semantic Capability Request ──────────────────────────────

export function validateSemanticCapabilityRequest(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'request_id', 'session_id', 'capability_id', 'origin', 'input',
    'data_class', 'timestamp',
  ], 'SemanticCapabilityRequest');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.request_id, 'request_id'),
    validateIdentifier(obj.session_id, 'session_id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    isOneOf(obj.origin, REQUEST_ORIGINS, 'origin'),
    isObject(obj.input, 'input'),
    isOneOf(obj.data_class, DATA_CLASSES, 'data_class'),
    isISO8601(obj.timestamp, 'timestamp'),
  ]);
}

// ── Proposed Execution Plan ─────────────────────────────────────

export function validateProposedExecutionPlan(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'request_id', 'capability_id', 'provider_id', 'resolved_boundary',
    'estimated_side_effects', 'data_class',
  ], 'ProposedExecutionPlan');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.request_id, 'request_id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    validateIdentifier(obj.provider_id, 'provider_id'),
    validateBoundaryResolution(obj.resolved_boundary, 'resolved_boundary'),
    validateSideEffects(obj.estimated_side_effects, 'estimated_side_effects'),
    isOneOf(obj.data_class, DATA_CLASSES, 'data_class'),
  ]);
}

// ── Authorization Result ────────────────────────────────────────

export function validateAuthorizationResult(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'authorization_id', 'decision', 'timestamp', 'reason',
  ], 'AuthorizationResult');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  const results = [
    validateIdentifier(obj.authorization_id, 'authorization_id'),
    isOneOf(obj.decision, AUTHORIZATION_DECISIONS, 'decision'),
    isISO8601(obj.timestamp, 'timestamp'),
    isString(obj.reason, 'reason'),
  ];
  if (obj.constraints !== null && obj.constraints !== undefined) {
    results.push(validateConstraints(obj.constraints, 'constraints'));
  }
  return collect(results);
}

// ── Authorized Execution Plan ───────────────────────────────────

export function validateAuthorizedExecutionPlan(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'request_id', 'authorization_id', 'capability_id', 'provider_id',
    'resolved_boundary', 'constraints', 'data_class',
  ], 'AuthorizedExecutionPlan');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.request_id, 'request_id'),
    validateIdentifier(obj.authorization_id, 'authorization_id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    validateIdentifier(obj.provider_id, 'provider_id'),
    validateBoundaryResolution(obj.resolved_boundary, 'resolved_boundary'),
    validateConstraints(obj.constraints, 'constraints'),
    isOneOf(obj.data_class, DATA_CLASSES, 'data_class'),
  ]);
}

// ── Execution Result ────────────────────────────────────────────

export function validateExecutionResult(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'execution_id', 'request_id', 'authorization_id', 'provider_id',
    'capability_id', 'status', 'output', 'error', 'started_at',
    'completed_at', 'duration_ms',
  ], 'ExecutionResult');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.execution_id, 'execution_id'),
    validateIdentifier(obj.request_id, 'request_id'),
    validateIdentifier(obj.authorization_id, 'authorization_id'),
    validateIdentifier(obj.provider_id, 'provider_id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    isOneOf(obj.status, ['success', 'failure', 'timeout', 'cancelled'] as const, 'status'),
    isISO8601(obj.started_at, 'started_at'),
    isISO8601(obj.completed_at, 'completed_at'),
    isNumber(obj.duration_ms, 'duration_ms'),
  ]);
}

// ── Verified Result ─────────────────────────────────────────────

export function validateVerifiedResult(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'execution_id', 'verification_method', 'verification_criteria',
    'passed', 'verified_at',
  ], 'VerifiedResult');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.execution_id, 'execution_id'),
    isNonEmptyString(obj.verification_method, 'verification_method'),
    isNonEmptyString(obj.verification_criteria, 'verification_criteria'),
    isBoolean(obj.passed, 'passed'),
    isISO8601(obj.verified_at, 'verified_at'),
  ]);
}

// ── 9. Evidence Envelope ────────────────────────────────────────

export function validateEvidenceEnvelope(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'evidence_id', 'identity_chain', 'source', 'timestamp', 'authority',
    'scope', 'sensitivity', 'status', 'provenance',
    'authorization', 'execution', 'verification', 'durability',
  ], 'EvidenceEnvelope');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;

  const results: ValidationResult[] = [
    validateIdentifier(obj.evidence_id, 'evidence_id'),
    isNonEmptyString(obj.source, 'source'),
    isISO8601(obj.timestamp, 'timestamp'),
    isNonEmptyString(obj.authority, 'authority'),
    isNonEmptyString(obj.scope, 'scope'),
    isOneOf(obj.sensitivity, DATA_CLASSES, 'sensitivity'),
    isOneOf(obj.status, ['valid', 'disputed', 'superseded'] as const, 'status'),
    isNonEmptyString(obj.provenance, 'provenance'),
    isOneOf(obj.durability, ['persisted', 'archived'] as const, 'durability'),
  ];

  // identity_chain
  const ic = obj.identity_chain;
  if (!ic || typeof ic !== 'object') {
    results.push(fail('identity_chain: must be an object'));
  } else {
    const chain = ic as Record<string, unknown>;
    results.push(
      validateIdentifier(chain.session_id, 'identity_chain.session_id'),
      validateIdentifier(chain.request_id, 'identity_chain.request_id'),
      validateIdentifier(chain.execution_id, 'identity_chain.execution_id'),
    );
    // Execution/evidence identity: evidence_id must equal identity_chain.execution_id
    if (typeof obj.evidence_id === 'string' && typeof chain.execution_id === 'string' &&
        obj.evidence_id !== chain.execution_id) {
      results.push(fail('evidence_id must equal identity_chain.execution_id (execution = evidence identity)'));
    }
  }

  // Three-way identity: execution.execution_id must also match evidence_id
  const exec2 = obj.execution;
  if (exec2 && typeof exec2 === 'object') {
    const eid = (exec2 as Record<string, unknown>).execution_id;
    if (typeof obj.evidence_id === 'string' && typeof eid === 'string' && obj.evidence_id !== eid) {
      results.push(fail('execution.execution_id must equal evidence_id (three-way identity)'));
    }
  }

  // authorization section — REQUIRED
  const auth = obj.authorization;
  if (!auth || typeof auth !== 'object') {
    results.push(fail('authorization: required section missing'));
  } else {
    const a = auth as Record<string, unknown>;
    results.push(
      validateIdentifier(a.authorization_id, 'authorization.authorization_id'),
      isOneOf(a.decision, AUTHORIZATION_DECISIONS, 'authorization.decision'),
    );
  }

  // execution section — REQUIRED
  const exec = obj.execution;
  if (!exec || typeof exec !== 'object') {
    results.push(fail('execution: required section missing'));
  } else {
    const e = exec as Record<string, unknown>;
    results.push(
      validateIdentifier(e.execution_id, 'execution.execution_id'),
      validateIdentifier(e.provider_id, 'execution.provider_id'),
      validateIdentifier(e.capability_id, 'execution.capability_id'),
      isOneOf(e.boundary, BOUNDARIES, 'execution.boundary'),
      isOneOf(e.status, ['success', 'failure', 'timeout', 'cancelled'] as const, 'execution.status'),
      isNumber(e.duration_ms, 'execution.duration_ms'),
    );
  }

  // verification section — REQUIRED
  const ver = obj.verification;
  if (!ver || typeof ver !== 'object') {
    results.push(fail('verification: required section missing'));
  } else {
    const vr = ver as Record<string, unknown>;
    results.push(
      isNonEmptyString(vr.method, 'verification.method'),
      isNonEmptyString(vr.criteria, 'verification.criteria'),
      isBoolean(vr.passed, 'verification.passed'),
      isISO8601(vr.verified_at, 'verification.verified_at'),
    );
  }

  return collect(results);
}

// ── 10. Claim ───────────────────────────────────────────────────

export function validateClaim(v: unknown): ValidationResult {
  const f = hasFields(v, ['claim_id', 'record_type', 'source', 'content', 'data_class', 'timestamp', 'evidence_refs'], 'Claim');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.claim_id, 'claim_id'),
    isOneOf(obj.record_type, RECORD_TYPES, 'record_type'),
    isNonEmptyString(obj.source, 'source'),
    isString(obj.content, 'content'),
    isOneOf(obj.data_class, DATA_CLASSES, 'data_class'),
    isISO8601(obj.timestamp, 'timestamp'),
    validateIdArray(obj.evidence_refs, 'evidence_refs'),
  ]);
}

// ── Association ─────────────────────────────────────────────────

export function validateAssociation(v: unknown): ValidationResult {
  const f = hasFields(v, ['claim_id', 'evidence_id', 'status', 'confidence', 'timestamp'], 'Association');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.claim_id, 'claim_id'),
    validateIdentifier(obj.evidence_id, 'evidence_id'),
    isOneOf(obj.status, ASSOCIATION_STATUSES, 'status'),
    isNumber(obj.confidence, 'confidence'),
    isISO8601(obj.timestamp, 'timestamp'),
  ]);
}

// ── 11. Observation ─────────────────────────────────────────────

export function validateObservation(v: unknown): ValidationResult {
  const f = hasFields(v, ['observation_id', 'capability_id', 'scope', 'source', 'content', 'data_class', 'status', 'verified', 'timestamp', 'evidence_refs', 'supersedes', 'superseded_by'], 'Observation');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  const results = [
    validateIdentifier(obj.observation_id, 'observation_id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    isNonEmptyString(obj.scope, 'scope'),
    isNonEmptyString(obj.source, 'source'),
    isString(obj.content, 'content'),
    isOneOf(obj.data_class, DATA_CLASSES, 'data_class'),
    isOneOf(obj.status, OBSERVATION_STATUSES, 'status'),
    isBoolean(obj.verified, 'verified'),
    isISO8601(obj.timestamp, 'timestamp'),
    validateIdArray(obj.evidence_refs, 'evidence_refs'),
    isNullOr(obj.supersedes, validateIdentifier, 'supersedes'),
    isNullOr(obj.superseded_by, validateIdentifier, 'superseded_by'),
  ];
  // supersedes requires verified=true and evidence
  if (obj.supersedes !== null && obj.supersedes !== undefined) {
    if (obj.verified !== true) {
      results.push(fail('supersedes requires verified=true'));
    }
    if (!Array.isArray(obj.evidence_refs) || (obj.evidence_refs as unknown[]).length === 0) {
      results.push(fail('supersedes requires non-empty evidence_refs'));
    }
    // self-supersession
    if (obj.supersedes === obj.observation_id) {
      results.push(fail('observation cannot supersede itself'));
    }
  }
  // self-reference in superseded_by
  if (obj.superseded_by !== null && obj.superseded_by === obj.observation_id) {
    results.push(fail('superseded_by cannot reference self'));
  }
  // SUPERSEDED status requires superseded_by to preserve lineage
  if (obj.status === 'SUPERSEDED' && (obj.superseded_by === null || obj.superseded_by === undefined)) {
    results.push(fail('SUPERSEDED observation must have superseded_by to preserve lineage'));
  }
  return collect(results);
}

/**
 * Validate that observation B correctly supersedes observation A.
 * Pure lineage check — same capability_id and scope required.
 */
export function validateSupersessionLineage(
  superseding: Record<string, unknown>,
  superseded: Record<string, unknown>,
): ValidationResult {
  const results: ValidationResult[] = [];
  if (superseding.capability_id !== superseded.capability_id) {
    results.push(fail('supersession requires same capability_id'));
  }
  if (superseding.scope !== superseded.scope) {
    results.push(fail('supersession requires same scope'));
  }
  if (superseding.verified !== true) {
    results.push(fail('superseding observation must be verified'));
  }
  if (superseding.supersedes !== superseded.observation_id) {
    results.push(fail('superseding.supersedes must reference superseded.observation_id'));
  }
  return collect(results);
}

// ── 12. Correction ──────────────────────────────────────────────

export function validateCorrection(v: unknown): ValidationResult {
  const f = hasFields(v, ['observation_id', 'disputes', 'source', 'reason', 'timestamp', 'evidence_refs'], 'Correction');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  const results = [
    validateIdentifier(obj.observation_id, 'observation_id'),
    validateIdentifier(obj.disputes, 'disputes'),
    isNonEmptyString(obj.source, 'source'),
    isNonEmptyString(obj.reason, 'reason'),
    isISO8601(obj.timestamp, 'timestamp'),
    validateIdArray(obj.evidence_refs, 'evidence_refs'),
  ];
  if (obj.observation_id === obj.disputes) {
    results.push(fail('correction cannot dispute itself'));
  }
  // Correction must never carry supersession semantics
  if ('supersedes' in obj) {
    results.push(fail('correction must not contain supersedes (corrections dispute, never supersede)'));
  }
  if ('superseded_by' in obj) {
    results.push(fail('correction must not contain superseded_by (corrections dispute, never supersede)'));
  }
  return collect(results);
}

// ── 13. Policy Document ─────────────────────────────────────────

export function validatePolicyDocument(v: unknown): ValidationResult {
  const f = hasFields(v, [
    'id', 'capability_id', 'origin', 'decision', 'scope', 'duration',
    'side_effect_constraint', 'allowed_boundaries', 'data_class_constraints',
    'version', 'provenance', 'source', 'timestamp',
  ], 'PolicyDocument');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.id, 'id'),
    validateIdentifier(obj.capability_id, 'capability_id'),
    isOneOf(obj.origin, REQUEST_ORIGINS, 'origin'),
    isOneOf(obj.decision, AUTHORIZATION_DECISIONS, 'decision'),
    isNonEmptyString(obj.scope, 'scope'),
    isNonEmptyString(obj.duration, 'duration'),
    isString(obj.side_effect_constraint, 'side_effect_constraint'),
    isArrayOf(obj.allowed_boundaries, BOUNDARIES, 'allowed_boundaries'),
    isArrayOf(obj.data_class_constraints, DATA_CLASSES, 'data_class_constraints'),
    isNumber(obj.version, 'version'),
    isNonEmptyString(obj.provenance, 'provenance'),
    isNonEmptyString(obj.source, 'source'),
    isISO8601(obj.timestamp, 'timestamp'),
  ]);
}

// ── Trusted Host Config ─────────────────────────────────────────

export function validateTrustedHostConfig(v: unknown): ValidationResult {
  const f = hasFields(v, ['id', 'host', 'declared_boundary', 'user_declaration', 'timestamp', 'version'], 'TrustedHostConfig');
  if (!f.valid) return f;
  const obj = v as Record<string, unknown>;
  return collect([
    validateIdentifier(obj.id, 'id'),
    isNonEmptyString(obj.host, 'host'),
    isOneOf(obj.declared_boundary, ['PRIVATE_LAN'] as const, 'declared_boundary'),
    isNonEmptyString(obj.user_declaration, 'user_declaration'),
    isISO8601(obj.timestamp, 'timestamp'),
    isNumber(obj.version, 'version'),
  ]);
}
