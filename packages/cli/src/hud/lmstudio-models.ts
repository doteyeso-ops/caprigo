/** LM Studio model list + load helpers. */

import {
  canonicalLmStudioModelId,
  describeLmStudioTarget,
  probeLmStudio,
} from '../embedded-runtime';

function rootFromOpenAiBase(baseUrl: string): string {
  // http://host:1234/v1 → http://host:1234
  return baseUrl.replace(/\/$/, '').replace(/\/v1$/i, '');
}

function authHeaders(): Record<string, string> {
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.LM_API_TOKEN?.trim() || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function listLmStudioModels(baseUrl?: string): Promise<{
  base: string;
  models: string[];
  error?: string;
}> {
  const probe = await probeLmStudio(baseUrl);
  return { base: probe.base, models: probe.models.filter(m => !/embed/i.test(m)), error: probe.error };
}

/** Unload every loaded LLM instance so a new load cannot stack `:2` / `:3` copies. */
export async function unloadAllLmStudioModels(baseUrl?: string): Promise<number> {
  const openAiBase = (baseUrl || describeLmStudioTarget()).replace(/\/$/, '');
  const root = rootFromOpenAiBase(openAiBase);
  const headers = authHeaders();
  let unloaded = 0;
  try {
    const res = await fetch(`${root}/api/v1/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return 0;
    const catalog = (await res.json()) as {
      models?: Array<{
        type?: string;
        loaded_instances?: Array<string | { id?: string; instance_id?: string }>;
      }>;
    };
    for (const m of catalog.models || []) {
      if (m.type === 'embedding') continue;
      for (const inst of m.loaded_instances || []) {
        const id =
          typeof inst === 'string' ? inst : String(inst.id || inst.instance_id || '');
        if (!id) continue;
        try {
          const u = await fetch(`${root}/api/v1/models/unload`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ instance_id: id }),
            signal: AbortSignal.timeout(60_000),
          });
          if (u.ok) unloaded += 1;
        } catch {
          /* ignore single unload failure */
        }
      }
    }
  } catch {
    return unloaded;
  }
  return unloaded;
}

export async function loadLmStudioModel(
  modelId: string,
  baseUrl?: string
): Promise<{ ok: boolean; detail: string }> {
  const openAiBase = (baseUrl || describeLmStudioTarget()).replace(/\/$/, '');
  const root = rootFromOpenAiBase(openAiBase);
  // Never load `model:2` instance ids — always the catalog key.
  const catalogId = canonicalLmStudioModelId(modelId);
  const headers = authHeaders();

  // Clear prior instances first (avoids duplicate `:N` rows + VRAM pile-up).
  await unloadAllLmStudioModels(openAiBase);

  const endpoints = [`${root}/api/v1/models/load`, `${root}/api/v0/models/load`];

  let lastErr = 'load failed';
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: catalogId, context_length: 8192 }),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await res.text();
      if (res.ok) {
        let detail = `loaded ${catalogId}`;
        try {
          const j = JSON.parse(text) as {
            status?: string;
            load_time_seconds?: number;
            instance_id?: string;
          };
          detail =
            `loaded ${j.instance_id || catalogId}` +
            (j.load_time_seconds != null ? ` in ${j.load_time_seconds.toFixed(1)}s` : '');
        } catch {
          /* keep */
        }
        return { ok: true, detail };
      }
      lastErr = `HTTP ${res.status}: ${text.slice(0, 160)}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  // Fallback: many LM Studio builds load on first chat with the model id — treat selection as OK.
  return {
    ok: true,
    detail: `selected ${catalogId} (native load API unavailable — will use on next chat). ${lastErr}`,
  };
}
