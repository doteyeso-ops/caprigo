/**
 * Caprigo learning suite — run smokes, write report under ~/.caprigo/test-runs/
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const dataRoot = process.env.CAPRIGO_HOME || path.join(os.homedir(), '.caprigo');
const outDir = path.join(dataRoot, 'test-runs');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const OFFLINE = [
  'smoke-tool-dialect.cjs',
  'smoke-harness-mission.cjs',
  'smoke-hermes-recovery.cjs',
  'smoke-prompt-brief.cjs',
  'smoke-bug-report.cjs',
  'smoke-stumble-learn.cjs',
  'smoke-brain-stumble.cjs',
  'smoke-model-profile.cjs',
  'smoke-desktop-routing.cjs',
  'smoke-web-search-routing.cjs',
  'smoke-format-blocks.cjs',
];

const LIVE = [
  { script: 'smoke-lms-chat.cjs', env: {} },
  { script: 'smoke-web-search-routing.cjs', env: {} },
  { script: 'smoke-e2e-dealers.cjs', env: {} },
  { script: 'smoke-e2e-home-notepad.cjs', env: {} },
  { script: 'smoke-desktop.cjs', env: {} },
  { script: 'smoke-desktop-ocr.cjs', env: {} },
  { script: 'smoke-digital-body-suite.cjs', env: {} },
  { script: 'smoke-image-gen.cjs', env: { CAPRIGO_IMAGE_SMOKE_PROBE_ONLY: '1' } },
];

function runOne(script, extraEnv = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    timeout: 180000,
  });
  return {
    script,
    code: r.status == null ? (r.signal ? 1 : -1) : r.status,
    ms: Date.now() - started,
    stdout: (r.stdout || '').slice(-4000),
    stderr: (r.stderr || '').slice(-4000),
    signal: r.signal || null,
  };
}

const results = [];
console.log('=== Caprigo learning suite ===');

for (const s of OFFLINE) {
  process.stdout.write(`OFFLINE ${s} … `);
  const r = runOne(s);
  results.push({ phase: 'offline', ...r });
  console.log(r.code === 0 ? `OK ${(r.ms / 1000).toFixed(1)}s` : `FAIL ${r.code}`);
  if (r.code !== 0) {
    console.log(r.stderr || r.stdout);
  }
}

for (const item of LIVE) {
  process.stdout.write(`LIVE ${item.script} … `);
  const r = runOne(item.script, item.env);
  results.push({ phase: 'live', ...r });
  console.log(r.code === 0 ? `OK ${(r.ms / 1000).toFixed(1)}s` : `FAIL ${r.code}`);
  if (r.code !== 0) {
    console.log((r.stderr || r.stdout).slice(0, 1500));
  }
}

const failed = results.filter(r => r.code !== 0);
const md = [
  `# Caprigo test run ${stamp}`,
  '',
  `- total: ${results.length}`,
  `- pass: ${results.length - failed.length}`,
  `- fail: ${failed.length}`,
  '',
  '## Results',
  ...results.map(
    r =>
      `- **${r.phase}** \`${r.script}\` → ${r.code === 0 ? 'PASS' : 'FAIL'} (${(r.ms / 1000).toFixed(1)}s)`
  ),
  '',
  ...(failed.length
    ? [
        '## Failures',
        ...failed.map(r =>
          [
            `### ${r.script}`,
            '```',
            (r.stderr || r.stdout || '(no output)').slice(0, 3000),
            '```',
            '',
          ].join('\n')
        ),
      ]
    : ['## Failures', '(none)', '']),
  '## Next agent actions',
  failed.length
    ? 'Fix FAIL scripts first; write lessons into Brain if skill routing/stumble related; update HandOff.'
    : 'All green — look for soft warnings in stdout and tighten harness.',
  '',
].join('\n');

const mdPath = path.join(outDir, `${stamp}-suite.md`);
const jsonPath = path.join(outDir, `${stamp}-suite.json`);
fs.writeFileSync(mdPath, md, 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify({ stamp, results }, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'LATEST.txt'), `${mdPath}\n${jsonPath}\n`, 'utf8');

console.log('\n' + md);
console.log(`Wrote ${mdPath}`);
process.exit(failed.length ? 1 : 0);
