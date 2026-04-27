/**
 * Native Ollama client - no proxies, direct integration
 */

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaToolCall {
  type: 'function';
  function: {
    index?: number;
    name: string;
    arguments?: Record<string, unknown> | string;
  };
}

export type OllamaChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface OllamaChatMessage {
  role: OllamaChatRole;
  content?: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  tools?: unknown[];
  think?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    /** Context / KV cache size (tokens). */
    num_ctx?: number;
    repeat_penalty?: number;
    /** Layers to offload to GPU (Ollama/llama.cpp; -1 often means max that fit). */
    num_gpu?: number;
    /** CPU thread count for layers that stay on CPU. */
    num_thread?: number;
    [key: string]: unknown;
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
}

/** Default per-request ceiling for `/api/chat` (one model round; multi-tool turns use multiple requests). */
const DEFAULT_OLLAMA_TIMEOUT_MS = 600_000;

export class OllamaClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    const raw = process.env.CAPRIGO_OLLAMA_TIMEOUT_MS?.trim() || String(DEFAULT_OLLAMA_TIMEOUT_MS);
    const n = parseInt(raw, 10);
    this.timeoutMs = Number.isFinite(n) && n >= 5000 ? n : DEFAULT_OLLAMA_TIMEOUT_MS;
  }

  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(Math.min(15000, this.timeoutMs)),
    });
    if (!response.ok) throw new Error(`Failed to list models: ${response.statusText}`);
    const data = (await response.json()) as { models?: OllamaModel[] };
    return data.models || [];
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, stream: false }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }
      return (await response.json()) as OllamaChatResponse;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === 'AbortError' || /aborted|timed out/i.test(String(err?.message))) {
        throw new Error(
          `Ollama request timed out after ${this.timeoutMs}ms (per model/tool step). Increase CAPRIGO_OLLAMA_TIMEOUT_MS in .env and restart the gateway.`
        );
      }
      throw e;
    }
  }

  async *chatStream(request: OllamaChatRequest): AsyncGenerator<OllamaChatResponse, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch (_) {}
        }
      }
    }
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer);
      } catch (_) {}
    }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
