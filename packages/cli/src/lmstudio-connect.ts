/**
 * Discover / connect Caprigo to an LM Studio OpenAI-compatible server.
 * Probes localhost, CAPRIGO_LMSTUDIO_HOSTS, then LAN /24 for :1234.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as net from 'net';
import { DEFAULT_LM_STUDIO_BASE } from '@caprigo/chat-backend';
import { probeLmStudio } from './embedded-runtime';

export type LmStudioEndpoint = {
  host: string;
  port: number;
  baseUrl: string;
  models: string[];
};

const DEFAULT_PORT = 1234;

function modelsUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, '');
  return b.endsWith('/v1') ? `${b}/models` : `${b}/v1/models`;
}

export function normalizeLmStudioBase(hostOrUrl: string, port = DEFAULT_PORT): string {
  const raw = hostOrUrl.trim();
  if (!raw) return DEFAULT_LM_STUDIO_BASE;
  if (/^https?:\/\//i.test(raw)) {
    const u = raw.replace(/\/$/, '');
    if (u.endsWith('/v1') || u.endsWith('/chat/completions')) return u.includes('/v1') ? u.replace(/\/chat\/completions$/, '') : u;
    return `${u}/v1`;
  }
  return `http://${raw.replace(/\/$/, '')}:${port}/v1`;
}

function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

function localIpv4s(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const a of list) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function subnetHosts(cidrBase: string, selfIp: string): string[] {
  // cidrBase like 10.0.0
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${cidrBase}.${i}`;
    if (ip !== selfIp) hosts.push(ip);
  }
  return hosts;
}

function candidateHostsFromEnv(): string[] {
  const raw = process.env.CAPRIGO_LMSTUDIO_HOSTS?.trim() || '';
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^https?:\/\//i, '').replace(/:\d+.*$/, '').replace(/\/.*$/, ''));
}

async function probeHost(host: string, port: number): Promise<LmStudioEndpoint | null> {
  const open = await tcpOpen(host, port, 350);
  if (!open) return null;
  const baseUrl = `http://${host}:${port}/v1`;
  const probe = await probeLmStudio(baseUrl);
  if (!probe.ok) {
    // Port open but /v1/models failed — still treat as candidate with empty models
    return { host, port, baseUrl, models: [] };
  }
  return { host, port, baseUrl, models: probe.models };
}

/**
 * Discover LM Studio endpoints. Order: explicit URL/host → localhost → env hosts → LAN /24.
 */
export async function discoverLmStudio(opts?: {
  host?: string;
  port?: number;
  scanLan?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<LmStudioEndpoint[]> {
  const port = opts?.port ?? DEFAULT_PORT;
  const found: LmStudioEndpoint[] = [];
  const seen = new Set<string>();
  const log = opts?.onProgress || (() => undefined);

  const add = async (host: string) => {
    const key = `${host}:${port}`;
    if (seen.has(key)) return;
    seen.add(key);
    log(`probing ${host}:${port}…`);
    const hit = await probeHost(host, port);
    if (hit) {
      log(`found ${hit.baseUrl} (${hit.models.length} model(s))`);
      found.push(hit);
    }
  };

  if (opts?.host?.trim()) {
    const host = opts.host
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/:\d+.*$/, '')
      .replace(/\/.*$/, '');
    await add(host);
    if (found.length) return found;
  }

  await add('127.0.0.1');
  await add('localhost');

  for (const h of candidateHostsFromEnv()) {
    await add(h);
  }

  // Common lab hosts (Caprigo box / prior Ollama LAN notes)
  for (const h of ['10.0.0.15', '10.0.0.10', '10.0.0.2', '10.0.0.1', '10.0.0.20', '10.0.0.100']) {
    await add(h);
  }

  if (opts?.scanLan !== false && found.length === 0) {
    const locals = localIpv4s();
    for (const self of locals) {
      const parts = self.split('.');
      if (parts.length !== 4) continue;
      const base = parts.slice(0, 3).join('.');
      log(`scanning ${base}.0/24 for :${port}…`);
      const hosts = subnetHosts(base, self);
      const concurrency = 48;
      for (let i = 0; i < hosts.length; i += concurrency) {
        const chunk = hosts.slice(i, i + concurrency);
        await Promise.all(chunk.map(h => add(h)));
        if (found.length) break;
      }
      if (found.length) break;
    }
  }

  return found;
}

export type ConnectResult = {
  envPath: string;
  baseUrl: string;
  model: string;
  models: string[];
  wrote: boolean;
};

function upsertEnvFile(envPath: string, patch: Record<string, string>): void {
  let existing: Record<string, string> = {};
  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      existing[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  }

  const next = { ...existing, ...patch };
  const keys = Object.keys(next);
  const handled = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      out.push(line);
      continue;
    }
    const eq = t.indexOf('=');
    if (eq <= 0) {
      out.push(line);
      continue;
    }
    const key = t.slice(0, eq).trim();
    if (key in patch) {
      out.push(`${key}=${patch[key]}`);
      handled.add(key);
    } else {
      out.push(line);
    }
  }
  for (const key of Object.keys(patch)) {
    if (!handled.has(key)) out.push(`${key}=${patch[key]}`);
  }
  // Drop unused for lint
  void keys;
  fs.writeFileSync(envPath, out.join('\n').replace(/\n*$/, '\n'), 'utf8');
}

/**
 * Discover LM Studio, write Caprigo .env for harness use, return connection info.
 */
export async function connectLmStudio(opts: {
  envPath: string;
  host?: string;
  port?: number;
  model?: string;
  scanLan?: boolean;
  write?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<ConnectResult> {
  const endpoints = await discoverLmStudio({
    host: opts.host,
    port: opts.port,
    scanLan: opts.scanLan,
    onProgress: opts.onProgress,
  });
  if (!endpoints.length) {
    throw new Error(
      'No LM Studio server found. Start LM Studio, enable Local Server (port 1234), allow network access, then retry — or pass --host <ip>.'
    );
  }
  const best = endpoints[0];
  const pickModel = (): string => {
    if (opts.model?.trim()) return opts.model.trim();
    const ids = best.models.filter(m => !/embed/i.test(m));
    const agentic = ids.find(m => /agentic/i.test(m));
    if (agentic) {
      // Prefer higher-quality quant when multiple agentic variants exist
      const q8 = ids.find(m => /agentic/i.test(m) && /q8/i.test(m));
      return q8 || agentic;
    }
    const coder = ids.find(m => /coder|code/i.test(m));
    if (coder) return coder;
    return ids[0] || 'local-model';
  };
  const model = pickModel();

  const patch: Record<string, string> = {
    CAPRIGO_LLM_PROVIDER: 'openai_compatible',
    OPENAI_BASE_URL: best.baseUrl,
    DEFAULT_MODEL: model,
    CAPRIGO_HARNESS_MODE: '1',
  };
  // Local LM Studio usually needs no key; keep existing key if already set unless blank desired.
  // Do not wipe OPENAI_API_KEY — remote providers may still be used later.

  const write = opts.write !== false;
  if (write) {
    upsertEnvFile(opts.envPath, patch);
  }

  // Apply to current process so launch can use immediately
  for (const [k, v] of Object.entries(patch)) {
    process.env[k] = v;
  }

  return {
    envPath: opts.envPath,
    baseUrl: best.baseUrl,
    model,
    models: best.models,
    wrote: write,
  };
}

export { modelsUrl };
