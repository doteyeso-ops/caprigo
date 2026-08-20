/**
 * Persist HUD ↑ input history under ~/.caprigo/
 */

import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot } from '@caprigo/shared';

const MAX = 200;

function historyPath(): string {
  return path.join(caprigoDataRoot(), 'hud-input-history.json');
}

export function loadInputHistory(): string[] {
  try {
    const p = historyPath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(x => typeof x === 'string').slice(-MAX);
  } catch {
    return [];
  }
}

export function saveInputHistory(entries: string[]): void {
  try {
    const dir = caprigoDataRoot();
    fs.mkdirSync(dir, { recursive: true });
    const cleaned = entries.filter(x => typeof x === 'string' && x.trim()).slice(-MAX);
    fs.writeFileSync(historyPath(), JSON.stringify(cleaned, null, 0), 'utf8');
  } catch {
    /* ignore */
  }
}
