/**
 * Caprigo digital body — OS mouse / keyboard / screenshot (Windows).
 * Kill switch: CAPRIGO_DISABLE_DESKTOP=1
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { Skill, caprigoWorkspaceRoot, resolvePathUnderWorkspaceRoot } from '@caprigo/shared';

const execFileAsync = promisify(execFile);

export function desktopDisabled(): boolean {
  const v = process.env.CAPRIGO_DISABLE_DESKTOP?.trim();
  return v === '1' || v === 'true' || v === 'yes';
}

export function desktopPlatformOk(): boolean {
  return os.platform() === 'win32';
}

/** HUD / doctor probe — no screenshot. */
export function probeDesktopBackend(): {
  ok: boolean;
  mode: 'ok' | 'off' | 'non-win';
  detail: string;
} {
  if (!desktopPlatformOk()) {
    return { ok: false, mode: 'non-win', detail: 'Desktop body is Windows-only' };
  }
  if (desktopDisabled()) {
    return { ok: false, mode: 'off', detail: 'CAPRIGO_DISABLE_DESKTOP=1' };
  }
  const script = resolveDesktopScript();
  if (!script) {
    return { ok: false, mode: 'off', detail: 'desktop-win.ps1 missing' };
  }
  return { ok: true, mode: 'ok', detail: 'Win32 desktop skills ready' };
}

