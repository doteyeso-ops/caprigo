/**
 * OpenAI-compatible /v1/chat/completions (OpenRouter, Groq, Together, LM Studio, Azure, etc.)
 */

import type {
  ChatLLMBackend,
  ChatStreamEvent,
  UnifiedChatMessage,
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedToolCall,
} from '@caprigo/shared';
import { openAICompatibleRequestHeaders } from '@caprigo/shared';

function completionsEndpoint(baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, '');
  if (b.endsWith('/chat/completions')) return b;
  if (b.endsWith('/v1')) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

function toOpenAIMessages(messages: UnifiedChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.tool_call_id ?? '',
        content: m.content ?? '',
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: m.content ?? null,
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments ?? {}),
          },
        })),
      });
      continue;
    }
    out.push({
      role: m.role,
      content: m.content ?? '',
    });
  }
  return out;
}

function parseOpenAIResponse(data: unknown): UnifiedChatResponse {
  const d = data as {
    choices?: Array<{
      message?: {
        role?: string;
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type?: string;
          function?: { name: string; arguments?: string };
        }>;
      };
    }>;
  };
  const msg = d.choices?.[0]?.message;
  if (!msg) {
    return { message: { role: 'assistant', content: null } };
  }

  const tool_calls: UnifiedToolCall[] | undefined = msg.tool_calls?.map(tc => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.function?.name ?? 'unknown',
      arguments: tc.function?.arguments ?? '{}',
    },
  }));

  return {
    message: {
      role: msg.role || 'assistant',
      content: msg.content ?? null,
      tool_calls,
    },
  };
}

function chatTimeoutMs(): number {
  const raw =
    process.env.CAPRIGO_OPENAI_CHAT_TIMEOUT_MS?.trim() ||
    process.env.OPENAI_CHAT_TIMEOUT_MS?.trim() ||
    '600000';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 10000 ? n : 600000;
}

/** Prefer nested JSON error messages over dumping the full body. */
function formatOpenAICompatibleHttpError(status: number, text: string): string {
  const raw = text.trim();
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; code?: string };
      message?: string;
    };
    const nested = j?.error;
    if (nested && typeof nested.message === 'string' && nested.message.trim()) {
      const code = nested.code ? ` [${nested.code}]` : '';
      return `OpenAI-compatible API error (${status})${code}: ${nested.message.trim()}`;
    }
    if (typeof j?.message === 'string' && j.message.trim()) {
      return `OpenAI-compatible API error (${status}): ${j.message.trim()}`;
    }
  } catch {
    /* use raw */
  }
  return `OpenAI-compatible API error (${status}): ${raw.slice(0, 2000)}`;
}

export class OpenAICompatibleLLMBackend implements ChatLLMBackend {
  readonly providerId = 'openai_compatible';
  private endpoint: string;
  private apiKey: string;

  constructor(
    baseUrl: string = 'https://api.openai.com/v1',
    apiKey: string = ''
  ) {
    this.endpoint = completionsEndpoint(baseUrl);
    this.apiKey = apiKey;
  }

  private buildChatBody(request: UnifiedChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAIMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      stream,
    };
    if (request.tools?.length) {
      body.tools = request.tools;
    }
    if (request.toolChoice != null) {
      body.tool_choice = request.toolChoice;
    }
    const omitMax =
      process.env.CAPRIGO_OPENAI_OMIT_MAX_TOKENS === '1' ||
      process.env.CAPRIGO_OPENAI_OMIT_MAX_TOKENS === 'true';
    if (omitMax) {
      delete body.max_tokens;
    }
    return body;
  }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const body = this.buildChatBody(request, false);
    delete body.stream;

    const headers = openAICompatibleRequestHeaders({
      bearerToken: this.apiKey || null,
      contentTypeJson: true,
    });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(chatTimeoutMs()),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(formatOpenAICompatibleHttpError(res.status, text));
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`OpenAI-compatible API: invalid JSON response`);
    }

    return parseOpenAIResponse(data);
  }

  /**
   * SSE stream for OpenAI-compatible servers (LM Studio, OpenRouter, etc.).
   * Assembles incremental tool_calls deltas into a final UnifiedChatResponse.
   */
  async chatStream(
    request: UnifiedChatRequest,
    onEvent: (e: ChatStreamEvent) => void
  ): Promise<UnifiedChatResponse> {
    const body = this.buildChatBody(request, true);
    const headers = openAICompatibleRequestHeaders({
      bearerToken: this.apiKey || null,
      contentTypeJson: true,
    });

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(chatTimeoutMs()),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(formatOpenAICompatibleHttpError(res.status, text));
    }

    if (!res.body) {
      // Some local servers ignore stream and return JSON — fall back.
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new Error('OpenAI-compatible API: empty stream body and invalid JSON');
      }
      const parsed = parseOpenAIResponse(data);
      const content = parsed.message.content || '';
      if (content) onEvent({ type: 'token', text: content });
      if (parsed.usage) onEvent({ type: 'usage', usage: parsed.usage });
      return parsed;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let role = 'assistant';
    const toolAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage: UnifiedChatResponse['usage'] | undefined;

    const flushToolCalls = (): UnifiedToolCall[] | undefined => {
      if (toolAcc.size === 0) return undefined;
      const keys = [...toolAcc.keys()].sort((a, b) => a - b);
      return keys.map(i => {
        const t = toolAcc.get(i)!;
        return {
          id: t.id || `call_${i}`,
          type: 'function' as const,
          function: {
            name: t.name || 'unknown',
            arguments: t.arguments || '{}',
          },
        };
      });
    };

    const handleDataPayload = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '[DONE]') return;
      let data: {
        choices?: Array<{
          delta?: {
            role?: string;
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          message?: {
            role?: string;
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      try {
        data = JSON.parse(trimmed) as typeof data;
      } catch {
        return;
      }

      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        };
      }

      const choice = data.choices?.[0];
      if (!choice) return;

      // Non-streaming-shaped chunk (rare)
      if (choice.message && !choice.delta) {
        if (choice.message.role) role = choice.message.role;
        const c = choice.message.content ?? '';
        if (c) {
          content += c;
          onEvent({ type: 'token', text: c });
        }
        if (choice.message.tool_calls?.length) {
          choice.message.tool_calls.forEach((tc, i) => {
            toolAcc.set(i, {
              id: tc.id,
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '{}',
            });
          });
        }
        return;
      }

      const delta = choice.delta as {
        role?: string;
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | null;
        thinking?: string | null;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      if (!delta) return;
      if (delta.role) role = delta.role;

      const thinkPiece =
        (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
        (typeof delta.reasoning === 'string' && delta.reasoning) ||
        (typeof delta.thinking === 'string' && delta.thinking) ||
        '';
      if (thinkPiece) onEvent({ type: 'think', text: thinkPiece });

      const piece = delta.content;
      if (piece) {
        content += piece;
        onEvent({ type: 'token', text: piece });
      }

      if (delta.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : 0;
          const prev = toolAcc.get(idx) || { id: '', name: '', arguments: '' };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.arguments += tc.function.arguments;
          toolAcc.set(idx, prev);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data:')) {
          handleDataPayload(trimmed.slice(5));
        }
      }
    }
    if (buffer.trim().startsWith('data:')) {
      handleDataPayload(buffer.trim().slice(5));
    }

    const tool_calls = flushToolCalls();
    if (usage) onEvent({ type: 'usage', usage });

    return {
      message: {
        role,
        content: content || null,
        tool_calls,
      },
      usage,
    };
  }
}
