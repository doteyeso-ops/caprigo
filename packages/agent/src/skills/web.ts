/**
 * Web lookup + readable page fetch (gateway host egress).
 * Opt out: CAPRIGO_DISABLE_WEB_TOOLS=1
 *
 * web_search backends (CAPRIGO_WEB_SEARCH=auto|brave|gemini|ddg):
 * - brave: Brave public HTML SERP (no key). Optional BRAVE_API_KEY uses official API.
 * - gemini: Google Gemini + Google Search grounding (needs GEMINI_API_KEY) — optional
 * - ddg: DuckDuckGo Instant Answer + HTML SERP fallback
 * - auto: Brave HTML (or API if keyed) → Gemini if keyed → DDG
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

function webSearchMode(): 'auto' | 'brave' | 'gemini' | 'ddg' {
  const v = (process.env.CAPRIGO_WEB_SEARCH || 'auto').trim().toLowerCase();
  if (v === 'brave') return 'brave';
  if (v === 'gemini' || v === 'google' || v === 'google_ai') return 'gemini';
  if (v === 'ddg' || v === 'duckduckgo') return 'ddg';
  return 'auto';
}

function braveApiKey(): string {
  return (
    process.env.BRAVE_API_KEY?.trim() ||
    process.env.BRAVE_SEARCH_API_KEY?.trim() ||
    process.env.CAPRIGO_BRAVE_API_KEY?.trim() ||
    ''
  );
}

function geminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    ''
  );
}

function geminiModelId(): string {
  return (
    process.env.CAPRIGO_GEMINI_SEARCH_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    'gemini-2.5-flash'
  );
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
  s = s
    .replace(/&nbsp;/g, ' ')
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

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function unwrapDdgRedirect(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return href;
  }
}

/** Scrape DuckDuckGo HTML SERP when Instant Answer API is empty. */
export function parseDdgHtmlResults(html: string, max = 8): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const url = unwrapDdgRedirect(decodeHtmlEntities(m[1]));
    const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (!url || !title || seen.has(url)) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (/duckduckgo\.com\/(?:y\.js|l\/)/i.test(url)) continue;
    seen.add(url);
    out.push({ text: title, url });
  }
  if (out.length === 0) {
    const lite = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{8,160})<\/a>/gi;
    while ((m = lite.exec(html)) && out.length < max) {
      const url = unwrapDdgRedirect(decodeHtmlEntities(m[1]));
      const title = decodeHtmlEntities(m[2]).trim();
      if (!url || !title || seen.has(url)) continue;
      if (/duckduckgo\.com/i.test(url)) continue;
      seen.add(url);
      out.push({ text: title, url });
    }
  }
  return out;
}

async function fetchDdgHtmlResults(query: string): Promise<{ text: string; url: string }[]> {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...outboundHeaders('text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'),
      'User-Agent':
        process.env.CAPRIGO_WEB_UA?.trim() ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  const html = await res.text();
  if (!res.ok) return [];
  return parseDdgHtmlResults(html, 8);
}

type SearchHit = { text: string; url: string };

type SearchOk = {
  success: true;
  query: string;
  source: string;
  summary: string;
  related: SearchHit[];
  abstractUrl?: string;
  model?: string;
  lesson?: string;
};

type SearchFail = {
  success: false;
  query?: string;
  error: string;
  hint?: string;
  bodySnippet?: string;
};