function resolveSiblingSkill(...names: string[]): string | null {
  const bases = [
    __dirname,
    path.join(__dirname, '..', '..', 'src', 'skills'),
    path.join(process.cwd(), 'packages', 'agent', 'src', 'skills'),
  ];
  for (const base of bases) {
    for (const name of names) {
      const p = path.join(base, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function resolveDesktopScript(): string | null {
  return resolveSiblingSkill('desktop-win.ps1');
}

function resolveOcrPython(): string | null {
  const override = process.env.CAPRIGO_OCR_PYTHON?.trim();
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    path.join(__dirname, '..', '..', '.venv-ocr', 'Scripts', 'python.exe'),
    path.join(__dirname, '..', '..', '.venv-ocr', 'bin', 'python'),
    path.join(process.cwd(), 'packages', 'agent', '.venv-ocr', 'Scripts', 'python.exe'),
    path.join(process.cwd(), 'packages', 'agent', '.venv-ocr', 'bin', 'python'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export type OcrEngineMode = 'auto' | 'winrt' | 'rapidocr';

export function preferredOcrEngine(): OcrEngineMode {
  const v = (process.env.CAPRIGO_OCR_ENGINE || 'auto').trim().toLowerCase();
  if (v === 'winrt' || v === 'windows') return 'winrt';
  if (v === 'rapidocr' || v === 'rapid') return 'rapidocr';
  return 'auto';
}

/** HUD probe — no image OCR. */
export function probeDesktopOcr(): {
  ok: boolean;
  mode: 'winrt' | 'rapidocr' | 'off' | 'non-win';
  detail: string;
} {
  if (!desktopPlatformOk()) {
    return { ok: false, mode: 'non-win', detail: 'OCR is Windows-only for now' };
  }
  if (desktopDisabled()) {
    return { ok: false, mode: 'off', detail: 'desktop disabled' };
  }
  const pref = preferredOcrEngine();
  const hasRapid = !!(resolveOcrPython() && resolveSiblingSkill('desktop-ocr.py'));
  const hasWinrt = !!resolveSiblingSkill('desktop-ocr-win.ps1');
  if (pref === 'rapidocr' && hasRapid) {
    return { ok: true, mode: 'rapidocr', detail: 'RapidOCR venv ready' };
  }
  if (pref === 'winrt' && hasWinrt) {
    return { ok: true, mode: 'winrt', detail: 'Windows.Media.Ocr ready' };
  }
  // auto: prefer WinRT (fast ~2s); RapidOCR available as upgrade
  if (hasWinrt) {
    return {
      ok: true,
      mode: 'winrt',
      detail: hasRapid ? 'WinRT default; RapidOCR venv also available' : 'Windows.Media.Ocr ready',
    };
  }
  if (hasRapid) {
    return { ok: true, mode: 'rapidocr', detail: 'RapidOCR venv ready' };
  }
  return { ok: false, mode: 'off', detail: 'No OCR backend (WinRT script or RapidOCR venv)' };
}

async function runRapidOcr(imagePath: string, maxBlocks: number): Promise<Record<string, unknown>> {
  const py = resolveOcrPython();
  const script = resolveSiblingSkill('desktop-ocr.py');
  if (!py || !script) {
    return { success: false, error: 'RapidOCR not available (missing .venv-ocr or desktop-ocr.py)' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      py,
      [script, imagePath, '--max', String(maxBlocks)],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      }
    );
    return parseDesktopJson(String(stdout || ''), stderr);
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: string; stdout?: string };
    if (err?.stdout?.trim()) return parseDesktopJson(String(err.stdout), err.stderr);
    return { success: false, error: err?.stderr?.trim() || err?.message || String(e) };
  }
}

async function runWinrtOcr(imagePath: string, maxBlocks: number): Promise<Record<string, unknown>> {
  const script = resolveSiblingSkill('desktop-ocr-win.ps1');
  if (!script) {
    return { success: false, error: 'desktop-ocr-win.ps1 missing' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Path',
        imagePath,
        '-MaxBlocks',
        String(maxBlocks),
      ],
      {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      }
    );
    return parseDesktopJson(String(stdout || ''), stderr);
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: string; stdout?: string };
    if (err?.stdout?.trim()) return parseDesktopJson(String(err.stdout), err.stderr);
    return { success: false, error: err?.stderr?.trim() || err?.message || String(e) };
  }
}

export async function runDesktopOcr(opts: {
  path: string;
  max_blocks?: number;
  engine?: OcrEngineMode | string;
}): Promise<Record<string, unknown>> {
  const imagePath = opts.path;
  if (!fs.existsSync(imagePath)) {
    return { success: false, error: `file not found: ${imagePath}` };
  }
  const maxBlocks = Math.min(300, Math.max(1, Number(opts.max_blocks) || 120));
  const eng = String(opts.engine || preferredOcrEngine()).toLowerCase() as OcrEngineMode | string;

  const tryWinrt = async () => runWinrtOcr(imagePath, maxBlocks);
  const tryRapid = async () => runRapidOcr(imagePath, maxBlocks);

  if (eng === 'rapidocr' || eng === 'rapid') {
    return tryRapid();
  }
  if (eng === 'winrt' || eng === 'windows') {
    return tryWinrt();
  }

  // auto: WinRT first (fast), RapidOCR fallback
  const win = await tryWinrt();
  if (win.success) return win;
  const rapid = await tryRapid();
  if (rapid.success) return rapid;
  return {
    success: false,
    error: `OCR failed. winrt: ${win.error || 'n/a'}; rapidocr: ${rapid.error || 'n/a'}`,
  };
}

function resolveWorkspaceImagePath(userPath: string): string | null {
  const trimmed = userPath.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) return trimmed;
  return resolvePathUnderWorkspaceRoot(caprigoWorkspaceRoot(), trimmed);
}

function shotDir(): string {
  const dir = path.join(caprigoWorkspaceRoot(), 'generated', 'desktop');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runDesktopAction(
  action: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  if (!desktopPlatformOk()) {
    return { success: false, error: 'Desktop skills are Windows-only.' };
  }
  if (desktopDisabled()) {
    return { success: false, error: 'Desktop disabled (CAPRIGO_DISABLE_DESKTOP=1).' };
  }
  const script = resolveDesktopScript();
  if (!script) {
    return { success: false, error: 'desktop-win.ps1 not found — rebuild/agent package incomplete.' };
  }

  const jsonArgs = JSON.stringify(args);
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-JsonArgs', jsonArgs],
      {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      }
    );
    return parseDesktopJson(String(stdout || ''), stderr);
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: string; stdout?: string };
    const fromOut = parseDesktopJson(String(err?.stdout || ''), err?.stderr);
    if (fromOut.success === false && fromOut.error && !String(fromOut.error).includes('empty')) {
      return fromOut;
    }
    // Some PowerShell failures still emit JSON on stdout before non-zero exit
    if (err?.stdout?.trim()) {
      const parsed = parseDesktopJson(String(err.stdout), err.stderr);
      if (parsed && typeof parsed === 'object') return parsed;
    }
    return {
      success: false,
      error: err?.stderr?.trim() || err?.message || String(e),
    };
  }
}

