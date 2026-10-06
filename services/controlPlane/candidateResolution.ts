/**
 * Control Plane — Candidate Resolution (M5)
 *
 * Shadow mode: produces a non-executing proposed execution plan for every
 * capability request. Does NOT authorize, enforce, deny, or change routing.
 * Current routing/execution remains authoritative until M8.
 *
 * Resolution pipeline (per capability request):
 *   capability_id → contract → ordered provider candidates →
 *   boundary per provider → availability per provider →
 *   payload data classes → disclosure implications →
 *   ShadowResolution → durable interim_gate record (source='candidate_resolution')
 *
 * M5 implements the D5 host→boundary resolution deferred from M4:
 *   resolveBoundaryForHost() is the M5 implementation of isTrustedHost().
 *
 * Call sites provide resolved host values from their own async context so this
 * module does NOT import localAI.ts or providerGateway.ts — avoiding indirect
 * native dependencies that break the test harness.
 *
 * M5 addresses: CAP-06, CAP-07, IDR-03 (resolution half), BND-02, EXE-05.
 * M5 MUST NOT: authorize, deny, change what executes, or issue live network probes.
 */

import type { CapabilityContract, ProviderDescriptor, BoundaryResolution, DataClass, Boundary } from './types';
import { lookupCapability, lookupProvider } from './registry';
import { AUTO_TRUSTED_CIDR, hasTrustedHostDeclaration } from './trustedHosts';
import { getSessionId, mintResolutionId } from './identifiers';
import { ensureReady, appendRecord } from './recorder';

// ── M5 Types ──────────────────────────────────────────────────────────────────

/** One candidate provider entry in a shadow resolution. */
export interface ProviderCandidate {
  /** Provider ID from the registry. */
  provider_id: string;
  /** 1-based position in contract.candidate_providers order. */
  position: number;
  /** Boundary resolved from runtime host (M5 replaces 'unresolved' where host is known). */
  boundary_resolution: BoundaryResolution;
  /** Availability derived from last-known state. M5 never issues live network probes. */
  availability: 'available' | 'unavailable' | 'unknown';
  /** Source of the availability fact. */
  availability_source: string;
  /** True if this candidate would be selected for execution based on availability. */
  selected: boolean;
}

/** What would be disclosed if the selected provider executes. */
export interface DisclosureImplication {
  boundary: Boundary;
  /** Human-readable recipient (e.g. 'brave_search_api', 'anthropic_api_via_gateway'). */
  recipient: string;
  data_classes_disclosed: DataClass[];
  disclosure_type: 'query' | 'content' | 'metadata';
}

/** Non-executing proposed execution plan produced by M5 candidate resolution. */
export interface ShadowResolution {
  resolution_id: string;
  /** RequestId from sendOrchestration if threaded through; null otherwise. */
  request_id: string | null;
  session_id: string;
  capability_id: string;
  contract_version: number;
  provider_candidates: ProviderCandidate[];
  data_classes: DataClass[];
  is_sensitive: boolean;
  is_protected: boolean;
  disclosure_implications: DisclosureImplication[];
  resolved_at: string;
  /** Invariant: always true. Shadow resolution NEVER authorizes or changes execution. */
  readonly shadow_mode: true;
  /** Whether the resolution was durably persisted by the Recorder, or degraded. */
  recorder_status: 'recorded' | 'degraded';
}

/** Payload of the append-only shadow comparison record written after actual execution. */
export interface ShadowComparisonPayload {
  resolution_id: string;
  capability_id: string;
  shadow_selected_provider: string | null;
  actual_provider: string;
  diverged: boolean;
  divergence_reason: string;
}

/** Parameters for resolveAndRecordShadow(). All optional fields default safely. */
export interface ShadowResolutionParams {
  capability_id: string;
  conversation_id?: string | null;
  request_id?: string | null;
  data_classes?: DataClass[];
  is_sensitive?: boolean;
  is_protected?: boolean;
  /** node_online from the most recent node health check result. */
  node_online?: boolean | null;
  /** WebSearchStatus string ('operational'|'configured'|'unavailable'|'degraded'|'auth_failed'). */
  web_search_status?: string;
  /**
   * Resolved Ollama host string (e.g. '192.168.4.52:11434').
   * Provided by call site (from getOllamaHost()) so this module does not import localAI.
   * If omitted, Ollama-provider boundaries remain 'unresolved'.
   */
  ollama_host?: string;
  /**
   * Resolved provider gateway base URL (e.g. 'http://192.168.4.52:8787').
   * Provided by call site (from getProviderGatewayBase()) so this module does not import providerGateway.
   * If omitted, gateway provider boundaries remain 'unresolved'.
   */
  gateway_host?: string;
}

