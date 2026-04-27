/**
 * GET a path on the local Caprigo gateway (JSON). Complements caprigo_gateway_ping with arbitrary paths.
 */

async function getJson(base, pathname, timeoutMs) {
  const url = `${base.replace(/\/$/, '')}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _nonJson: text.slice(0, 4000) };
  }
  return { status: res.status, url, body };
}

module.exports = {
  name: 'caprigo_api_get',
  description:
    'GET JSON from the Caprigo HTTP API. Params: path (e.g. /api/skills, /api/runtime, /health), baseUrl (default http://127.0.0.1:18789), timeoutMs (default 8000).',
  execute: async params => {
    const pathname = params?.path ?? params?.pathname ?? '/health';
    const base = String(params?.baseUrl ?? params?.base ?? 'http://127.0.0.1:18789');
    const timeoutMs = Math.min(60_000, Math.max(1000, parseInt(params?.timeoutMs ?? 8000, 10) || 8000));
    if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
      return { success: false, error: 'path must be a string starting with /' };
    }
    try {
      const r = await getJson(base, pathname, timeoutMs);
      return { success: true, ...r };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        base,
        path: pathname,
      };
    }
  },
};
