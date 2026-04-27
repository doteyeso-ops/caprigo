#!/usr/bin/env node
/**
 * HTTP probe for a running Caprigo gateway (or any JSON /health).
 * Usage: node gateway-ping.mjs [baseUrl]
 * Default: http://127.0.0.1:18789
 */
const baseArg = process.argv[2] || 'http://127.0.0.1:18789';
const base = baseArg.replace(/\/$/, '');

async function main() {
  const out = { ok: false, base, health: null, runtime: null, errors: [] };

  try {
    const healthRes = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    const healthText = await healthRes.text();
    let healthJson = null;
    try {
      healthJson = JSON.parse(healthText);
    } catch {
      healthJson = { raw: healthText.slice(0, 2000) };
    }
    out.health = { status: healthRes.status, body: healthJson };
  } catch (e) {
    out.errors.push(`health: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const rtRes = await fetch(`${base}/api/runtime`, { signal: AbortSignal.timeout(8000) });
    const rtText = await rtRes.text();
    let rtJson = null;
    try {
      rtJson = JSON.parse(rtText);
    } catch {
      rtJson = { raw: rtText.slice(0, 2000) };
    }
    out.runtime = { status: rtRes.status, body: rtJson };
  } catch (e) {
    out.errors.push(`runtime: ${e instanceof Error ? e.message : String(e)}`);
  }

  out.ok = out.errors.length === 0;
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }, null, 2));
});