/** Parse Gemini generateContent JSON into Caprigo search shape (exported for smoke). */
export function parseGeminiSearchResponse(
  data: unknown,
  query: string,
  model: string
): SearchOk | SearchFail {
  const root = data as {
    error?: { message?: string };
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        webSearchQueries?: string[];
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };
  if (root?.error?.message) {
    return { success: false, query, error: `Gemini: ${root.error.message}` };
  }
  const cand = root?.candidates?.[0];
  const answer = (cand?.content?.parts || [])
    .map(p => String(p.text || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const meta = cand?.groundingMetadata;
  const related: SearchHit[] = [];
  const seen = new Set<string>();
  for (const chunk of meta?.groundingChunks || []) {
    const uri = String(chunk?.web?.uri || '').trim();
    const title = String(chunk?.web?.title || '').trim() || uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    related.push({ text: title, url: uri });
  }
  const queries = (meta?.webSearchQueries || []).filter(Boolean);
  if (!answer && related.length === 0) {
    return {
      success: false,
      query,
      error: 'Gemini returned no grounded answer. Falling back or retry with a tighter query.',
    };
  }
  const parts: string[] = [];
  if (answer) parts.push(`Google AI answer:\n${answer}`);
  if (queries.length) parts.push(`Search queries used: ${queries.join(' · ')}`);
  if (related.length) parts.push('Sources (cite these; web_fetch if you need more detail):');
  return {
    success: true,
    query,
    source: 'gemini_google_search',
    model,
    summary: parts.join('\n\n'),
    related: related.slice(0, 10),
    abstractUrl: related[0]?.url,
    lesson:
      'Prefer summarizing this Google-grounded answer for the user. Only web_fetch if a source needs deeper detail.',
  };
}

/** Parse Brave public HTML SERP (no API key). */
export function parseBraveHtmlResults(html: string, max = 8): SearchHit[] {
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  const parts = html.split(/data-type="web"/i);
  for (const part of parts.slice(1)) {
    if (out.length >= max) break;
    const href = part.match(
      /<a href="(https?:\/\/(?!cdn\.search\.brave|imgs\.search\.brave|search\.brave\.com\/)[^"]+)"[^>]*class="[^"]*\bl1\b[^"]*"/i
    );
    if (!href) continue;
    const url = decodeHtmlEntities(href[1]).trim();
    if (!url || seen.has(url)) continue;
    let title = '';
    const t1 = part.match(
      /class="title search-snippet-title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/i
    );
    const t2 = part.match(/class="title[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/i);
    const rawTitle = (t1 || t2)?.[1] || '';
    title = decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) title = url;
    seen.add(url);
    out.push({ text: title, url });
  }
  // Fallback: any result-content l1 anchors
  if (out.length === 0) {
    const re =
      /result-content[^>]*>[\s\S]*?<a href="(https?:\/\/[^"]+)"[^>]*class="[^"]*\bl1\b[^"]*"[^>]*>[\s\S]*?class="title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < max) {
      const url = decodeHtmlEntities(m[1]).trim();
      if (!url || seen.has(url) || /search\.brave\.com/i.test(url)) continue;
      const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      seen.add(url);
      out.push({ text: title || url, url });
    }
  }
  return out;
}

