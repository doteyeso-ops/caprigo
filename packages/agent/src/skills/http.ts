import { Skill } from '@caprigo/shared';
import { openAICompatibleUserAgent } from '@caprigo/shared';

const DEFAULT_MAX_BODY = 2_000_000;

function maxHttpBodyBytes(): number {
  const raw = process.env.CAPRIGO_HTTP_MAX_BODY_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_BODY;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 10_000 ? Math.min(n, 20_000_000) : DEFAULT_MAX_BODY;
}

function mergeHeaders(h?: Record<string, string>): Record<string, string> {
  return {
    Accept: '*/*',
    'User-Agent': openAICompatibleUserAgent(),
    ...h,
  };
}

export const httpGetSkill: Skill = {
  name: 'http_get',
  description:
    'HTTP GET for APIs and raw URLs. Prefer `web_search` / `web_fetch` for browsing; use this when you need the exact response body (JSON/XML) or non-HTML data.',
  execute: async (params: { url: string; headers?: Record<string, string> }) => {
    try {
      const response = await fetch(params.url, {
        method: 'GET',
        headers: mergeHeaders(params.headers),
      });
      let text = await response.text();
      const maxB = maxHttpBodyBytes();
      if (text.length > maxB) {
        text = text.substring(0, maxB) + '\n... (truncated; set CAPRIGO_HTTP_MAX_BODY_BYTES to raise cap)';
      }
      return {
        success: true,
        status: response.status,
        body: text,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const httpPostSkill: Skill = {
  name: 'http_post',
  description: 'HTTP POST with JSON body for REST APIs.',
  execute: async (params: { url: string; body?: any; headers?: Record<string, string> }) => {
    try {
      const headers: Record<string, string> = mergeHeaders({
        'Content-Type': 'application/json',
        ...params.headers,
      });
      const response = await fetch(params.url, {
        method: 'POST',
        headers,
        body: params.body ? JSON.stringify(params.body) : undefined,
      });
      let text = await response.text();
      const maxB = maxHttpBodyBytes();
      if (text.length > maxB) {
        text = text.substring(0, maxB) + '\n... (truncated; set CAPRIGO_HTTP_MAX_BODY_BYTES to raise cap)';
      }
      return {
        success: true,
        status: response.status,
        body: text,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const httpSkills: Skill[] = [httpGetSkill, httpPostSkill];
