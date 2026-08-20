/**
 * Harness-Owned Mission Executor (HOME) — compile intent, bootstrap skills,
 * propose next actions, verify acceptance. Model is worker; harness is executive.
 */

import {
  suggestedDesktopLaunchCommand,
  userLikelyNeedsDesktop,
  userLikelyNeedsWeb,
} from './model-profile';
import { desktopDisabled, desktopPlatformOk } from './skills/desktop';

export type MissionKind =
  | 'web_lookup'
  | 'desktop_ui'
  | 'file_write'
  | 'shell'
  | 'browser'
  | 'general';

export type AcceptanceRule =
  | { type: 'tool_used'; tool: string }
  | { type: 'any_tools'; tools: string[] }
  | { type: 'web_results' }
  | { type: 'file_written' }
  | { type: 'desktop_typed' }
  | { type: 'desktop_seen' }
  | { type: 'nonempty_answer' };

export interface MissionStep {
  tool: string;
  args: Record<string, unknown>;
  label?: string;
}

export interface MissionPlan {
  kind: MissionKind;
  objective: string;
  playbookId?: string;
  acceptance: AcceptanceRule[];
  bootstrap: MissionStep[];
  /** Remaining playbook / policy steps after bootstrap (harness may auto-pick). */
  remaining: MissionStep[];
  slots: Record<string, string>;
  source: 'playbook' | 'compiled' | 'objective';
}

export type MissionVerifyStatus = 'pass' | 'continue' | 'blocked';

export interface MissionVerifyResult {
  status: MissionVerifyStatus;
  detail: string;
  /** Harness-assembled user answer when pass and model text is empty/refusal. */
  directAnswer?: string;
}

export interface MissionRuntime {
  plan: MissionPlan;
  bootstrapDone: boolean;
  cardWarnUsed: number;
  autoPickUsed: number;
  /** Cap LLM re-asks after auto-drain/auto-pick (prevents infinite harness loops). */
  postActionLlmUsed: number;
  lastResults: Record<string, unknown>;
  webQuery?: string;
  webResult?: unknown;
}

