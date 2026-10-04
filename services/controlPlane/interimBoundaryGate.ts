/**
 * Interim Boundary Gate (M2)
 *
 * TEMPORARY — REMOVE IN M8 after shadow policy parity.
 *
 * Consumes PayloadClassification and determines M2 containment:
 * - sensitive → local-only reasoning (no cloud fallback)
 * - protected → refuse reasoning entirely (zero engine egress)
 * - sensitive search → block web search
 * - protected search → block web search
 *
 * This gate does NOT:
 * - produce ALLOW/DENY/ASK authorization records
 * - read PolicyDocument
 * - grant capabilities
 * - choose providers
 * - create evidence/authorization/execution IDs
 * - become a permanent policy system
 */

import type { PayloadClassification } from '@/services/controlPlane/classifier';

// ── Gate Decisions ──────────────────────────────────────────────

export type GateDecision =
  | { action: 'proceed'; isSensitive: false; }
  | { action: 'proceed_local_only'; isSensitive: true; reason: string; }
  | { action: 'refuse'; reason: string; };

export type SearchGateDecision =
  | { action: 'allow_search'; }
  | { action: 'block_search'; reason: string; };

// ── TEMPORARY — REMOVE IN M8 ───────────────────────────────────

/**
 * Determine reasoning containment from payload classification.
 *
 * Protected → refuse (D7 strict deny, zero engine egress).
 * Sensitive → local-only (D1, no cloud fallback).
 * Otherwise → proceed normally.
 */
export function gateReasoning(classification: PayloadClassification): GateDecision {
  if (classification.isProtected) {
    return {
      action: 'refuse',
      reason: 'Protected data detected in outbound payload. Reasoning request refused.',
    };
  }

  if (classification.isSensitive) {
    return {
      action: 'proceed_local_only',
      isSensitive: true,
      reason: 'Sensitive data detected. Reasoning constrained to local/private infrastructure.',
    };
  }

  return { action: 'proceed', isSensitive: false };
}

/**
 * Determine whether web search may proceed.
 *
 * If the search query OR the originating current text contains
 * sensitive or protected data, block the search.
 */
export function gateSearch(classification: PayloadClassification): SearchGateDecision {
  if (classification.isProtected) {
    return {
      action: 'block_search',
      reason: 'Protected data detected. Web search blocked.',
    };
  }

  if (classification.isSensitive) {
    return {
      action: 'block_search',
      reason: 'Sensitive data detected. Web search blocked to prevent disclosure.',
    };
  }

  return { action: 'allow_search' };
}
