/**
 * Real-work model benchmark: each model must create a unique HTML page via Caprigo tools.
 * Usage: node scripts/bench-models-webpage.mjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// Load .env
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

process.env.CAPRIGO_HARNESS_MODE = '1';

const { createEmbeddedRuntime } = require('../packages/cli/dist/embedded-runtime');

const OUT_DIR = path.join(ROOT, 'generated', 'bench');
const REPORT_JSON = path.join(OUT_DIR, `report-${stamp()}.json`);
const REPORT_MD = path.join(OUT_DIR, `report-${stamp()}.md`);

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function slug(model) {
  return model.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

function scoreFile(filePath, token) {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      bytes: 0,
      hasDoctype: false,
      hasHtml: false,
      hasToken: false,
      hasStyle: false,
      stubby: false,
      score: 0,
    };
  }
  const body = fs.readFileSync(filePath, 'utf8');
  const hasDoctype = /<!DOCTYPE\s+html/i.test(body);
  const hasHtml = /<html[\s>]/i.test(body);
  const hasToken = body.includes(token);
  const hasStyle = /<style[\s>]|style=/i.test(body);
  const stubby = /\.\.\.|…/.test(body) && body.length < 800;
  let score = 0;
  if (hasDoctype) score += 15;
  if (hasHtml) score += 15;
  if (hasToken) score += 25;
  if (hasStyle) score += 15;
  if (body.length >= 600) score += 15;
  if (body.length >= 1200) score += 10;
  if (!stubby) score += 5;
  return {
    exists: true,
    bytes: body.length,
    hasDoctype,
    hasHtml,
    hasToken,
    hasStyle,
    stubby,
    score: Math.min(100, score),
  };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function healthChat(model) {
  const base = (process.env.OPENAI_BASE_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'x'}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with OK' }],
      max_tokens: 6,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`health ${res.status}: ${text.slice(0, 160)}`);
  return true;
}

async function tryLoad(model) {
  const { loadLmStudioModel } = require('../packages/cli/dist/hud/lmstudio-models');
  const loaded = await loadLmStudioModel(model);
  // Give llama-server a moment after load API
  await new Promise(r => setTimeout(r, 2500));
  await healthChat(model);
  return loaded;
}

async function benchOne(model) {
  const id = slug(model);
  const token = `BENCH_TOKEN_${id.toUpperCase().replace(/-/g, '_')}`;
  const rel = `generated/bench/${id}-nebula.html`;
  const abs = path.join(ROOT, rel);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }

  let loadInfo = null;
  try {
    loadInfo = await tryLoad(model);
  } catch (e) {
    return {
      model,
      slug: id,
      path: rel,
      token,
      elapsedMs: 0,
      error: `load/health failed: ${e instanceof Error ? e.message : String(e)}`,
      tools: [],
      llmCalls: null,
      responseHead: '',
      file: scoreFile(abs, token),
      usedWrite: false,
      usedRead: false,
      verifyOk: false,
      totalScore: 0,
      events: [],
      loadInfo,
      hallucinated: false,
    };
  }

  const prompt = [
    `You are Caprigo. Use tools. Do not pretend.`,
    `TASK: create a webpage by calling write_file.`,
    `Path (exact): ${rel}`,
    `Must include this exact visible token in the page body text: ${token}`,
    `Full HTML5: DOCTYPE, html, head, body.`,
    `Design: deep-space nebula CSS gradients, centered glass card, subtle CSS animation.`,
    `H1: Caprigo Bench — ${model}`,
    `Inside the card: a unique 3-5 line micro-story (not lorem).`,
    `After write_file succeeds, call read_file on ${rel}.`,
    `If read shows stubs or missing token, rewrite.`,
    `Never claim the file exists unless write_file returned success.`,
    `Never ask to continue.`,
  ].join('\n');

  const t0 = Date.now();
  let response = '';
  let stats = null;
  let error = null;
  const events = [];

  let rt;
  try {
    rt = await createEmbeddedRuntime({ model, displayName: `bench-${id}` });
    const result = await withTimeout(
      rt.processMessage(prompt, e => {
        if (e.type === 'task_start' || e.type === 'task_end' || (e.type === 'status' && e.detail)) {
          events.push({
            type: e.type,
            tool: e.tool || e.label,
            ok: e.ok,
            detail: e.detail,
            summary: e.summary,
            phase: e.phase,
          });
        }
      }),
      180000,
      model
    );
    response = result.response || '';
    stats = result.stats;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    if (rt) {
      try {
        await rt.dispose();
      } catch {
        /* ignore */
      }
    }
  }

  const elapsedMs = Date.now() - t0;
  const tools = stats?.tools || [];
  const file = scoreFile(abs, token);
  const usedWrite = tools.some(t => /write_file|hash_edit/.test(t));
  const usedRead = tools.includes('read_file');
  const verifyOk =
    usedWrite &&
    usedRead &&
    tools.lastIndexOf('read_file') >
      Math.max(tools.lastIndexOf('write_file'), tools.lastIndexOf('hash_edit'));
  const hallucinated =
    !usedWrite &&
    !file.exists &&
    /created|written|saved|webpage|html/i.test(response || '');

  let total = file.score;
  if (usedWrite) total += 20;
  if (verifyOk) total += 15;
  if (!error) total += 5;
  if (hallucinated) total = Math.min(total, 10);
  if (error) total = Math.min(total, 25);

  return {
    model,
    slug: id,
    path: rel,
    token,
    elapsedMs,
    error,
    tools,
    llmCalls: stats?.llmCalls ?? null,
    responseHead: (response || '').slice(0, 280).replace(/\s+/g, ' '),
    file,
    usedWrite,
    usedRead,
    verifyOk,
    hallucinated,
    totalScore: Math.min(100, total),
    events: events.slice(0, 40),
    loadInfo,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { probeLmStudio } = require('../packages/cli/dist/embedded-runtime');
  const probe = await probeLmStudio();
  if (!probe.ok) {
    console.error('LM Studio unreachable:', probe.error);
    process.exit(1);
  }

  const argOnly = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const models = probe.models.filter(m => !/embed/i.test(m));

  const preferred = argOnly.length
    ? argOnly
    : [
        'openzero-fusion-qwen3-4b-agentic@q4_k_m',
        'meine-gehorsame-coding-ki',
        'google/gemma-4-e2b',
        'deepseek-v4-pro-qwen3.5-4b-i1',
        'google/gemma-3-4b',
        'gemma-4-e4b-it-obliterated',
        'deepseek/deepseek-r1-0528-qwen3-8b',
        'openzero-fusion-qwen3-4b-agentic@q8_0',
        'prism-ml/bonsai-27b',
      ];

  const ordered = preferred.filter(m => models.includes(m));
  console.log(`Benchmarking ${ordered.length} models → ${OUT_DIR}`);
  const results = [];

  for (const model of ordered) {
    console.log(`\n=== ${model} ===`);
    const row = await benchOne(model);
    results.push(row);
    console.log(
      JSON.stringify(
        {
          score: row.totalScore,
          ms: row.elapsedMs,
          tools: row.tools,
          fileBytes: row.file.bytes,
          token: row.file.hasToken,
          verify: row.verifyOk,
          hallucinated: row.hallucinated,
          error: row.error,
        },
        null,
        0
      )
    );
  }

  results.sort((a, b) => b.totalScore - a.totalScore || a.elapsedMs - b.elapsedMs);
  const payload = {
    generatedAt: new Date().toISOString(),
    target: process.env.OPENAI_BASE_URL,
    results,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(payload, null, 2));

  const lines = [
    '# Caprigo model bench — unique webpage via tools',
    '',
    `Generated: ${payload.generatedAt}`,
    `Target: ${payload.target}`,
    '',
    'Task: each model must `write_file` a unique nebula/glass HTML page under `generated/bench/`, include a model-specific token, then `read_file` to verify.',
    '',
    '| Rank | Model | Score | Time | Write | Verify | Bytes | Token | Hallucinated | Error |',
    '| --- | --- | ---: | ---: | :---: | :---: | ---: | :---: | :---: | --- |',
  ];
  results.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | \`${r.model}\` | ${r.totalScore} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${r.usedWrite ? '✓' : '✗'} | ${r.verifyOk ? '✓' : '✗'} | ${r.file.bytes} | ${r.file.hasToken ? '✓' : '✗'} | ${r.hallucinated ? 'yes' : ''} | ${r.error ? r.error.slice(0, 70).replace(/\|/g, '/') : ''} |`
    );
  });
  lines.push('', '## Paths', '');
  for (const r of results) {
    lines.push(`- \`${r.model}\` → \`${r.path}\` (token \`${r.token}\`)`);
  }
  fs.writeFileSync(REPORT_MD, lines.join('\n') + '\n');

  console.log(`\nReport: ${REPORT_MD}`);
  console.log(lines.join('\n'));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
