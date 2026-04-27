import * as path from 'path';
import { caprigoEnv } from './caprigo-env';

/**
 * Root for resolving per-agent instruction file paths (`Session.agentInstructionsPath`).
 * Override with `CAPRIGO_WORKSPACE`; default is `process.cwd()` (gateway working directory).
 */
export function caprigoWorkspaceRoot(): string {
  const w = caprigoEnv('WORKSPACE');
  if (w) return path.resolve(w);
  return process.cwd();
}

/**
 * Resolve a user-supplied relative path under the workspace root.
 * Returns `null` if the path escapes the workspace (e.g. `../` outside root).
 */
export function resolvePathUnderWorkspaceRoot(workspaceRoot: string, userPath: string): string | null {
  const root = path.resolve(workspaceRoot);
  const joined = path.resolve(root, userPath);
  const rel = path.relative(root, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return joined;
}
