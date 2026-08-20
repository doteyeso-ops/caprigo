/**
 * Smoke: desktop OCR (WinRT default) + optional RapidOCR + desktop_find.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  const desk = require('../packages/agent/dist/skills/desktop');

  if (os.platform() !== 'win32') {
    const p = desk.probeDesktopOcr();
    assert(p.mode === 'non-win', 'non-win expected');
    console.log('OK ocr-skip-non-win');
    return;
  }

  const probe = desk.probeDesktopOcr();
  console.log('probe', probe);
  assert(probe.ok, probe.detail || 'ocr probe failed');

  let shotPath = path.resolve(__dirname, '../generated/desktop/smoke-desktop.png');
  if (!fs.existsSync(shotPath)) {
    const shot = await desk.desktopScreenshotSkill.execute({
      path: 'generated/desktop/smoke-desktop.png',
    });
    assert(shot.success, shot.error || 'screenshot failed');
    shotPath = shot.path;
  }

  const ocr = await desk.desktopOcrSkill.execute({
    path: 'generated/desktop/smoke-desktop.png',
    max_blocks: 40,
  });
  console.log('ocr', {
    success: ocr.success,
    engine: ocr.engine,
    count: ocr.count,
    sample: Array.isArray(ocr.blocks) ? ocr.blocks.slice(0, 5).map(b => b.text) : [],
    error: ocr.error,
  });
  assert(ocr.success, ocr.error || 'desktop_ocr failed');
  assert(Array.isArray(ocr.blocks) && ocr.blocks.length > 0, 'expected OCR blocks');
  assert(ocr.blocks[0].cx != null && ocr.blocks[0].cy != null, 'blocks need cx/cy');

  const q = String(ocr.blocks[0].text || '').slice(0, 12);
  if (q) {
    const found = await desk.desktopFindSkill.execute({
      path: 'generated/desktop/smoke-desktop.png',
      query: q,
    });
    console.log('find', { success: found.success, match: found.match?.text, cx: found.cx, cy: found.cy });
    assert(found.success, found.error || 'desktop_find failed');
  }

  const withOcr = await desk.desktopScreenshotSkill.execute({
    path: 'generated/desktop/smoke-desktop-ocr.png',
    ocr: true,
    max_blocks: 20,
  });
  assert(withOcr.success, withOcr.error || 'screenshot+ocr failed');
  assert(withOcr.ocr?.success || (Array.isArray(withOcr.blocks) && withOcr.blocks.length), 'ocr attach failed');

  console.log('OK desktop-ocr');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
