/**
 * Ollama /api/chat backend — maps unified messages to Ollama and back.
 */

import { randomUUID } from 'crypto';
import { OllamaClient, OllamaChatMessage, OllamaChatRequest, OllamaChatResponse } from '@caprigo/ollama-client';
import type {
  ChatLLMBackend,
  UnifiedChatMessage,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedToolCall,
} from '@caprigo/shared';
import { caprigoEnv } from '@caprigo/shared';

/** Optional Ollama runtime tuning from the gateway env (see README / CONTINUITY). */
function ollamaOptionsFromCaprigoEnv(): Record<string, number> {
  const out: Record<string, number> = {};
  const gpu = caprigoEnv('OLLAMA_NUM_GPU')?.trim();
  if (gpu) {
    const n = parseInt(gpu, 10);
    if (Number.isFinite(n)) out.num_gpu = n;
  }
  const th = caprigoEnv('OLLAMA_NUM_THREAD')?.trim();
  if (th) {
    const n = parseInt(th, 10);
    if (Number.isFinite(n)) out.num_thread = n;
  }
  return out;
}

function toOllamaMessages(messages: UnifiedChatMessage[]): OllamaChatMessage[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_name: m.tool_name || 'unknown',
        content: m.content ?? '',
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.tool_calls.map(tc => ({
          type: 'function' as const,
          function: {
            index: tc.function.index,
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      };
    }
    return {
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content ?? '',
    };
  });
}

function normalizeOllamaResponse(resp: OllamaChatResponse): UnifiedChatResponse {
  const raw = resp.message.tool_calls;
  const tool_calls: UnifiedToolCall[] | undefined = raw?.map((tc, i) => ({
    id: `ollama-${randomUUID()}`,
    type: 'function',
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
      index: tc.function.index ?? i,
    },
  }));

  return {
    message: {
      role: resp.message.role || 'assistant',
      content: resp.message.content ?? null,
      tool_calls,
    },
  };
}

export class OllamaLLMBackend implements ChatLLMBackend {
  readonly providerId = 'ollama';
  private client: OllamaClient;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.client = new OllamaClient(baseUrl);
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const body: OllamaChatRequest = {
      model: request.model,
      messages: toOllamaMessages(request.messages),
      tools: request.tools,
      options: {
        ...ollamaOptionsFromCaprigoEnv(),
        temperature: request.temperature,
        num_predict: request.maxTokens,
        ...(request.numCtx != null ? { num_ctx: request.numCtx } : {}),
      },
    };
    const resp = await this.client.chat(body);
    return normalizeOllamaResponse(resp);
  }
}
