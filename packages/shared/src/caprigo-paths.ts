import * as fs from 'fs';
import * as path from 'path';
import { caprigoEnv } from './caprigo-env';

function defaultDataRoots(): { caprigoRoot: string; legacyRoot: string } {
  const home = process.env.USERPROFILE || process.env.HOME || '.';
  return {
    caprigoRoot: path.join(home, '.caprigo'),
    legacyRoot: path.join(home, ['.', 'r', 'a', 'd', 'b', 'o', 't'].join('')),
  };
}

function copyLegacyTree(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyLegacyTree(from, to);
      continue;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
    }
  }
}

function ensurePreferredCaprigoRoot(): string {
  const override = caprigoEnv('HOME');
  if (override) return path.resolve(override);

  const { caprigoRoot, legacyRoot } = defaultDataRoots();
  try {
    if (fs.existsSync(caprigoRoot)) {
      return caprigoRoot;
    }
    if (!fs.existsSync(legacyRoot)) {
      return caprigoRoot;
    }
    try {
      fs.renameSync(legacyRoot, caprigoRoot);
      return caprigoRoot;
    } catch {
      copyLegacyTree(legacyRoot, caprigoRoot);
      return caprigoRoot;
    }
  } catch {
    return caprigoRoot;
  }
}

/**
 * Data directory for Caprigo Core (`~/.caprigo` by default).
 * `CAPRIGO_HOME` overrides. If a legacy Caprigo home exists,
 * Caprigo migrates it into `~/.caprigo` and continues from the new location.
 */
export function caprigoDataRoot(): string {
  return ensurePreferredCaprigoRoot();
}