function parseDesktopJson(stdout: string, stderr?: string | null): Record<string, unknown> {
  const text = String(stdout || '').trim();
  if (!text) {
    return {
      success: false,
      error: stderr?.trim() || 'desktop action returned empty output',
    };
  }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last) as Record<string, unknown>;
  } catch {
    return { success: false, error: `Bad JSON from desktop: ${last.slice(0, 200)}`, raw: text.slice(0, 400) };
  }
}

function gateError(): { success: false; error: string } | null {
  if (!desktopPlatformOk()) return { success: false, error: 'Desktop skills are Windows-only.' };
  if (desktopDisabled()) return { success: false, error: 'Desktop disabled (CAPRIGO_DISABLE_DESKTOP=1).' };
  return null;
}

export const desktopScreenshotSkill: Skill = {
  name: 'desktop_screenshot',
  description:
    'Capture the Windows desktop (or a region) to a PNG under generated/desktop/. Returns path, size, and cursor. Set ocr:true to also run desktop OCR and return blocks[{text,cx,cy,…}] for clicking. Prefer desktop_focus before typing. For web pages use browser_screenshot.',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional output path under the workspace' },
      x: { type: 'number', description: 'Region origin X (default 0)' },
      y: { type: 'number', description: 'Region origin Y (default 0)' },
      width: { type: 'number', description: 'Region width (default full screen)' },
      height: { type: 'number', description: 'Region height (default full screen)' },
      ocr: {
        type: 'boolean',
        description: 'If true, OCR the capture and attach blocks with click centers (cx,cy)',
      },
      max_blocks: { type: 'number', description: 'Max OCR blocks when ocr:true (default 120)' },
    },
    additionalProperties: false,
  },
  execute: async (params: {
    path?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    ocr?: boolean;
    max_blocks?: number;
  }) => {
    const g = gateError();
    if (g) return g;
    let outPath: string | undefined;
    if (params.path?.trim()) {
      const resolved = resolvePathUnderWorkspaceRoot(caprigoWorkspaceRoot(), params.path.trim());
      if (!resolved) return { success: false, error: `path escapes workspace: ${params.path}` };
      outPath = resolved;
    } else {
      outPath = path.join(shotDir(), `${Date.now()}-desktop.png`);
    }
    const shot = await runDesktopAction('screenshot', {
      path: outPath,
      x: params.x ?? 0,
      y: params.y ?? 0,
      width: params.width,
      height: params.height,
    });
    if (!shot.success || !params.ocr) return shot;
    const img = String(shot.path || outPath);
    const ocr = await runDesktopOcr({ path: img, max_blocks: params.max_blocks });
    return {
      ...shot,
      ocr,
      blocks: ocr.blocks,
      ocr_text: ocr.text,
      ocr_engine: ocr.engine,
    };
  },
};

