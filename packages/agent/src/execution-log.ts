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
  /** Compact reason for why this tool was used. */
  rationale?: string;
  /** Compact result summary for trace/replay surfaces. */
  resultSummary?: string;
  /** Coarse output size proxy for cost/verbosity visibility. */
  outputChars?: number;
}

function summarizeRationale(skill: string, params: unknown): string | undefined {
  const record =
    params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : null;
  const firstString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  const firstArrayLen = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = record?.[key];
      if (Array.isArray(value)) return value.length;
    }
    return undefined;
  };

  if (skill === 'repo_map') return 'Map repository structure before reading full files.';
  if (skill === 'codebase_context') {
    const query = firstString('query', 'q', 'text');
    return query ? `Find likely code files for "${query}".` : 'Find likely code files before deeper reads.';
  }
  if (skill === 'search_files') {
    const pattern = firstString('pattern', 'query', 'q');
    return pattern ? `Search workspace files for "${pattern}".` : 'Search workspace files for a matching path or pattern.';
  }
  if (skill === 'read_file') {
    const path = firstString('path', 'file', 'filePath');
    return path ? `Inspect ${path}.` : 'Inspect a specific file.';
  }
  if (skill === 'write_file') {
    const path = firstString('path', 'file', 'filePath');
    return path ? `Write updated content to ${path}.` : 'Write updated file content.';
  }
  if (skill === 'search_replace') {
    const path = firstString('path', 'file', 'filePath');
    return path ? `Apply a targeted edit in ${path}.` : 'Apply a targeted text edit.';
  }
  if (skill === 'web_search') {
    const query = firstString('query', 'q');
    return query ? `Check the web for "${query}".` : 'Check the web for current information.';
  }
  if (skill === 'web_fetch' || skill === 'http_get') {
    const url = firstString('url');
    return url ? `Fetch data from ${url}.` : 'Fetch a remote page or API response.';
  }
  if (skill === 'http_post') {
    const url = firstString('url');
    return url ? `Send a request to ${url}.` : 'Send a remote API request.';
  }
  if (skill === 'execute_command') {
    const command = firstString('command', 'cmd');
    return command ? `Run "${command}" on the host.` : 'Run a host command to verify or change local state.';
  }
  if (skill === 'fleet_message') {
    const kind = firstString('kind') || 'fleet';
    return `Send a ${kind} message to a linked agent.`;
  }
  if (skill === 'fleet_roster') return 'Check the currently linked fleet sessions.';
  if (skill.startsWith('local:')) {
    return `Run the local script ${skill.slice('local:'.length)}.`;
  }
  if (skill.startsWith('mcp_')) return 'Use an external MCP-connected tool.';
  if (skill.startsWith('as_')) return 'Follow an installed agent skill playbook.';
  if (skill.startsWith('vibes_')) {
    const listingId = firstString('listingId', 'listing_id');
    return listingId ? `Use a Vibes-Coded marketplace tool or listing (${listingId}).` : 'Use a Vibes-Coded marketplace tool.';
  }

  const path = firstString('path', 'file', 'filePath');
  if (path) return `Operate on ${path}.`;
  const url = firstString('url');
  if (url) return `Operate on ${url}.`;
  const query = firstString('query', 'q', 'pattern', 'text');
  if (query) return `Work from "${query}".`;
  const arrayLen = firstArrayLen('paths', 'files', 'items');
  if (typeof arrayLen === 'number') return `Operate on ${arrayLen} selected item${arrayLen === 1 ? '' : 's'}.`;
  return undefined;
}

function summarizeResult(result: unknown): { resultSummary?: string; outputChars?: number } {
  if (result == null) return {};
  const asString =
    typeof result === 'string'
      ? result
      : (() => {
          try {
            return JSON.stringify(result);
          } catch {
            return String(result);
          }
        })();
  const outputChars = asString.length;
  if (typeof result !== 'object' || result === null) {
    return {
      resultSummary: asString.length > 240 ? `${asString.slice(0, 237)}...` : asString,
      outputChars,
    };
  }

  const r = result as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof r.files_scanned === 'number') parts.push(`files_scanned=${r.files_scanned}`);
  if (typeof r.files_with_symbols === 'number') parts.push(`files_with_symbols=${r.files_with_symbols}`);
  if (typeof r.symbols_returned === 'number') parts.push(`symbols=${r.symbols_returned}`);
  if (Array.isArray(r.candidate_files)) parts.push(`candidate_files=${r.candidate_files.length}`);
  if (Array.isArray(r.search_hits)) parts.push(`search_hits=${r.search_hits.length}`);
  if (Array.isArray(r.matches)) parts.push(`matches=${r.matches.length}`);
  if (typeof r.path === 'string') parts.push(`path=${r.path}`);
  if (typeof r.message === 'string') parts.push(r.message);
  if (typeof r.error === 'string') parts.push(`error=${r.error}`);
  if (Array.isArray(r.ranked_candidates) && r.ranked_candidates.length > 0) {
    const top = r.ranked_candidates
      .slice(0, 2)
      .map(item => {
        const row = item as Record<string, unknown>;
        const path = typeof row.path === 'string' ? row.path : '?';
        const score = typeof row.score === 'number' ? row.score : 0;
        return `${path}@${score}`;
      })
      .join(', ');
    parts.push(`top=${top}`);
  }

  const resultSummary = parts.join(' | ') || (asString.length > 240 ? `${asString.slice(0, 237)}...` : asString);
  return { resultSummary, outputChars };
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
    rationale: summarizeRationale(skill, params),
    ...summarizeResult(result),
  });
}