// ── Host → BoundaryResolution (M5: isTrustedHost implementation) ─────────────

/**
 * Resolve the data boundary for a runtime host.
 *
 * Priority:
 *   1. Architecture rule: bare host prefix matches AUTO_TRUSTED_CIDR → PRIVATE_LAN
 *   2. Explicit D5 declaration: hasTrustedHostDeclaration(host) → PRIVATE_LAN
 *   3. No match → unresolved
 *
 * This is the M5 implementation of isTrustedHost() deferred from M4.
 * Never throws.
 */
export async function resolveBoundaryForHost(host: string): Promise<BoundaryResolution> {
  if (!host) return { status: 'unresolved' };

  const bare = host.split(':')[0];

  // Architecture rule: exact 192.168.4.0/24 CIDR — octet-validated, not string-prefix.
  // A bare string-prefix match (startsWith) would incorrectly trust '192.168.4.1.evil.com'.
  const octs = bare.split('.');
  const inCIDR =
    octs.length === 4 &&
    octs[0] === '192' && octs[1] === '168' && octs[2] === '4' &&
    /^\d{1,3}$/.test(octs[3]) &&
    parseInt(octs[3], 10) <= 255;
  if (inCIDR) {
    return { status: 'resolved', boundary: 'PRIVATE_LAN', provenance: 'architecture_rule' };
  }

  // Explicit D5 trusted-host declaration
  try {
    const declared = await hasTrustedHostDeclaration(host);
    if (declared) {
      return { status: 'resolved', boundary: 'PRIVATE_LAN', provenance: 'trusted_host_configuration' };
    }
  } catch {
    // Storage read error — treat as unresolved, never throw
  }

  return { status: 'unresolved' };
}

// ── Provider boundary resolution ─────────────────────────────────────────────

