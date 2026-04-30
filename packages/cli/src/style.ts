/**
 * Terminal styling with lightweight polish and no extra dependencies.
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

export function accent(s: string): string {
  return `${C.magenta}${s}${C.reset}`;
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

export function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return s.slice(0, max - 3) + '...';
}

export function termWidth(): number {
  const w = process.stdout.columns;
  return typeof w === 'number' && w > 40 ? w : 80;
}

export function framedSection(title: string, lines: string[]): string {
  const width = Math.min(74, Math.max(54, termWidth() - 2));
  const textWidth = width - 4;
  const h = (n: number) => '─'.repeat(n);
  const top = `╭${h(width - 2)}╮`;
  const titleRow = (() => {
    const t = bold(trunc(title, textWidth));
    return `│ ${t}${' '.repeat(Math.max(0, textWidth - visibleLen(t)))} │`;
  })();
  const sep = `├${h(width - 2)}┤`;
  const body = lines.map(line => {
    const t = trunc(line, textWidth);
    return `│ ${t}${' '.repeat(Math.max(0, textWidth - visibleLen(t)))} │`;
  });
  const bottom = `╰${h(width - 2)}╯`;
  return [top, titleRow, sep, ...body, bottom].join('\n');
}

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

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

export function brandHeader(product: string, tagline: string, detail?: string): string {
  const width = Math.min(74, Math.max(54, termWidth() - 2));
  const h = (n: number) => '═'.repeat(n);
  const center = (text: string, formatter: (value: string) => string) => {
    const visible = visibleLen(text);
    const left = Math.max(0, Math.floor((width - 2 - visible) / 2));
    const right = Math.max(0, width - 2 - visible - left);
    return `${C.cyan}║${C.reset}${' '.repeat(left)}${formatter(text)}${' '.repeat(right)}${C.cyan}║${C.reset}`;
  };

  const rows = [
    `${C.cyan}╔${h(width - 2)}╗${C.reset}`,
    center(product, value => bold(accent(value))),
    center(tagline, value => dim(value)),
  ];
  if (detail) rows.push(center(detail, value => muted(value)));
  rows.push(`${C.cyan}╚${h(width - 2)}╝${C.reset}`);
  return rows.join('\n');
}
