/**
 * Vibes-Coded (vibes-coded.com) marketplace tools — REST parity with listings/import/feed flows.
 * Optional auth: VIBES_CODED_API_KEY (or CAPRIGO_VIBES_API_KEY).
 * Local markdown packs: CAPRIGO_VIBES_PACKS_DIR.
 *
 * Caprigo skills here are listings-oriented. Outcome prepaid / Operator Interrupt live on the public site:
 *   https://vibes-coded.com/start · X-Operator-Notify → /api/v1/operator-interrupt/{id}
 *   Official connector: https://doteyeso-ops.github.io/vibes-coded-agent-connector/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Skill, caprigoEnv } from '@caprigo/shared';

function apiBase(): string {
  return (process.env.VIBES_CODED_API_BASE || 'https://vibes-coded.com/api').replace(/\/$/, '');
}

function agentKey(): string | undefined {
  const k = process.env.VIBES_CODED_API_KEY || caprigoEnv('VIBES_API_KEY');
  return k?.trim() || undefined;
}

function packsDir(): string | undefined {
  const d = caprigoEnv('VIBES_PACKS_DIR');
  return d ? path.resolve(d) : undefined;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
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
    return { success: false, httpStatus: res.status, error: text.slice(0, 2000) };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { success: false, error: 'Invalid JSON from Vibes API', raw: text.slice(0, 500) };
  }
}

async function postJson(url: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<unknown> {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const vibesMeta = { executionType: 'api' as const };
const vibesLocalMeta = { executionType: 'local' as const };

export const vibesPublicFeedSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_public_feed',
  description:
    'Browse the public Vibes-Coded agent capability feed (semantic tags, listing hints, no auth). Use for discovery before purchase.',
  toolParameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Optional max items (if API supports)' },
    },
    additionalProperties: true,
  },
  execute: async (params: { limit?: number }) => {
    const q = params?.limit != null ? `?limit=${encodeURIComponent(String(params.limit))}` : '';
    return fetchJson(`${apiBase()}/v1/agent-feed${q}`);
  },
};

export const vibesBrowseListingsSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_browse_listings',
  description: 'Search public marketplace listings (skills, packs, agents). No API key required.',
  toolParameters: {
    type: 'object',
    properties: {
      page: { type: 'number' },
      page_size: { type: 'number', description: 'Page size (capped by server)' },
      category: { type: 'string' },
      q: { type: 'string', description: 'Search query' },
      listing_kind: { type: 'string', description: 'e.g. skill, rag_pack' },
    },
    additionalProperties: true,
  },
  execute: async (params: Record<string, unknown>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null) continue;
      search.set(k, String(v));
    }
    const qs = search.toString();
    return fetchJson(`${apiBase()}/listings${qs ? `?${qs}` : ''}`);
  },
};

export const vibesListingManifestSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_listing_manifest',
  description: 'Get machine-readable product manifest for a listing id (install hints, manifest version).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string', description: 'Numeric listing id as string' },
    },
    additionalProperties: false,
  },
  execute: async (params: { listing_id: string }) => {
    const id = encodeURIComponent(String(params.listing_id));
    return fetchJson(`${apiBase()}/listings/${id}/manifest`);
  },
};

export const vibesListingInstallSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_listing_install',
  description: 'Get normalized install plan for a listing (artifacts, steps, runtime targets).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: { listing_id: string }) => {
    const id = encodeURIComponent(String(params.listing_id));
    return fetchJson(`${apiBase()}/listings/${id}/install`);
  },
};

export const vibesPublicImportPreviewSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_public_import_preview',
  description:
    'POST import-preview for a listing (target_runtime e.g. caprigo, openclaw; optional agent_name, notes). No API key.',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
      target_runtime: { type: 'string', description: 'e.g. caprigo, generic, openclaw' },
      target_environment: { type: 'string' },
      agent_name: { type: 'string' },
      notes: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: Record<string, string | undefined>) => {
    const id = encodeURIComponent(String(params.listing_id));
    const body: Record<string, unknown> = {
      target_runtime: params.target_runtime ?? null,
      target_environment: params.target_environment ?? null,
      agent_name: params.agent_name ?? null,
      notes: params.notes ?? null,
    };
    return postJson(`${apiBase()}/listings/${id}/import-preview`, body);
  },
};

export const vibesPublicImportActionSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_public_import_action',
  description:
    'POST import-action — next-step payload for add-to-agent flow (purchase gating, importPayload). No API key.',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
      target_runtime: { type: 'string' },
      target_environment: { type: 'string' },
      agent_name: { type: 'string' },
      notes: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: Record<string, string | undefined>) => {
    const id = encodeURIComponent(String(params.listing_id));
    const body: Record<string, unknown> = {
      target_runtime: params.target_runtime ?? null,
      target_environment: params.target_environment ?? null,
      agent_name: params.agent_name ?? null,
      notes: params.notes ?? null,
    };
    return postJson(`${apiBase()}/listings/${id}/import-action`, body);
  },
};

export const vibesAgentImportPreviewSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_agent_import_preview',
  description:
    'Authenticated POST import-preview for Caprigo/runtime-specific install preview (requires VIBES_CODED_API_KEY).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
      target_runtime: { type: 'string' },
      target_environment: { type: 'string' },
      notes: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: Record<string, string | undefined>) => {
    const key = agentKey();
    if (!key) {
      return { success: false, error: 'Set VIBES_CODED_API_KEY' };
    }
    const id = encodeURIComponent(String(params.listing_id));
    const body: Record<string, unknown> = {
      target_runtime: params.target_runtime ?? null,
      target_environment: params.target_environment ?? null,
      notes: params.notes ?? null,
    };
    return postJson(`${apiBase()}/ai-agents/listings/${id}/import-preview`, body, { 'X-API-Key': key });
  },
};

export const vibesAgentImportActionSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_agent_import_action',
  description:
    'Authenticated POST import-action with purchase/importPayload for agents (requires VIBES_CODED_API_KEY).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
      target_runtime: { type: 'string' },
      target_environment: { type: 'string' },
      notes: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: Record<string, string | undefined>) => {
    const key = agentKey();
    if (!key) {
      return { success: false, error: 'Set VIBES_CODED_API_KEY' };
    }
    const id = encodeURIComponent(String(params.listing_id));
    const body: Record<string, unknown> = {
      target_runtime: params.target_runtime ?? null,
      target_environment: params.target_environment ?? null,
      notes: params.notes ?? null,
    };
    return postJson(`${apiBase()}/ai-agents/listings/${id}/import-action`, body, { 'X-API-Key': key });
  },
};

export const vibesProofOfUseSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_proof_of_use',
  description:
    'Report proof-of-use after deploying a purchased capability (outcome: good|mixed|poor; purchase_id required for paid listings).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
      outcome: { type: 'string', description: 'good | mixed | poor' },
      purchase_id: { type: 'string' },
      output_type: { type: 'string' },
      note: { type: 'string' },
    },
    additionalProperties: true,
  },
  execute: async (params: Record<string, string | undefined>) => {
    const key = agentKey();
    if (!key) {
      return { success: false, error: 'Set VIBES_CODED_API_KEY' };
    }
    const id = encodeURIComponent(String(params.listing_id));
    const body: Record<string, unknown> = {
      outcome: params.outcome || 'good',
      purchase_id: params.purchase_id ?? null,
      output_type: params.output_type ?? null,
      note: params.note ?? null,
    };
    return postJson(`${apiBase()}/ai-agents/listings/${id}/use`, body, { 'X-API-Key': key });
  },
};

export const vibesAffiliateLinkSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_affiliate_link',
  description: 'Get affiliate checkout URLs for a listing (requires registered agent with affiliate_code).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: { listing_id: string }) => {
    const key = agentKey();
    if (!key) {
      return { success: false, error: 'Set VIBES_CODED_API_KEY' };
    }
    const id = encodeURIComponent(String(params.listing_id));
    return fetchJson(`${apiBase()}/ai-agents/listings/${id}/affiliate-link`, {
      headers: { 'X-API-Key': key },
    });
  },
};

export const vibesAgentCommerceSummarySkill: Skill = {
  ...vibesMeta,
  name: 'vibes_agent_commerce_summary',
  description: 'GET commerce summary for the linked agent user (sales, spend, affiliate). Requires API key.',
  toolParameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    const key = agentKey();
    if (!key) {
      return { success: false, error: 'Set VIBES_CODED_API_KEY' };
    }
    return fetchJson(`${apiBase()}/ai-agents/commerce-summary`, {
      headers: { 'X-API-Key': key },
    });
  },
};

export const vibesAgentFeedSkill: Skill = {
  ...vibesMeta,
  name: 'vibes_agent_feed',
  description:
    'Authenticated ranked marketplace feed for agents (requires VIBES_CODED_API_KEY). Sections and activity.',
  toolParameters: {
    type: 'object',
    properties: {},
    additionalProperties: true,
  },
  execute: async () => {
    const key = agentKey();
    if (!key) {
      return {
        success: false,
        error: 'Set VIBES_CODED_API_KEY (from POST /ai-agents/register or register-with-account on vibes-coded.com)',
      };
    }
    return fetchJson(`${apiBase()}/ai-agents/listings/feed`, {
      headers: { 'X-API-Key': key },
    });
  },
};

export const vibesAgentDeliverySkill: Skill = {
  ...vibesMeta,
  name: 'vibes_agent_delivery',
  description:
    'Fetch delivery payload for a listing using agent API key (free listings, or after purchase per server rules).',
  toolParameters: {
    type: 'object',
    required: ['listing_id'],
    properties: {
      listing_id: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: { listing_id: string }) => {
    const key = agentKey();
    if (!key) {
      return {
        success: false,
        error: 'Set VIBES_CODED_API_KEY to fetch agent delivery',
      };
    }
    const id = encodeURIComponent(String(params.listing_id));
    return fetchJson(`${apiBase()}/ai-agents/listings/${id}/delivery`, {
      headers: { 'X-API-Key': key },
    });
  },
};

export const vibesReadLocalPackSkill: Skill = {
  ...vibesLocalMeta,
  name: 'vibes_read_local_pack',
  description:
    'Read a markdown skill/pack file from CAPRIGO_VIBES_PACKS_DIR (local clone of Vibes deliverables or downloaded pack).',
  toolParameters: {
    type: 'object',
    required: ['filename'],
    properties: {
      filename: {
        type: 'string',
        description: 'Basename only, e.g. rag-retrieval-blueprint-skill.md (no path traversal)',
      },
    },
    additionalProperties: false,
  },
  execute: async (params: { filename: string }) => {
    const root = packsDir();
    if (!root) {
      return {
        success: false,
        error:
          'Set CAPRIGO_VIBES_PACKS_DIR to a directory containing .md packs (e.g. .../Vibes,Coded/backend/deliverables)',
      };
    }
    const base = path.basename(params.filename);
    if (!base.endsWith('.md') || base !== params.filename.replace(/^[\\/]+/, '')) {
      return { success: false, error: 'Only basename .md files allowed' };
    }
    const full = path.join(root, base);
    const resolved = path.resolve(full);
    if (!resolved.startsWith(path.resolve(root))) {
      return { success: false, error: 'Path must stay under the configured Vibes packs directory' };
    }
    try {
      const content = await fs.readFile(resolved, 'utf-8');
      return { success: true, filename: base, content };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  },
};

export const vibesSkills: Skill[] = [
  vibesPublicFeedSkill,
  vibesBrowseListingsSkill,
  vibesListingManifestSkill,
  vibesListingInstallSkill,
  vibesPublicImportPreviewSkill,
  vibesPublicImportActionSkill,
  vibesAgentImportPreviewSkill,
  vibesAgentImportActionSkill,
  vibesAgentFeedSkill,
  vibesAgentDeliverySkill,
  vibesProofOfUseSkill,
  vibesAffiliateLinkSkill,
  vibesAgentCommerceSummarySkill,
  vibesReadLocalPackSkill,
];
