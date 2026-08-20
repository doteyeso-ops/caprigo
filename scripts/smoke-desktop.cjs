/**
 * Smoke: Windows desktop body — list windows + screenshot (optional click).
 * Skip click unless CAPRIGO_DESKTOP_SMOKE_CLICK=1.
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
  const probe = desk.probeDesktopBackend();
  console.log('probe', probe);

  if (os.platform() !== 'win32') {
    assert(probe.mode === 'non-win', 'non-Windows should report non-win');
    console.log('OK desktop-skip-non-win');
    return;
  }

  if (desk.desktopDisabled()) {
    assert(probe.mode === 'off', 'disabled should be off');
    console.log('OK desktop-disabled');
    return;
  }

  assert(probe.ok && probe.mode === 'ok', 'desktop should be ready on Windows');

  const win = await desk.desktopWindowsSkill.execute({});
  console.log('windows', {
    success: win.success,
    count: Array.isArray(win.windows) ? win.windows.length : win.count,
    error: win.error,
  });
  assert(win.success, win.error || 'desktop_windows failed');

  const out = path.resolve(__dirname, '../generated/desktop/smoke-desktop.png');
  const shot = await desk.desktopScreenshotSkill.execute({ path: 'generated/desktop/smoke-desktop.png' });
  console.log('screenshot', shot);
  assert(shot.success, shot.error || 'desktop_screenshot failed');
  assert(fs.existsSync(shot.path || out), 'screenshot file missing');

  if (process.env.CAPRIGO_DESKTOP_SMOKE_CLICK === '1') {
    const click = await desk.desktopClickSkill.execute({ x: 0, y: 0, button: 'left' });
    console.log('click', click);
    assert(click.success, click.error || 'desktop_click failed');
  } else {
    console.log('skip click (set CAPRIGO_DESKTOP_SMOKE_CLICK=1 to enable)');
  }

  console.log('OK desktop');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
