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

export interface SemanticContextParams {
  text: string;
  messageId: string;
  conversationId: string;
  fetchCredential: CredentialFetcher;
  embedUserMessage: (content: string, messageId: string, conversationId: string) => void;
  findRelevantNodes: (text: string) => Promise<string[]>;
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
  const { text, messageId, conversationId, fetchCredential, embedUserMessage, findRelevantNodes } = params;

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

  embedUserMessage(text, messageId, conversationId);

  return {
    classification,
    embeddingCalled: true,
    retrievalPromise: findRelevantNodes(text).catch(() => [] as string[]),
  };
}