async function resolveProviderBoundary(
  descriptor: ProviderDescriptor,
  opts: { ollama_host?: string; gateway_host?: string },
): Promise<BoundaryResolution> {
  // Already resolved at build time (e.g. INTERNET/CLOUD via architecture_rule) → preserve
  if (descriptor.boundary_resolution.status === 'resolved') {
    return descriptor.boundary_resolution;
  }

  const pid = String(descriptor.id);

  if (pid === 'local_reasoning_resolver' || pid === 'ollama_embed_resolver') {
    if (opts.ollama_host) return resolveBoundaryForHost(opts.ollama_host);
    return { status: 'unresolved' };
  }

  if (pid.startsWith('gateway_')) {
    if (opts.gateway_host) {
      const withoutScheme = opts.gateway_host.replace(/^https?:\/\//, '');
      return resolveBoundaryForHost(withoutScheme);
    }
    return { status: 'unresolved' };
  }

  return { status: 'unresolved' };
}

// ── Availability determination ────────────────────────────────────────────────

/**
 * Determine provider availability from last-known state.
 * M5 shadow mode NEVER issues live network probes.
 * Exported for direct testing.
 */
export function resolveProviderAvailability(
  providerId: string,
  opts: { node_online?: boolean | null; web_search_status?: string },
): { availability: ProviderCandidate['availability']; availability_source: string } {
  const { node_online, web_search_status } = opts;

  if (providerId === 'local_reasoning_resolver' || providerId === 'ollama_embed_resolver') {
    if (node_online === true)  return { availability: 'available',   availability_source: 'node_health_check' };
    if (node_online === false) return { availability: 'unavailable', availability_source: 'node_health_check' };
    return { availability: 'unknown', availability_source: 'no_check' };
  }

  if (providerId === 'cloud_reasoning_resolver') {
    // No live gateway probe in shadow mode — safe default is unknown
    return { availability: 'unknown', availability_source: 'not_probed' };
  }

  if (providerId === 'brave_resolver') {
    const s = web_search_status ?? '';
    if (s === 'operational' || s === 'configured') {
      return { availability: 'available',   availability_source: 'key_presence_check' };
    }
    if (s === 'unavailable' || s === 'auth_failed' || s === 'degraded') {
      return { availability: 'unavailable', availability_source: 'key_presence_check' };
    }
    return { availability: 'unknown', availability_source: 'no_check' };
  }

  if (providerId.startsWith('gateway_')) {
    return { availability: 'unknown', availability_source: 'not_probed' };
  }

  return { availability: 'unknown', availability_source: 'not_probed' };
}

// ── Recipient label and disclosure type ───────────────────────────────────────

function providerRecipient(providerId: string): string {
  const labels: Record<string, string> = {
    'brave_resolver':           'brave_search_api',
    'cloud_reasoning_resolver': 'anthropic_api_via_gateway',
    'local_reasoning_resolver': 'ollama_private_node',
    'ollama_embed_resolver':    'ollama_private_node',
  };
  return labels[providerId] ?? (providerId.startsWith('gateway_') ? 'provider_gateway' : providerId);
}

function disclosureType(capabilityId: string): DisclosureImplication['disclosure_type'] {
  if (capabilityId === 'web.search') return 'query';
  if (capabilityId === 'reasoning')  return 'content';
  return 'metadata';
}

// ── Disclosure implications ───────────────────────────────────────────────────

/**
 * Compute disclosure implications for selected provider candidates.
 * Only selected candidates with a resolved boundary produce implications.
 * Exported for direct testing.
 */
export function computeDisclosureImplications(
  candidates: ProviderCandidate[],
  dataClasses: DataClass[],
  capabilityId: string,
): DisclosureImplication[] {
  return candidates
    .filter(c => c.selected && c.boundary_resolution.status === 'resolved')
    .map(c => ({
      boundary: (c.boundary_resolution as { status: 'resolved'; boundary: Boundary }).boundary,
      recipient: providerRecipient(c.provider_id),
      data_classes_disclosed: [...dataClasses],
      disclosure_type: disclosureType(capabilityId),
    }));
}

// ── Candidate list builder ─────────────────────────────────────────────────────

async function buildCandidates(
  contract: CapabilityContract,
  opts: {
    node_online?: boolean | null;
    web_search_status?: string;
    ollama_host?: string;
    gateway_host?: string;
  },
): Promise<ProviderCandidate[]> {
  const providerIds = contract.candidate_providers as string[];
  const candidates: ProviderCandidate[] = [];
  let firstSelected = false;

  for (let i = 0; i < providerIds.length; i++) {
    const pid = providerIds[i];
    const descriptor = lookupProvider(pid);
    if (!descriptor) continue;

    const boundary = await resolveProviderBoundary(descriptor, {
      ollama_host:  opts.ollama_host,
      gateway_host: opts.gateway_host,
    });
    const { availability, availability_source } = resolveProviderAvailability(pid, opts);

    // First candidate with 'available' status is selected (mirrors production priority order)
    const selected = availability === 'available' && !firstSelected;
    if (selected) firstSelected = true;

    candidates.push({
      provider_id:         pid,
      position:            i + 1,
      boundary_resolution: boundary,
      availability,
      availability_source,
      selected,
    });
  }

  return candidates;
}

// ── Shadow record persistence ─────────────────────────────────────────────────

async function persistShadowRecord(
  resolution: ShadowResolution,
  conversationId: string | null,
): Promise<'recorded' | 'degraded'> {
  try {
    const ready = await ensureReady();
    if (!ready) return 'degraded';

    // Persist payload without recorder_status (circular: status not yet known at serialize time)
    const { recorder_status: _omit, ...payloadShape } = resolution as ShadowResolution & { recorder_status?: string };
    const result = await appendRecord({
      record_id:       resolution.resolution_id,
      record_kind:     'interim_gate',
      record_type:     null,
      session_id:      resolution.session_id,
      conversation_id: conversationId,
      message_id:      null,
      request_id:      resolution.request_id,
      timestamp:       Date.now(),
      source:          'candidate_resolution',
      payload:         JSON.stringify(payloadShape),
    });
    return result.status === 'recorded' ? 'recorded' : 'degraded';
  } catch {
    // Never throw from shadow persistence — recorder degraded is acceptable
    return 'degraded';
  }
}

// ── Divergence reason taxonomy ─────────────────────────────────────────────────

function computeDivergenceReason(resolution: ShadowResolution, actualProvider: string): string {
  const shadowSelected = resolution.provider_candidates.find(c => c.selected)?.provider_id ?? null;
  if (shadowSelected === actualProvider) return 'match';
  if (!shadowSelected) return 'shadow_no_candidate_selected_actual_executed';

  // Local was shadow-selected but actual used cloud
  if (shadowSelected.startsWith('local_') && actualProvider.includes('cloud')) {
    return 'local_primary_unavailable_actual_cloud_fallback';
  }

  // Actual provider boundary was unresolved in shadow
  const actualCandidate = resolution.provider_candidates.find(c => c.provider_id === actualProvider);
  if (actualCandidate?.boundary_resolution.status === 'unresolved') {
    if (actualProvider.startsWith('gateway_')) return 'gateway_boundary_unresolved_shadow_only';
    return 'boundary_unresolved_shadow_only';
  }

  return 'shadow_provider_differs_from_actual';
}

/**
 * Append an immutable shadow comparison record after actual execution is known.
 *
 * MUST NOT mutate the original candidate-resolution record.
 * Linked to the original via resolution_id and request_id.
 * record_kind='interim_gate' / source='candidate_resolution_comparison'.
 * Never throws. Returns 'recorded' on durable success, 'degraded' otherwise.
 * Provider result is unchanged regardless of outcome.
 */
export async function recordShadowComparison(
  resolution: ShadowResolution,
  actualProvider: string,
  conversationId: string | null,
): Promise<'recorded' | 'degraded'> {
  try {
    const ready = await ensureReady();
    if (!ready) return 'degraded';

    const shadowSelected = resolution.provider_candidates.find(c => c.selected)?.provider_id ?? null;
    const diverged = shadowSelected !== actualProvider;
    const divergence_reason = computeDivergenceReason(resolution, actualProvider);

    const comparisonPayload: ShadowComparisonPayload = {
      resolution_id:           resolution.resolution_id,
      capability_id:           resolution.capability_id,
      shadow_selected_provider: shadowSelected,
      actual_provider:         actualProvider,
      diverged,
      divergence_reason,
    };

    const result = await appendRecord({
      record_id:       mintResolutionId(), // new unique ID — never the same as the original resolution_id
      record_kind:     'interim_gate',
      record_type:     null,
      session_id:      resolution.session_id,
      conversation_id: conversationId,
      message_id:      null,
      request_id:      resolution.request_id,
      timestamp:       Date.now(),
      source:          'candidate_resolution_comparison',
      payload:         JSON.stringify(comparisonPayload),
    });
    return result.status === 'recorded' ? 'recorded' : 'degraded';
  } catch {
    // Never throw — shadow comparison is best-effort
    return 'degraded';
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Resolve provider candidates and record a shadow execution plan.
 *
 * Always returns the ShadowResolution (even when recorder persistence degrades).
 * Never throws. Never changes routing or execution. shadow_mode=true is invariant.
 *
 * Call sites fire this without awaiting (fire-and-forget) so it adds zero
 * blocking latency to production paths. Tests may await it for assertions.
 */
export async function resolveAndRecordShadow(
  params: ShadowResolutionParams,
): Promise<ShadowResolution | null> {
  try {
    const contract = lookupCapability(params.capability_id);
    if (!contract) return null;

    const sessionId    = getSessionId();
    const resolutionId = mintResolutionId();
    const dataClasses: DataClass[] = params.data_classes ?? ['public'];
    const isSensitive  = params.is_sensitive  ?? false;
    const isProtected  = params.is_protected  ?? false;

    const candidates = await buildCandidates(contract, {
      node_online:       params.node_online,
      web_search_status: params.web_search_status,
      ollama_host:       params.ollama_host,
      gateway_host:      params.gateway_host,
    });

    const disclosures = computeDisclosureImplications(candidates, dataClasses, params.capability_id);

    const resolution: ShadowResolution = {
      resolution_id:           resolutionId,
      request_id:              params.request_id ?? null,
      session_id:              sessionId,
      capability_id:           params.capability_id,
      contract_version:        contract.version,
      provider_candidates:     candidates,
      data_classes:            dataClasses,
      is_sensitive:            isSensitive,
      is_protected:            isProtected,
      disclosure_implications: disclosures,
      resolved_at:             new Date().toISOString(),
      shadow_mode:             true,
      recorder_status:         'degraded', // set below after persist attempt
    };

    // L1: persist attempt completes before returning — caller may await this before execution
    resolution.recorder_status = await persistShadowRecord(resolution, params.conversation_id ?? null);

    return resolution;
  } catch {
    return null;
  }
}
