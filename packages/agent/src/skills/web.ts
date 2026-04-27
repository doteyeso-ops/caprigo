/**
 * Web lookup + readable page fetch (gateway host egress).
 * Opt out: CAPRIGO_DISABLE_WEB_TOOLS=1
 */

import type { Skill } from '@caprigo/shared';
import { openAICompatibleUserAgent } from '@caprigo/shared';

const DEFAULT_FETCH_CHARS = 12_000;
const MAX_FETCH_CHARS = 200_000;
const FETCH_TIMEOUT_MS = 45_000;

function webToolsDisabled(): boolean {
  const v = process.env.CAPRIGO_DISABLE_WEB_TOOLS?.trim();
  return v === '1' || v === 'true';
}

function outboundHeaders(accept: string): Record<string, string> {
  return {
    Accept: accept,
    'User-Agent': openAICompatibleUserAgent(),
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function stripHtmlToText(html: string, maxChars: number): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n… (truncated)';
  return s;
}

function safeHttpUrl(url: string): URL | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

function flattenDdgTopics(raw: unknown, max: number): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const walk = (node: unknown) => {
    if (out.length >= max) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.Text === 'string' && typeof o.FirstURL === 'string') {
        out.push({ text: o.Text.trim(), url: o.FirstURL });
      }
      if (Array.isArray(o.Topics)) walk(o.Topics);
    }
  };
  walk(raw);
  return out;
}

export const webSearchSkill: Skill = {
  name: 'web_search',
  description:
    'Look up concise facts and links via DuckDuckGo (no API key). Use for general questions before fetching full pages. Returns summary text and related links when available.',
  executionType: 'api',
  toolParameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keywords or question (e.g. "Rust ownership rules", "Caprigo planet diameter").',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute: async (params: { query?: string }) => {
    if (webToolsDisabled()) {
      return { success: false, error: 'Web tools disabled (CAPRIGO_DISABLE_WEB_TOOLS=1).' };
    }
    const query = String(params?.query ?? '').trim();
    if (!query) return { success: false, error: 'query is required' };

    const url = `https://api.duckduckgo.com/?${new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      no_redirect: '1',
    })}`;

    try {
      const res = await fetch(url, {
        headers: outboundHeaders('application/json'),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) {
        return { success: false, error: `Search HTTP ${res.status}`, bodySnippet: text.slice(0, 500) };
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return { success: false, error: 'Invalid JSON from search API' };
      }

      const answer = typeof data.Answer === 'string' ? data.Answer.trim() : '';
      const abstract = typeof data.AbstractText === 'string' ? data.AbstractText.trim() : '';
      const abstractUrl = typeof data.AbstractURL === 'string' ? data.AbstractURL : '';
      const heading = typeof data.Heading === 'string' ? data.Heading : '';
      const related = flattenDdgTopics(data.RelatedTopics, 8);

      const parts: string[] = [];
      if (answer) parts.push(`Instant answer: ${answer}`);
      if (abstract) {
        parts.push(
          abstractUrl ? `Summary: ${abstract}\nSource: ${abstractUrl}` : `Summary: ${abstract}`
        );
      } else if (heading && !answer) {
        parts.push(`Topic: ${heading}`);
      }
      if (!parts.length && related.length === 0) {
        parts.push(
          'No instant summary from DuckDuckGo for this query. Try `web_fetch` on a known URL, narrow the query, or use `http_get` against a specific API.'
        );
      }

      return {
        success: true,
        query,
        summary: parts.join('\n\n'),
        abstractUrl: abstractUrl || undefined,
        related,
      };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { success: false, error: err?.message || String(e) };
    }
  },
};

export const webFetchSkill: Skill = {
  name: 'web_fetch',
  description:
    'Fetch a public http(s) page and return plain text (HTML tags stripped). Use after `web_search` when you have a URL, or to read documentation pages. Cannot run JavaScript on the page.',
  executionType: 'hybrid',
  toolParameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full https (or http) URL.' },
      max_chars: {
        type: 'number',
        description: `Max characters of text to return (default ${DEFAULT_FETCH_CHARS}, max ${MAX_FETCH_CHARS}).`,
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  execute: async (params: { url?: string; max_chars?: number }) => {
    if (webToolsDisabled()) {
      return { success: false, error: 'Web tools disabled (CAPRIGO_DISABLE_WEB_TOOLS=1).' };
    }
    const rawUrl = String(params?.url ?? '').trim();
    const u = safeHttpUrl(rawUrl);
    if (!u) return { success: false, error: 'url must be an absolute http(s) URL' };

    let maxChars = DEFAULT_FETCH_CHARS;
    if (params?.max_chars != null) {
      const n = Number(params.max_chars);
      if (Number.isFinite(n)) maxChars = Math.min(MAX_FETCH_CHARS, Math.max(500, Math.floor(n)));
    }

    try {
      const res = await fetch(u.toString(), {
        method: 'GET',
        headers: outboundHeaders('text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'),
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const raw = await res.text();
      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: `HTTP ${res.status}`,
          bodySnippet: stripHtmlToText(raw, 800),
        };
      }
      const contentType = res.headers.get('content-type') || '';
      const text =
        /application\/json/i.test(contentType) || /^[\s\n]*[{[]/.test(raw.slice(0, 20))
          ? raw.length > maxChars
            ? raw.slice(0, maxChars) + '\n… (truncated)'
            : raw
          : stripHtmlToText(raw, maxChars);

      return {
        success: true,
        url: u.toString(),
        status: res.status,
        content_type: contentType || undefined,
        text,
      };
    } catch (e: unknown) {
      const err = e as { message?: string };
      return { success: false, error: err?.message || String(e) };
    }
  },
};

export const webSkills: Skill[] = [webSearchSkill, webFetchSkill];
