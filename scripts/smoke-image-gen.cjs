/**
 * Smoke: probe Forge + optional tiny txt2img (skip gen with CAPRIGO_IMAGE_SMOKE_PROBE_ONLY=1).
 */
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const p = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

async function main() {
  loadEnv();
  const { generateImageSkill, probeImageBackend } = require('../packages/agent/dist/skills/image');
  const probe = await probeImageBackend();
  console.log('probe', probe);
  assert(probe.ok, 'image backend should be reachable (start Forge on :7860)');
  assert(probe.provider === 'a1111' || probe.provider === 'openai' || probe.provider === 'http', 'provider');

  if (process.env.CAPRIGO_IMAGE_SMOKE_PROBE_ONLY === '1') {
    console.log('OK image-probe-only');
    return;
  }

  const out = 'generated/images/smoke-caprigo.png';
  const r = await generateImageSkill.execute({
    prompt: 'caprigo smoke test: blue cube on white background, simple 3d render',
    steps: 10,
    width: 512,
    height: 512,
    path: out,
  });
  console.log(r);
  assert(r.success, r.error || 'generate failed');
  assert(fs.existsSync(r.path), 'file written');
  assert(fs.statSync(r.path).size > 1000, 'png size');
  console.log('OK image-gen', r.path, `${(r.elapsed_ms / 1000).toFixed(1)}s`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
