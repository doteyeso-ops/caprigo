/**
 * Caprigo TUI — live streaming shell (thinking / tools / tokens).
 * Zero deps beyond ANSI + readline + fetch.
 */
import * as readline from 'readline';
import { bad, bold, col, dim, muted, ok, termWidth, warn, accent, soft } from './style';
import { gatewayFetch, gatewayJson, gatewayPostJson, getGatewayUrl } from './gateway-client';
import { TurnRenderer, printWelcomeHeader, printYouBlock } from './tui-stream';

type SessionRow = {
  id: string;
  displayName?: string;
  name?: string;
  runtimeMode?: string;
  messageCount?: number;
  effectiveModel?: string | null;
};

type TurnUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type TurnMeta = {
  llmCalls?: number;
  tools?: string[];
  elapsedMs?: number;
  wallMs?: number;
};

type SessionTotals = {
  promptTokens: number;
  completionTokens: number;
  lastLatencyMs: number;
};

type StatusPhase = 'thinking' | 'working' | 'streaming' | 'idle' | 'error' | 'ready';

function stripAnsi(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function hr(ch = '─'): string {
  return dim(ch.repeat(Math.min(termWidth(), 72)));
}

function padLine(left: string, right: string): string {
  const w = Math.min(termWidth(), 72);
  const gap = Math.max(1, w - stripAnsi(left) - stripAnsi(right));
  return left + ' '.repeat(gap) + right;
}

function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
}

function hideCursor(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25l');
}

function showCursor(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h');
}

async function waitGateway(timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await gatewayJson('/health');
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return false;
}

async function listSessions(): Promise<SessionRow[]> {
  const data = await gatewayJson<{ sessions: SessionRow[] }>('/api/sessions');
  return data.sessions || [];
}

async function createSession(name: string): Promise<SessionRow> {
  return gatewayPostJson('/api/sessions', {
    displayName: name,
    runtimeMode: 'llm',
    agentRole: 'agent',
  });
}

function sessionLabel(s: SessionRow): string {
  return s.displayName || s.name || s.id.slice(0, 8);
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusGlyph(phase: StatusPhase, detail?: string, spinFrame = 0): string {
  const spin = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][spinFrame % 10];
  switch (phase) {
    case 'thinking':
      return `${col.cyan}${spin}${col.reset} thinking…`;
    case 'working':
      return `${col.yellow}◐${col.reset} working ${detail ? dim(detail) : ''}`.trim();
    case 'streaming':
      return `${col.green}◌${col.reset} streaming`;
    case 'error':
      return `${col.red}✕${col.reset} error${detail ? dim(' ' + detail.slice(0, 40)) : ''}`;
    case 'idle':
    case 'ready':
    default:
      return `${dim('○')} ready`;
  }
}

type HeaderInfo = {
  model: string;
  healthOk: boolean;
  healthLabel: string;
};

async function fetchHeaderInfo(session: SessionRow | null): Promise<HeaderInfo> {
  try {
    const [health, runtime] = await Promise.all([
      gatewayJson<{ llm?: { ollama?: string; provider?: string } }>('/health'),
      gatewayJson<{ engine?: { model?: string } }>('/api/runtime'),
    ]);
    const model = runtime.engine?.model || session?.effectiveModel || '—';
    const llmOk = health.llm?.ollama === 'ok' || health.llm?.provider === 'ok';
    return {
      model,
      healthOk: true,
      healthLabel: llmOk ? ok('ok') : warn('llm?'),
    };
  } catch {
    return { model: session?.effectiveModel || '—', healthOk: false, healthLabel: bad('down') };
  }
}

function printHeader(session: SessionRow | null, info: HeaderInfo, totals: SessionTotals): void {
  const name = session ? sessionLabel(session) : 'no agent';
  const idShort = session ? session.id.slice(0, 8) : '········';
  const tok =
    totals.promptTokens || totals.completionTokens
      ? `tok ${fmtTok(totals.promptTokens)}↑ ${fmtTok(totals.completionTokens)}↓`
      : 'tok —';
  const lat = totals.lastLatencyMs > 0 ? fmtMs(totals.lastLatencyMs) : '—';

  console.log('');
  console.log(
    padLine(
      `${bold(accent('◆ Caprigo'))}  ${dim(name)}  ${muted(idShort)}`,
      `${dim(info.model)}  gw ${info.healthLabel}`
    )
  );
  console.log(padLine(`  ${dim(tok)}`, `${dim('last')} ${dim(lat)}`));
  console.log(hr('═'));
  console.log(dim(`  ${getGatewayUrl()}   /help /files /agents /new /use /status /tokens /quit`));
  console.log(hr());
  console.log('');
}

