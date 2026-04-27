/**
 * Offline scripts: local files spawned without LLM. Catalog from manifest.json or *.mjs/*.js scan.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import type { OfflineScriptCatalogItem } from '@caprigo/shared';
import { caprigoDataRoot, caprigoEnv } from '@caprigo/shared';

interface Manifest {
  version?: number;
  scripts?: Array<{
    id: string;
    name?: string;
    path: string;
    interpreter?: string;
    description?: string;
  }>;
}

export function getOfflineScriptsDir(): string {
  const fromEnv = caprigoEnv('OFFLINE_SCRIPTS_DIR');
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const cwd = path.resolve(process.cwd(), 'offline-scripts');
  if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
    return cwd;
  }
  return path.join(caprigoDataRoot(), 'offline-scripts');
}

function ensureWithinRoot(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) {
    throw new Error('Script path escapes offline directory');
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error('Script file not found');
  }
  return abs;
}

function defaultInterpreterForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.mjs' || ext === '.js' || ext === '.cjs') return 'node';
  if (ext === '.py') return process.platform === 'win32' ? 'python' : 'python3';
  if (ext === '.ps1') return 'powershell';
  if (ext === '.sh') return 'shell';
  return 'node';
}

function buildSpawnArgs(
  absScript: string,
  interpreter: string,
  extraArgs: string[]
): { command: string; args: string[] } {
  const i = interpreter.toLowerCase().trim();
  if (i === 'node') {
    return { command: 'node', args: [absScript, ...extraArgs] };
  }
  if (i === 'python' || i === 'python3') {
    const cmd = process.platform === 'win32' ? 'python' : 'python3';
    return { command: cmd, args: [absScript, ...extraArgs] };
  }
  if (i === 'powershell') {
    if (process.platform === 'win32') {
      return { command: 'powershell.exe', args: ['-NoProfile', '-File', absScript, ...extraArgs] };
    }
    return { command: 'pwsh', args: ['-NoProfile', '-File', absScript, ...extraArgs] };
  }
  if (i === 'shell' || i === 'bash' || i === 'sh') {
    return { command: process.platform === 'win32' ? 'bash' : 'bash', args: [absScript, ...extraArgs] };
  }
  throw new Error(`Unsupported interpreter: ${interpreter}`);
}

export function loadOfflineCatalog(root: string): OfflineScriptCatalogItem[] {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [];
  }

  const manifestPath = path.join(root, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    let m: Manifest;
    try {
      m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    } catch {
      return [];
    }
    const scripts = m.scripts || [];
    const out: OfflineScriptCatalogItem[] = [];
    for (const s of scripts) {
      if (!s?.id || !s?.path) continue;
      const rel = s.path.replace(/\\/g, '/');
      try {
        ensureWithinRoot(root, rel);
      } catch {
        continue;
      }
      const base = path.basename(rel);
      const interpreter = (s.interpreter || defaultInterpreterForFile(base)).trim();
      out.push({
        id: String(s.id).trim(),
        name: (s.name || s.id).trim(),
        description: (s.description || 'Offline script').trim(),
        relPath: rel,
        interpreter,
      });
    }
    return out;
  }

  const out: OfflineScriptCatalogItem[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name;
    if (!/\.(mjs|js|cjs|py)$/i.test(name)) continue;
    const id = path.basename(name, path.extname(name));
    out.push({
      id,
      name: id,
      description: `Offline script (${name})`,
      relPath: name,
      interpreter: defaultInterpreterForFile(name),
    });
  }
  return out;
}

export function resolveOfflineScriptAbs(root: string, entry: OfflineScriptCatalogItem): string {
  return ensureWithinRoot(root, entry.relPath);
}

const MAX_CAPTURE = 12 * 1024 * 1024;

export function runOfflineScriptFile(opts: {
  scriptAbsPath: string;
  interpreter: string;
  cwd: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; error?: string }> {
  const { command, args } = buildSpawnArgs(opts.scriptAbsPath, opts.interpreter, opts.args);
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      windowsHide: true,
    });
    let timedOut = false;
    let hardKillTimer: NodeJS.Timeout | null = null;
    const terminateProcess = () => {
      timedOut = true;
      try {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('error', () => {
            try {
              proc.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          });
          return;
        }
        proc.kill('SIGTERM');
        hardKillTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }, 2000);
      } catch {
        /* ignore */
      }
    };
    const killTimer = setTimeout(terminateProcess, opts.timeoutMs);

    const append = (buf: Buffer, which: 'stdout' | 'stderr') => {
      const chunk = buf.toString();
      if (which === 'stdout') {
        if (stdout.length < MAX_CAPTURE) stdout += chunk;
      } else if (stderr.length < MAX_CAPTURE) stderr += chunk;
    };
    proc.stdout?.on('data', d => append(d, 'stdout'));
    proc.stderr?.on('data', d => append(d, 'stderr'));
    proc.on('error', err => {
      clearTimeout(killTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      resolve({ stdout, stderr, exitCode: null, error: err.message });
    });
    proc.on('close', (code, signal) => {
      clearTimeout(killTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      if (signal) {
        resolve({
          stdout,
          stderr: stderr + `\n(killed: ${signal})`,
          exitCode: null,
          error: timedOut || signal === 'SIGTERM' ? 'Timed out' : `Signal ${signal}`,
        });
        return;
      }
      if (timedOut) {
        resolve({ stdout, stderr, exitCode: null, error: 'Timed out' });
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}
