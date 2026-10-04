/**
 * Control Plane — Identifier Minting (M3)
 *
 * Runtime identifier generation using M1 branded types.
 * D9: session_id = APP LAUNCH (one per process lifecycle).
 *
 * Identifiers are collision-resistant, never model-derived.
 */

import type {
  SessionId, RequestId, DecisionId,
  ConversationRef, MessageRef,
} from './types';

let _seq = 0;

function mint(prefix: string): string {
  return `${prefix}.${Date.now()}.${(++_seq).toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
}

// D9: one session_id per app launch — module-level singleton
const _sessionId = mint('sess') as SessionId;

export function getSessionId(): SessionId {
  return _sessionId;
}

export function mintRequestId(): RequestId {
  return mint('req') as RequestId;
}

export function mintDecisionId(): DecisionId {
  return mint('dec') as DecisionId;
}

export function toConversationRef(id: string): ConversationRef {
  return id as ConversationRef;
}

export function toMessageRef(id: string): MessageRef {
  return id as MessageRef;
}