function printYou(text: string): void {
  printYouBlock(text);
}

function printHelp(embedded = false): void {
  console.log(dim('  Commands'));
  console.log(`  ${bold('/help')}              this list`);
  console.log(`  ${bold('/loop')} [objective]  mission mode — keep going until done/blocked`);
  console.log(`  ${bold('/noloop')}            clear mission objective`);
  console.log(`  ${bold('/think')}             toggle showing model thinking`);
  console.log(`  ${bold('/model')} [name]      show or set model`);
  console.log(`  ${bold('/tools')}             list skills`);
  console.log(`  ${bold('/stop')}              cancel in-flight turn`);
  console.log(`  ${bold('/status')}            refresh header`);
  console.log(`  ${bold('/tokens')}            session token totals`);
  console.log(`  ${bold('/clear')}             clear screen`);
  if (!embedded) {
    console.log(`  ${bold('/files')}             files Caprigo created/edited`);
    console.log(`  ${bold('/agents')}            list agents`);
    console.log(`  ${bold('/new')}               create agent + switch`);
    console.log(`  ${bold('/use')} <id>          switch agent`);
  }
  console.log(`  ${bold('!')} <cmd>             run local shell (no model turn)`);
  console.log(`  ${bold('/quit')}              exit`);
  console.log('');
}

async function printFiles(): Promise<void> {
  const data = await gatewayJson<{
    touched?: Array<{ path: string; lastAction: string; lastTs: string; count: number }>;
  }>('/api/file-ledger?limit=25');
  const rows = data.touched || [];
  if (!rows.length) {
    console.log(warn('  No file changes yet.'));
    console.log('');
    return;
  }
  for (const r of rows) {
    console.log(`  ${ok(r.lastAction.padEnd(8))} ${r.path}  ${dim('×' + r.count)}`);
  }
  console.log('');
}

async function printAgents(currentId?: string): Promise<void> {
  const rows = await listSessions();
  if (!rows.length) {
    console.log(warn('  No agents. /new to create one.'));
    console.log('');
    return;
  }
  for (const s of rows) {
    const mark = s.id === currentId ? bold('●') : dim('○');
    console.log(
      `  ${mark} ${sessionLabel(s).padEnd(16)} ${dim(s.id.slice(0, 8))}  ${muted(String(s.messageCount ?? 0) + ' msgs')}`
    );
  }
  console.log('');
}

async function pickOrCreateSession(preferredId?: string): Promise<SessionRow> {
  const rows = (await listSessions()).filter(s => s.runtimeMode !== 'offline');
  if (preferredId) {
    const hit =
      rows.find(s => s.id === preferredId) ||
      rows.find(s => s.id.toLowerCase().startsWith(preferredId.toLowerCase()));
    if (hit) return hit;
  }
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    const box = rows.find(s => /box/i.test(sessionLabel(s)));
    return box || rows[rows.length - 1];
  }
  return createSession('Box');
}

