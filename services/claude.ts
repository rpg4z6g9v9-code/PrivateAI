/**
 * Claude API Types
 * 
 * Message types, API request/response structures.
 */

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeAPIRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ConversationMessage[];
}

export interface ClaudeAPIResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AIRouteResult {
  text: string;
  route: 'cloud' | 'local';
  model: string;
  latency: number;
  tokens?: {
    input: number;
    output: number;
  };
}

export interface AIRouteParams {
  messages: ConversationMessage[];
  isSensitive: boolean;
  safeMode: boolean;
  nodeOnline?: boolean;   // pre-checked node status — skip local attempt if false
  onToken?: (token: string) => void; // streaming callback — local route only
  toolContext?: string;  // structured tool results injected for this turn
}
