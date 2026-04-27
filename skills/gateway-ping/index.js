/**
 * GET /health and /api/runtime from a Caprigo gateway (same idea as offline-scripts/gateway-ping.mjs).
 */
const GATEWAY = 'http://127.0.0.1:18789';

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 2000) };
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  name: 'caprigo_gateway_ping',
  description:
    'Probe a Caprigo gateway: GET /health and /api/runtime. Param baseUrl (default http://127.0.0.1:18789).',
  execute: async params => {
    const base = (params?.baseUrl || GATEWAY).replace(/\/$/, '');
    const timeoutMs = Math.min(60000, Math.max(1000, parseInt(params?.timeoutMs ?? 8000, 10) || 8000));
    const health = await fetchJson(`${base}/health`, timeoutMs);
    const runtime = await fetchJson(`${base}/api/runtime`, timeoutMs);
    return {
      success: true,
      baseUrl: base,
      health: health.json,
      runtime: runtime.json,
      healthOk: health.ok,
      runtimeOk: runtime.ok,
    };
  },
};
