/**
 * Agent-side auto bug packs (escalate / crash). HUD also writes richer packs via cli/hud/bug-report.
 */

import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot } from '@caprigo/shared';
import { brainStatusSummary } from './brain';

export type AutoBugInput = {
  sessionId?: string;
  model?: string;
  note?: string;
  error?: string;
  tools?: string[];
  signature?: string;
  extra?: Record<string, unknown>;
};

function dir(): string {
  return path.join(caprigoDataRoot(), 'bug-reports');
}

function scrub(s: string): string {
  return String(s || '')
    .replace(/\b(sk-[a-zA-Z0-9-]{10,})\b/g, 'sk-***')
    .replace(/\b(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^"'\s&]+/gi, '$1=***');
}

/** Lightweight auto pack when harness escalates or catches a hard failure. */
export function writeAutoBugReport(input: AutoBugInput): string {
  const d = dir();
  fs.mkdirSync(d, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mdPath = path.join(d, `${stamp}-auto.md`);
  let brain: ReturnType<typeof brainStatusSummary> | null = null;
  try {
    brain = brainStatusSummary();
  } catch {
    brain = null;
  }
  const body = [
    `# Caprigo auto bug report`,
    ``,
    `- **When:** ${new Date().toISOString()}`,
    `- **Note:** ${input.note || 'auto'}`,
    `- **Error:** ${scrub(input.error || '')}`,
    `- **Signature:** ${input.signature || ''}`,
    `- **Session:** ${input.sessionId || ''}`,
    `- **Model:** ${input.model || ''}`,
    `- **Tools:** ${(input.tools || []).join(', ') || '—'}`,
    ``,
    `## Brain lessons (tail)`,
    ...(brain?.recentLessons?.length
      ? brain.recentLessons.slice(0, 8).map(
          l => `- \`${l.signature}\` — ${scrub(l.cause).slice(0, 100)} → ${scrub(l.fix).slice(0, 100)}`
        )
      : ['(none)']),
    ``,
    `## Extra`,
    '```json',
    JSON.stringify(input.extra || {}, null, 2),
    '```',
    ``,
  ].join('\n');
  fs.writeFileSync(mdPath, body, 'utf8');
  try {
    fs.writeFileSync(path.join(d, 'LATEST.txt'), `${mdPath}\n`, 'utf8');
  } catch {
    /* ignore */
  }
  return mdPath;
}
