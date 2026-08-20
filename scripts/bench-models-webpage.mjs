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

  const prompt = [
    `Create ONE unique webpage at path exactly: ${rel}`,
    `Requirements (must all be true):`,
    `- Full HTML5 document (DOCTYPE + html/head/body)`,
    `- Include this exact token somewhere visible in the page text: ${token}`,
    `- Theme: deep-space nebula background (CSS gradients), a glassmorphism card centered, subtle CSS animation`,
    `- Title and H1 must mention Caprigo Bench and the model id: ${model}`,
    `- Put a short poem or micro-story (3–5 lines) inside the card — make it unique, not lorem ipsum`,
    `- Use write_file with the FULL finished HTML (no "..." placeholders)`,
    `- After writing, read_file the same path to verify`,
    `Do not ask whether to continue. Just write, verify, confirm the path.`,
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
  const verifyOk = usedWrite && usedRead && tools.lastIndexOf('read_file') > Math.max(tools.lastIndexOf('write_file'), tools.lastIndexOf('hash_edit'));

  let total = file.score;
  if (usedWrite) total += 20;
  if (verifyOk) total += 15;
  if (!error) total += 5;
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
    responseHead: (response || '').slice(0, 240).replace(/\s+/g, ' '),
    file,
    usedWrite,
    usedRead,
    verifyOk,
    totalScore: Math.min(100, total),
    events: events.slice(0, 40),
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

  // Prefer agentic / coding-sized models; still include others. Skip known-crash q8 last or include with short fail.
  const skip = new Set([]);
  const models = probe.models.filter(m => !/embed/i.test(m) && !skip.has(m));

  // Order: likely-good agentic first, huge last
  const preferred = [
    'openzero-fusion-qwen3-4b-agentic@q4_k_m',
    'openzero-fusion-qwen3-4b-agentic@q8_0',
    'deepseek-v4-pro-qwen3.5-4b-i1',
    'deepseek/deepseek-r1-0528-qwen3-8b',
    'google/gemma-3-4b',
    'google/gemma-4-e2b',
    'gemma-4-e4b-it-obliterated',
    'meine-gehorsame-coding-ki',
    'prism-ml/bonsai-27b',
  ];
  const ordered = [
    ...preferred.filter(m => models.includes(m)),
    ...models.filter(m => !preferred.includes(m)),
  ];

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
    '| Rank | Model | Score | Time | Write | Verify | Bytes | Token | Error |',
    '| --- | --- | ---: | ---: | :---: | :---: | ---: | :---: | --- |',
  ];
  results.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | \`${r.model}\` | ${r.totalScore} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${r.usedWrite ? '✓' : '✗'} | ${r.verifyOk ? '✓' : '✗'} | ${r.file.bytes} | ${r.file.hasToken ? '✓' : '✗'} | ${r.error ? r.error.slice(0, 60).replace(/\|/g, '/') : ''} |`
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
