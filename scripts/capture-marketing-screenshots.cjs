#!/usr/bin/env node
/**
 * Capture README/marketing screenshots from a running gateway + built web UI.
 *
 * Prereqs:
 *   npm run build && npm run build:web
 *   node scripts/seed-demo-crew.cjs --reset   (optional but recommended)
 *   npm run start                             (gateway on :18789)
 *
 * Usage:
 *   node scripts/capture-marketing-screenshots.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const baseUrl = (process.env.CAPRIGO_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
const outDir = path.join(__dirname, '..', 'docs', 'assets');

const shots = [
  { name: 'overview.png', path: '/?tab=overview', waitMs: 1200 },
  { name: 'board-crew.png', path: '/?tab=board', waitMs: 1600 },
  { name: 'session.png', path: '/?tab=session', waitMs: 1200 },
];

async function main() {
  let playwright;
  try {
    playwright = require(path.join(__dirname, '..', 'packages', 'agent', 'node_modules', 'playwright'));
  } catch {
    playwright = require('playwright');
  }

  fs.mkdirSync(outDir, { recursive: true });

  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) throw new Error(`Gateway not reachable at ${baseUrl} (${health.status})`);

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const shot of shots) {
    const url = `${baseUrl}${shot.path}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(shot.waitMs);
    const target = path.join(outDir, shot.name);
    await page.screenshot({ path: target, fullPage: false });
    console.log('wrote', target);
  }

  await browser.close();
  console.log(JSON.stringify({ ok: true, outDir, baseUrl }, null, 2));
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
