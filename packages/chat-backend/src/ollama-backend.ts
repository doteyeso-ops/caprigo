/**
 * Ollama /api/chat backend — maps unified messages to Ollama and back.
 */

import { randomUUID } from 'crypto';
import { OllamaClient, OllamaChatMessage, OllamaChatRequest, OllamaChatResponse, OllamaChatRole } from '@caprigo/ollama-client';
import type {
  ChatLLMBackend,
  ChatStreamEvent,
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

function buildOllamaBody(request: UnifiedChatRequest): OllamaChatRequest {
  return {
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

  const promptTokens = resp.prompt_eval_count;
  const completionTokens = resp.eval_count;
  const usage =
    promptTokens != null || completionTokens != null || resp.total_duration != null
      ? {
          promptTokens,
          completionTokens,
          totalTokens:
            promptTokens != null || completionTokens != null
              ? (promptTokens ?? 0) + (completionTokens ?? 0)
              : undefined,
          durationMs:
            resp.total_duration != null ? Math.round(resp.total_duration / 1_000_000) : undefined,
        }
      : undefined;

  return {
    message: {
      role: resp.message.role || 'assistant',
      content: resp.message.content ?? null,
      tool_calls,
    },
    usage,
  };
}

function thinkDeltaFromMessage(msg: OllamaChatMessage | undefined): string {
  if (!msg) return '';
  return msg.thinking || msg.reasoning || '';
}

export class OllamaLLMBackend implements ChatLLMBackend {
  readonly providerId = 'ollama';
  private client: OllamaClient;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.client = new OllamaClient(baseUrl);
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const resp = await this.client.chat(buildOllamaBody(request));
    return normalizeOllamaResponse(resp);
  }

  async chatStream(
    request: UnifiedChatRequest,
    onEvent: (e: ChatStreamEvent) => void
  ): Promise<UnifiedChatResponse> {
    let content = '';
    let role: OllamaChatRole = 'assistant';
    let tool_calls: OllamaChatResponse['message']['tool_calls'];
    let lastChunk: OllamaChatResponse | undefined;

    for await (const chunk of this.client.chatStream(buildOllamaBody(request))) {
      lastChunk = chunk;
      const msg = chunk.message;
      if (msg?.role) role = msg.role;

      const delta = msg?.content ?? '';
      if (delta) {
        content += delta;
        onEvent({ type: 'token', text: delta });
      }

      const think = thinkDeltaFromMessage(msg);
      if (think) {
        onEvent({ type: 'think', text: think });
      }

      if (msg?.tool_calls?.length) {
        tool_calls = msg.tool_calls;
      }

      if (chunk.done) {
        const normalized = normalizeOllamaResponse({
          ...chunk,
          message: {
            role,
            content,
            tool_calls,
          },
        });
        if (normalized.usage) {
          onEvent({ type: 'usage', usage: normalized.usage });
        }
        return normalized;
      }
    }

    if (!lastChunk) {
      return { message: { role: 'assistant', content: '' } };
    }

    const normalized = normalizeOllamaResponse({
      ...lastChunk,
      message: {
        role,
        content,
        tool_calls,
      },
    });
    if (normalized.usage) {
      onEvent({ type: 'usage', usage: normalized.usage });
    }
    return normalized;
  }
}
