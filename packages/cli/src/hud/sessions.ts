/**
 * HUD session persistence — save / list / load / archive under ~/.caprigo/hud-sessions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { caprigoDataRoot } from '@caprigo/shared';

export type HudLogKind = 'system' | 'user' | 'think' | 'reply' | 'tool' | 'ok' | 'err' | 'meta';

export type HudLogLine = { kind: HudLogKind; text: string; ts: number };

export type HudMessage = { role: 'user' | 'assistant'; content: string; timestamp?: number };

export type HudSessionRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  model: string;
  workspace: string;
  logs: HudLogLine[];
  filesTouched: string[];
  messages: HudMessage[];
};

export type HudSessionMeta = {
  id: string;
  title: string;
  updatedAt: number;
  archived: boolean;
  model: string;
  logCount: number;
};

function sessionsDir(): string {
  return path.join(caprigoDataRoot(), 'hud-sessions');
}

function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}

function ensureDir(): void {
  fs.mkdirSync(sessionsDir(), { recursive: true });
}

export function listHudSessions(opts?: { archived?: boolean }): HudSessionMeta[] {
  ensureDir();
  const wantArchived = opts?.archived === true;
  const out: HudSessionMeta[] = [];
  for (const name of fs.readdirSync(sessionsDir())) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir(), name), 'utf8')) as HudSessionRecord;
      if (!!raw.archived !== wantArchived && opts?.archived !== undefined) continue;
      if (opts?.archived === undefined && raw.archived) continue; // default: active only
      out.push({
        id: raw.id,
        title: raw.title || raw.id.slice(0, 8),
        updatedAt: raw.updatedAt || raw.createdAt || 0,
        archived: !!raw.archived,
        model: raw.model || '',
        logCount: Array.isArray(raw.logs) ? raw.logs.length : 0,
      });
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function loadHudSession(id: string): HudSessionRecord | null {
  const p = sessionPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as HudSessionRecord;
  } catch {
    return null;
  }
}

export function saveHudSession( partial: {
  id?: string;
  title?: string;
  model: string;
  workspace: string;
  logs: HudLogLine[];
  filesTouched: string[];
  messages: HudMessage[];
  archived?: boolean;
}): HudSessionRecord {
  ensureDir();
  const now = Date.now();
  const existing = partial.id ? loadHudSession(partial.id) : null;
  const id = partial.id || existing?.id || randomUUID();
  const title =
    partial.title?.trim() ||
    existing?.title ||
    guessTitle(partial.logs) ||
    `Session ${new Date(now).toLocaleString()}`;
  const rec: HudSessionRecord = {
    id,
    title,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    archived: partial.archived ?? existing?.archived ?? false,
    model: partial.model,
    workspace: partial.workspace,
    logs: partial.logs.slice(-4000),
    filesTouched: [...new Set(partial.filesTouched)].slice(-80),
    messages: partial.messages.slice(-200),
  };
  fs.writeFileSync(sessionPath(id), JSON.stringify(rec, null, 2), 'utf8');
  return rec;
}

export function archiveHudSession(id: string): boolean {
  const rec = loadHudSession(id);
  if (!rec) return false;
  rec.archived = true;
  rec.updatedAt = Date.now();
  fs.writeFileSync(sessionPath(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

export function unarchiveHudSession(id: string): boolean {
  const rec = loadHudSession(id);
  if (!rec) return false;
  rec.archived = false;
  rec.updatedAt = Date.now();
  fs.writeFileSync(sessionPath(id), JSON.stringify(rec, null, 2), 'utf8');
  return true;
}

function guessTitle(logs: HudLogLine[]): string {
  const user = [...logs].reverse().find(l => l.kind === 'user');
  if (!user) return '';
  const t = user.text.replace(/^you ›\s*/i, '').trim();
  if (!t) return '';
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}