export const desktopClickSkill: Skill = {
  name: 'desktop_click',
  description:
    'Click the Windows mouse at screen coordinates (x,y). Optional button left|right|middle and double-click. Prefer screenshot first to choose coordinates. Does not control Playwright browser — use browser_click for web pages.',
  toolParameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Screen X' },
      y: { type: 'number', description: 'Screen Y' },
      button: { type: 'string', description: 'left (default) | right | middle' },
      double: { type: 'boolean', description: 'Double-click if true' },
    },
    required: ['x', 'y'],
    additionalProperties: false,
  },
  execute: async (params: { x?: number; y?: number; button?: string; double?: boolean }) => {
    const g = gateError();
    if (g) return g;
    if (params.x == null || params.y == null) return { success: false, error: 'x and y are required' };
    return runDesktopAction('click', {
      x: Number(params.x),
      y: Number(params.y),
      button: params.button || 'left',
      double: !!params.double,
    });
  },
};

export const desktopMoveSkill: Skill = {
  name: 'desktop_move',
  description: 'Move the Windows mouse cursor to screen coordinates (x,y) without clicking.',
  toolParameters: {
    type: 'object',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
    },
    required: ['x', 'y'],
    additionalProperties: false,
  },
  execute: async (params: { x?: number; y?: number }) => {
    const g = gateError();
    if (g) return g;
    if (params.x == null || params.y == null) return { success: false, error: 'x and y are required' };
    return runDesktopAction('move', { x: Number(params.x), y: Number(params.y) });
  },
};

export const desktopTypeSkill: Skill = {
  name: 'desktop_type',
  description:
    'Type text into the focused Windows window via keystrokes (ASCII) or clipboard paste (unicode / paste:true). ALWAYS desktop_focus the target window first so you do not type into Caprigo HUD.',
  toolParameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to type' },
      paste: { type: 'boolean', description: 'Force clipboard paste (Ctrl+V)' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  execute: async (params: { text?: string; paste?: boolean }) => {
    const g = gateError();
    if (g) return g;
    const text = String(params.text ?? '');
    if (!text) return { success: false, error: 'text is required' };
    return runDesktopAction('type', { text, paste: !!params.paste });
  },
};

export const desktopHotkeySkill: Skill = {
  name: 'desktop_hotkey',
  description:
    'Press a Windows keyboard chord, e.g. "ctrl+c", "alt+tab", "win+e", "ctrl+shift+esc". Prefer desktop_focus before app-specific shortcuts.',
  toolParameters: {
    type: 'object',
    properties: {
      keys: { type: 'string', description: 'Chord like ctrl+s or alt+f4' },
    },
    required: ['keys'],
    additionalProperties: false,
  },
  execute: async (params: { keys?: string }) => {
    const g = gateError();
    if (g) return g;
    const keys = String(params.keys || '').trim();
    if (!keys) return { success: false, error: 'keys is required' };
    return runDesktopAction('hotkey', { keys });
  },
};

export const desktopKeySkill: Skill = {
  name: 'desktop_key',
  description: 'Press a single Windows key (enter, escape, tab, f5, left, …).',
  toolParameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key name' },
    },
    required: ['key'],
    additionalProperties: false,
  },
  execute: async (params: { key?: string }) => {
    const g = gateError();
    if (g) return g;
    const key = String(params.key || '').trim();
    if (!key) return { success: false, error: 'key is required' };
    return runDesktopAction('key', { key });
  },
};

export const desktopWindowsSkill: Skill = {
  name: 'desktop_windows',
  description: 'List visible top-level Windows with titles and PIDs. Use before desktop_focus.',
  toolParameters: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () => {
    const g = gateError();
    if (g) return g;
    return runDesktopAction('windows', {});
  },
};

