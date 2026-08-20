#!/usr/bin/env node
'use strict';

/**
 * Generate marketing screenshots from docs/hud-preview.html (faithful HUD mock).
 *
 * Usage:
 *   node scripts/capture-harness-screenshots.cjs
 *   node scripts/capture-harness-screenshots.cjs --scene notepad
 *   node scripts/capture-harness-screenshots.cjs --list
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'docs', 'hud-preview.html');
const OUT_DIR = path.join(ROOT, 'docs', 'assets');

const SHOTS = [
  {
    id: 'notepad',
    scene: 'notepad',
    layout: 'shot',
    file: 'hud-terminal.png',
    viewport: { width: 1100, height: 720 },
    desc: 'Hero — HOME notepad mission (README, GitHub)',
  },
  {
    id: 'web',
    scene: 'web',
    layout: 'shot',
    file: 'hud-web-mission.png',
    viewport: { width: 1100, height: 720 },
    desc: 'Web search + fetch tool loop',
  },
  {
    id: 'write',
    scene: 'write',
    layout: 'shot',
    file: 'hud-write-mission.png',
    viewport: { width: 1100, height: 720 },
    desc: 'write_file + browser preview',
  },
  {
    id: 'og',
    scene: 'notepad',
    layout: 'og',
    file: 'hud-og.png',
    viewport: { width: 1200, height: 630 },
    desc: 'Open Graph / X card (1200×630)',
  },
];

function parseArgs(argv) {
  const out = { list: false, scene: null, all: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--scene') out.scene = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (out.scene) out.all = false;
  return out;
}

function loadPlaywright() {
  try {
    return require(path.join(ROOT, 'packages', 'agent', 'node_modules', 'playwright'));
  } catch {
    return require('playwright');
  }
}

function fileUrl(p) {
  return `file:///${p.replace(/\\/g, '/')}`;
}

async function captureOne(playwright, spec) {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: spec.viewport });
  const url = `${fileUrl(HTML)}?scene=${encodeURIComponent(spec.scene)}&layout=${encodeURIComponent(spec.layout)}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(350);
  const outPath = path.join(OUT_DIR, spec.file);
  await page.screenshot({ path: outPath, fullPage: false });
  await browser.close();
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/capture-harness-screenshots.cjs [--scene id] [--list]

Scenes: ${SHOTS.map(s => s.id).join(', ')}
Output: ${OUT_DIR}
`);
    process.exit(0);
  }
  if (args.list) {
    for (const s of SHOTS) console.log(`${s.id.padEnd(8)} → ${s.file.padEnd(24)} ${s.desc}`);
    process.exit(0);
  }

  if (!fs.existsSync(HTML)) {
    console.error('Missing', HTML);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const playwright = loadPlaywright();
  const queue = args.all ? SHOTS : SHOTS.filter(s => s.id === args.scene || s.scene === args.scene);
  if (!queue.length) {
    console.error('Unknown scene:', args.scene);
    console.error('Use --list for options.');
    process.exit(1);
  }

  console.log('Caprigo harness screenshots');
  console.log('Source:', HTML);
  console.log('');
  for (const spec of queue) {
    const out = await captureOne(playwright, spec);
    console.log('✓', spec.file, '—', spec.desc);
    console.log(' ', out);
  }
  console.log('');
  console.log('Done. See docs/SCREENSHOTS.md for live-terminal capture tips.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
