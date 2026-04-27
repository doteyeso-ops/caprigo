/**
 * Vibes-Coded marketplace: browse public listings and extract Caprigo skill JS from import-action payloads.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadSkillsFromFile } from '@caprigo/user-skills-loader';

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      return {
        success: false,
        httpStatus: res.status,
        error: j?.error || j?.message || text.slice(0, 2000),
      };
    } catch {
      return { success: false, httpStatus: res.status, error: text.slice(0, 2000) };
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { success: false, error: 'Invalid JSON', raw: text.slice(0, 500) };
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<unknown> {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function vibesBrowseListings(
  apiBase: string,
  query: Record<string, string | undefined>
): Promise<unknown> {
  const base = apiBase.replace(/\/$/, '');
  const u = new URL(`${base}/listings`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, v);
  }
  return fetchJson(u.toString());
}

export interface NormalizedListing {
  id: string;
  title?: string;
  description?: string;
  listing_kind?: string;
}

export function normalizeListingHits(data: unknown): NormalizedListing[] {
  const out: NormalizedListing[] = [];
  const push = (x: unknown) => {
    const n = normalizeOneListing(x);
    if (n) out.push(n);
  };
  if (Array.isArray(data)) {
    data.forEach(push);
    return out;
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const arr = o.data ?? o.results ?? o.listings ?? o.items ?? o.records;
    if (Array.isArray(arr)) {
      arr.forEach(push);
      return out;
    }
  }
  return out;
}

function normalizeOneListing(x: unknown): NormalizedListing | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = o.id ?? o.listing_id ?? o.listingId;
  if (id == null) return null;
  return {
    id: String(id),
    title:
      typeof o.title === 'string'
        ? o.title
        : typeof o.name === 'string'
          ? o.name
          : undefined,
    description: typeof o.description === 'string' ? o.description : undefined,
    listing_kind: typeof o.listing_kind === 'string' ? o.listing_kind : undefined,
  };
}

/** Vibes import-preview body — request Caprigo-targeted artifacts when the marketplace supports it. */
const PREVIEW_BODY = {
  target_runtime: 'caprigo',
  target_environment: null as string | null,
  agent_name: null as string | null,
  notes: 'caprigo-gateway',
};

/**
 * Call import-preview then import-action (public or authenticated agent routes).
 */
export async function vibesFetchImportPayload(
  apiBase: string,
  listingId: string,
  agentKey?: string
): Promise<unknown> {
  const base = apiBase.replace(/\/$/, '');
  const id = encodeURIComponent(String(listingId));

  const useAgent = !!agentKey?.trim();
  const headers = useAgent ? { 'X-API-Key': agentKey!.trim() } : undefined;
  const previewPath = useAgent
    ? `${base}/ai-agents/listings/${id}/import-preview`
    : `${base}/listings/${id}/import-preview`;
  const actionPath = useAgent
    ? `${base}/ai-agents/listings/${id}/import-action`
    : `${base}/listings/${id}/import-action`;

  await postJson(previewPath, { ...PREVIEW_BODY }, headers);
  return postJson(actionPath, { ...PREVIEW_BODY }, headers);
}

/**
 * Extract a single Caprigo skill module string from Vibes import-action JSON.
 */
export function extractCaprigoSkillCode(payload: unknown): string | null {
  if (payload == null) return null;
  const tried = new WeakSet<object>();

  function fromObject(r: Record<string, unknown>): string | null {
    const keys = [
      'code',
      'skill_js',
      'caprigo_skill_js',
      `${['rad', 'bot'].join('')}_skill_js`,
      'javascript',
      'module_code',
      'skill_code',
    ];
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v.length > 40 && looksLikeSkillModule(v)) {
        return v;
      }
    }
    const ip = (r.importPayload ?? r.import_payload) as Record<string, unknown> | undefined;
    if (ip && typeof ip === 'object') {
      for (const k of keys) {
        const v = ip[k];
        if (typeof v === 'string' && v.length > 40 && looksLikeSkillModule(v)) {
          return v;
        }
      }
      const files = ip.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          if (f && typeof f === 'object') {
            const fo = f as Record<string, unknown>;
            const pathStr = String(fo.path ?? fo.name ?? '');
            const content = fo.content;
            if (
              typeof content === 'string' &&
              content.length > 40 &&
              /\.(js|cjs)$/i.test(pathStr) &&
              looksLikeSkillModule(content)
            ) {
              return content;
            }
          }
        }
      }
    }
    return null;
  }

  function walk(o: unknown, depth: number): string | null {
    if (depth > 14) return null;
    if (!o || typeof o !== 'object') return null;
    if (tried.has(o as object)) return null;
    tried.add(o as object);
    const r = o as Record<string, unknown>;
    const direct = fromObject(r);
    if (direct) return direct;
    for (const v of Object.values(r)) {
      if (v && typeof v === 'object') {
        const sub = fromObject(v as Record<string, unknown>);
        if (sub) return sub;
        const w = walk(v, depth + 1);
        if (w) return w;
      }
    }
    return null;
  }

  return walk(payload, 0);
}

function looksLikeSkillModule(s: string): boolean {
  return (
    s.includes('execute') &&
    (s.includes('module.exports') || s.includes('exports.') || s.includes('export default'))
  );
}

export function defaultVibesFolder(listingId: string): string {
  const raw = `vibes_${String(listingId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const t = raw.slice(0, 48);
  return /^[a-zA-Z]/.test(t) ? t : `v_${t}`.slice(0, 48);
}

/** Map exported skill names → Vibes listing metadata (via `.vibes-source.json` next to each imported skill). */
export function mapVibesMarketplaceBySkillName(
  skillsDir: string
): Map<string, { listingId: string; title?: string }> {
  const map = new Map<string, { listingId: string; title?: string }>();
  try {
    if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
      return map;
    }
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const metaPath = path.join(skillsDir, ent.name, '.vibes-source.json');
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        listingId?: string;
        title?: string;
        skillNames?: string[];
      };
      if (!meta.listingId) continue;
      const idx = path.join(skillsDir, ent.name, 'index.js');
      let names = Array.isArray(meta.skillNames) ? meta.skillNames.map(String).filter(Boolean) : [];
      if (names.length === 0 && fs.existsSync(idx)) {
        const trial = loadSkillsFromFile(idx);
        names = trial.loaded.map(s => s.name);
      }
      for (const n of names) {
        map.set(n, { listingId: String(meta.listingId), title: meta.title });
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}
