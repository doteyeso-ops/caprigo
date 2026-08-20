/**
 * Caprigo HUD theme + ANSI-safe cell fitting.
 * Truncate/pad by *visible* columns only — never chop mid-escape.
 */

export const T = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  teal: '\x1b[38;2;79;209;197m',
  purple: '\x1b[38;2;183;148;244m',
  amber: '\x1b[38;2;246;173;85m',
  green: '\x1b[38;2;72;187;120m',
  red: '\x1b[38;2;252;129;129m',
  gray: '\x1b[38;2;148;163;184m',
  white: '\x1b[38;2;241;245;249m',
  border: '\x1b[38;2;71;85;105m',
  bgPanel: '\x1b[48;2;15;23;42m',
  bgHeader: '\x1b[48;2;30;41;59m',
  bgOnline: '\x1b[48;2;19;78;74m',
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function paint(color: string, s: string): string {
  if (!s) return '';
  return `${color}${s}${T.reset}`;
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** Visible column width (ANSI ignored; treat codepoints as width 1 for TUI stability). */
export function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

/**
 * Truncate to at most `width` visible columns, preserving ANSI sequences.
 */
export function clipVis(s: string, width: number): string {
  if (width <= 0) return '';
  if (visibleLen(s) <= width) return s;

  let out = '';
  let vis = 0;
  let i = 0;
  const ellipsis = width >= 1 ? '…' : '';
  const limit = Math.max(0, width - ellipsis.length);

  while (i < s.length && vis < limit) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += s[i];
    vis += 1;
    i += 1;
  }
  return out + (ellipsis ? paint(T.gray, ellipsis) : '') + T.reset;
}

/** Fit string into exactly `width` visible columns (clip + pad). */
export function fitCell(s: string, width: number): string {
  if (width <= 0) return '';
  const clipped = clipVis(s, width);
  const pad = width - visibleLen(clipped);
  return clipped + (pad > 0 ? ' '.repeat(pad) : '');
}

export function truncPlain(s: string, n: number): string {
  if (n <= 0) return '';
  if (s.length <= n) return s;
  if (n <= 1) return '…';
  return s.slice(0, n - 1) + '…';
}

/** Build a horizontal rule of exact width. */
export function hRule(width: number, ch = '─'): string {
  return paint(T.border, ch.repeat(Math.max(0, width)));
}

/** Join three panes with borders into one row of exact `cols` width. */
export function row3(
  left: string,
  mid: string,
  right: string,
  leftW: number,
  midW: number,
  rightW: number
): string {
  // leftW + midW + rightW === cols; borders live inside left/mid budgets
  const lInner = Math.max(0, leftW - 1);
  const mInner = Math.max(0, midW - 1);
  const rInner = Math.max(0, rightW);
  return (
    fitCell(left, lInner) +
    paint(T.border, '│') +
    fitCell(mid, mInner) +
    paint(T.border, '│') +
    fitCell(right, rInner)
  );
}

/**
 * Wrap text to at most `width` visible columns per line, preserving ANSI sequences.
 * Soft-wraps on spaces when possible.
 */
export function wrapVis(s: string, width: number): string[] {
  if (width <= 0) return [''];
  if (!s) return [''];
  const plain = stripAnsi(s);
  if (visibleLen(s) <= width) return [s];

  // If no ANSI, wrap simply
  if (plain === s) {
    const out: string[] = [];
    let rest = s;
    while (rest.length > width) {
      let cut = width;
      const chunk = rest.slice(0, width + 1);
      const sp = chunk.lastIndexOf(' ');
      if (sp > Math.floor(width * 0.4)) cut = sp;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
    return out.length ? out : [''];
  }

  // ANSI-aware: walk codepoints, emit lines at width
  const out: string[] = [];
  let line = '';
  let vis = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        line += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (vis >= width) {
      out.push(line + T.reset);
      line = '';
      vis = 0;
    }
    line += s[i];
    vis += 1;
    i += 1;
  }
  if (line) out.push(line + T.reset);
  return out.length ? out : [''];
}