async function fetchBraveHtmlResults(query: string): Promise<SearchHit[]> {
  const url = `https://search.brave.com/search?${new URLSearchParams({
    q: query,
    source: 'web',
  })}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        process.env.CAPRIGO_WEB_UA?.trim() ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
  });
  const html = await res.text();
  if (!res.ok) return [];
  return parseBraveHtmlResults(html, 8);
}

async function searchViaBraveHtml(query: string): Promise<SearchOk | SearchFail> {
  try {
    const related = await fetchBraveHtmlResults(query);
    if (!related.length) {
      return {
        success: false,
        query,
        error: 'Brave HTML search returned no results (blocked or empty). Trying next backend.',
      };
    }
    const lines = related.map((h, i) => `${i + 1}. ${h.text}\n   ${h.url}`);
    return {
      success: true,
      query,
      source: 'brave_html',
      summary: `Brave Search results for "${query}":\n\n${lines.join('\n\n')}\n\nSummarize for the user; web_fetch 1–2 top URLs if you need more detail.`,
      related,
      abstractUrl: related[0]?.url,
      lesson: 'Brave HTML SERP (no API key). Prefer citing these links; web_fetch when snippets are thin.',
    };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, query, error: err?.message || String(e) };
  }
}

/** Parse Brave Search API JSON (exported for smoke). */
export function parseBraveSearchResponse(data: unknown, query: string): SearchOk | SearchFail {
  const root = data as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
      }>;
    };
    news?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
    mixed?: { type?: string };
    query?: { original?: string };
  };

  const related: SearchHit[] = [];
  const seen = new Set<string>();
  const pushHit = (title?: string, url?: string, desc?: string) => {
    const u = String(url || '').trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    const t = String(title || u).trim();
    const d = String(desc || '').trim();
    related.push({ text: d ? `${t} — ${d.slice(0, 180)}` : t, url: u });
  };

  for (const r of root?.web?.results || []) {
    pushHit(r.title, r.url, r.description || r.extra_snippets?.[0]);
  }
  for (const r of root?.news?.results || []) {
    pushHit(r.title, r.url, r.description);
  }

  if (related.length === 0) {
    return {
      success: false,
      query,
      error: 'Brave returned no web results. Retry with a shorter query or another backend.',
    };
  }

  const lines = related.slice(0, 8).map((h, i) => `${i + 1}. ${h.text}\n   ${h.url}`);
  return {
    success: true,
    query,
    source: 'brave',
    summary: `Brave Search results for "${query}":\n\n${lines.join('\n\n')}\n\nSummarize for the user; web_fetch 1–2 top URLs if you need more detail.`,
    related: related.slice(0, 10),
    abstractUrl: related[0]?.url,
    lesson: 'Brave SERP is primary for Caprigo. Prefer citing these links; web_fetch when snippets are thin.',
  };
}

async function searchViaBrave(query: string): Promise<SearchOk | SearchFail> {
  // Prefer official API when keyed; otherwise scrape public HTML (no key).
  if (braveApiKey()) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '8');
    url.searchParams.set('text_decorations', 'false');
    url.searchParams.set('search_lang', 'en');

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': braveApiKey(),
        },
        signal: AbortSignal.timeout(25_000),
      });
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return {
          success: false,
          query,
          error: `Brave API non-JSON HTTP ${res.status}`,
          bodySnippet: text.slice(0, 400),
        };
      }
      if (!res.ok) {
        const msg =
          (data as { message?: string; error?: { detail?: string } })?.message ||
          (data as { error?: { detail?: string } })?.error?.detail ||
          text.slice(0, 240);
        // Fall through to HTML if API fails
        const html = await searchViaBraveHtml(query);
        if (html.success) {
          return {
            ...html,
            lesson: `Brave API failed (${msg}); used Brave HTML. ${html.lesson || ''}`.trim(),
          };
        }
        return { success: false, query, error: `Brave HTTP ${res.status}: ${msg}` };
      }
      return parseBraveSearchResponse(data, query);
    } catch (e: unknown) {
      const err = e as { message?: string };
      const html = await searchViaBraveHtml(query);
      if (html.success) return html;
      return { success: false, query, error: err?.message || String(e) };
    }
  }

  return searchViaBraveHtml(query);
}

async function searchViaGemini(query: string): Promise<SearchOk | SearchFail> {
  const key = geminiApiKey();
  if (!key) {
    return {
      success: false,
      query,
      error: 'No GEMINI_API_KEY / GOOGLE_API_KEY — set one for Google AI search grounding.',
    };
  }
  const model = geminiModelId();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const prompt = [
    "You are Caprigo's web research helper. Answer the user question using Google Search grounding.",
    'Be concise and factual. Prefer lists for events/meetups (name, when/where if known, link).',
    'Include concrete names and URLs when available. If uncertain, say what you found vs what is missing.',
    '',
    `Question: ${query}`,
  ].join('\n');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        query,
        error: `Gemini non-JSON HTTP ${res.status}`,
        bodySnippet: text.slice(0, 400),
      };
    }
    if (!res.ok) {
      const msg =
        (data as { error?: { message?: string } })?.error?.message || text.slice(0, 240);
      return { success: false, query, error: `Gemini HTTP ${res.status}: ${msg}` };
    }
    return parseGeminiSearchResponse(data, query, model);
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, query, error: err?.message || String(e) };
  }
}

async function searchViaDdg(query: string): Promise<SearchOk | SearchFail> {
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
      return { success: false, query, error: `Search HTTP ${res.status}`, bodySnippet: text.slice(0, 500) };
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { success: false, query, error: 'Invalid JSON from search API' };
    }

    const answer = typeof data.Answer === 'string' ? data.Answer.trim() : '';
    const abstract = typeof data.AbstractText === 'string' ? data.AbstractText.trim() : '';
    const abstractUrl = typeof data.AbstractURL === 'string' ? data.AbstractURL : '';
    const heading = typeof data.Heading === 'string' ? data.Heading : '';
    let related = flattenDdgTopics(data.RelatedTopics, 8);
    let source: 'instant' | 'html' | 'mixed' = 'instant';

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
      try {
        const htmlHits = await fetchDdgHtmlResults(query);
        if (htmlHits.length) {
          related = htmlHits;
          source = 'html';
          parts.push(`Web results for "${query}" (use web_fetch on useful URLs):`);
        }
      } catch {
        /* keep empty */
      }
    } else if (related.length === 0) {
      try {
        const htmlHits = await fetchDdgHtmlResults(query);
        if (htmlHits.length) {
          related = [...related, ...htmlHits].slice(0, 10);
          source = 'mixed';
        }
      } catch {
        /* ignore */
      }
    }

    if (!parts.length && related.length === 0) {
      return {
        success: false,
        query,
        error:
          'No web results. Retry with a shorter/different query, or web_fetch a known URL. Do not tell the user you lack internet access.',
        hint: 'Set GEMINI_API_KEY for Google AI grounded search, or retry web_search / web_fetch.',
      };
    }

    if (related.length && !parts.some(p => /Web results/i.test(p))) {
      parts.push('Related links (web_fetch promising ones):');
    }

    return {
      success: true,
      query,
      source,
      summary: parts.join('\n\n'),
      abstractUrl: abstractUrl || undefined,
      related,
      lesson:
        source === 'html'
          ? 'Instant Answer was empty; HTML search returned links. Always web_fetch 1–2 top links before saying nothing was found.'
          : undefined,
    };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, query, error: err?.message || String(e) };
  }
}

export const webSearchSkill: Skill = {
  name: 'web_search',
  description:
    'INTERNET research for facts, news, events, meetups, docs, how-tos — anything not in the local repo. Prefer this before claiming you lack information. Default: Brave Search HTML (no API key), then DuckDuckGo. Do NOT use for grepping code — that is search_files.',
  executionType: 'api',
  toolParameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keywords or full question (e.g. "AI meetups near Nashville this month").',
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

    const mode = webSearchMode();
    const errors: string[] = [];
    const hasGemini = !!geminiApiKey();

    // Free-first: Brave HTML/API → Gemini (only if keyed) → DDG
    const order: Array<'brave' | 'gemini' | 'ddg'> =
      mode === 'auto'
        ? [...(hasGemini ? (['brave', 'gemini'] as const) : (['brave'] as const)), 'ddg']
        : mode === 'brave'
          ? hasGemini
            ? ['brave', 'gemini', 'ddg']
            : ['brave', 'ddg']
          : mode === 'gemini'
            ? ['gemini', 'ddg']
            : ['ddg'];

    for (const backend of order) {
      const result =
        backend === 'brave'
          ? await searchViaBrave(query)
          : backend === 'gemini'
            ? await searchViaGemini(query)
            : await searchViaDdg(query);
      if (result.success) {
        if (errors.length && (backend === 'ddg' || result.source === 'brave_html')) {
          return {
            ...result,
            lesson: `${errors.join('; ')}; used ${result.source}. ${result.lesson || ''}`.trim(),
          };
        }
        return result;
      }
      errors.push(`${backend}: ${result.error}`);
    }

    return {
      success: false,
      query,
      error: errors.join(' · ') || 'No web search backend succeeded',
      hint: 'Brave HTML and DuckDuckGo need no API keys. Optional: BRAVE_API_KEY or GEMINI_API_KEY.',
    };
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
