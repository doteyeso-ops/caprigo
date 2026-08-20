/**
 * Live turn renderer — clear THINK / REPLY / TOOL sections for Caprigo TUI.
 */

import { bad, bold, col, dim, muted, ok, soft, think as paintThink, trunc } from './style';

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export type TurnRenderOpts = {
  modelLabel: string;
  showThinking: boolean;
};

type Section = 'none' | 'status' | 'think' | 'reply' | 'tool';

/**
 * Stateful live renderer for one agent turn.
 * Separates model thinking from spoken reply, and frames tool calls.
 */
export class TurnRenderer {
  private section: Section = 'none';
  private spin = 0;
  private statusDirty = false;
  private phase = 'thinking';
  private phaseDetail = '';
  private started = Date.now();
  private toolsSeen: string[] = [];
  private streamedReply = false;
  private inThinkTag = false;
  private tagCarry = '';
  private spinner: ReturnType<typeof setInterval> | null = null;
  private readonly modelShort: string;
  private showThinking: boolean;

  constructor(opts: TurnRenderOpts) {
    this.modelShort = shortModel(opts.modelLabel);
    this.showThinking = opts.showThinking;
  }

  start(): void {
    if (process.stdout.isTTY) process.stdout.write('\x1b[?25l');
    this.spinner = setInterval(() => {
      this.spin++;
      if (this.section === 'status' || this.section === 'none') this.writeStatus(true);
    }, 90);
    this.openStatus('thinking');
  }

  stop(): void {
    if (this.spinner) clearInterval(this.spinner);
    this.spinner = null;
    this.clearStatus();
    if (this.section === 'think') {
      console.log('');
      console.log(`  ${paintThink('╰─')} ${muted('end think')}`);
      this.section = 'none';
    }
    if (process.stdout.isTTY) process.stdout.write('\x1b[?25h');
  }

  onStatus(phase: string, detail?: string): void {
    this.phase = phase;
    this.phaseDetail = detail || '';
    if (
      phase === 'thinking' &&
      this.section !== 'think' &&
      this.section !== 'reply' &&
      this.section !== 'tool'
    ) {
      this.openStatus('thinking');
    } else if (phase === 'working' && this.section !== 'tool') {
      this.openStatus('working');
    } else {
      this.writeStatus(true);
    }
  }

  onThink(text: string): void {
    if (!text) return;
    if (!this.showThinking) {
      this.openStatus('thinking');
      return;
    }
    this.openThink();
    this.writeThinkChunk(text);
  }

  onToken(text: string): void {
    if (!text) return;
    this.feedContent(text);
  }

  onToolStart(label: string): void {
    this.toolsSeen.push(label);
    if (this.section === 'think') {
      console.log('');
      console.log(`  ${paintThink('╰─')} ${muted('end think')}`);
    } else if (this.section === 'reply') {
      process.stdout.write('\n');
    }
    this.section = 'none';
    this.clearStatus();
    console.log('');
    console.log(
      `  ${col.yellow}⚙${col.reset} ${bold('tool')}  ${soft(label)}  ${muted('running…')}`
    );
    this.section = 'tool';
    this.phase = 'working';
    this.phaseDetail = label;
  }

  onToolEnd(okFlag: boolean, detail?: string): void {
    this.clearStatus();
    const mark = okFlag ? ok('✓') : bad('✕');
    const d = detail ? muted(` — ${trunc(detail, 60)}`) : '';
    console.log(`  ${mark} ${dim('done')}${d}`);
    this.section = 'none';
    this.openStatus('thinking');
  }

