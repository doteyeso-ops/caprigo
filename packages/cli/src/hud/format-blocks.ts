/**
 * Cursor-like reply formatting for the HUD: code fences → bordered cards,
 * markdown tables → box-drawing tables.
 */

import { T, paint, clipVis, visibleLen } from './theme';

const FENCE_OPEN = /^```([a-zA-Z0-9_+.-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?[\s:|-]+\|\s*$/;

export function looksStructuredMarkdown(text: string): boolean {
  return /```[\s\S]*?```/.test(text) || /^\s*\|.+\|/m.test(text);
}

/** Format assistant reply into painted HUD lines (no kind prefix). */
export function formatMarkdownReply(text: string, width: number): string[] {
  const w = Math.max(24, width);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN);
    if (open) {
      const lang = open[1] || 'code';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing fence
      out.push(...codeCard(lang, body, w));
      continue;
    }

    if (TABLE_ROW.test(lines[i])) {
      const tableLines: string[] = [];
      while (i < lines.length && (TABLE_ROW.test(lines[i]) || TABLE_SEP.test(lines[i]))) {
        tableLines.push(lines[i]);
        i += 1;
      }
      out.push(...tableCard(tableLines, w));
      continue;
    }

    // Prose / blank
    const line = lines[i];
    i += 1;
    if (!line.trim()) {
      out.push('');
      continue;
    }
    // Inline `code` → amber tint (simple pass)
    out.push(...wrapProse(tintInlineCode(line), w));
  }

  // Trim leading/trailing blank noise
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function tintInlineCode(s: string): string {
  return s.replace(/`([^`]+)`/g, (_m, code: string) => paint(T.amber, code));
}

function wrapProse(s: string, width: number): string[] {
  const inner = Math.max(8, width - 2);
  const words = s.split(/(\s+)/);
  const rows: string[] = [];
  let cur = '';
  for (const part of words) {
    if (visibleLen(cur + part) > inner && cur) {
      rows.push(`  ${cur}`);
      cur = part.trimStart();
    } else {
      cur += part;
    }
  }
  if (cur) rows.push(`  ${cur}`);
  return rows.length ? rows : ['  '];
}

function codeCard(lang: string, body: string[], width: number): string[] {
  const inner = Math.max(10, width - 4);
  const label = lang || 'code';
  const head =
    paint(T.border, '╭─ ') +
    paint(T.purple + T.bold, label) +
    paint(T.border, ' ' + '─'.repeat(Math.max(0, inner - visibleLen(label) - 2)));
  const rows = [head];
  const shown = body.length > 80 ? body.slice(0, 80) : body;
  for (const line of shown) {
    rows.push(paint(T.border, '│ ') + paint(T.white, clipVis(line, inner)));
  }
  if (body.length > shown.length) {
    rows.push(
      paint(T.border, '│ ') + paint(T.dim + T.gray, `… ${body.length - shown.length} more lines`)
    );
  }
  if (!shown.length) {
    rows.push(paint(T.border, '│ ') + paint(T.dim + T.gray, '(empty)'));
  }
  rows.push(paint(T.border, '╰' + '─'.repeat(Math.max(1, Math.min(inner + 1, width - 2)))));
  return rows;
}

function parseTable(raw: string[]): { headers: string[]; rows: string[][] } | null {
  const cleaned = raw
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !TABLE_SEP.test(l));
  if (cleaned.length < 1) return null;

  const split = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  };

  const headers = split(cleaned[0]);
  const rows = cleaned.slice(1).map(split);
  // Normalize column counts
  const cols = headers.length;
  const norm = rows.map(r => {
    const out = r.slice(0, cols);
    while (out.length < cols) out.push('');
    return out;
  });
  return { headers, rows: norm };
}

function tableCard(raw: string[], width: number): string[] {
  const parsed = parseTable(raw);
  if (!parsed || !parsed.headers.length) {
    return raw.map(l => `  ${l}`);
  }

  const cols = parsed.headers.length;
  const all = [parsed.headers, ...parsed.rows];
  const maxes = Array.from({ length: cols }, (_, c) =>
    Math.min(
      28,
      Math.max(3, ...all.map(r => (r[c] || '').length))
    )
  );

  // Shrink if wider than pane
  let total = maxes.reduce((a, b) => a + b, 0) + cols * 3 + 1;
  while (total > width - 2 && maxes.some(m => m > 4)) {
    const i = maxes.indexOf(Math.max(...maxes));
    maxes[i] -= 1;
    total = maxes.reduce((a, b) => a + b, 0) + cols * 3 + 1;
  }

  const rule = (left: string, mid: string, right: string, fill: string) =>
    paint(
      T.border,
      left + maxes.map(m => fill.repeat(m + 2)).join(mid) + right
    );

  const cellRow = (cells: string[], bold = false) => {
    const parts = cells.map((c, i) => {
      const clipped = clipVis(c, maxes[i]);
      const pad = ' '.repeat(Math.max(0, maxes[i] - visibleLen(clipped)));
      const body = bold ? paint(T.teal + T.bold, clipped) : paint(T.white, clipped);
      return ` ${body}${pad} `;
    });
    return paint(T.border, '│') + parts.join(paint(T.border, '│')) + paint(T.border, '│');
  };

  const out: string[] = [];
  out.push(rule('╭', '┬', '╮', '─'));
  out.push(cellRow(parsed.headers, true));
  out.push(rule('├', '┼', '┤', '─'));
  for (const row of parsed.rows.slice(0, 40)) {
    out.push(cellRow(row));
  }
  if (parsed.rows.length > 40) {
    out.push(
      paint(T.border, '│ ') +
        paint(T.dim + T.gray, `… ${parsed.rows.length - 40} more rows`) +
        paint(T.border, ' │')
    );
  }
  out.push(rule('╰', '┴', '╯', '─'));
  return out;
}
