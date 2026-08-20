/**
 * Hash-anchored line edits (OMP-style).
 * Anchors are short content hashes so local models can edit without exact string replay.
 */

/** Stable 3-char base36 hash of line text (trailing newline stripped). */
export function lineHash(text: string): string {
  const s = text.replace(/\r$/, '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // unsigned, map to 3 base36 chars
  const n = h >>> 0;
  return (n % 46656).toString(36).padStart(3, '0');
}

/** Annotate file body as `NNN:hhh|content` per line (1-based). */
export function annotateWithHashes(content: string): string {
  const lines = content.split('\n');
  // Preserve trailing newline semantics: split keeps final empty if file ends with \n
  const width = Math.max(3, String(Math.max(lines.length, 1)).length);
  return lines
    .map((line, i) => {
      const body = line.replace(/\r$/, '');
      const num = String(i + 1).padStart(width, ' ');
      return `${num}:${lineHash(body)}|${body}`;
    })
    .join('\n');
}

export type HashEditAction = 'replace' | 'delete' | 'insert_after' | 'insert_before';

export type HashEditOp = {
  anchor: string;
  action: HashEditAction;
  content?: string;
};

export type ResolvedEdit = {
  lineIndex: number;
  action: HashEditAction;
  content?: string;
  anchor: string;
};

function parseAnchor(raw: string): { line?: number; hash?: string } {
  const s = String(raw || '').trim();
  if (!s) return {};
  // "42:a7c" or "42:a7c|..."
  const m = s.match(/^(\d+)\s*:\s*([0-9a-z]{2,4})\b/i);
  if (m) return { line: Number(m[1]), hash: m[2].toLowerCase() };
  // bare hash
  if (/^[0-9a-z]{2,4}$/i.test(s)) return { hash: s.toLowerCase() };
  // bare line number
  if (/^\d+$/.test(s)) return { line: Number(s) };
  // "NNN:hhh|rest" full annotated line
  const m2 = s.match(/^\s*(\d+)\s*:\s*([0-9a-z]{2,4})\s*\|/i);
  if (m2) return { line: Number(m2[1]), hash: m2[2].toLowerCase() };
  return {};
}

/**
 * Resolve an anchor against current file lines.
 * Prefer unique hash; if line:hash given, verify hash or search nearby by hash.
 */
export function resolveAnchor(
  lines: string[],
  anchor: string
): { index: number } | { error: string } {
  const { line, hash } = parseAnchor(anchor);
  const hashes = lines.map(l => lineHash(l.replace(/\r$/, '')));

  if (hash) {
    const matches: number[] = [];
    for (let i = 0; i < hashes.length; i++) {
      if (hashes[i] === hash) matches.push(i);
    }
    if (line != null && line >= 1 && line <= lines.length) {
      const idx = line - 1;
      if (hashes[idx] === hash) return { index: idx };
      // drifted: prefer unique hash elsewhere
      if (matches.length === 1) return { index: matches[0] };
      if (matches.length > 1) {
        // pick closest to expected line
        matches.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx));
        return { index: matches[0] };
      }
      return {
        error: `Anchor ${anchor}: line ${line} hash is ${hashes[idx]}, expected ${hash} (line content changed)`,
      };
    }
    if (matches.length === 1) return { index: matches[0] };
    if (matches.length === 0) {
      return { error: `Anchor ${anchor}: hash ${hash} not found in file` };
    }
    return {
      error: `Anchor ${anchor}: hash ${hash} matches ${matches.length} lines (${matches
        .slice(0, 8)
        .map(i => i + 1)
        .join(', ')}); use line:hash`,
    };
  }

  if (line != null) {
    if (line < 1 || line > lines.length) {
      return { error: `Anchor ${anchor}: line ${line} out of range (1–${lines.length})` };
    }
    return { index: line - 1 };
  }

  return { error: `Invalid anchor "${anchor}" (use hash like a7c or line:hash like 42:a7c)` };
}

/** Apply edits bottom-up so indices stay valid. */
export function applyHashEdits(
  content: string,
  edits: HashEditOp[]
): { content: string; applied: Array<{ anchor: string; action: HashEditAction; line: number }> } | { error: string } {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { error: 'edits must be a non-empty array' };
  }

  const lines = content.split('\n');
  // If file ends with newline, last element is ''; keep that representation
  const resolved: ResolvedEdit[] = [];

  for (const ed of edits) {
    const action = (ed.action || 'replace') as HashEditAction;
    if (!['replace', 'delete', 'insert_after', 'insert_before'].includes(action)) {
      return { error: `Unknown action "${ed.action}"` };
    }
    const r = resolveAnchor(lines, ed.anchor);
    if ('error' in r) return r;
    if ((action === 'replace' || action === 'insert_after' || action === 'insert_before') && ed.content == null) {
      return { error: `Edit ${ed.anchor}: content required for ${action}` };
    }
    resolved.push({
      lineIndex: r.index,
      action,
      content: ed.content,
      anchor: ed.anchor,
    });
  }

  // Sort descending by line so earlier lines aren't shifted
  resolved.sort((a, b) => b.lineIndex - a.lineIndex || a.action.localeCompare(b.action));

  const applied: Array<{ anchor: string; action: HashEditAction; line: number }> = [];

  for (const ed of resolved) {
    const lineNo = ed.lineIndex + 1;
    if (ed.action === 'replace') {
      const parts = String(ed.content ?? '').split('\n');
      lines.splice(ed.lineIndex, 1, ...parts);
      applied.push({ anchor: ed.anchor, action: ed.action, line: lineNo });
    } else if (ed.action === 'delete') {
      lines.splice(ed.lineIndex, 1);
      applied.push({ anchor: ed.anchor, action: ed.action, line: lineNo });
    } else if (ed.action === 'insert_after') {
      const parts = String(ed.content ?? '').split('\n');
      lines.splice(ed.lineIndex + 1, 0, ...parts);
      applied.push({ anchor: ed.anchor, action: ed.action, line: lineNo });
    } else if (ed.action === 'insert_before') {
      const parts = String(ed.content ?? '').split('\n');
      lines.splice(ed.lineIndex, 0, ...parts);
      applied.push({ anchor: ed.anchor, action: ed.action, line: lineNo });
    }
  }

  applied.reverse(); // chronological order for reporting
  return { content: lines.join('\n'), applied };
}
