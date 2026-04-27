/**
 * Append-only execution log for skill runs (Tier 1 roadmap: observability).
 * Writes JSON lines under caprigoDataRoot() (override with CAPRIGO_EXECUTION_LOG_PATH).
 */

import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot, caprigoEnv } from '@caprigo/shared';

const MAX_PARAM_LEN = 4000;

function getLogPath(): string | null {
  const logFlag = caprigoEnv('EXECUTION_LOG');
  if (logFlag === '0' || logFlag === 'false') {
    return null;
  }
  const pathOverride = caprigoEnv('EXECUTION_LOG_PATH');
  if (pathOverride) {
    return path.resolve(pathOverride);
  }
  return path.join(caprigoDataRoot(), 'executions.jsonl');
}

function redactParams(params: unknown): unknown {
  if (params === null || params === undefined) return params;
  let s: string;
  try {
    s = typeof params === 'string' ? params : JSON.stringify(params);
  } catch {
    s = String(params);
  }
  s = s.replace(/\b(sk-[a-zA-Z0-9-]{10,})\b/g, 'sk-***');
  s = s.replace(/\b(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^"'\s&]+/gi, '$1=***');
  if (s.length > MAX_PARAM_LEN) s = s.slice(0, MAX_PARAM_LEN) + '…';
  return s;
}

export interface ExecutionLogEntry {
  ts: number;
  skill: string;
  ok: boolean;
  durationMs: number;
  sessionId?: string;
  error?: string;
  /** Redacted params snapshot */
  paramsSummary?: string;
}

export function appendExecutionLog(entry: ExecutionLogEntry): void {
  const file = getLogPath();
  if (!file) return;
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(file, line, 'utf-8');
  } catch {
    // best-effort
  }
}

/** Read last N entries from the log file (newest last). */
export function readExecutionLogTail(limit: number = 100): ExecutionLogEntry[] {
  const file = getLogPath();
  if (!file || !fs.existsSync(file)) return [];
  try {
    const target = Math.max(1, Math.min(500, limit));
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const chunkSize = 64 * 1024;
    let pos = stat.size;
    let text = '';
    let lineCount = 0;
    while (pos > 0 && lineCount <= target + 1) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      text = buf.toString('utf8') + text;
      lineCount = text.split('\n').length;
    }
    fs.closeSync(fd);
    const lines = text.split('\n').filter(Boolean);
    const slice = lines.slice(-target);
    return slice.map(line => JSON.parse(line) as ExecutionLogEntry);
  } catch {
    return [];
  }
}

export function getExecutionLogPathForApi(): string | null {
  return getLogPath();
}

export function logSkillExecution(
  skill: string,
  params: unknown,
  started: number,
  result: { ok?: boolean; error?: string } | unknown,
  sessionId?: string
): void {
  const durationMs = Math.max(0, Date.now() - started);
  let ok = true;
  let error: string | undefined;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.success === false || r.ok === false) {
      ok = false;
      error = String(r.error || r.message || 'failed');
    }
  }
  appendExecutionLog({
    ts: Date.now(),
    skill,
    ok,
    durationMs,
    sessionId,
    error,
    paramsSummary: String(redactParams(params)),
  });
}