  finishWithResponse(response: string): void {
    const text = (response || '').trim();
    if (!this.streamedReply && text) {
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '')
        .trim();
      if (cleaned) {
        this.openReply();
        this.writeReplyChunk(cleaned);
        process.stdout.write('\n');
        this.streamedReply = true;
      }
    } else if (this.section === 'reply' || this.section === 'think') {
      process.stdout.write('\n');
    }
  }

  printFooter(stats: {
    promptTokens: number;
    completionTokens: number;
    elapsedMs: number;
    tools: string[];
  } | null): void {
    this.clearStatus();
    console.log('');
    if (!stats) {
      console.log(dim('  ─'));
      console.log('');
      return;
    }
    const tools =
      stats.tools.length > 0
        ? stats.tools.join(', ')
        : this.toolsSeen.length
          ? this.toolsSeen.join(', ')
          : '—';
    const tps =
      stats.completionTokens > 0 && stats.elapsedMs > 0
        ? `${((stats.completionTokens / stats.elapsedMs) * 1000).toFixed(1)} tok/s`
        : '';
    console.log(
      muted(
        `  ${fmtTok(stats.promptTokens)}↑  ${fmtTok(stats.completionTokens)}↓  ${fmtMs(stats.elapsedMs)}` +
          (tps ? `  ${tps}` : '') +
          `  ·  ${tools}`
      )
    );
    console.log('');
  }

  private openStatus(kind: 'thinking' | 'working'): void {
    if (this.section === 'think' || this.section === 'reply' || this.section === 'tool') return;
    this.section = 'status';
    this.phase = kind;
    this.writeStatus(true);
  }

  private openThink(): void {
    if (this.section === 'think') return;
    this.clearStatus();
    if (this.section === 'reply') process.stdout.write('\n');
    this.section = 'think';
    console.log('');
    console.log(
      `  ${paintThink('╭─')} ${bold(paintThink('thinking'))} ${muted('·')} ${muted(this.modelShort)}`
    );
    process.stdout.write(`  ${paintThink('│')} `);
  }

  private openReply(): void {
    if (this.section === 'reply') return;
    this.clearStatus();
    if (this.section === 'think') {
      console.log('');
      console.log(`  ${paintThink('╰─')} ${muted('end think')}`);
    }
    this.section = 'reply';
    this.streamedReply = true;
    console.log('');
    console.log(
      `  ${soft('╭─')} ${bold(soft('reply'))} ${muted('·')} ${muted(this.modelShort)}`
    );
    process.stdout.write(`  ${soft('│')} `);
  }

  private writeThinkChunk(text: string): void {
    process.stdout.write(paintThink(text).replace(/\n/g, `\n  ${paintThink('│')} `));
  }

  private writeReplyChunk(text: string): void {
    process.stdout.write(text.replace(/\n/g, `\n  ${soft('│')} `));
  }

  private feedContent(raw: string): void {
    let s = this.tagCarry + raw;
    this.tagCarry = '';
    while (s.length) {
      if (this.inThinkTag) {
        const end = s.search(/<\/think>/i);
        if (end === -1) {
          const partial = holdPartialTag(s);
          const emit = s.slice(0, s.length - partial.length);
          if (emit) this.onThink(emit);
          this.tagCarry = partial;
          return;
        }
        const inside = s.slice(0, end);
        if (inside) this.onThink(inside);
        this.inThinkTag = false;
        s = s.slice(end).replace(/^<\/think>/i, '');
        continue;
      }
      const start = s.search(/<think>/i);
      if (start === -1) {
        const partial = holdPartialTag(s);
        const emit = s.slice(0, s.length - partial.length);
        if (emit) {
          this.openReply();
          this.writeReplyChunk(emit);
        }
        this.tagCarry = partial;
        return;
      }
      const before = s.slice(0, start);
      if (before) {
        this.openReply();
        this.writeReplyChunk(before);
      }
      this.inThinkTag = true;
      s = s.slice(start).replace(/^<think>/i, '');
    }
  }

  private writeStatus(force = false): void {
    if (!process.stdout.isTTY) return;
    if (!force && this.section !== 'status' && this.section !== 'none') return;
    if (this.section === 'think' || this.section === 'reply' || this.section === 'tool') return;
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spin = frames[this.spin % frames.length];
    const elapsed = fmtMs(Date.now() - this.started);
    let label: string;
    if (this.phase === 'working') {
      label = `${col.yellow}${spin}${col.reset} ${bold('working')} ${muted(this.phaseDetail || 'tool')}  ${muted(elapsed)}`;
    } else {
      label = `${col.magenta}${spin}${col.reset} ${bold('thinking')} ${muted('·')} ${muted(this.modelShort)}  ${muted(elapsed)}`;
    }
    process.stdout.write(`\r\x1b[2K  ${label}`);
    this.statusDirty = true;
    this.section = 'status';
  }

  private clearStatus(): void {
    if (!this.statusDirty) return;
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    this.statusDirty = false;
  }
}

function shortModel(model: string): string {
  const m = model.trim();
  if (!m) return 'model';
  const base = m.includes('/') ? m.split('/').pop()! : m;
  return trunc(base, 42);
}

function holdPartialTag(s: string): string {
  const i = s.lastIndexOf('<');
  if (i === -1) return '';
  const tail = s.slice(i);
  if (/^<\/?t(?:h(?:i(?:n(?:k)?)?)?)?$/i.test(tail) || /^<\/?think$/i.test(tail)) return tail;
  if (tail === '<' || /^<\/?$/.test(tail)) return tail;
  return '';
}

export function printYouBlock(text: string): void {
  console.log('');
  console.log(`  ${col.cyan}╭─${col.reset} ${bold(soft('you'))}`);
  for (const line of text.split(/\r?\n/)) {
    console.log(`  ${soft('│')} ${line}`);
  }
  console.log(`  ${soft('╰─')}`);
}

export function printWelcomeHeader(info: {
  model: string;
  endpoint: string;
  workspace: string;
  mission?: string;
  loop?: boolean;
  showThinking?: boolean;
  reachable: boolean;
  error?: string;
}): void {
  const w = Math.min(72, Math.max(52, (process.stdout.columns || 80) - 2));
  const line = (ch: string) => dim(ch.repeat(w));
  console.log('');
  console.log(line('═'));
  console.log(`  ${bold(soft('◆ Caprigo'))}  ${muted('local agent harness')}`);
  console.log(line('─'));
  console.log(`  ${muted('model')}   ${bold(info.model)}`);
  console.log(`  ${muted('server')}  ${info.endpoint}`);
  console.log(`  ${muted('cwd')}     ${trunc(info.workspace, w - 12)}`);
  console.log(
    `  ${muted('mode')}    ${info.loop ? soft('LOOP') : dim('chat')}` +
      `  ·  thinking ${info.showThinking === false ? dim('off') : ok('on')}`
  );
  if (info.mission) {
    console.log(`  ${muted('goal')}    ${trunc(info.mission, w - 12)}`);
  }
  if (!info.reachable) {
    console.log(`${col.yellow}  LM Studio unreachable${info.error ? ` (${info.error})` : ''}${col.reset}`);
  }
  console.log(line('═'));
  console.log(
    dim('  /help  /loop  /think  /model  /tools  /stop  /clear  /quit   ·   !shell')
  );
  console.log('');
}