/** Parse SSE from a fetch Response body. */
async function* readSse(
  res: Response
): AsyncGenerator<{ event: string; data: string }, void, unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body for SSE');
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let dataLines: string[] = [];

  const flush = (): { event: string; data: string } | null => {
    if (!dataLines.length) {
      event = 'message';
      return null;
    }
    const data = dataLines.join('\n');
    const ev = event;
    event = 'message';
    dataLines = [];
    return { event: ev, data };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const line of parts) {
      if (line === '') {
        const item = flush();
        if (item) yield item;
        continue;
      }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  if (buffer.trim()) {
    const line = buffer;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  const last = flush();
  if (last) yield last;
}

type StreamResult = {
  response: string;
  usage?: TurnUsage;
  meta?: TurnMeta;
  error?: string;
};

/**
 * Run one turn via SSE stream endpoint; render live churn to the terminal.
 */
async function streamTurn(sessionId: string, message: string): Promise<StreamResult> {
  const res = await gatewayFetch(`/api/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const text = await res.text();
    let err = text.slice(0, 240);
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) err = j.error;
    } catch {
      /* keep */
    }
    throw new Error(err || `HTTP ${res.status}`);
  }

  let phase: StatusPhase = 'thinking';
  let phaseDetail = '';
  let spin = 0;
  let statusDirty = true;
  let thinkingOpen = false;
  let assistantOpen = false;
  let firstToken = false;
  const toolsSeen: string[] = [];
  let final: StreamResult = { response: '' };

  const writeStatus = (force = false) => {
    if (!process.stdout.isTTY && !force) return;
    if (!statusDirty && !force) return;
    const line = `  ${statusGlyph(phase, phaseDetail, spin)}`;
    process.stdout.write(`\r\x1b[2K${line}`);
    statusDirty = false;
  };

  const clearStatusLine = () => {
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
  };

  const ensureNewline = () => {
    clearStatusLine();
    process.stdout.write('\n');
  };

  const spinner = setInterval(() => {
    if (firstToken && phase === 'streaming') return;
    if (phase === 'idle' || phase === 'ready' || phase === 'error') return;
    spin++;
    statusDirty = true;
    writeStatus();
  }, 80);

  hideCursor();
  writeStatus(true);

  try {
    for await (const { event, data } of readSse(res)) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (event === 'status') {
        const p = String(payload.phase || '') as StatusPhase;
        if (p === 'thinking' || p === 'working' || p === 'streaming' || p === 'idle' || p === 'error') {
          if (phase === 'streaming' && assistantOpen && p !== 'streaming') {
            ensureNewline();
            assistantOpen = false;
          }
          if (thinkingOpen && p !== 'thinking' && p !== 'streaming') {
            /* keep thinking block closed visually */
          }
          phase = p;
          phaseDetail = typeof payload.detail === 'string' ? payload.detail : '';
          statusDirty = true;
          writeStatus(true);
        }
        continue;
      }

      if (event === 'think') {
        const text = typeof payload.text === 'string' ? payload.text : '';
        if (!text) continue;
        clearStatusLine();
        if (!thinkingOpen) {
          console.log(dim('thinking'));
          thinkingOpen = true;
        }
        process.stdout.write(dim(text));
        statusDirty = true;
        continue;
      }

      if (event === 'token') {
        const text = typeof payload.text === 'string' ? payload.text : '';
        if (!text) continue;
        firstToken = true;
        phase = 'streaming';
        clearStatusLine();
        if (thinkingOpen) {
          process.stdout.write('\n');
          thinkingOpen = false;
        }
        if (!assistantOpen) {
          console.log(bold('caprigo'));
          process.stdout.write('  ');
          assistantOpen = true;
        }
        // indent newlines in streamed text
        process.stdout.write(text.replace(/\n/g, '\n  '));
        continue;
      }

      if (event === 'tool_start') {
        const label = typeof payload.label === 'string' ? payload.label : 'tool';
        toolsSeen.push(label);
        if (assistantOpen) {
          ensureNewline();
          assistantOpen = false;
        }
        if (thinkingOpen) {
          process.stdout.write('\n');
          thinkingOpen = false;
        }
        clearStatusLine();
        console.log(`  ${col.yellow}◐${col.reset} ${dim('tool')} ${label}`);
        phase = 'working';
        phaseDetail = label;
        statusDirty = true;
        writeStatus(true);
        continue;
      }

      if (event === 'tool_end') {
        const okFlag = payload.ok !== false;
        const detail = typeof payload.detail === 'string' ? payload.detail : '';
        clearStatusLine();
        console.log(
          `  ${okFlag ? ok('✓') : bad('✕')} ${dim('tool done')}${detail ? dim(' — ' + detail) : ''}`
        );
        phase = 'thinking';
        phaseDetail = '';
        statusDirty = true;
        writeStatus(true);
        continue;
      }

      if (event === 'done') {
        const response = typeof payload.response === 'string' ? payload.response : '';
        final = {
          response,
          usage: payload.usage as TurnUsage | undefined,
          meta: payload.meta as TurnMeta | undefined,
        };
        if (assistantOpen) {
          process.stdout.write('\n');
          assistantOpen = false;
        } else if (response && !firstToken) {
          // Backend returned text without token events (non-streaming backend)
          clearStatusLine();
          console.log(bold('caprigo'));
          for (const line of response.split(/\r?\n/)) console.log(`  ${line}`);
        }
        if (thinkingOpen) {
          process.stdout.write('\n');
          thinkingOpen = false;
        }
        phase = 'idle';
        clearStatusLine();
        break;
      }

      if (event === 'error') {
        const err = typeof payload.error === 'string' ? payload.error : 'stream error';
        final = { response: '', error: err };
        if (assistantOpen || thinkingOpen) process.stdout.write('\n');
        clearStatusLine();
        phase = 'error';
        phaseDetail = err;
        break;
      }
    }
  } finally {
    clearInterval(spinner);
    clearStatusLine();
    showCursor();
  }

  // Footer
  if (final.error) {
    console.log(bad('  ' + final.error));
    console.log('');
    return final;
  }

  const usage = final.usage || {};
  const meta = final.meta || {};
  const pin = usage.promptTokens ?? 0;
  const cout = usage.completionTokens ?? 0;
  const total = usage.totalTokens ?? pin + cout;
  const elapsed = meta.elapsedMs ?? meta.wallMs ?? 0;
  const tools = meta.tools?.length ? meta.tools.join(', ') : toolsSeen.length ? toolsSeen.join(', ') : '—';
  const tps =
    cout > 0 && elapsed > 0 ? `${((cout / elapsed) * 1000).toFixed(1)} tok/s` : '';

  console.log('');
  console.log(
    dim(
      `  ${fmtTok(pin)} in · ${fmtTok(cout)} out · ${fmtTok(total)} total · ${fmtMs(elapsed)}` +
        (tps ? ` · ${tps}` : '') +
        ` · tools: ${tools}`
    )
  );
  console.log('');
  return final;
}

/**
 * Main TUI entry. Defaults to embedded Agent + LM Studio (no gateway).
 * Pass `{ gateway: true }` or set CAPRIGO_TUI_GATEWAY=1 for HTTP gateway mode.
 */
export async function runTui(
  sessionIdArg?: string,
  opts?: { gateway?: boolean }
): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error('TUI needs an interactive terminal');
  }

  const useGateway =
    opts?.gateway === true ||
    /^(1|true|yes)$/i.test(String(process.env.CAPRIGO_TUI_GATEWAY || ''));

  if (!useGateway) {
    await runEmbeddedTui();
    return;
  }

  await runGatewayTui(sessionIdArg);
}

async function runEmbeddedTui(): Promise<void> {
  const { createEmbeddedRuntime, probeLmStudio } = await import('./embedded-runtime');
  const { runHud } = await import('./hud/app');

  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write('starting Caprigo HUD…\n');

  const probe = await probeLmStudio();
  const catalogPick =
    probe.models.find(m => /agentic/i.test(m) && !/embed/i.test(m)) ||
    probe.models.find(m => !/embed/i.test(m));
  const rt = await createEmbeddedRuntime({
    model: process.env.DEFAULT_MODEL?.trim() || catalogPick,
  });

  await runHud(rt);
}

async function streamEmbeddedTurn(
  rt: import('./embedded-runtime').EmbeddedRuntime,
  text: string,
  opts?: { showThinking?: boolean }
): Promise<{ stats: import('@caprigo/agent').TurnStats | null }> {
  const view = new TurnRenderer({
    modelLabel: rt.model,
    showThinking: opts?.showThinking !== false,
  });
  view.start();
  try {
    const { response, stats } = await rt.processMessage(text, e => {
      if (e.type === 'status') {
        view.onStatus(e.phase, e.detail);
        return;
      }
      if (e.type === 'think') {
        view.onThink(e.text || '');
        return;
      }
      if (e.type === 'token') {
        view.onToken(e.text || '');
        return;
      }
      if (e.type === 'task_start') {
        view.onToolStart(e.label);
        return;
      }
      if (e.type === 'task_end') {
        view.onToolEnd(e.ok, e.detail);
      }
    });
    view.finishWithResponse(response);
    view.stop();
    view.printFooter(stats);
    return { stats };
  } catch (err) {
    view.stop();
    throw err;
  }
}

async function runGatewayTui(sessionIdArg?: string): Promise<void> {
  const totals: SessionTotals = { promptTokens: 0, completionTokens: 0, lastLatencyMs: 0 };

  clearScreen();
  process.stdout.write(dim('connecting…\n'));
  const up = await waitGateway(10_000);
  if (!up) {
    console.log('');
    console.log(bad('Gateway not reachable at ') + getGatewayUrl());
    console.log(dim('Start it with: caprigo serve   OR use embedded TUI (default)'));
    process.exit(1);
  }

  let session = await pickOrCreateSession(sessionIdArg);
  let headerInfo = await fetchHeaderInfo(session);
  clearScreen();
  printHeader(session, headerInfo, totals);
  printHelp(false);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const refreshHeader = async () => {
    headerInfo = await fetchHeaderInfo(session);
    clearScreen();
    printHeader(session, headerInfo, totals);
  };

  const prompt = (): void => {
    rl.question(`${col.cyan}❯${col.reset} `, async raw => {
      const text = String(raw || '').trim();
      if (!text) {
        prompt();
        return;
      }

      const lower = text.toLowerCase();
      if (lower === '/quit' || lower === '/exit' || lower === '/q') {
        console.log(dim('bye'));
        rl.close();
        return;
      }
      if (lower === '/help' || lower === '/?') {
        printHelp(false);
        prompt();
        return;
      }
      if (lower === '/clear') {
        clearScreen();
        printHeader(session, headerInfo, totals);
        prompt();
        return;
      }
      if (lower === '/status') {
        await refreshHeader();
        prompt();
        return;
      }
      if (lower === '/tokens') {
        console.log(
          dim(
            `  session tokens  in ${fmtTok(totals.promptTokens)}  out ${fmtTok(totals.completionTokens)}  last ${totals.lastLatencyMs ? fmtMs(totals.lastLatencyMs) : '—'}`
          )
        );
        console.log('');
        prompt();
        return;
      }
      if (lower === '/files') {
        try {
          await printFiles();
        } catch (e: unknown) {
          console.log(bad('  ' + (e instanceof Error ? e.message : String(e))));
          console.log('');
        }
        prompt();
        return;
      }
      if (lower === '/agents') {
        try {
          await printAgents(session.id);
        } catch (e: unknown) {
          console.log(bad('  ' + (e instanceof Error ? e.message : String(e))));
          console.log('');
        }
        prompt();
        return;
      }
      if (lower === '/new') {
        try {
          session = await createSession('Box');
          totals.promptTokens = 0;
          totals.completionTokens = 0;
          totals.lastLatencyMs = 0;
          console.log(ok(`  created ${session.id}`));
          console.log('');
          await refreshHeader();
        } catch (e: unknown) {
          console.log(bad('  ' + (e instanceof Error ? e.message : String(e))));
          console.log('');
        }
        prompt();
        return;
      }
      if (lower.startsWith('/use ')) {
        const id = text.slice(5).trim();
        try {
          session = await pickOrCreateSession(id);
          totals.promptTokens = 0;
          totals.completionTokens = 0;
          totals.lastLatencyMs = 0;
          await refreshHeader();
        } catch (e: unknown) {
          console.log(bad('  ' + (e instanceof Error ? e.message : String(e))));
          console.log('');
        }
        prompt();
        return;
      }
      if (text.startsWith('/')) {
        console.log(warn('  unknown command — /help'));
        console.log('');
        prompt();
        return;
      }

      printYou(text);
      try {
        const out = await streamTurn(session.id, text);
        if (out.usage) {
          totals.promptTokens += out.usage.promptTokens ?? 0;
          totals.completionTokens += out.usage.completionTokens ?? 0;
        }
        if (out.meta?.elapsedMs || out.meta?.wallMs) {
          totals.lastLatencyMs = out.meta.elapsedMs ?? out.meta.wallMs ?? 0;
        }
      } catch (e: unknown) {
        console.log(bad('  ' + (e instanceof Error ? e.message : String(e))));
        console.log('');
      }
      prompt();
    });
  };

  rl.on('close', () => {
    showCursor();
    process.exit(0);
  });
  prompt();
}
