/**
 * Factory for ChatLLMBackend (Ollama vs OpenAI-compatible HTTP).
 *
 * Env:
 * - CAPRIGO_LLM_PROVIDER: ollama | openai | openai_compatible | api (default: ollama)
 * - OLLAMA_URL or CAPRIGO_OLLAMA_URL: default http://localhost:11434
 * - OPENAI_BASE_URL or OPENAI_API_BASE: default https://api.openai.com/v1
 * - OPENAI_API_KEY or CAPRIGO_OPENAI_API_KEY: optional for some local servers
 */

import type { ChatLLMBackend } from '@caprigo/shared';
import { caprigoEnv } from '@caprigo/shared';
import { OllamaLLMBackend } from './ollama-backend';
import { OpenAICompatibleLLMBackend } from './openai-backend';

export { OllamaLLMBackend, OpenAICompatibleLLMBackend };

export function createLLMBackendFromEnv(): ChatLLMBackend {
  const p = (caprigoEnv('LLM_PROVIDER') || 'ollama').toLowerCase().trim();
  const useOpenAI =
    p === 'openai' ||
    p === 'openai_compatible' ||
    p === 'api' ||
    p === 'http' ||
    p === 'remote';

  if (useOpenAI) {
    const base =
      process.env.OPENAI_BASE_URL?.trim() ||
      process.env.OPENAI_API_BASE?.trim() ||
      'https://api.openai.com/v1';
    const key = process.env.OPENAI_API_KEY?.trim() || caprigoEnv('OPENAI_API_KEY') || '';
    return new OpenAICompatibleLLMBackend(base, key);
  }

  const ollamaUrl =
    process.env.OLLAMA_URL?.trim() || caprigoEnv('OLLAMA_URL') || 'http://localhost:11434';
  return new OllamaLLMBackend(ollamaUrl);
}