const NOTEPAD_TYPE_RE =
  /\b(?:open|launch|start|run)\b.{0,48}\bnotepad\b.{0,80}\btype\b\s+["']?(.+?)["']?\s*$/i;
const TYPE_ONLY_RE = /\btype\b\s+(?:into\s+(?:it|notepad)\s+)?["']?(.+?)["']?\s*$/i;
const WRITE_HTML_RE =
  /\b(write|create|make|save)\b.{0,40}\b(html|htm|\.html)\b|\bhtml\b.{0,40}\b(file|page|animation)\b/i;
const URL_RE = /https?:\/\/[^\s"'<>]+/i;

function extractTypeText(msg: string): string | null {
  const m = String(msg || '').match(NOTEPAD_TYPE_RE) || String(msg || '').match(TYPE_ONLY_RE);
  if (!m?.[1]) return null;
  let t = m[1].trim().replace(/[.?!]+$/, '').trim();
  if (t.length < 1 || t.length > 500) return null;
  if (/^(something|text|a message|here)$/i.test(t)) return null;
  return t;
}

function extractHtmlPath(msg: string): string {
  const named = String(msg || '').match(
    /(?:as|to|into|file(?:\s+named)?|path)\s+[`'"]?([a-z0-9_\-./\\]+\.html?)[`'"]?/i
  );
  if (named?.[1]) {
    const p = named[1].replace(/\\/g, '/');
    return p.includes('/') ? p : `generated/${p}`;
  }
  return `generated/mission-${Date.now()}.html`;
}

function desktopReady(): boolean {
  return desktopPlatformOk() && !desktopDisabled();
}

/** Playbook: notepad launch → focus → type → screenshot verify */
function playbookNotepadType(userMessage: string): MissionPlan | null {
  if (!desktopReady()) return null;
  const t = userMessage.toLowerCase();
  if (!/\bnotepad\b/.test(t)) return null;
  if (!/\b(open|launch|start|run|type)\b/.test(t)) return null;
  const text = extractTypeText(userMessage) || 'hello world';
  const launch = suggestedDesktopLaunchCommand(userMessage) || 'Start-Process notepad; Start-Sleep -Seconds 1';
  return {
    kind: 'desktop_ui',
    objective: `Open Notepad and type: ${text}`,
    playbookId: 'desktop_notepad_type',
    acceptance: [
      { type: 'desktop_seen' },
      { type: 'desktop_typed' },
      { type: 'tool_used', tool: 'desktop_screenshot' },
    ],
    bootstrap: [
      {
        tool: 'execute_command',
        args: { command: `powershell -NoProfile -Command "${launch.replace(/"/g, '\\"')}"` },
        label: 'launch notepad',
      },
      // No OCR — focus+type playbook does not need WinRT (~2s each).
      { tool: 'desktop_screenshot', args: { ocr: false }, label: 'see desktop' },
    ],
    remaining: [
      { tool: 'desktop_focus', args: { title: 'Notepad', click: true }, label: 'focus notepad' },
      { tool: 'desktop_type', args: { text, paste: true }, label: 'type text' },
      { tool: 'desktop_screenshot', args: { ocr: false }, label: 'verify' },
    ],
    slots: { type_text: text, focus_title: 'Notepad' },
    source: 'playbook',
  };
}

/** Playbook: web search → answer */
function playbookWebAnswer(userMessage: string): MissionPlan | null {
  if (!userLikelyNeedsWeb(userMessage)) return null;
  const q = userMessage.replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    kind: 'web_lookup',
    objective: q,
    playbookId: 'web_answer',
    acceptance: [{ type: 'web_results' }, { type: 'nonempty_answer' }],
    bootstrap: [{ tool: 'web_search', args: { query: q }, label: 'web_search' }],
    remaining: [],
    slots: { query: q },
    source: 'playbook',
  };
}

/** Playbook: write HTML under generated/ → read verify */
function playbookWriteHtml(userMessage: string): MissionPlan | null {
  if (!WRITE_HTML_RE.test(userMessage)) return null;
  const path = extractHtmlPath(userMessage);
  const stub = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Caprigo</title>
<style>body{margin:0;min-height:100vh;background:linear-gradient(160deg,#0b1a2a,#c45c26);}</style>
</head>
<body></body>
</html>
`;
  return {
    kind: 'file_write',
    objective: `Write HTML file at ${path}`,
    playbookId: 'write_html_file',
    acceptance: [{ type: 'file_written' }, { type: 'tool_used', tool: 'read_file' }],
    bootstrap: [],
    remaining: [
      { tool: 'write_file', args: { path, content: stub }, label: 'write html' },
      { tool: 'read_file', args: { path }, label: 'verify' },
    ],
    slots: { path },
    source: 'playbook',
  };
}

function compileDesktop(userMessage: string): MissionPlan | null {
  if (!desktopReady() || !userLikelyNeedsDesktop(userMessage)) return null;
  const launch = suggestedDesktopLaunchCommand(userMessage);
  const typeText = extractTypeText(userMessage);
  const bootstrap: MissionStep[] = [];
  if (launch) {
    bootstrap.push({
      tool: 'execute_command',
      args: { command: `powershell -NoProfile -Command "${launch.replace(/"/g, '\\"')}"` },
      label: 'launch app',
    });
  }
  bootstrap.push({
    tool: 'desktop_screenshot',
    // OCR only when we may need click targets; typed/focus flows skip it for speed.
    args: typeText ? { ocr: false } : { ocr: true, max_blocks: 40 },
    label: 'see desktop',
  });
  const remaining: MissionStep[] = [];
  if (typeText) {
    remaining.push({ tool: 'desktop_focus', args: { title: 'Notepad', click: true }, label: 'focus' });
    remaining.push({ tool: 'desktop_type', args: { text: typeText, paste: true }, label: 'type' });
    remaining.push({ tool: 'desktop_screenshot', args: { ocr: false }, label: 'verify' });
  }
  const acceptance: AcceptanceRule[] = [{ type: 'desktop_seen' }];
  if (typeText) acceptance.push({ type: 'desktop_typed' });
  return {
    kind: 'desktop_ui',
    objective: userMessage.replace(/\s+/g, ' ').trim().slice(0, 240),
    acceptance,
    bootstrap,
    remaining,
    slots: typeText ? { type_text: typeText } : {},
    source: 'compiled',
  };
}

