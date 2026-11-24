import type { Op } from '../../../../mcp/recipe';

export interface AgentResult {
  reply: string;
  ops: Op[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface AiProvider {
  id: string;
  label: string;
  chat(request: ProviderRequest): Promise<string>;
}

export class AgentError extends Error {}
