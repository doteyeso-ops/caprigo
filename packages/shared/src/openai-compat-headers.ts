/**
 * Headers for outbound OpenAI-compatible HTTP calls.
 * Many hosted APIs sit behind CDNs that reject Node/undici's default User-Agent.
 */

/** Override entirely, or leave unset to use a browser-like default. */
export function openAICompatibleUserAgent(): string {
  const custom = process.env.CAPRIGO_OPENAI_USER_AGENT?.trim();
  if (custom) return custom;
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

export function openAICompatibleRequestHeaders(init?: {
  bearerToken?: string | null;
  contentTypeJson?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': openAICompatibleUserAgent(),
  };
  if (init?.contentTypeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const t = init?.bearerToken?.trim?.();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}
