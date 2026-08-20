import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot } from './caprigo-paths';

export type FileLedgerAction = 'write' | 'replace' | 'delete';

export interface FileLedgerEntry {
  ts: string;
  action: FileLedgerAction;
  path: string;
  sessionId?: string;
  bytes?: number;
  replacements?: number;
  note?: string;
}

function ledgerPath(): string {
  return path.join(caprigoDataRoot(), 'file-ledger.jsonl');
}

/** Append one file-change event (best-effort; never throws to callers). */
export function recordFileChange(entry: Omit<FileLedgerEntry, 'ts'> & { ts?: string }): void {
  try {
    const root = caprigoDataRoot();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    const row: FileLedgerEntry = {
      ts: entry.ts || new Date().toISOString(),
      action: entry.action,
      path: entry.path,
      sessionId: entry.sessionId,
      bytes: entry.bytes,
      replacements: entry.replacements,
      note: entry.note,
    };
    fs.appendFileSync(ledgerPath(), `${JSON.stringify(row)}\n`, 'utf8');
  } catch {
    /* ignore ledger failures */
  }
}

/** Newest-last array of recent ledger rows. */
export function readFileLedgerTail(limit = 50): FileLedgerEntry[] {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return [];
  const lim = Math.min(500, Math.max(1, limit));
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-lim);
  const out: FileLedgerEntry[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as FileLedgerEntry);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

/** Unique paths touched, newest first. */
export function summarizeTouchedFiles(limit = 40): Array<{ path: string; lastAction: string; lastTs: string; count: number }> {
  const entries = readFileLedgerTail(500);
  const map = new Map<string, { path: string; lastAction: string; lastTs: string; count: number }>();
  for (const e of entries) {
    const prev = map.get(e.path);
    if (!prev) {
      map.set(e.path, { path: e.path, lastAction: e.action, lastTs: e.ts, count: 1 });
    } else {
      prev.count += 1;
      prev.lastAction = e.action;
      prev.lastTs = e.ts;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))
    .slice(0, limit);
}
