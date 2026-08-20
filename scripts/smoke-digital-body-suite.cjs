/**
 * Full regression for digital body + OCR + related harness wiring.
 * Safe by default (no click/type into random windows).
 * Set CAPRIGO_DESKTOP_E2E=1 for Notepad type-hello flow.
 * Set CAPRIGO_DESKTOP_SMOKE_CLICK=1 to click (0,0).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const p = path.join(ROOT, '.env');
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

const results = [];
function ok(name, detail) {
  results.push({ name, pass: true, detail: detail || '' });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  results.push({ name, pass: false, detail: String(detail || '') });
  console.error(`FAIL  ${name} — ${detail}`);
}
function assert(name, cond, detail) {
  if (cond) ok(name, detail);
  else fail(name, detail || 'assertion failed');
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  loadEnv();
  process.chdir(ROOT);
  console.log('=== Caprigo digital-body suite ===\n');

  // ── 1. Build artifacts present ──
  const deskDist = path.join(ROOT, 'packages/agent/dist/skills/desktop.js');
  const assets = [
    'desktop-win.ps1',
    'desktop-ocr-win.ps1',
    'desktop-ocr.py',
  ].map(n => path.join(ROOT, 'packages/agent/dist/skills', n));
  assert('dist desktop.js', fs.existsSync(deskDist));
  for (const a of assets) {
    assert(`asset ${path.basename(a)}`, fs.existsSync(a));
  }

  const desk = require(deskDist);
  const agent = require(path.join(ROOT, 'packages/agent/dist/index.js'));
  const modelProfile = require(path.join(ROOT, 'packages/agent/dist/model-profile.js'));
  const dialect = require(path.join(ROOT, 'packages/agent/dist/tool-dialect.js'));

  // ── 2. Registration / exports ──
  const { harnessCoreSkills, ensureCoreLessons, brainStatusSummary, loadBrain } = agent;
  const { coreToolNames } = modelProfile;
  const names = new Set(harnessCoreSkills.map(s => s.name));
  const expectedSkills = [
    'desktop_screenshot',
    'desktop_click',
    'desktop_move',
    'desktop_type',
    'desktop_hotkey',
    'desktop_key',
    'desktop_windows',
    'desktop_focus',
    'desktop_ocr',
    'desktop_find',
    'execute_command',
    'browser_navigate',
    'browser_press',
    'web_search',
    'generate_image',
  ];
  for (const n of expectedSkills) {
    assert(`harness has ${n}`, names.has(n));
  }

  const core = coreToolNames();
  for (const n of [
    'desktop_ocr',
    'desktop_find',
    'desktop_click',
    'browser_press',
  ]) {
    assert(`coreToolNames has ${n}`, core.has(n));
  }

  assert('export probeDesktopBackend', typeof agent.probeDesktopBackend === 'function');
  assert('export probeDesktopOcr', typeof agent.probeDesktopOcr === 'function');

  // ── 3. Dialect aliases ──
  const aliasPairs = [
    ['desktop_shot', 'desktop_screenshot'],
    ['hotkey', 'desktop_hotkey'],
    ['type_keys', 'desktop_type'],
    ['ocr', 'desktop_ocr'],
    ['find_on_screen', 'desktop_find'],
    ['mouse', 'desktop_click'],
    ['screenshot', 'browser_screenshot'],
  ];
  const skillList = [...names, 'browser_screenshot'];
  for (const [from, to] of aliasPairs) {
    const got = dialect.resolveSkillName(from, skillList);
    const name = got && got.name;
    assert(`dialect ${from}→${to}`, name === to, JSON.stringify(got));
  }

  // ── 4. Brain sticky lessons ──
  ensureCoreLessons();
  const store = loadBrain();
  const lessonOk = (store.lessons || []).some(
    l => l.signature === 'os_ui_needs_desktop_screenshot_loop'
  );
  assert(
    'sticky lesson os_ui_needs_desktop_screenshot_loop',
    lessonOk,
    `lessons=${(store.lessons || []).length}`
  );
  void brainStatusSummary;
  // ── 5. Probes ──
  const dProbe = desk.probeDesktopBackend();
  const oProbe = desk.probeDesktopOcr();
  console.log('probe desktop', dProbe);
  console.log('probe ocr', oProbe);

  if (os.platform() !== 'win32') {
    assert('desktop non-win', dProbe.mode === 'non-win');
    assert('ocr non-win', oProbe.mode === 'non-win');
    summary();
    return;
  }

  assert('desktop probe ok', dProbe.ok && dProbe.mode === 'ok', dProbe.detail);
  assert('ocr probe ok', oProbe.ok, oProbe.detail);

  if (desk.desktopDisabled()) {
    fail('desktop enabled', 'CAPRIGO_DISABLE_DESKTOP is set — skipping live body tests');
    summary();
    return;
  }

  // ── 6. Live desktop skills ──
  const win = await desk.desktopWindowsSkill.execute({});
  assert(
    'desktop_windows',
    win.success && Array.isArray(win.windows) && win.windows.length > 0,
    `count=${win.count} err=${win.error || ''}`
  );

  const shotPath = 'generated/desktop/suite-shot.png';
  const shot = await desk.desktopScreenshotSkill.execute({ path: shotPath });
  assert(
    'desktop_screenshot',
    shot.success && fs.existsSync(shot.path || path.join(ROOT, shotPath)),
    `${shot.path || shot.error}`
  );

  const move = await desk.desktopMoveSkill.execute({ x: 200, y: 200 });
  assert('desktop_move', move.success, move.error);

  const ocr = await desk.desktopOcrSkill.execute({
    path: shotPath,
    max_blocks: 50,
  });
  assert(
    'desktop_ocr',
    ocr.success && Array.isArray(ocr.blocks) && ocr.blocks.length > 0,
    `engine=${ocr.engine} count=${ocr.count}`
  );
  assert(
    'ocr blocks have cx/cy',
    ocr.blocks[0].cx != null && ocr.blocks[0].cy != null,
    JSON.stringify(ocr.blocks[0])
  );

  const q = String(ocr.blocks[0].text || ' ').trim().slice(0, 16);
  if (q) {
    const found = await desk.desktopFindSkill.execute({ path: shotPath, query: q });
    assert(
      'desktop_find',
      found.success && found.cx != null,
      `match=${found.match?.text || found.error}`
    );
  } else {
    fail('desktop_find', 'no query text from OCR');
  }

  const shotOcr = await desk.desktopScreenshotSkill.execute({
    path: 'generated/desktop/suite-shot-ocr.png',
    ocr: true,
    max_blocks: 30,
  });
  assert(
    'desktop_screenshot ocr:true',
    shotOcr.success &&
      (shotOcr.ocr?.success || (Array.isArray(shotOcr.blocks) && shotOcr.blocks.length)),
    `engine=${shotOcr.ocr_engine || shotOcr.ocr?.engine}`
  );

  // Safe key: press nothing destructive — F15 if available is rare; skip desktop_key
  // Use desktop_key Escape is relatively safe
  const key = await desk.desktopKeySkill.execute({ key: 'escape' });
  assert('desktop_key escape', key.success, key.error);

  if (process.env.CAPRIGO_DESKTOP_SMOKE_CLICK === '1') {
    const click = await desk.desktopClickSkill.execute({ x: 0, y: 0 });
    assert('desktop_click (0,0)', click.success, click.error);
  } else {
    ok('desktop_click', 'skipped (set CAPRIGO_DESKTOP_SMOKE_CLICK=1)');
  }

  // RapidOCR optional path
  const rapidPy = path.join(ROOT, 'packages/agent/.venv-ocr/Scripts/python.exe');
  if (fs.existsSync(rapidPy)) {
    const rapid = await desk.desktopOcrSkill.execute({
      path: shotPath,
      engine: 'rapidocr',
      max_blocks: 15,
    });
    assert(
      'desktop_ocr rapidocr',
      rapid.success && rapid.engine === 'rapidocr',
      `count=${rapid.count} err=${rapid.error || ''}`
    );
  } else {
    ok('desktop_ocr rapidocr', 'skipped (no .venv-ocr)');
  }

  // ── 7. Optional Notepad e2e ──
  if (process.env.CAPRIGO_DESKTOP_E2E === '1') {
    const marker = `caprigo-e2e-${Date.now().toString(36)}`;
    const noteDir = path.join(ROOT, 'generated', 'desktop');
    fs.mkdirSync(noteDir, { recursive: true });
    const noteBase = `e2e-${Date.now().toString(36)}.txt`;
    const notePath = path.join(noteDir, noteBase);
    fs.writeFileSync(notePath, '', 'utf8');
    try {
      // Open a *unique* Notepad title so we never target IDE chrome or an old Notepad.
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Start-Process notepad.exe -ArgumentList '${notePath.replace(/'/g, "''")}'`,
        ],
        { windowsHide: false, timeout: 15000 }
      );
      let focus = { success: false, error: 'not attempted', title: '', verified: false, hwnd: 0 };
      const focusNeedles = [noteBase, 'Notepad'];
      for (let i = 0; i < 12; i++) {
        await sleep(500);
        for (const needle of focusNeedles) {
          focus = await desk.desktopFocusSkill.execute({ title: needle, click: true });
          if (focus.success && /notepad/i.test(String(focus.title || ''))) break;
        }
        if (focus.success && /notepad/i.test(String(focus.title || ''))) break;
      }
      assert(
        'e2e desktop_focus Notepad',
        focus.success && /notepad/i.test(String(focus.title || '')),
        focus.error || focus.title || 'window not found'
      );
      if (!focus.success || !/notepad/i.test(String(focus.title || ''))) {
        const wins = await desk.desktopWindowsSkill.execute({});
        fail(
          'e2e window list',
          (wins.windows || []).map(w => w.title).slice(0, 12).join(' | ')
        );
      } else {
        // Prefer clipboard paste — more reliable than per-key when IDE fights for focus.
        let typed = await desk.desktopTypeSkill.execute({ text: marker, paste: true });
        if (!typed.success) {
          await desk.desktopFocusSkill.execute({ title: noteBase, click: true });
          typed = await desk.desktopTypeSkill.execute({ text: marker, paste: true });
        }
        assert('e2e desktop_type', typed.success, typed.error);
        await sleep(400);

        // Confirm FG still looks like our Notepad (soft signal via windows list).
        const winsAfter = await desk.desktopWindowsSkill.execute({});
        const titlesAfter = (winsAfter.windows || []).map(w => String(w.title || ''));
        const stillHaveNote = titlesAfter.some(
          t => t.toLowerCase().includes(noteBase.toLowerCase()) || /notepad/i.test(t)
        );
        assert('e2e notepad still open', stillHaveNote, titlesAfter.slice(0, 8).join(' | '));

        let textBlob = '';
        let verifyOk = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            await desk.desktopFocusSkill.execute({ title: noteBase, click: true });
            await desk.desktopTypeSkill.execute({ text: marker, paste: true });
            await sleep(300);
          }
          const verify = await desk.desktopScreenshotSkill.execute({
            path: `generated/desktop/suite-notepad-${attempt}.png`,
            ocr: true,
            max_blocks: 120,
          });
          textBlob = String(verify.ocr_text || verify.ocr?.text || '').toLowerCase();
          const hasMarker = textBlob.includes(marker.toLowerCase());
          // Reject Cursor-only OCR false positives: require Notepad chrome or our file name.
          const hasNotepadCtx =
            textBlob.includes('notepad') ||
            textBlob.includes(noteBase.toLowerCase()) ||
            /untitled/.test(textBlob);
          const cursorHeavy =
            /bug reporter|new agent|ctrl\+n|harness-owned/.test(textBlob) && !hasNotepadCtx;
          verifyOk = !!(verify.success && hasMarker && hasNotepadCtx && !cursorHeavy);
          if (verifyOk) break;
        }
        assert(
          'e2e OCR sees typed text',
          verifyOk,
          textBlob.slice(0, 240) || 'marker/notepad context missing in OCR'
        );
        await desk.desktopFocusSkill.execute({ title: noteBase, click: true });
        await desk.desktopHotkeySkill.execute({ keys: 'alt+f4' });
        await sleep(400);
        // Discard save dialog if prompted
        await desk.desktopKeySkill.execute({ key: 'n' });
        ok('e2e close notepad', 'alt+f4 + n');
      }
    } catch (e) {
      fail('e2e notepad flow', e instanceof Error ? e.message : String(e));
    }
  } else {
    ok('e2e notepad', 'skipped (set CAPRIGO_DESKTOP_E2E=1)');
  }

  summary();
}

function summary() {
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed, ${results.length} total ===`);
  if (failed) {
    for (const r of results.filter(x => !x.pass)) {
      console.error(`  • ${r.name}: ${r.detail}`);
    }
    process.exit(1);
  }
  console.log('OK digital-body-suite');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
