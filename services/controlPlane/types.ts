/**
 * Control Plane V1 — Schema Layer (M1)
 *
 * Shared internal vocabulary for the PrivateAI Control Plane.
 * Representation + validation only. No runtime behavior.
 *
 * This module must NOT import any production runtime module.
 */

// ── 1. Identifiers ──────────────────────────────────────────────

export type SessionId = string & { readonly __brand: 'SessionId' };
export type RequestId = string & { readonly __brand: 'RequestId' };
export type ResolutionId = string & { readonly __brand: 'ResolutionId' };
export type AuthorizationId = string & { readonly __brand: 'AuthorizationId' };
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type ClaimId = string & { readonly __brand: 'ClaimId' };
export type ObservationId = string & { readonly __brand: 'ObservationId' };
export type DecisionId = string & { readonly __brand: 'DecisionId' };
export type ConversationRef = string & { readonly __brand: 'ConversationRef' };
export type MessageRef = string & { readonly __brand: 'MessageRef' };
export type CapabilityId = string & { readonly __brand: 'CapabilityId' };
export type ProviderId = string & { readonly __brand: 'ProviderId' };
export type PolicyId = string & { readonly __brand: 'PolicyId' };
export type TrustedHostId = string & { readonly __brand: 'TrustedHostId' };

// ── 2. Boundaries ───────────────────────────────────────────────

export const BOUNDARIES = ['ON_DEVICE', 'PRIVATE_LAN', 'LOCAL_INFRASTRUCTURE', 'INTERNET/CLOUD'] as const;
export type Boundary = typeof BOUNDARIES[number];

export type BoundaryResolutionStatus = 'resolved' | 'unresolved';

export const PROVENANCE_SOURCES = ['architecture_rule', 'trusted_host_configuration'] as const;
export type ProvenanceSource = typeof PROVENANCE_SOURCES[number];

export interface ResolvedBoundary {
  status: 'resolved';
  boundary: Boundary;
  provenance: ProvenanceSource;
}

export interface UnresolvedBoundary {
  status: 'unresolved';
}

export type BoundaryResolution = ResolvedBoundary | UnresolvedBoundary;

// ── 3. Trusted-Host Configuration Shape ─────────────────────────

export interface TrustedHostConfig {
  id: TrustedHostId;
  host: string;
  declared_boundary: 'PRIVATE_LAN';
  user_declaration: string;
  timestamp: string;
  version: number;
}

// ── 4. Data Classes ─────────────────────────────────────────────

export const DATA_CLASSES = ['public', 'internal', 'medical', 'financial', 'pii', 'protected'] as const;
export type DataClass = typeof DATA_CLASSES[number];

// ── 5. Request Origin ───────────────────────────────────────────

export const REQUEST_ORIGINS = ['user_detected', 'cordelia_proposed'] as const;
export type RequestOrigin = typeof REQUEST_ORIGINS[number];

// ── 6. Capability Contract ──────────────────────────────────────

export interface SideEffectClassification {
  has_side_effects: boolean;
  description: string;
  reversible: boolean;
}

export interface CapabilityContract {
  id: CapabilityId;
  version: number;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  side_effects: SideEffectClassification;
  candidate_providers: ProviderId[];
  permitted_boundaries: Boundary[];
  verification_method: string;
  verification_criteria: string;
  evidence_produced: string;
  timeout_ms: number;
  failure_semantics: 'fail_safe' | 'fail_open' | 'retry';
  credential_source_ref: string | null;
}

// ── 7. Registry Entry / Provider Descriptor ─────────────────────

export interface ProviderDescriptor {
  id: ProviderId;
  capability_id: CapabilityId;
  boundary_resolution: BoundaryResolution;
  network_path: string;
  credential_source_ref: string | null;
  availability_method: string;
  fallback_provider_ref: ProviderId | null;
}

// ── 8. Execution Planning Types ─────────────────────────────────

export interface SemanticCapabilityRequest {
  request_id: RequestId;
  session_id: SessionId;
  capability_id: CapabilityId;
  origin: RequestOrigin;
  input: Record<string, unknown>;
  data_class: DataClass;
  conversation_ref: ConversationRef | null;
  message_ref: MessageRef | null;
  timestamp: string;
}

export interface ProposedExecutionPlan {
  request_id: RequestId;
  capability_id: CapabilityId;
  provider_id: ProviderId;
  resolved_boundary: BoundaryResolution;
  estimated_side_effects: SideEffectClassification;
  data_class: DataClass;
}

export const AUTHORIZATION_DECISIONS = ['DENY', 'ALLOW', 'ASK'] as const;
export type AuthorizationDecision = typeof AUTHORIZATION_DECISIONS[number];

export interface AuthorizationConstraints {
  scope: string;
  duration: string;
  side_effect_limit: string;
  boundary_constraint: {
    allowed_boundaries: Boundary[];
  };
  data_limit: DataClass[];
}

export interface AuthorizationResult {
  authorization_id: AuthorizationId;
  decision: AuthorizationDecision;
  constraints: AuthorizationConstraints | null;
  policy_ref: PolicyId | null;
  timestamp: string;
  reason: string;
}