function compileBrowser(userMessage: string): MissionPlan | null {
  const m = userMessage.match(URL_RE);
  if (!m) return null;
  if (!/\b(open|browse|navigate|go to|visit)\b/i.test(userMessage) && !/\bbrowser\b/i.test(userMessage)) {
    // bare URL still ok if user said open/visit elsewhere; require browse-ish verb OR "in browser"
    if (!/\b(http|www\.)/i.test(userMessage)) return null;
  }
  const url = m[0];
  return {
    kind: 'browser',
    objective: `Open ${url}`,
    acceptance: [{ type: 'tool_used', tool: 'browser_navigate' }],
    bootstrap: [{ tool: 'browser_navigate', args: { url }, label: 'navigate' }],
    remaining: [{ tool: 'browser_snapshot', args: {}, label: 'snapshot' }],
    slots: { url },
    source: 'compiled',
  };
}

/**
 * Compile a harness mission from the user turn.
 * Returns null for pure chat / no actionable body work.
 */
export function compileMission(
  userMessage: string,
  opts?: { objective?: string; force?: boolean }
): MissionPlan | null {
  const msg = String(userMessage || '').trim();
  if (!msg) return null;

  const notepad = playbookNotepadType(msg);
  if (notepad) return notepad;

  const html = playbookWriteHtml(msg);
  if (html) return html;

  const browser = compileBrowser(msg);
  if (browser) return browser;

  const desktop = compileDesktop(msg);
  if (desktop) return desktop;

  const web = playbookWebAnswer(msg);
  if (web) return web;

  const obj = opts?.objective?.trim();
  if (obj && (opts?.force || obj.length > 8)) {
    // Sticky /loop objective without a fresh intent match — keep general mission.
    return {
      kind: 'general',
      objective: obj,
      acceptance: [{ type: 'nonempty_answer' }],
      bootstrap: [],
      remaining: [],
      slots: {},
      source: 'objective',
    };
  }

  return null;
}

export function createMissionRuntime(plan: MissionPlan): MissionRuntime {
  return {
    plan,
    bootstrapDone: false,
    cardWarnUsed: 0,
    autoPickUsed: 0,
    postActionLlmUsed: 0,
    lastResults: {},
    webQuery: plan.slots.query,
  };
}

export function proposeNextActions(runtime: MissionRuntime, toolsUsed: string[]): MissionStep[] {
  const { plan } = runtime;
  const used = new Set(toolsUsed);
  const out: MissionStep[] = [];
  const shotCount = toolsUsed.filter(t => t === 'desktop_screenshot').length;

  for (const step of plan.remaining) {
    // Never re-propose a tool already attempted this turn (failed or ok) — that loops forever.
    if (step.tool === 'desktop_screenshot') {
      const wantVerify = /verify/i.test(step.label || '');
      if (wantVerify && shotCount >= 2) continue;
      if (!wantVerify && shotCount >= 1) continue;
    } else if (used.has(step.tool)) {
      continue;
    }
    out.push(step);
    if (out.length >= 3) break;
  }

  if (!out.length) {
    if (plan.kind === 'web_lookup' && used.has('web_search')) {
      return [];
    }
    if (plan.kind === 'desktop_ui' && shotCount < 1) {
      out.push({ tool: 'desktop_screenshot', args: { ocr: false }, label: 'see desktop' });
    }
  }
  return out;
}

function ruleSatisfied(
  rule: AcceptanceRule,
  toolsUsed: string[],
  runtime: MissionRuntime,
  assistantText: string
): boolean {
  const used = new Set(toolsUsed);
  switch (rule.type) {
    case 'tool_used':
      return used.has(rule.tool);
    case 'any_tools':
      return rule.tools.some(t => used.has(t));
    case 'web_results': {
      const r = runtime.webResult;
      if (!r || typeof r !== 'object') return used.has('web_search');
      const o = r as Record<string, unknown>;
      if (o.success === false) return false;
      const related = Array.isArray(o.related) ? o.related : [];
      return related.length > 0 || String(o.summary || '').length > 40 || used.has('web_search');
    }
    case 'file_written':
      return used.has('write_file') || used.has('hash_edit') || used.has('search_replace');
    case 'desktop_typed':
      return used.has('desktop_type');
    case 'desktop_seen':
      return used.has('desktop_screenshot') || used.has('desktop_ocr') || used.has('desktop_windows');
    case 'nonempty_answer':
      return String(assistantText || '').trim().length > 20;
    default:
      return false;
  }
}

