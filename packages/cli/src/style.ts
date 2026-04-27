/**
 * Terminal styling — Hermes-like polish without extra dependencies.
 * Honors NO_COLOR / FORCE_COLOR.
 */

const noColor = () => process.env.NO_COLOR != null && process.env.NO_COLOR !== '';
const forceColor = () => process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === '2';

export function useColor(): boolean {
  if (noColor()) return false;
  if (forceColor()) return true;
  return process.stdout.isTTY === true;
}

const C = useColor()
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      cyan: '\x1b[36m',
      blue: '\x1b[34m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      magenta: '\x1b[35m',
      gray: '\x1b[90m',
    }
  : {
      reset: '',
      bold: '',
      dim: '',
      cyan: '',
      blue: '',
      green: '',
      yellow: '',
      red: '',
      magenta: '',
      gray: '',
    };

export const col = C;

export function bold(s: string): string {
  return `${C.bold}${s}${C.reset}`;
}

export function dim(s: string): string {
  return `${C.dim}${s}${C.reset}`;
}

export function titleLine(text: string): string {
  return `${C.bold}${C.cyan}${text}${C.reset}`;
}

export function ok(s: string): string {
  return `${C.green}${s}${C.reset}`;
}

export function warn(s: string): string {
  return `${C.yellow}${s}${C.reset}`;
}

export function bad(s: string): string {
  return `${C.red}${s}${C.reset}`;
}

export function muted(s: string): string {
  return `${C.gray}${s}${C.reset}`;
}

/** Fixed-width truncate with ellipsis */
export function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

export function termWidth(): number {
  const w = process.stdout.columns;
  return typeof w === 'number' && w > 40 ? w : 80;
}

/**
 * Framed section — Hermes-style panel (UTF-8 box drawing).
 * `W` is total width including corners; text fits in `W - 4` (side borders + padding).
 */
export function framedSection(title: string, lines: string[]): string {
  const W = Math.min(74, Math.max(54, termWidth() - 2));
  const textW = W - 4;
  const h = (n: number) => '─'.repeat(n);
  const top = `╭${h(W - 2)}╮`;
  const titleRow = (() => {
    const t = bold(trunc(title, textW));
    return `│ ${t}${' '.repeat(Math.max(0, textW - visibleLen(t)))} │`;
  })();
  const sep = `├${h(W - 2)}┤`;
  const body = lines.map(s => {
    const t = trunc(s, textW);
    return `│ ${t}${' '.repeat(Math.max(0, textW - visibleLen(t)))} │`;
  });
  const bot = `╰${h(W - 2)}╯`;
  return [top, titleRow, sep, ...body, bot].join('\n');
}

/** Rough visible length without ANSI (for padding). */
function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Simple aligned columns: last column gets remaining space for descriptions.
 */
export function table(headers: string[], widths: number[], rows: string[][]): string {
  const pad = (s: string, n: number) => {
    const v = trunc(s.replace(/\n/g, ' '), n);
    return v + ' '.repeat(Math.max(0, n - visibleLen(v)));
  };
  const head = headers.map((h, i) => pad(h, widths[i])).join('  ');
  const sep = widths.map(n => '─'.repeat(n)).join('  ');
  const body = rows.map(r => r.map((cell, i) => pad(cell, widths[i])).join('  ')).join('\n');
  return [bold(head), dim(sep), body].join('\n');
}
