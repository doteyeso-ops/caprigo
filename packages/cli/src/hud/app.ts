/**
 * Caprigo HUD — multi-pane TUI (header / agents / session / context / input).
 * Zero deps beyond Node readline raw mode.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { EmbeddedRuntime } from '../embedded-runtime';
import {
  describeLmStudioTarget,
  probeImageBackend,
  probeDesktopBackend,
  probeDesktopOcr,
  playwrightChromiumReady,
  probeLmStudio,
} from '../embedded-runtime';
import { brainStatusSummary, profileOneLiner } from '@caprigo/agent';
import { connectLmStudio } from '../lmstudio-connect';
import { autosaveCodeFences } from './autosave';
import { formatMarkdownReply, looksStructuredMarkdown } from './format-blocks';
import { InputLine } from './input-line';
import { writeBugReport, listBugReports } from './bug-report';
import { listLmStudioModels, loadLmStudioModel } from './lmstudio-models';
import { canonicalLmStudioModelId } from '../embedded-runtime';
import {
  archiveHudSession,
  listHudSessions,
  loadHudSession,
  saveHudSession,
  type HudLogLine,
  type HudSessionMeta,
} from './sessions';
import { T, paint, fitCell, row3, hRule, truncPlain, wrapVis } from './theme';
import { toolCardClose, toolCardOpen } from './tool-cards';
import {
  loadInputHistory,
  saveInputHistory,
} from './input-history';
import { openLocalPath } from '../open-browser';
/** Braille pinwheel for header status while a model load runs in the background. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

type LogKind = HudLogLine['kind'];
type LogLine = HudLogLine;

type Mode = 'chat' | 'models' | 'provider' | 'sessions';

function envPath(): string {
  return path.resolve(__dirname, '../../../../.env');
}

function upsertEnv(patch: Record<string, string>): void {
  const p = envPath();
  let raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const lines = raw ? raw.split(/\r?\n/) : [];
  const handled = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      out.push(line);
      continue;
    }
    const eq = t.indexOf('=');
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = t.slice(0, eq).trim();
    if (key in patch) {
      out.push(`${key}=${patch[key]}`);
      handled.add(key);
    } else out.push(line);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!handled.has(k)) out.push(`${k}=${v}`);
  }
  fs.writeFileSync(p, out.join('\n').replace(/\n*$/, '\n'), 'utf8');
  for (const [k, v] of Object.entries(patch)) process.env[k] = v;
}

function shortModel(m: string, max = 32): string {
  const base = m.includes('/') ? m.split('/').pop()! : m;
  return truncPlain(base, max);
}

export async function runHud(rt: EmbeddedRuntime): Promise<void> {
  const logs: LogLine[] = [];
  const filesTouched: string[] = [];
  let mode: Mode = 'chat';
  let busy = false;
  /** Catalog id while LM Studio load runs; null when idle. Blocks double-Enter / stacked instances. */
  let modelLoadInFlight: string | null = null;
  let spinFrame = 0;
  /** One queued user prompt while an agent turn is in flight (Claude Code-style). */
  let pendingPrompt: string | null = null;
  let showThinking = !/^(0|false|off|no)$/i.test(String(process.env.CAPRIGO_SHOW_THINKING ?? '1'));
  let missionOn = !!rt.session.objective;
  let statusMsg = 'ready';
  let online = false;
  let modelList: string[] = [];
  let modelCursor = 0;
  let providerField: 'url' | 'key' | 'done' = 'url';
  let providerDraft = '';
  let scroll = 0; // lines from bottom (wrapped view)
  let needsDraw = true;
  let lastDraw = '';
  let sessionId: string | undefined;
  let sessionTitle = 'Untitled';
  let sessionList: HudSessionMeta[] = [];
  let sessionCursor = 0;
  let showArchived = false;
  let midInnerW = 40;
  let capsBrowser = playwrightChromiumReady();
  let capsImage = '…';
  let capsImageOk = false;
  let capsDesktop = '…';
  let capsDesktopOk = false;
  let capsOcr = '…';
  let capsOcrOk = false;
  let capsDialect = '…';
  let capsBrain = '…';
  let capsWeb = '…';
  let capsWebOk = false;

  const refreshCaps = async () => {
    capsBrowser = playwrightChromiumReady();
    try {
      const desk = probeDesktopBackend();
      capsDesktopOk = desk.ok;
      capsDesktop = desk.mode;
    } catch {
      capsDesktopOk = false;
      capsDesktop = 'off';
    }
    try {
      const ocr = probeDesktopOcr();
      capsOcrOk = ocr.ok;
      capsOcr = ocr.mode;
    } catch {
      capsOcrOk = false;
      capsOcr = 'off';
    }
    try {
      const img = await probeImageBackend();
      capsImageOk = img.ok;
      if (img.ok) {
        const short = img.model
          ? String(img.model).replace(/\.safetensors.*/i, '').slice(0, 18)
          : img.provider;
        capsImage = short || 'ready';
      } else {
        capsImage = 'off';
      }
    } catch {
      capsImageOk = false;
      capsImage = 'off';
    }
    const mode = (process.env.CAPRIGO_WEB_SEARCH || 'auto').trim().toLowerCase();
    const braveKey = !!(
      process.env.BRAVE_API_KEY?.trim() ||
      process.env.BRAVE_SEARCH_API_KEY?.trim() ||
      process.env.CAPRIGO_BRAVE_API_KEY?.trim()
    );
    const gemKey = !!(
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.GOOGLE_AI_API_KEY?.trim()
    );
    const webOff = /^(1|true)$/i.test(String(process.env.CAPRIGO_DISABLE_WEB_TOOLS || ''));
    if (webOff) {
      capsWebOk = false;
      capsWeb = 'off';
    } else if (mode === 'ddg' || mode === 'duckduckgo') {
      capsWebOk = true;
      capsWeb = 'ddg';
    } else if (mode === 'brave') {
      capsWebOk = true;
      capsWeb = braveKey ? 'brave-api' : 'brave';
    } else if (mode === 'gemini' || mode === 'google' || mode === 'google_ai') {
      capsWebOk = gemKey;
      capsWeb = gemKey ? 'gemini' : 'need key';
    } else {
      // auto: free Brave HTML by default
      capsWebOk = true;
      capsWeb = braveKey ? 'brave-api' : gemKey ? 'brave+gem' : 'brave';
    }
    try {
      const p = rt.getProfile();
      capsDialect = p ? `${p.dialect}/${p.source}` : '…';
    } catch {
      capsDialect = '?';
    }
    try {
      const b = brainStatusSummary();
      const goal = b.working.goal ? String(b.working.goal).slice(0, 24) : '—';
      capsBrain = `${b.lessonCount}L ${goal}`;
    } catch {
      capsBrain = '?';
    }
    needsDraw = true;
  };
  void refreshCaps();
  const capsTimer = setInterval(() => {
    void refreshCaps();
  }, 45_000);

  const push = (kind: LogKind, text: string) => {
    const atBottom = scroll === 0;
    const before = logs.length;
    for (const line of text.split(/\r?\n/)) {
      logs.push({ kind, text: line, ts: Date.now() });
    }
    if (logs.length > 4000) logs.splice(0, logs.length - 4000);
    const added = logs.length - before;
    if (atBottom) scroll = 0;
    else scroll += Math.max(0, added);
    needsDraw = true;
  };

  const persistSession = (title?: string) => {
    const rec = saveHudSession({
      id: sessionId,
      title: title || sessionTitle,
      model: rt.model,
      workspace: rt.workspace,
      logs,
      filesTouched,
      messages: rt.getTranscript(),
    });
    sessionId = rec.id;
    sessionTitle = rec.title;
    return rec;
  };

  const probe = await probeLmStudio();
  online = probe.ok;
  modelList = probe.models.filter(m => !/embed/i.test(m));
  modelCursor = Math.max(0, modelList.findIndex(m => m === rt.model));

  push('system', 'Caprigo HUD ready. Ask in plain language — Caprigo writes files and runs tools for you.');
  push('meta', `Server ${describeLmStudioTarget()} · model ${rt.model}`);
  push('meta', 'Tips: PgUp/PgDn scroll · Tab /cmds · Ctrl+J newline · /save · /models · /quit');

  const enterAlt = () => {
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
  };
  const leaveAlt = () => {
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  };

  const size = () => {
    // Soft floors so Windows small consoles still render without wrap cascade.
    const cols = Math.max(60, Number(process.stdout.columns) || 80);
    const rows = Math.max(16, Number(process.stdout.rows) || 24);
    return { cols, rows };
  };

  const draw = () => {
    const { cols, rows } = size();
    const headerH = 4;
    const inputH = 3;
    const bodyH = Math.max(8, rows - headerH - inputH);

    // Stable pane widths that always sum to cols
    const leftW = cols < 100 ? 18 : 20;
    const rightW = cols < 110 ? 26 : 30;
    const midW = cols - leftW - rightW;

    const lines: string[] = [];

    // ── Header ──────────────────────────────────────────
    const onlineBadge = online
      ? paint(T.bgOnline + T.teal + T.bold, ' LM STUDIO ONLINE ')
      : paint(T.red + T.bold, ' LM STUDIO OFFLINE ');
    const spin = SPINNER[spinFrame % SPINNER.length];
    const liveStatus = modelLoadInFlight
      ? paint(
          T.amber + T.bold,
          `${spin} Model is loading · ${shortModel(modelLoadInFlight, 28)}`
        )
      : busy
        ? paint(T.amber + T.bold, `${spin} ${statusMsg || 'processing…'}`)
        : paint(T.gray, statusMsg);
    const headerBits = [
      paint(T.teal + T.bold, ' * CAPRIGO'),
      paint(T.gray, 'local'),
      onlineBadge,
      paint(T.purple + T.bold, shortModel(rt.model, Math.min(40, Math.floor(cols / 4)))),
      liveStatus,
    ];
    lines.push(fitCell(headerBits.join(paint(T.border, ' | ')), cols));
    lines.push(hRule(cols));
    lines.push(fitCell(paint(T.dim + T.gray, `  cwd  ${rt.workspace}`), cols));
    lines.push(hRule(cols));

    // ── Column content (plain-ish strings; fitCell clips safely) ──
    const left: string[] = [];
    const mid: string[] = [];
    const right: string[] = [];

    left.push(paint(T.teal + T.bold, ' AGENTS'));
    left.push(paint(T.border, '─'.repeat(Math.max(0, leftW - 2))));
    left.push(paint(T.purple + T.bold, ' * Caprigo'));
    left.push(paint(T.green, '   active'));
    left.push(paint(T.gray, missionOn ? '   mode LOOP' : '   mode chat'));
    left.push(paint(T.gray, showThinking ? '   think ON' : '   think OFF'));
    left.push('');
    left.push(paint(T.dim + T.gray, ' /models'));
    left.push(paint(T.dim + T.gray, ' /provider'));
    left.push(paint(T.dim + T.gray, ' /loop'));
    left.push(paint(T.dim + T.gray, ' /think'));

    right.push(paint(T.teal + T.bold, ' CONTEXT'));
    right.push(paint(T.border, '─'.repeat(Math.max(0, rightW - 1))));
    right.push(paint(T.gray, ' Caps'));
    right.push(
      paint(
        online ? T.green : T.red,
        ` LMS ${online ? 'up' : 'down'}`
      )
    );
    right.push(
      paint(capsBrowser ? T.green : T.amber, ` Browser ${capsBrowser ? 'ok' : 'need install'}`)
    );
    right.push(paint(capsDesktopOk ? T.green : T.amber, ` Desktop ${capsDesktop}`));
    right.push(paint(capsOcrOk ? T.green : T.amber, ` OCR ${capsOcr}`));
    right.push(paint(capsImageOk ? T.green : T.amber, ` Image ${capsImage}`));
    right.push(paint(capsWebOk ? T.green : T.amber, ` Web ${capsWeb}`));
    {
      const hk = rt.session.homeMissionKind || (missionOn ? 'loop' : '');
      right.push(
        paint(hk ? T.green : T.dim + T.gray, ` Mission ${hk || 'off'}${rt.session.homePlaybookId ? `/${rt.session.homePlaybookId}` : ''}`.slice(0, Math.max(12, rightW - 1)))
      );
    }
    right.push(paint(T.purple, ` Dialect ${capsDialect}`));
    right.push(paint(T.teal, ` Brain ${capsBrain}`));
    right.push('');
    right.push(paint(T.gray, ' Engine'));
    right.push(paint(T.white, ` ${shortModel(rt.model, rightW - 3)}`));
    right.push(paint(T.dim + T.gray, ` ${describeLmStudioTarget()}`));
    right.push('');
    right.push(paint(T.gray, ' Files'));
    if (!filesTouched.length) {
      right.push(paint(T.dim + T.gray, ' (none yet)'));
    } else {
      for (const f of filesTouched.slice(-8)) {
        right.push(paint(T.amber, ` ${path.basename(f)}`));
      }
    }
    right.push('');
    right.push(paint(T.gray, ' Goal'));
    right.push(
      paint(
        T.white,
        ` ${rt.session.objective ? rt.session.objective : '—'}`
      )
    );

    // Models / provider / sessions: full-width overlay
    const overlay = mode === 'models' || mode === 'provider' || mode === 'sessions';

    if (overlay) {
      const menu: string[] = [];
      if (mode === 'models') {
        menu.push(paint(T.purple + T.bold, ' SELECT MODEL'));
        menu.push(paint(T.dim + T.gray, ' Up/Down move  ·  Enter load  ·  Esc cancel'));
        menu.push(hRule(cols));
        menu.push('');
        if (!modelList.length) {
          menu.push(paint(T.amber, '  No models found. Is LM Studio serving /v1/models?'));
        }
        const listH = bodyH - 5;
        const start = Math.max(0, Math.min(modelCursor - Math.floor(listH / 2), modelList.length - listH));
        const view = modelList.slice(start, start + listH);
        view.forEach((m, idx) => {
          const i = start + idx;
          const selected = i === modelCursor;
          const current = m === rt.model;
          const mark = selected ? paint(T.teal + T.bold, ' > ') : '   ';
          const name = paint(selected ? T.white + T.bold : T.gray, m);
          const tag = current ? paint(T.green, '  [current]') : '';
          menu.push(fitCell(mark + name + tag, cols));
        });
      } else if (mode === 'provider') {
        menu.push(paint(T.purple + T.bold, ' PROVIDER SETUP'));
        menu.push(paint(T.dim + T.gray, ' Enter confirm  ·  Esc cancel'));
        menu.push(hRule(cols));
        menu.push('');
        menu.push(paint(T.gray, ' Current'));
        menu.push(paint(T.white, `  ${describeLmStudioTarget()}`));
        menu.push('');
        if (providerField === 'url') {
          menu.push(paint(T.amber, ' Step 1/2 — Base URL'));
          menu.push(paint(T.white, `  ${providerDraft || 'http://HOST:1234/v1'}`));
          menu.push(paint(T.dim + T.gray, '  Example: http://10.0.0.27:1234/v1'));
        } else {
          menu.push(paint(T.amber, ' Step 2/2 — API key (optional for LM Studio)'));
          menu.push(paint(T.white, `  ${providerDraft ? '********' : '(leave blank if local)'}`));
        }
      } else {
        menu.push(paint(T.purple + T.bold, showArchived ? ' ARCHIVED SESSIONS' : ' SAVED SESSIONS'));
        menu.push(
          paint(T.dim + T.gray, ' Up/Down · Enter load · a archive · Tab toggle archive · Esc')
        );
        menu.push(hRule(cols));
        menu.push('');
        if (!sessionList.length) {
          menu.push(
            paint(T.amber, showArchived ? '  No archived sessions.' : '  No saved sessions. Use /save')
          );
        }
        const listH = bodyH - 5;
        const start = Math.max(
          0,
          Math.min(sessionCursor - Math.floor(listH / 2), sessionList.length - listH)
        );
        sessionList.slice(start, start + listH).forEach((s, idx) => {
          const i = start + idx;
          const selected = i === sessionCursor;
          const mark = selected ? paint(T.teal + T.bold, ' > ') : '   ';
          const title = paint(selected ? T.white + T.bold : T.gray, truncPlain(s.title, cols - 28));
          const when = paint(T.dim + T.gray, `  ${new Date(s.updatedAt).toLocaleString()}`);
          menu.push(fitCell(mark + title + when, cols));
        });
      }
      while (menu.length < bodyH) menu.push('');
      for (let i = 0; i < bodyH; i++) lines.push(fitCell(menu[i] || '', cols));
    } else {
      mid.push(
        paint(T.teal + T.bold, ' SESSION') +
          paint(T.dim + T.gray, `  ${truncPlain(sessionTitle, Math.max(8, midW - 18))}`)
      );
      const scrollHint =
        scroll > 0 ? paint(T.amber, ` ↑${scroll}`) : paint(T.dim + T.gray, ' PgUp');
      mid.push(paint(T.border, '─'.repeat(Math.max(0, midW - 8))) + scrollHint);

      midInnerW = Math.max(12, midW - 1);
      const wrapped: Array<{ kind: LogKind; text: string }> = [];
      for (const row of logs) {
        for (const chunk of wrapVis(row.text, midInnerW)) {
          wrapped.push({ kind: row.kind, text: chunk });
        }
      }
      const viewH = Math.max(1, bodyH - 2);
      const maxScroll = Math.max(0, wrapped.length - viewH);
      if (scroll > maxScroll) scroll = maxScroll;
      const slice = wrapped.slice(
        Math.max(0, wrapped.length - viewH - scroll),
        Math.max(0, wrapped.length - scroll)
      );
      for (const row of slice) {
        const c =
          row.kind === 'user'
            ? T.teal
            : row.kind === 'think'
              ? T.purple + T.dim
              : row.kind === 'reply'
                ? T.white
                : row.kind === 'tool'
                  ? T.amber
                  : row.kind === 'ok'
                    ? T.green
                    : row.kind === 'err'
                      ? T.red
                      : T.gray;
        mid.push(paint(c, row.text));
      }

      while (left.length < bodyH) left.push('');
      while (mid.length < bodyH) mid.push('');
      while (right.length < bodyH) right.push('');

      for (let i = 0; i < bodyH; i++) {
        lines.push(row3(left[i] || '', mid[i] || '', right[i] || '', leftW, midW, rightW));
      }
    }

    // ── Input ───────────────────────────────────────────
    lines.push(hRule(cols));
    const displayValue = input.value.replace(/\n/g, '⏎');
    const cursorVis = input.value.slice(0, input.cursorPos).replace(/\n/g, '⏎').length;
    const before = displayValue.slice(0, cursorVis);
    const after = displayValue.slice(cursorVis);
    let inputRow: string;
    if (mode === 'models' || mode === 'sessions') {
      inputRow = paint(T.dim + T.gray, mode === 'models' ? '  [model picker]' : '  [session picker]');
    } else if (input.value.length || mode === 'provider') {
      inputRow =
        paint(T.teal + T.bold, ' > ') +
        paint(T.white, before) +
        paint(T.teal + T.bold, '|') +
        paint(T.white, after);
    } else {
      inputRow =
        paint(T.teal + T.bold, ' > ') +
        paint(T.dim + T.gray, 'Ask Caprigo…  /save  /sessions  /models');
    }
    lines.push(fitCell(inputRow, cols));
    lines.push(
      fitCell(
        paint(
          T.dim + T.gray,
          modelLoadInFlight
            ? `  ${SPINNER[spinFrame % SPINNER.length]} waiting for model…`
            : busy
              ? `  ${SPINNER[spinFrame % SPINNER.length]} processing · Ctrl+C stop · Enter STEER · Enter×2 send`
              : '  Enter×2 send · Ctrl+Enter send · Ctrl+J newline · Tab /cmds · /bug · /help'
        ),
        cols
      )
    );

    while (lines.length < rows) lines.push(fitCell('', cols));
    // Ensure every line is exact width to prevent wrap cascade
    const frame = lines
      .slice(0, rows)
      .map(l => fitCell(l, cols))
      .join('\n');

    if (frame !== lastDraw) {
      process.stdout.write('\x1b[H\x1b[J' + frame);
      lastDraw = frame;
    }
    needsDraw = false;
  };

  const input = new InputLine(ev => {
    if (ev.type === 'change') {
      if (mode === 'provider') providerDraft = ev.value;
      input.setScrollArrows(mode === 'chat' && !ev.value);
      needsDraw = true;
      return;
    }
    if (ev.type === 'steer_armed') {
      statusMsg = 'Enter again to send…';
      needsDraw = true;
      return;
    }
    if (ev.type === 'interrupt') {
      if (busy) {
        rt.requestStop();
        statusMsg = 'stop requested';
        push('meta', 'Stop requested…');
        needsDraw = true;
        return;
      }
      shutdown(0);
      return;
    }
    if (ev.type === 'cancel') {
      shutdown(0);
      return;
    }
    if (ev.type === 'escape') {
      if (mode !== 'chat') {
        setMode('chat');
        input.clear();
        statusMsg = 'ready';
        needsDraw = true;
      }
      return;
    }
    if (ev.type === 'tab') {
      if (mode === 'sessions') {
        showArchived = !showArchived;
        sessionList = listHudSessions({ archived: showArchived });
        sessionCursor = 0;
        needsDraw = true;
        return;
      }
      if (mode === 'chat') {
        const cur = input.value;
        if (cur.startsWith('/')) {
          const cmds = [
            '/models',
            '/provider',
            '/save',
            '/sessions',
            '/archive',
            '/new',
            '/load ',
            '/loop',
            '/noloop',
            '/think',
            '/clear',
            '/compact',
            '/status',
            '/tools',
            '/brain',
            '/profile',
            '/bug',
            '/steer ',
            '/open ',
            '/help',
            '/quit',
          ];
          const hits = cmds.filter(c => c.startsWith(cur.toLowerCase()));
          if (hits.length === 1) {
            input.setValue(hits[0]);
          } else if (hits.length > 1) {
            // Longest common prefix
            let p = hits[0];
            for (const h of hits.slice(1)) {
              let i = 0;
              while (i < p.length && i < h.length && p[i] === h[i]) i += 1;
              p = p.slice(0, i);
            }
            if (p.length > cur.length) input.setValue(p);
            else push('meta', hits.join('  '));
          }
          needsDraw = true;
        }
      }
      return;
    }
    if (ev.type === 'pageup' || ev.type === 'scroll_up') {
      if (mode === 'chat') {
        scroll += ev.type === 'pageup' ? 8 : 1;
        needsDraw = true;
      }
      return;
    }
    if (ev.type === 'pagedown' || ev.type === 'scroll_down') {
      if (mode === 'chat') {
        scroll = Math.max(0, scroll - (ev.type === 'pagedown' ? 8 : 1));
        needsDraw = true;
      }
      return;
    }
    if (ev.type === 'up' && mode === 'models') {
      modelCursor = Math.max(0, modelCursor - 1);
      needsDraw = true;
      return;
    }
    if (ev.type === 'down' && mode === 'models') {
      modelCursor = Math.min(Math.max(0, modelList.length - 1), modelCursor + 1);
      needsDraw = true;
      return;
    }
    if (ev.type === 'up' && mode === 'sessions') {
      sessionCursor = Math.max(0, sessionCursor - 1);
      needsDraw = true;
      return;
    }
    if (ev.type === 'down' && mode === 'sessions') {
      sessionCursor = Math.min(Math.max(0, sessionList.length - 1), sessionCursor + 1);
      needsDraw = true;
      return;
    }
    if (ev.type === 'submit') {
      void onSubmit(ev.value);
    }
  });

  const setMode = (next: Mode) => {
    mode = next;
    input.setNavMode(next === 'models' || next === 'sessions');
    input.setScrollArrows(next === 'chat' && !input.value);
    if (next === 'models' || next === 'sessions') input.clear();
  };

  const onSubmit = async (raw: string) => {
    const text = raw.trim();
    if (mode === 'sessions') {
      if (!text || text.toLowerCase() === 'a') {
        // bare Enter loads; "a" archives selected
        if (text.toLowerCase() === 'a') {
          const pick = sessionList[sessionCursor];
          if (pick && archiveHudSession(pick.id)) {
            push('ok', `Archived: ${pick.title}`);
            sessionList = listHudSessions({ archived: showArchived });
            sessionCursor = Math.min(sessionCursor, Math.max(0, sessionList.length - 1));
            needsDraw = true;
          }
          return;
        }
      }
      const pick = sessionList[sessionCursor];
      if (!pick) return;
      const loaded = loadHudSession(pick.id);
      if (!loaded) {
        push('err', `Could not load session ${pick.id}`);
        setMode('chat');
        return;
      }
      logs.length = 0;
      for (const row of loaded.logs) logs.push(row);
      filesTouched.length = 0;
      filesTouched.push(...(loaded.filesTouched || []));
      sessionId = loaded.id;
      sessionTitle = loaded.title;
      rt.replaceTranscript(loaded.messages || []);
      if (loaded.model) rt.setModel(loaded.model);
      scroll = 0;
      setMode('chat');
      statusMsg = `loaded ${truncPlain(sessionTitle, 24)}`;
      push('system', `Restored session: ${sessionTitle}`);
      needsDraw = true;
      return;
    }

    if (mode === 'models') {
      if (modelLoadInFlight) {
        push('meta', `Already loading ${shortModel(modelLoadInFlight)} — wait for it to finish.`);
        setMode('chat');
        input.clear();
        needsDraw = true;
        return;
      }
      const pick = canonicalLmStudioModelId(modelList[modelCursor] || '');
      if (!pick) return;

      // Instant return to chat; load runs in background with header pinwheel.
      modelLoadInFlight = pick;
      spinFrame = 0;
      rt.setModel(pick);
      upsertEnv({ DEFAULT_MODEL: pick });
      setMode('chat');
      input.clear();
      statusMsg = 'loading model…';
      push('meta', `Selected ${shortModel(pick)} — loading in background…`);
      needsDraw = true;
      draw();

      void (async () => {
        try {
          const loaded = await loadLmStudioModel(pick);
          // Ignore stale completion if user started a newer load.
          if (modelLoadInFlight !== pick) return;
          push(loaded.ok ? 'ok' : 'err', loaded.detail);
          statusMsg = loaded.ok ? `model ${shortModel(pick)}` : 'load failed';
        } catch (err) {
          if (modelLoadInFlight !== pick) return;
          push('err', err instanceof Error ? err.message : String(err));
          statusMsg = 'load failed';
        } finally {
          if (modelLoadInFlight === pick) modelLoadInFlight = null;
          needsDraw = true;
        }
      })();
      return;
    }

    if (mode === 'provider') {
      if (providerField === 'url') {
        const url = (text || providerDraft || describeLmStudioTarget()).trim();
        upsertEnv({
          CAPRIGO_LLM_PROVIDER: 'openai_compatible',
          OPENAI_BASE_URL: url.replace(/\/$/, '').endsWith('/v1')
            ? url.replace(/\/$/, '')
            : `${url.replace(/\/$/, '')}/v1`,
          CAPRIGO_HARNESS_MODE: '1',
        });
        providerField = 'key';
        providerDraft = '';
        input.clear();
        statusMsg = 'enter API key (optional)';
        needsDraw = true;
        return;
      }
      if (providerField === 'key') {
        if (text) upsertEnv({ OPENAI_API_KEY: text });
        const probe2 = await probeLmStudio();
        online = probe2.ok;
        modelList = probe2.models.filter(m => !/embed/i.test(m));
        push(online ? 'ok' : 'err', online ? `Connected ${describeLmStudioTarget()}` : `Unreachable: ${probe2.error}`);
        setMode('chat');
        providerField = 'url';
        providerDraft = '';
        input.clear();
        statusMsg = online ? 'ready' : 'offline';
        needsDraw = true;
        return;
      }
    }

    if (!text) return;

    // slash commands
    const lower = text.toLowerCase();
    if (lower === '/quit' || lower === '/exit' || lower === '/q') {
      shutdown(0);
      return;
    }
    if (lower === '/clear') {
      logs.length = 0;
      filesTouched.length = 0;
      rt.clearTranscript();
      rt.clearBrainWorking();
      sessionId = undefined;
      sessionTitle = 'Untitled';
      scroll = 0;
      pendingPrompt = null;
      push('system', 'Session cleared (log + transcript + brain working memory). Lessons/profiles kept.');
      statusMsg = 'cleared';
      void refreshCaps();
      return;
    }
    if (lower === '/compact') {
      const keep = 120;
      if (logs.length > keep) {
        const removed = logs.length - keep;
        logs.splice(0, removed);
        push('meta', `Compacted HUD log (−${removed} lines). Agent transcript unchanged — use /clear to reset memory.`);
      } else {
        push('meta', 'Log already compact.');
      }
      scroll = 0;
      statusMsg = 'compact';
      return;
    }
    if (lower === '/save' || lower.startsWith('/save ')) {
      const title = lower === '/save' ? undefined : text.slice(5).trim();
      const rec = persistSession(title);
      push('ok', `Saved session: ${rec.title}`);
      statusMsg = 'saved';
      return;
    }
    if (lower === '/sessions' || lower === '/archive' || lower === '/history') {
      showArchived = lower === '/archive';
      sessionList = listHudSessions({ archived: showArchived });
      sessionCursor = 0;
      setMode('sessions');
      statusMsg = showArchived ? 'archived sessions' : 'sessions';
      needsDraw = true;
      return;
    }
    if (lower === '/new') {
      if (logs.length > 3) persistSession();
      logs.length = 0;
      filesTouched.length = 0;
      rt.clearTranscript();
      rt.clearBrainWorking();
      sessionId = undefined;
      sessionTitle = 'Untitled';
      scroll = 0;
      push('system', 'New session started. Working memory cleared; lessons kept.');
      statusMsg = 'new session';
      void refreshCaps();
      return;
    }
    if (lower.startsWith('/load ')) {
      const id = text.slice(5).trim();
      const loaded = loadHudSession(id) || listHudSessions().map(m => loadHudSession(m.id)).find(s => s && (s.id === id || s.title === id));
      if (!loaded) {
        push('err', `Session not found: ${id}`);
        return;
      }
      logs.length = 0;
      for (const row of loaded.logs) logs.push(row);
      filesTouched.length = 0;
      filesTouched.push(...(loaded.filesTouched || []));
      sessionId = loaded.id;
      sessionTitle = loaded.title;
      rt.replaceTranscript(loaded.messages || []);
      scroll = 0;
      push('system', `Restored: ${sessionTitle}`);
      return;
    }
    if (lower === '/think' || lower === '/thinking') {
      showThinking = !showThinking;
      process.env.CAPRIGO_SHOW_THINKING = showThinking ? '1' : '0';
      push('meta', showThinking ? 'Thinking visible.' : 'Thinking hidden.');
      return;
    }
    if (lower === '/models' || lower === '/model') {
      if (modelLoadInFlight) {
        push('meta', `Model still loading (${shortModel(modelLoadInFlight)}) — wait before switching.`);
        needsDraw = true;
        return;
      }
      // Show picker immediately; refresh list in background.
      setMode('models');
      statusMsg = 'select model';
      needsDraw = true;
      draw();
      void listLmStudioModels().then(listed => {
        if (mode !== 'models') return;
        online = !listed.error;
        modelList = listed.models;
        modelCursor = Math.max(0, modelList.findIndex(m => m === rt.model));
        if (modelCursor < 0) modelCursor = 0;
        needsDraw = true;
      });
      return;
    }
    if (lower === '/provider') {
      setMode('provider');
      providerField = 'url';
      providerDraft = describeLmStudioTarget();
      input.setValue(providerDraft);
      statusMsg = 'provider setup';
      needsDraw = true;
      return;
    }
    if (lower === '/noloop' || lower === '/loop off') {
      rt.clearMission();
      missionOn = false;
      push('ok', 'Mission cleared.');
      return;
    }
    if (lower === '/loop' || lower.startsWith('/loop ')) {
      const obj = lower === '/loop' ? '' : text.slice(5).trim();
      if (!obj) {
        push('err', 'Usage: /loop <goal>');
        return;
      }
      rt.enableMission(obj);
      missionOn = true;
      push('ok', `Mission: ${obj}`);
      await runAgent(obj);
      return;
    }
    if (lower === '/tools' || lower === '/skills') {
      push('meta', 'Tools: ' + rt.listSkills().join(', '));
      return;
    }
    if (lower === '/connect') {
      try {
        const result = await connectLmStudio({
          envPath: envPath(),
          scanLan: true,
          write: true,
          onProgress: m => push('meta', m),
        });
        online = true;
        rt.setModel(result.model);
        modelList = result.models.filter(m => !/embed/i.test(m));
        push('ok', `Connected ${result.baseUrl} · ${result.model}`);
      } catch (e) {
        push('err', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (lower === '/help' || lower === '/?') {
      push(
        'system',
        'Commands: /models /provider /status /tools /brain /profile /bug /steer /open /save /sessions /new /load /loop /think /clear /compact /quit'
      );
      push(
        'system',
        'STEER: Enter = newline · Enter again (≤500ms) = send · Ctrl+Enter = send now · while busy Enter steers mid-turn'
      );
      push('system', 'Shell: !command  ·  Tab completes /cmds  ·  PgUp/PgDn scroll  ·  /bug [note] writes ~/.caprigo/bug-reports/');
      push(
        'system',
        'Skills: files, shell, web, browser, desktop_* (+ ocr/find), list_lan_devices, clipboard_*, brain_*, generate_image, memory'
      );
      push('system', 'Digital body: execute_command · browser_* · desktop_* (screenshot→ocr→click cx,cy→verify). Caps Desktop/OCR.');
      push('system', 'Stumble-to-walk + Brain learn from failures. /profile probe re-handshakes tool dialect.');
      push('system', '/clear resets log + transcript + working memory (lessons persist).');
      return;
    }
    if (lower === '/bug' || lower.startsWith('/bug ')) {
      const note = text.slice(4).trim() || 'manual';
      try {
        const p = rt.getProfile();
        const { mdPath } = writeBugReport({
          note,
          sessionId: rt.session.id,
          model: rt.model,
          provider: rt.providerId,
          workspace: rt.workspace,
          online,
          busy,
          mission: rt.session.objective,
          dialect: p ? profileOneLiner(p) : capsDialect,
          caps: {
            browser: capsBrowser,
            desktop: capsDesktop,
            ocr: capsOcr,
            image: capsImage,
            brain: capsBrain,
          },
          logs: logs.slice(-120).map(l => ({ kind: l.kind, text: l.text, ts: l.ts })),
          transcript: rt.getTranscript(),
          toolsRecent: filesTouched.slice(-20),
        });
        push('ok', `Bug report → ${mdPath}`);
        push('meta', 'Open that file in chat with the next agent, or say “read LATEST bug report”.');
      } catch (e) {
        push('err', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (lower.startsWith('/steer')) {
      const guidance = text.slice(6).trim();
      if (!guidance) {
        push('meta', 'Usage: /steer <guidance> — inject into the current turn (or queue if idle).');
        return;
      }
      if (busy && rt.steer(guidance)) {
        push('ok', `STEER · ${guidance.slice(0, 120)}`);
        return;
      }
      await runAgent(guidance);
      return;
    }
    if (lower === '/bugs') {
      const list = listBugReports(8);
      if (!list.length) push('meta', 'No bug reports yet. Use /bug [note].');
      else for (const p of list) push('meta', p);
      return;
    }
    if (lower === '/status') {
      await refreshCaps();
      push('system', `LMS ${online ? 'up' : 'down'} · ${describeLmStudioTarget()} · model ${rt.model}`);
      push('system', `cwd ${rt.workspace}`);
      push(
        'system',
        `browser ${capsBrowser ? 'chromium ready' : 'missing — npx playwright install chromium'} · desktop ${capsDesktop}${capsDesktopOk ? '' : ' (CAPRIGO_DISABLE_DESKTOP or non-Windows)'} · ocr ${capsOcr}${capsOcrOk ? '' : ' (WinRT/RapidOCR)'} · image ${capsImage}${capsImageOk ? '' : ' (Forge :7860 or OPENAI_API_KEY)'}`
      );
      const p = rt.getProfile();
      push('system', `dialect ${p ? profileOneLiner(p) : capsDialect} · brain ${capsBrain}`);
      push(
        'system',
        `mission ${missionOn ? 'ON' : 'off'}${rt.session.objective ? ` — ${rt.session.objective}` : ''} · think ${showThinking ? 'ON' : 'off'} · busy ${busy ? 'yes' : 'no'}${pendingPrompt ? ' · queued:1' : ''}`
      );
      push('system', `skills ${rt.listSkills().length} · files touched ${filesTouched.length}`);
      return;
    }
    if (lower === '/brain') {
      const b = brainStatusSummary();
      push('system', `Brain working: ${JSON.stringify(b.working)}`);
      push('system', `Lessons (${b.lessonCount}):`);
      for (const l of b.recentLessons) {
        push('meta', `  [${l.signature}] ${l.cause.slice(0, 80)} → ${l.fix.slice(0, 80)}`);
      }
      if (!b.recentLessons.length) push('meta', '  (none yet)');
      return;
    }
    if (lower === '/profile' || lower.startsWith('/profile ')) {
      const force = /probe|refresh|force/.test(lower);
      try {
        const p = await rt.ensureProfile({ forceProbe: force });
        push('ok', profileOneLiner(p));
        if (p.quirks?.length) push('meta', `quirks: ${p.quirks.join(', ')}`);
        if (force) push('meta', 'Handshake/probe complete — dialect cached.');
        void refreshCaps();
      } catch (e) {
        push('err', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (lower === '/tools') {
      const names = rt.listSkills();
      push('system', `Skills (${names.length}): ${names.join(', ')}`);
      return;
    }
    if (lower.startsWith('/open')) {
      const arg = text.slice(5).trim();
      const target =
        arg ||
        (filesTouched.length ? filesTouched[filesTouched.length - 1] : '') ||
        rt.workspace;
      try {
        const resolved = path.isAbsolute(target)
          ? target
          : path.resolve(rt.workspace, target);
        openLocalPath(resolved, { reveal: true });
        push('ok', `Opened ${resolved}`);
      } catch (e) {
        push('err', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (text.startsWith('/')) {
      push('err', `Unknown command: ${text}  (/help)`);
      return;
    }
    if (text.startsWith('!')) {
      const cmd = text.slice(1).trim();
      try {
        const { execSync } = await import('child_process');
        const out = execSync(cmd, {
          cwd: rt.workspace,
          encoding: 'utf8',
          maxBuffer: 1_000_000,
        });
        push('ok', out.trim() || '(no output)');
      } catch (e: unknown) {
        const err = e as { stderr?: string; message?: string };
        push('err', err.stderr || err.message || String(e));
      }
      return;
    }

    await runAgent(text);
    try {
      saveInputHistory(input.getHistory());
    } catch {
      /* ignore */
    }
  };

  const runAgent = async (userText: string) => {
    if (busy) {
      const busyMode = String(process.env.CAPRIGO_BUSY_MODE || 'steer').toLowerCase();
      if (busyMode !== 'queue' && rt.steer(userText)) {
        push('ok', `STEER · ${userText.slice(0, 120)}`);
        needsDraw = true;
        return;
      }
      pendingPrompt = userText;
      push('meta', 'Queued — will run when the current turn finishes.');
      needsDraw = true;
      return;
    }
    if (modelLoadInFlight) {
      push('meta', `Model still loading (${shortModel(modelLoadInFlight)}) — try again in a moment.`);
      needsDraw = true;
      return;
    }
    busy = true;
    spinFrame = 0;
    statusMsg = 'processing…';
    push('user', `you › ${userText}`);
    needsDraw = true;
    draw();

    let thinkOpen = false;
    let replyOpen = false;
    let lineBuf = '';
    let inThink = false;
    let replyLogStart = -1;

    const pushLine = (kind: LogKind, line: string) => {
      push(kind, kind === 'think' || kind === 'reply' ? `  ${line}` : line);
    };

    try {
      const { response, stats } = await rt.processMessage(userText, e => {
        if (e.type === 'status') {
          statusMsg = e.phase + (e.detail ? ` · ${e.detail}` : '');
          needsDraw = true;
          return;
        }
        if (e.type === 'think') {
          if (showThinking) {
            if (!thinkOpen) {
              push('think', `thinking · ${shortModel(rt.model)}`);
              thinkOpen = true;
            }
            lineBuf += e.text || '';
            const parts = lineBuf.split('\n');
            lineBuf = parts.pop() || '';
            for (const p of parts) pushLine('think', p);
          }
          needsDraw = true;
          return;
        }
        if (e.type === 'token') {
          let t = e.text || '';
          // crude <think> handling
          if (t.includes('<think>')) {
            inThink = true;
            t = t.replace(/<think>/gi, '');
          }
          if (inThink) {
            const end = t.search(/<\/think>/i);
            if (end >= 0) {
              const inside = t.slice(0, end);
              if (showThinking && inside) {
                if (!thinkOpen) {
                  push('think', `thinking · ${shortModel(rt.model)}`);
                  thinkOpen = true;
                }
                pushLine('think', inside);
              }
              inThink = false;
              t = t.slice(end).replace(/<\/think>/i, '');
            } else {
              if (showThinking) {
                if (!thinkOpen) {
                  push('think', `thinking · ${shortModel(rt.model)}`);
                  thinkOpen = true;
                }
                lineBuf += t;
                const parts = lineBuf.split('\n');
                lineBuf = parts.pop() || '';
                for (const p of parts) pushLine('think', p);
              }
              needsDraw = true;
              return;
            }
          }
          if (!t) return;
          if (!replyOpen) {
            if (lineBuf && showThinking && thinkOpen) {
              pushLine('think', lineBuf);
              lineBuf = '';
            }
            replyLogStart = logs.length;
            push('reply', `reply · ${shortModel(rt.model)}`);
            replyOpen = true;
            statusMsg = 'replying…';
          }
          lineBuf += t;
          const parts = lineBuf.split('\n');
          lineBuf = parts.pop() || '';
          for (const p of parts) pushLine('reply', p);
          needsDraw = true;
          return;
        }
        if (e.type === 'task_start') {
          if (lineBuf) {
            pushLine(replyOpen ? 'reply' : 'think', lineBuf);
            lineBuf = '';
          }
          const tool = e.tool || e.label;
          for (const row of toolCardOpen(tool, e.argsPreview, e.path)) push('tool', row);
          if (
            e.path &&
            tool &&
            /^(write_file|hash_edit|search_replace)$/.test(tool)
          ) {
            const rel = path.isAbsolute(e.path)
              ? path.relative(rt.workspace, e.path) || e.path
              : e.path;
            if (rel && !filesTouched.includes(rel)) filesTouched.push(rel);
          }
          statusMsg = `tool · ${tool}`;
          thinkOpen = false;
          replyOpen = false;
          needsDraw = true;
          return;
        }
        if (e.type === 'task_end') {
          for (const row of toolCardClose(e.ok, e.summary, e.detail)) {
            push(e.ok ? 'ok' : 'err', row);
          }
          needsDraw = true;
          return;
        }
        if (e.type === 'stumble_retry') {
          push(
            'meta',
            `stumble #${e.count}${e.escalate ? ' escalate' : ''}: ${String(e.signature).slice(0, 60)}`
          );
          needsDraw = true;
          return;
        }
        if (e.type === 'lesson_saved') {
          push('ok', `lesson saved: ${String(e.signature).slice(0, 72)}`);
          void refreshCaps();
          needsDraw = true;
          return;
        }
        if (e.type === 'dialect_flip') {
          push('meta', `dialect ${e.from} → ${e.to} (${e.reason})`);
          void refreshCaps();
          needsDraw = true;
          return;
        }
        if (e.type === 'mission_compiled') {
          missionOn = true;
          push(
            'meta',
            `HOME ${e.playbookId || e.kind}: ${String(e.objective).slice(0, 72)}`
          );
          needsDraw = true;
          return;
        }
        if (e.type === 'mission_bootstrap') {
          push(e.ok ? 'ok' : 'err', `HOME bootstrap ${e.tool}`);
          needsDraw = true;
          return;
        }
        if (e.type === 'mission_action') {
          push('meta', `HOME ${e.source} → ${e.tool}`);
          needsDraw = true;
          return;
        }
        if (e.type === 'mission_verified') {
          push(
            e.status === 'pass' ? 'ok' : e.status === 'blocked' ? 'err' : 'meta',
            `HOME ${e.status}: ${String(e.detail).slice(0, 72)}`
          );
          needsDraw = true;
          return;
        }
        if (e.type === 'steer') {
          push('ok', `STEER applied · ${String(e.text || '').slice(0, 100)}`);
          needsDraw = true;
          return;
        }
        if (e.type === 'bug_report') {
          push('meta', `auto bug → ${e.path}`);
          needsDraw = true;
          return;
        }
      });

      if (lineBuf) {
        pushLine(replyOpen ? 'reply' : thinkOpen ? 'think' : 'reply', lineBuf);
        lineBuf = '';
      }

      // Re-render reply as Cursor-style code cards / tables when structured.
      const finalText = (response || '').trim();
      if (finalText && looksStructuredMarkdown(finalText)) {
        if (replyLogStart >= 0 && replyLogStart < logs.length) {
          logs.splice(replyLogStart);
        }
        push('reply', `reply · ${shortModel(rt.model)}`);
        for (const row of formatMarkdownReply(finalText, midInnerW)) {
          push('reply', row);
        }
      } else if (!replyOpen && finalText) {
        push('reply', `reply · ${shortModel(rt.model)}`);
        for (const line of finalText.split(/\n/)) pushLine('reply', line);
      }

      const tools = stats?.tools || [];
      const saved = autosaveCodeFences(response || '', rt.workspace, tools);
      for (const f of saved) {
        filesTouched.push(f);
        push('ok', `Saved code → ${f}`);
      }
      if (tools.includes('write_file') || tools.includes('search_replace') || tools.includes('hash_edit')) {
        push('meta', 'Files updated via tools (see workspace / CONTEXT).');
      }

      if (stats) {
        push(
          'meta',
          `${stats.promptTokens}↑ ${stats.completionTokens}↓ · ${(stats.elapsedMs / 1000).toFixed(1)}s · ${tools.join(', ') || '—'}`
        );
      }
      if (missionOn && rt.session.taskState) {
        push('meta', `STATE: ${rt.session.taskState}`);
      }
      statusMsg = 'ready';
      try {
        persistSession();
      } catch {
        /* ignore autosave errors */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      push('err', msg);
      statusMsg = 'error';
      try {
        const { mdPath } = writeBugReport({
          note: 'turn error',
          error: msg,
          sessionId: rt.session.id,
          model: rt.model,
          provider: rt.providerId,
          workspace: rt.workspace,
          online,
          busy: true,
          mission: rt.session.objective,
          logs: logs.slice(-80).map(l => ({ kind: l.kind, text: l.text, ts: l.ts })),
          transcript: rt.getTranscript(),
        });
        push('meta', `auto bug → ${mdPath}`);
      } catch {
        /* ignore */
      }
    } finally {
      busy = false;
      needsDraw = true;
      if (pendingPrompt && !modelLoadInFlight) {
        const next = pendingPrompt;
        pendingPrompt = null;
        void runAgent(next);
      }
    }
  };

  const shutdown = (code: number) => {
    try {
      if (logs.length > 3) persistSession();
    } catch {
      /* ignore */
    }
    try {
      saveInputHistory(input.getHistory());
    } catch {
      /* ignore */
    }
    input.stop();
    clearInterval(ticker);
    clearInterval(capsTimer);
    leaveAlt();
    void rt.dispose().finally(() => process.exit(code));
  };

  enterAlt();
  input.setHistory(loadInputHistory());
  input.start();
  input.setScrollArrows(true);

  const crashOnce = (kind: string, err: unknown) => {
    try {
      const msg = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err);
      writeBugReport({
        note: `crash:${kind}`,
        error: msg.slice(0, 4000),
        sessionId: rt.session.id,
        model: rt.model,
        provider: rt.providerId,
        workspace: rt.workspace,
        logs: logs.slice(-60).map(l => ({ kind: l.kind, text: l.text, ts: l.ts })),
      });
    } catch {
      /* ignore */
    }
  };
  process.once('uncaughtException', e => {
    crashOnce('uncaughtException', e);
    shutdown(1);
  });
  process.once('unhandledRejection', e => {
    crashOnce('unhandledRejection', e);
  });

  const ticker = setInterval(() => {
    if (modelLoadInFlight || busy) {
      spinFrame = (spinFrame + 1) % SPINNER.length;
      needsDraw = true;
    }
    if (needsDraw || busy || modelLoadInFlight) draw();
  }, 80);
  draw();

  process.on('SIGWINCH', () => {
    lastDraw = '';
    needsDraw = true;
  });
  process.stdout.on('resize', () => {
    lastDraw = '';
    needsDraw = true;
  });
}
