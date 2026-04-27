import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot } from './caprigo-paths';
import { caprigoEnv } from './caprigo-env';
import { caprigoWorkspaceRoot } from './caprigo-workspace';

export interface CaprigoFileScope {
  path: string;
  read: boolean;
  write: boolean;
}

export interface CaprigoShellPermissions {
  enabled: boolean;
  blocked: string[];
  cwdOnly: boolean;
}

export interface CaprigoFilesystemPermissions {
  enabled: boolean;
  scopes: CaprigoFileScope[];
}

export interface CaprigoPermissionsManifest {
  filesystem: CaprigoFilesystemPermissions;
  shell: CaprigoShellPermissions;
}

const BLOCKED_COMMANDS = [
  'sudo *',
  'rm -rf /',
  'rm -rf ~',
  'rm -rf /*',
  'mkfs *',
  'dd if=*',
  'chmod 777 /',
  'chown * /',
  ':(){ :|:& };:',
  'shutdown *',
  'reboot *',
  'halt *',
  'init 0',
  'init 6',
  'kill -9 1',
  '> /dev/sda',
  'mv /* /dev/null',
  'del /s /q C:\\*',
  'rmdir /s /q C:\\*',
  'format *',
  'icacls * C:\\* /grant',
  'net user *',
  'netsh *',
  'reg delete *',
  'cmd /c rd /s /q *',
];

export function caprigoPermissionsPath(): string {
  const override = caprigoEnv('PERMISSIONS_FILE');
  if (override) return path.resolve(override);
  return path.join(caprigoDataRoot(), 'permissions.json');
}

function defaultPermissionsManifest(): CaprigoPermissionsManifest {
  const workspace = caprigoWorkspaceRoot();
  const home = caprigoDataRoot();
  return {
    filesystem: {
      enabled: true,
      scopes: [
        { path: workspace, read: true, write: true },
        { path: home, read: true, write: true },
      ],
    },
    shell: {
      enabled: true,
      blocked: [...BLOCKED_COMMANDS],
      cwdOnly: true,
    },
  };
}

function ensurePermissionsFile(): CaprigoPermissionsManifest {
  const file = caprigoPermissionsPath();
  const defaults = defaultPermissionsManifest();
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
      return defaults;
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CaprigoPermissionsManifest>;
    return {
      filesystem: {
        enabled: parsed.filesystem?.enabled ?? defaults.filesystem.enabled,
        scopes: Array.isArray(parsed.filesystem?.scopes) && parsed.filesystem!.scopes!.length > 0
          ? parsed.filesystem!.scopes!.map(scope => ({
              path: String(scope.path),
              read: scope.read !== false,
              write: scope.write !== false,
            }))
          : defaults.filesystem.scopes,
      },
      shell: {
        enabled: parsed.shell?.enabled ?? defaults.shell.enabled,
        blocked: Array.isArray(parsed.shell?.blocked) && parsed.shell!.blocked!.length > 0
          ? parsed.shell!.blocked!.map(x => String(x))
          : defaults.shell.blocked,
        cwdOnly: parsed.shell?.cwdOnly ?? defaults.shell.cwdOnly,
      },
    };
  } catch {
    return defaults;
  }
}

function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function withinScope(candidate: string, scopePath: string): boolean {
  const full = normalizeForCompare(candidate);
  const scope = normalizeForCompare(scopePath);
  return full === scope || full.startsWith(scope + path.sep);
}

export function caprigoPermissions(): CaprigoPermissionsManifest {
  return ensurePermissionsFile();
}

export function checkCaprigoPathAccess(
  candidatePath: string,
  mode: 'read' | 'write'
): { allowed: boolean; reason?: string } {
  const perms = caprigoPermissions();
  if (!perms.filesystem.enabled) {
    return { allowed: false, reason: 'Filesystem access is disabled by Caprigo permissions.' };
  }
  const resolved = path.resolve(candidatePath);
  for (const scope of perms.filesystem.scopes) {
    if (!withinScope(resolved, scope.path)) continue;
    if (mode === 'read' && scope.read) return { allowed: true };
    if (mode === 'write' && scope.write) return { allowed: true };
    return {
      allowed: false,
      reason: `Caprigo permissions deny ${mode} access to ${resolved} under scope ${scope.path}.`,
    };
  }
  return {
    allowed: false,
    reason: `Path ${resolved} is outside Caprigo's approved filesystem scopes (${caprigoPermissionsPath()}).`,
  };
}

export function resolveCaprigoToolPath(userPath: string, baseDir?: string): string {
  if (path.isAbsolute(userPath)) return path.resolve(userPath);
  return path.resolve(baseDir || caprigoWorkspaceRoot(), userPath);
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, process.platform === 'win32' ? 'i' : '');
}

export function checkCaprigoShellCommand(
  command: string,
  cwd: string
): { allowed: boolean; reason?: string } {
  const perms = caprigoPermissions();
  if (!perms.shell.enabled) {
    return { allowed: false, reason: 'Shell execution is disabled by Caprigo permissions.' };
  }
  const trimmed = command.trim();
  for (const pattern of perms.shell.blocked) {
    if (wildcardToRegExp(pattern).test(trimmed)) {
      return { allowed: false, reason: `Blocked shell command: matches "${pattern}".` };
    }
  }
  if (perms.shell.cwdOnly) {
    const cwdCheck = checkCaprigoPathAccess(cwd, 'write');
    if (!cwdCheck.allowed) {
      return {
        allowed: false,
        reason: `Shell cwd ${path.resolve(cwd)} is outside Caprigo's approved filesystem scopes.`,
      };
    }
  }
  return { allowed: true };
}