export const desktopFocusSkill: Skill = {
  name: 'desktop_focus',
  description:
    'Focus a Windows window whose title contains the given substring (case-insensitive). Prefers real app titles over IDE chrome, restores/foregrounds, and clicks into the client area so desktop_type lands correctly. Call before desktop_type / desktop_hotkey.',
  toolParameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Substring of window title' },
      click: {
        type: 'boolean',
        description: 'Click into window client area after focus (default true)',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  execute: async (params: { title?: string; click?: boolean }) => {
    const g = gateError();
    if (g) return g;
    const title = String(params.title || '').trim();
    if (!title) return { success: false, error: 'title is required' };
    const args: Record<string, unknown> = { title };
    if (params.click === false) args.click = false;
    return runDesktopAction('focus', args);
  },
};

export const desktopOcrSkill: Skill = {
  name: 'desktop_ocr',
  description:
    'OCR a desktop screenshot PNG into text blocks with bounding boxes and click centers (cx,cy). Call after desktop_screenshot (or pass that path). Use blocks to desktop_click — do not guess coordinates. Default engine is fast Windows OCR; set engine=rapidocr for harder UI text if the RapidOCR venv is installed.',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'PNG path from desktop_screenshot (workspace-relative or absolute)' },
      max_blocks: { type: 'number', description: 'Max blocks to return (default 120)' },
      engine: {
        type: 'string',
        description: 'auto (default) | winrt | rapidocr',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  execute: async (params: { path?: string; max_blocks?: number; engine?: string }) => {
    const g = gateError();
    if (g) return g;
    const raw = String(params.path || '').trim();
    if (!raw) return { success: false, error: 'path is required' };
    const resolved = resolveWorkspaceImagePath(raw);
    if (!resolved) return { success: false, error: `path not found or escapes workspace: ${raw}` };
    return runDesktopOcr({
      path: resolved,
      max_blocks: params.max_blocks,
      engine: params.engine,
    });
  },
};

export const desktopFindSkill: Skill = {
  name: 'desktop_find',
  description:
    'OCR a screenshot and find the best block whose text contains query (case-insensitive). Returns match {text,cx,cy,…} ready for desktop_click. Prefer this over scanning all OCR blocks manually.',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'PNG path from desktop_screenshot' },
      query: { type: 'string', description: 'Substring to find on screen' },
      engine: { type: 'string', description: 'auto | winrt | rapidocr' },
      max_blocks: { type: 'number' },
    },
    required: ['path', 'query'],
    additionalProperties: false,
  },
  execute: async (params: {
    path?: string;
    query?: string;
    engine?: string;
    max_blocks?: number;
  }) => {
    const g = gateError();
    if (g) return g;
    const raw = String(params.path || '').trim();
    const query = String(params.query || '').trim();
    if (!raw) return { success: false, error: 'path is required' };
    if (!query) return { success: false, error: 'query is required' };
    const resolved = resolveWorkspaceImagePath(raw);
    if (!resolved) return { success: false, error: `path not found or escapes workspace: ${raw}` };
    const ocr = await runDesktopOcr({
      path: resolved,
      max_blocks: params.max_blocks ?? 200,
      engine: params.engine,
    });
    if (!ocr.success) return ocr;
    const needle = query.toLowerCase();
    const blocks = Array.isArray(ocr.blocks) ? (ocr.blocks as Array<Record<string, unknown>>) : [];
    let best: Record<string, unknown> | null = null;
    let bestScore = -1;
    for (const b of blocks) {
      const text = String(b.text || '');
      const lower = text.toLowerCase();
      if (!lower.includes(needle)) continue;
      // Prefer shorter labels (buttons) over long paragraphs
      const score = 1000 - text.length + (lower === needle ? 50 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (!best) {
      return {
        success: false,
        error: `No OCR block matching: ${query}`,
        engine: ocr.engine,
        count: ocr.count,
        sample: blocks.slice(0, 12).map(b => b.text),
      };
    }
    return {
      success: true,
      match: best,
      cx: best.cx,
      cy: best.cy,
      engine: ocr.engine,
      path: ocr.path,
    };
  },
};

export const desktopSkills: Skill[] = [
  desktopScreenshotSkill,
  desktopClickSkill,
  desktopMoveSkill,
  desktopTypeSkill,
  desktopHotkeySkill,
  desktopKeySkill,
  desktopWindowsSkill,
  desktopFocusSkill,
  desktopOcrSkill,
  desktopFindSkill,
];