export interface AuthorizedExecutionPlan {
  request_id: RequestId;
  authorization_id: AuthorizationId;
  capability_id: CapabilityId;
  provider_id: ProviderId;
  resolved_boundary: ResolvedBoundary;
  constraints: AuthorizationConstraints;
  data_class: DataClass;
}

export interface ExecutionResult {
  execution_id: ExecutionId;
  request_id: RequestId;
  authorization_id: AuthorizationId;
  provider_id: ProviderId;
  capability_id: CapabilityId;
  status: 'success' | 'failure' | 'timeout' | 'cancelled';
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

// ── 9. Verified Result / Evidence ───────────────────────────────

export interface VerifiedResult {
  execution_id: ExecutionId;
  verification_method: string;
  verification_criteria: string;
  passed: boolean;
  verified_at: string;
  notes: string | null;
}

/**
 * Durable evidence envelope.
 *
 * Exists ONLY after successful persistence by the Recorder.
 * If Recorder write fails, VerifiedResult may exist but
 * EvidenceEnvelope does NOT exist — no ghost evidence.
 *
 * durability describes the actual durable state of a persisted record:
 * - persisted: committed to durable storage
 * - archived: moved to long-term archive
 *
 * execution_id in the identity chain IS the evidence identity.
 * evidence_id must equal identity_chain.execution_id (validator-enforced).
 */
export type DurabilityStatus = 'persisted' | 'archived';

export interface EvidenceEnvelope {
  evidence_id: EvidenceId;
  identity_chain: {
    session_id: SessionId;
    request_id: RequestId;
    execution_id: ExecutionId;
  };
  source: string;
  timestamp: string;
  authority: string;
  scope: string;
  sensitivity: DataClass;
  status: 'valid' | 'disputed' | 'superseded';
  provenance: string;
  authorization: {
    authorization_id: AuthorizationId;
    decision: AuthorizationDecision;
    policy_ref: PolicyId | null;
    constraints: AuthorizationConstraints | null;
  };
  execution: {
    execution_id: ExecutionId;
    provider_id: ProviderId;
    capability_id: CapabilityId;
    boundary: Boundary;
    status: 'success' | 'failure' | 'timeout' | 'cancelled';
    duration_ms: number;
  };
  verification: {
    method: string;
    criteria: string;
    passed: boolean;
    verified_at: string;
  };
  durability: DurabilityStatus;
}

// ── 10. Record Types ────────────────────────────────────────────

export const RECORD_TYPES = [
  'user_statement',
  'user_decision',
  'observation',
  'tool_result',
  'model_inference',
  'policy',
  'correction',
  'execution_evidence',
] as const;
export type RecordType = typeof RECORD_TYPES[number];

// ── 11. Claim / Association ─────────────────────────────────────

export interface Claim {
  claim_id: ClaimId;
  record_type: RecordType;
  source: string;
  content: string;
  data_class: DataClass;
  timestamp: string;
  evidence_refs: EvidenceId[];
}

export const ASSOCIATION_STATUSES = ['matched', 'partial', 'disputed'] as const;
export type AssociationStatus = typeof ASSOCIATION_STATUSES[number];

export interface Association {
  claim_id: ClaimId;
  evidence_id: EvidenceId;
  status: AssociationStatus;
  confidence: number;
  timestamp: string;
}

// ── 12. Observation / Correction ────────────────────────────────

export const OBSERVATION_STATUSES = ['CURRENT', 'STALE', 'DISPUTED', 'SUPERSEDED'] as const;
export type ObservationStatus = typeof OBSERVATION_STATUSES[number];

/**
 * Observation with explicit supersession lineage.
 *
 * Only a new VERIFIED observation of the SAME capability and scope
 * may supersede a prior observation. Corrections dispute but never supersede.
 *
 * verified: true when this observation has been verified (evidence-backed).
 * supersedes: the ObservationId this observation replaces (or null).
 * superseded_by: set when a later verified observation replaces this one (or null).
 *
 * Validator enforces:
 * - supersedes != null requires verified = true and non-empty evidence_refs
 * - self-supersession rejected
 */
export interface Observation {
  observation_id: ObservationId;
  capability_id: CapabilityId;
  scope: string;
  source: string;
  content: string;
  data_class: DataClass;
  status: ObservationStatus;
  verified: boolean;
  timestamp: string;
  evidence_refs: EvidenceId[];
  supersedes: ObservationId | null;
  superseded_by: ObservationId | null;
}

export interface Correction {
  observation_id: ObservationId;
  disputes: ObservationId;
  source: string;
  reason: string;
  timestamp: string;
  evidence_refs: EvidenceId[];
}

// ── 13. Policy Document Shape ───────────────────────────────────

export interface PolicyDocument {
  id: PolicyId;
  capability_id: CapabilityId;
  origin: RequestOrigin;
  decision: AuthorizationDecision;
  scope: string;
  duration: string;
  side_effect_constraint: string;
  allowed_boundaries: Boundary[];
  data_class_constraints: DataClass[];
  version: number;
  provenance: string;
  source: string;
  timestamp: string;
}
