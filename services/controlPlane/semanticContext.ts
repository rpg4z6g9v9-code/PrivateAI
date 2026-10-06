/**
 * Semantic Context Gate (M2)
 *
 * Extracted from app/(tabs)/index.tsx for testability.
 * Gates embedding/retrieval calls behind protected-data classification.
 *
 * Protected current text → ZERO embedding calls, ZERO retrieval calls.
 * Non-protected text → existing embedding/retrieval behavior preserved.
 */

import { classifyPayload, type CredentialFetcher, type PayloadClassification } from '@/services/controlPlane/classifier';
import type { DataClass } from '@/services/controlPlane/types';

export interface SemanticContextParams {
  text: string;
  messageId: string;
  conversationId: string;
  requestId?: string;
  fetchCredential: CredentialFetcher;
  embedUserMessage: (content: string, messageId: string, conversationId: string, requestId?: string, dataClasses?: DataClass[]) => void;
  findRelevantNodes: (text: string, requestId?: string, dataClasses?: DataClass[]) => Promise<string[]>;
}

export interface SemanticContextResult {
  classification: PayloadClassification;
  embeddingCalled: boolean;
  retrievalPromise: Promise<string[]>;
}

/**
 * Classify current text and gate embedding/retrieval.
 * Production index.tsx calls this; tests can inject mock embed/retrieval functions.
 */
export async function gateSemanticContext(
  params: SemanticContextParams
): Promise<SemanticContextResult> {
  const { text, messageId, conversationId, requestId, fetchCredential, embedUserMessage, findRelevantNodes } = params;

  const classification = await classifyPayload({
    currentText: text,
    messages: [],
    fetchCredential,
  });

  if (classification.isProtected) {
    return {
      classification,
      embeddingCalled: false,
      retrievalPromise: Promise.resolve([]),
    };
  }

  // L2: pass M2 PayloadClassification.unionClasses to both callbacks — not rebuilt locally.
  // L6: pass requestId so embed and retrieval resolutions share the same request_id.
  embedUserMessage(text, messageId, conversationId, requestId, classification.unionClasses);

  return {
    classification,
    embeddingCalled: true,
    retrievalPromise: findRelevantNodes(text, requestId, classification.unionClasses).catch(() => [] as string[]),
  };
}
