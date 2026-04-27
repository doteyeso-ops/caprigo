/** Suggested `OPENAI_BASE_URL` values (Caprigo appends `/v1/chat/completions` when needed). */
export interface OpenAiCompatibleBaseExample {
  label: string;
  url: string;
  note?: string;
}

export const OPENAI_COMPATIBLE_BASE_EXAMPLES: OpenAiCompatibleBaseExample[] = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { label: 'Together', url: 'https://api.together.xyz/v1' },
  { label: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { label: 'LM Studio (local)', url: 'http://127.0.0.1:1234/v1' },
];
