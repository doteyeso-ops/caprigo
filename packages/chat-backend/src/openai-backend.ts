/**
 * OpenAI-compatible /v1/chat/completions (OpenRouter, Groq, Together, LM Studio, Azure, etc.)
 */

import type {
  ChatLLMBackend,
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

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAIMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
    };
    if (request.tools?.length) {
      body.tools = request.tools;
    }
    const omitMax =
      process.env.CAPRIGO_OPENAI_OMIT_MAX_TOKENS === '1' ||
      process.env.CAPRIGO_OPENAI_OMIT_MAX_TOKENS === 'true';
    if (omitMax) {
      delete body.max_tokens;
    }

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
}
