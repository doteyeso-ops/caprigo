/**
 * Scout Caprigo-adjacent ecosystem (Hermes, LMS patterns) → ~/.caprigo/scout/
 * Decide viability notes for HandOff. Safe network; no code execution of remote.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function dataRoot() {
  return process.env.CAPRIGO_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.caprigo');
}

function fetchText(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Caprigo-scout/1.0' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location, timeoutMs).then(resolve, reject);
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, 200000)));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function main() {
  const outDir = path.join(dataRoot(), 'scout');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const findings = [];

  const targets = [
    {
      id: 'hermes-cli-docs',
      url: 'https://hermes-agent.nousresearch.com/docs/user-guide/cli',
      viable: 'STEER/busy_input_mode — Caprigo now has double-Enter + mid-turn steerTurn',
    },
    {
      id: 'hermes-repo-readme',
      url: 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/README.md',
      viable: 'Recovery loops / todo — already ported; watch new busy modes',
    },
  ];

  for (const t of targets) {
    try {
      const body = await fetchText(t.url);
      const file = path.join(outDir, `${stamp}-${t.id}.txt`);
      fs.writeFileSync(file, body.slice(0, 80000), 'utf8');
      const hitSteer = /steer|busy_input_mode|double.?enter/i.test(body);
      findings.push({
        id: t.id,
        url: t.url,
        ok: true,
        bytes: body.length,
        hitSteer,
        note: t.viable,
        file,
      });
    } catch (e) {
      findings.push({
        id: t.id,
        url: t.url,
        ok: false,
        error: e.message || String(e),
        note: t.viable,
      });
    }
  }

  const md = [
    `# Caprigo scout ${new Date().toISOString()}`,
    '',
    ...findings.map(f =>
      [
        `## ${f.id}`,
        `- url: ${f.url}`,
        `- ok: ${f.ok}`,
        f.error ? `- error: ${f.error}` : `- bytes: ${f.bytes} · steer-ish: ${f.hitSteer}`,
        `- viability: ${f.note}`,
        f.file ? `- saved: ${f.file}` : '',
        '',
      ].join('\n')
    ),
    '## Decision defaults',
    '- Adopt Hermes STEER injection after tool boundary (done in Caprigo agent.steerTurn).',
    '- Do not pull Hermes Python runtime; keep LMS+HOME.',
    '- Prefer qwen tool-use models over groq-tool-use that ignores tools[].',
    '',
  ].join('\n');

  const summaryPath = path.join(outDir, `${stamp}-SUMMARY.md`);
  fs.writeFileSync(summaryPath, md, 'utf8');
  fs.writeFileSync(path.join(outDir, 'LATEST.txt'), summaryPath + '\n', 'utf8');
  console.log('OK scout →', summaryPath);
  console.log(JSON.stringify(findings, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
