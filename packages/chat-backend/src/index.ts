/**
 * Factory for ChatLLMBackend (LM Studio / OpenAI-compatible vs Ollama).
 *
 * Env:
 * - CAPRIGO_LLM_PROVIDER: openai_compatible | openai | ollama | api (default: openai_compatible → LM Studio)
 * - OPENAI_BASE_URL or OPENAI_API_BASE: default http://127.0.0.1:1234/v1 (LM Studio)
 * - OPENAI_API_KEY or CAPRIGO_OPENAI_API_KEY: optional for local servers
 * - OLLAMA_URL or CAPRIGO_OLLAMA_URL: default http://localhost:11434
 */

import type { ChatLLMBackend } from '@caprigo/shared';
import { caprigoEnv } from '@caprigo/shared';
import { OllamaLLMBackend } from './ollama-backend';
import { OpenAICompatibleLLMBackend } from './openai-backend';

export { OllamaLLMBackend, OpenAICompatibleLLMBackend };

/** Default local OpenAI-compatible endpoint (LM Studio). */
export const DEFAULT_LM_STUDIO_BASE = 'http://127.0.0.1:1234/v1';

export function createLLMBackendFromEnv(): ChatLLMBackend {
  const p = (caprigoEnv('LLM_PROVIDER') || 'openai_compatible').toLowerCase().trim();
  const useOllama = p === 'ollama';

  if (useOllama) {
    const ollamaUrl =
      process.env.OLLAMA_URL?.trim() || caprigoEnv('OLLAMA_URL') || 'http://localhost:11434';
    return new OllamaLLMBackend(ollamaUrl);
  }

  const base =
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_API_BASE?.trim() ||
    DEFAULT_LM_STUDIO_BASE;
  const key = process.env.OPENAI_API_KEY?.trim() || caprigoEnv('OPENAI_API_KEY') || '';
  return new OpenAICompatibleLLMBackend(base, key);
}
