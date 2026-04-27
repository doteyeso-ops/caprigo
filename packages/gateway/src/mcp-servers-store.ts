import fs from 'fs';
import path from 'path';
import { caprigoDataRoot } from '@caprigo/shared';

export type McpServerEntry = {
  /** Short id used in Caprigo skill names: mcp_<id>_<tool>. */
  id: string;
  enabled: boolean;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Optional cwd for the child process. */
  cwd?: string;
};

export type McpServersFile = {
  servers: McpServerEntry[];
};

const FILE = 'mcp-servers.json';

export function mcpServersConfigPath(): string {
  return path.join(caprigoDataRoot(), 'gateway', FILE);
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;

export function validateMcpServerEntry(s: unknown): { ok: true; entry: McpServerEntry } | { ok: false; error: string } {
  if (!s || typeof s !== 'object') return { ok: false, error: 'Server entry must be an object' };
  const o = s as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  if (!ID_RE.test(id)) {
    return { ok: false, error: `Invalid server id "${id}" (use letters, digits, _ - ; max 48 chars)` };
  }
  const enabled = o.enabled !== false;
  const command = String(o.command ?? '').trim();
  if (!command) return { ok: false, error: `Server ${id}: command is required` };
  if (!Array.isArray(o.args)) return { ok: false, error: `Server ${id}: args must be an array` };
  const args = o.args.map(a => String(a));
  let env: Record<string, string> | undefined;
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== 'object') return { ok: false, error: `Server ${id}: env must be an object of strings` };
    env = {};
    for (const [k, v] of Object.entries(o.env as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }
  let cwd: string | undefined;
  if (o.cwd !== undefined && o.cwd !== null) {
    cwd = String(o.cwd).trim();
    if (!cwd) cwd = undefined;
  }
  return {
    ok: true,
    entry: { id, enabled, command, args, env, cwd },
  };
}

export function validateMcpServersFile(body: unknown): { ok: true; data: McpServersFile } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const servers = (body as Record<string, unknown>).servers;
  if (!Array.isArray(servers)) return { ok: false, error: 'servers must be an array' };
  const out: McpServerEntry[] = [];
  for (const item of servers) {
    const v = validateMcpServerEntry(item);
    if (!v.ok) return v;
    out.push(v.entry);
  }
  const ids = new Set<string>();
  for (const s of out) {
    if (ids.has(s.id)) return { ok: false, error: `Duplicate server id: ${s.id}` };
    ids.add(s.id);
  }
  return { ok: true, data: { servers: out } };
}

export function loadMcpServers(): McpServersFile {
  const p = mcpServersConfigPath();
  try {
    if (!fs.existsSync(p)) return { servers: [] };
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const v = validateMcpServersFile(parsed);
    if (!v.ok) {
      console.warn(`[MCP] Invalid ${p}: ${v.error} — using empty config`);
      return { servers: [] };
    }
    return v.data;
  } catch (e: any) {
    console.warn(`[MCP] Could not read ${p}: ${e?.message || e} — using empty config`);
    return { servers: [] };
  }
}

export function saveMcpServers(data: McpServersFile): void {
  const p = mcpServersConfigPath();
  ensureParentDir(p);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}