export function verifyMission(
  runtime: MissionRuntime,
  toolsUsed: string[],
  assistantText: string,
  opts?: { formatWebAnswer?: (result: unknown, query: string) => string | null }
): MissionVerifyResult {
  const { plan } = runtime;
  if (!plan.acceptance.length) {
    if (String(assistantText || '').trim()) return { status: 'pass', detail: 'answered' };
    return { status: 'continue', detail: 'need answer' };
  }

  const pending = plan.acceptance.filter(
    r => !ruleSatisfied(r, toolsUsed, runtime, assistantText)
  );

  // Web: harness can assemble answer when search succeeded
  if (plan.kind === 'web_lookup' && runtime.webResult && opts?.formatWebAnswer) {
    const webOk = ruleSatisfied({ type: 'web_results' }, toolsUsed, runtime, assistantText);
    if (webOk) {
      const onlyAnswerLeft =
        pending.length === 0 ||
        (pending.length === 1 && pending[0].type === 'nonempty_answer');
      if (onlyAnswerLeft) {
        const direct =
          opts.formatWebAnswer(runtime.webResult, runtime.webQuery || plan.objective) || undefined;
        if (direct || String(assistantText || '').trim().length > 20) {
          return {
            status: 'pass',
            detail: 'web results ready',
            directAnswer: String(assistantText || '').trim().length > 40 ? undefined : direct,
          };
        }
      }
    }
  }

  if (!pending.length) {
    return { status: 'pass', detail: 'acceptance met' };
  }

  // Still have playbook steps the harness can run
  if (proposeNextActions(runtime, toolsUsed).length > 0) {
    return { status: 'continue', detail: `pending: ${pending.map(p => p.type).join(',')}` };
  }

  if (plan.kind === 'web_lookup' && toolsUsed.includes('web_search')) {
    const direct = opts?.formatWebAnswer?.(runtime.webResult, runtime.webQuery || plan.objective);
    if (direct) return { status: 'pass', detail: 'harness web answer', directAnswer: direct };
  }

  return { status: 'continue', detail: `pending: ${pending.map(p => p.type).join(',')}` };
}

/** Advance remaining list after a successful tool (best-effort). */
export function noteToolSuccess(runtime: MissionRuntime, tool: string): void {
  const idx = runtime.plan.remaining.findIndex(s => s.tool === tool);
  if (idx >= 0) runtime.plan.remaining.splice(idx, 1);
}

export function missionSystemSuffix(plan: MissionPlan): string {
  const pb = plan.playbookId ? ` playbook=${plan.playbookId}` : '';
  return [
    `\n[Caprigo HOME mission${pb}]`,
    `Objective: ${plan.objective}`,
    `Kind: ${plan.kind}. Bootstrap tools may already have run — use their results.`,
    'Continue with Action Cards or native tool_calls. Never refuse OS/web capability.',
    'Harness decides done via acceptance checks — do not ask the user to retry.\n',
  ].join('\n');
}

export function homeEnabled(): boolean {
  const raw = String(process.env.CAPRIGO_HOME ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

/** After bootstrap, execute remaining playbook steps without waiting for the LLM (default on). */
export function homeAutoDrainEnabled(): boolean {
  const raw = String(process.env.CAPRIGO_HOME_AUTODRAIN ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

export function formatHomeDoneAnswer(runtime: MissionRuntime, direct?: string): string {
  if (direct?.trim()) return direct.trim();
  const { plan } = runtime;
  if (plan.playbookId === 'desktop_notepad_type' || plan.kind === 'desktop_ui') {
    const text = plan.slots.type_text;
    return text
      ? `Done. Opened the target app and typed: ${text}`
      : `Done. Completed desktop steps for: ${plan.objective}`;
  }
  if (plan.playbookId === 'write_html_file' || plan.kind === 'file_write') {
    const p = plan.slots.path || 'generated/…';
    return `Done. Wrote and verified ${p}`;
  }
  if (plan.kind === 'web_lookup') {
    return `Done. Looked up: ${plan.objective}`;
  }
  return `Done: ${plan.objective}`;
}
