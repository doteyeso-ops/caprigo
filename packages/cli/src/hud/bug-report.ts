/**
 * Internal bug reporter — packs HUD + runtime diagnostics for later agent/dev handoff.
 * Writes ~/.caprigo/bug-reports/<iso>-<note>.md (+ .json sidecar).
 */

import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot } from '@caprigo/shared';
import { brainStatusSummary } from '@caprigo/agent';

export type BugReportInput = {
  note?: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  workspace?: string;
  online?: boolean;
  busy?: boolean;
  mission?: string;
  dialect?: string;
  caps?: Record<string, string | boolean | number | undefined>;
  /** Recent HUD log lines (kind + text). */
  logs?: Array<{ kind: string; text: string; ts?: number }>;
  transcript?: Array<{ role: string; content: string }>;
  toolsRecent?: string[];
  error?: string;
  extra?: Record<string, unknown>;
};

function bugReportsDir(): string {
  return path.join(caprigoDataRoot(), 'bug-reports');
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function slug(s: string): string {
  return String(s || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'report';
}

function scrub(s: string): string {
  return String(s || '')
    .replace(/\b(sk-[a-zA-Z0-9-]{10,})\b/g, 'sk-***')
    .replace(/\b(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^"'\s&]+/gi, '$1=***');
}

/** Write a bug pack; returns absolute paths. */
export function writeBugReport(input: BugReportInput): { mdPath: string; jsonPath: string } {
  const dir = bugReportsDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = `${stamp()}-${slug(input.note || input.error || 'manual')}`;
  const mdPath = path.join(dir, `${id}.md`);
  const jsonPath = path.join(dir, `${id}.json`);

  let brain: ReturnType<typeof brainStatusSummary> | null = null;
  try {
    brain = brainStatusSummary();
  } catch {
    brain = null;
  }

  const payload = {
    createdAt: new Date().toISOString(),
    note: input.note || '',
    error: input.error || '',
    sessionId: input.sessionId || '',
    model: input.model || '',
    provider: input.provider || '',
    workspace: input.workspace || '',
    online: input.online,
    busy: input.busy,
    mission: input.mission || '',
    dialect: input.dialect || '',
    caps: input.caps || {},
    toolsRecent: input.toolsRecent || [],
    brain: brain
      ? {
          lessonCount: brain.lessonCount,
          working: brain.working,
          recentLessons: brain.recentLessons.slice(0, 12),
        }
      : null,
    logs: (input.logs || []).slice(-120).map(l => ({
      kind: l.kind,
      text: scrub(l.text).slice(0, 2000),
      ts: l.ts,
    })),
    transcript: (input.transcript || []).slice(-24).map(m => ({
      role: m.role,
      content: scrub(m.content).slice(0, 4000),
    })),
    extra: input.extra || {},
    dataRoot: caprigoDataRoot(),
  };

  const md = [
    `# Caprigo bug report`,
    ``,
    `- **When:** ${payload.createdAt}`,
    `- **Note:** ${payload.note || '(none)'}`,
    `- **Error:** ${payload.error || '(none)'}`,
    `- **Model:** ${payload.model} · ${payload.provider}`,
    `- **Session:** ${payload.sessionId}`,
    `- **Workspace:** ${payload.workspace}`,
    `- **Mission:** ${payload.mission || 'off'}`,
    `- **Dialect:** ${payload.dialect || '—'}`,
    `- **Data root:** ${payload.dataRoot}`,
    ``,
    `## Caps`,
    '```json',
    JSON.stringify(payload.caps, null, 2),
    '```',
    ``,
    `## Recent tools`,
    payload.toolsRecent.length ? payload.toolsRecent.join(', ') : '(none)',
    ``,
    `## Brain (recent lessons)`,
    ...(payload.brain?.recentLessons?.length
      ? payload.brain.recentLessons.map(
          (l: { signature: string; cause: string; fix: string }) =>
            `- \`${l.signature}\` — ${scrub(l.cause).slice(0, 120)} → ${scrub(l.fix).slice(0, 120)}`
        )
      : ['(none)']),
    ``,
    `## HUD log (tail)`,
    '```',
    ...payload.logs.map(l => `[${l.kind}] ${l.text}`),
    '```',
    ``,
    `## Transcript (tail)`,
    ...payload.transcript.map(m => `### ${m.role}\n\n${m.content}\n`),
    ``,
    `## For the next agent`,
    `Read this file + the sidecar JSON. Reproduce from Note/Error, check Brain lessons for \`unknown:\` skill labels,`,
    `and prefer fixing harness/HOME/STEER over prompting the model harder.`,
    ``,
  ].join('\n');

  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  // Index pointer for “latest bug”
  try {
    fs.writeFileSync(
      path.join(dir, 'LATEST.txt'),
      `${mdPath}\n${jsonPath}\n`,
      'utf8'
    );
  } catch {
    /* ignore */
  }

  return { mdPath, jsonPath };
}

export function listBugReports(limit = 20): string[] {
  const dir = bugReportsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => path.join(dir, f));
}

export function readLatestBugReportPath(): string | null {
  const p = path.join(bugReportsDir(), 'LATEST.txt');
  try {
    const first = fs.readFileSync(p, 'utf8').split(/\r?\n/).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}
