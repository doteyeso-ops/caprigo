/**
 * Stumble-to-walk — failure signatures, diagnose/retry prompts, verify churn limits.
 */

import { recallLessons, recordLesson, recordEpisode, scrubSecrets, touchLesson, updateWorking } from './brain';
import type { ModelProfile } from './model-profile';
import { profileOneLiner } from './model-profile';

export function stumbleEnabled(): boolean {
  const v = process.env.CAPRIGO_STUMBLE;
  if (v === undefined || v === '') {
    // default on when harness mode is on
    const h = process.env.CAPRIGO_HARNESS_MODE;
    if (h === '0' || h === 'false') return false;
    return true;
  }
  return /^(1|true|yes)$/i.test(v);
}

export function stumbleMaxPerSignature(): number {
  const n = Number(process.env.CAPRIGO_STUMBLE_MAX || '3');
  return Number.isFinite(n) && n > 0 ? Math.min(8, n) : 3;
}

export function stumbleVerifyMax(): number {
  const n = Number(process.env.CAPRIGO_STUMBLE_VERIFY_MAX || '3');
  return Number.isFinite(n) && n > 0 ? Math.min(8, n) : 3;
}

export function normalizeErrorSignature(tool: string, error: string): string {
  const e = scrubSecrets(error)
    .toLowerCase()
    .replace(/\b[a-f0-9]{8,}\b/g, '#')
    .replace(/\d+/g, 'N')
    .replace(/\\/g, '/')
    .replace(/c:\/users\/[^/]+/gi, 'c:/users/#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${tool}|${e}`.slice(0, 160);
}

/** Concrete fix text for common failure classes (so Brain learns something actionable). */
export function suggestedFixForFailure(tool: string, error: string): string {
  const e = String(error || '').toLowerCase();
  const t = String(tool || '').toLowerCase();
  if (/enoent|no such file or directory/.test(e) && /write_file|hash_edit|search_replace/.test(t)) {
    return 'write_file creates parent folders — retry the same path with FULL content, or use generated/<name>.ext. Never ask the user to continue.';
  }
  if (/outside.*scope|permissions\.json|escapes workspace/.test(e)) {
    return 'Use a path under the Caprigo workspace (prefer generated/). Do not invent absolute paths outside scopes.';
  }
  if (/requires string \"content\"|requires \"path\"|requires string "content"/.test(e)) {
    return 'Call write_file with both path and full content string — no empty args, no ... stubs.';
  }
  if (/playwright|browserType\.launch|chromium/.test(e)) {
    return 'Run npx playwright install chromium, or use web_fetch/web_search instead of browser_* for static pages.';
  }
  if (/econnrefused|fetch failed|network/.test(e) && /web_|http_/.test(t)) {
    return 'Retry web_search with a simpler query, or try web_fetch on a known URL. Check network.';
  }
  if (
    /unknown skill|__unknown_skill__|unknown_skill|unknown:/.test(e) ||
    /^unknown(_skill)?$/i.test(t) ||
    /^unknown:/i.test(t)
  ) {
    return 'Call an exact allowed skill name. For search/find/lookup: web_search (internet) or search_files (local grep). Do not invent tool names.';
  }
  return `Do not retry identical ${tool} args. Change path/args/tool. Never ask the user whether to continue — act.`;
}

export type StumbleState = {
  counts: Map<string, number>;
  lastSignature?: string;
  lastTool?: string;
  lastError?: string;
  hadFailure: boolean;
  verifyChurns: number;
  /** Paths/args already auto-retried by harness this turn. */
  autoRetried: Set<string>;
};

export function createStumbleState(): StumbleState {
  return {
    counts: new Map(),
    hadFailure: false,
    verifyChurns: 0,
    autoRetried: new Set(),
  };
}

export function noteStumbleFailure(
  state: StumbleState,
  tool: string,
  error: string,
  opts?: { modelId?: string; autoLesson?: boolean }
): { signature: string; count: number; escalate: boolean; lessonId?: string } {
  const signature = normalizeErrorSignature(tool, error);
  const count = (state.counts.get(signature) || 0) + 1;
  state.counts.set(signature, count);
  state.lastSignature = signature;
  state.lastTool = tool;
  state.lastError = error;
  state.hadFailure = true;

  const max = stumbleMaxPerSignature();
  const escalate = count >= 2;
  let lessonId: string | undefined;

  // Learn on first failure (was: only after max hits — so nothing stuck in Brain).
  if (opts?.autoLesson !== false) {
    const lesson = recordLesson({
      signature,
      cause: scrubSecrets(error).slice(0, 400),
      fix: suggestedFixForFailure(tool, error),
      tools: [tool],
      tags: ['sticky', 'auto', 'stumble'],
      modelId: opts?.modelId,
    });
    lessonId = lesson.id;
    touchLesson(lesson.id);
    if (count === 1 || count >= max) {
      recordEpisode({
        kind: 'fail',
        summary: `${tool} failed ×${count}: ${scrubSecrets(error).slice(0, 200)}`,
        modelId: opts?.modelId,
        signature,
      });
    }
  }

  updateWorking({
    last_action: `${tool} failed`,
    next_step: escalate ? 'change approach after repeated failure' : 'diagnose and retry with different args',
    blockers: [scrubSecrets(error).slice(0, 200)],
  });

  return { signature, count, escalate, lessonId };
}

export function buildStumbleRetryPrompt(opts: {
  signature: string;
  count: number;
  escalate: boolean;
  tool: string;
  error: string;
  profile?: ModelProfile | null;
  modelId?: string;
}): string {
  const lessons = recallLessons({
    signature: opts.signature,
    query: `${opts.tool} ${opts.error}`,
    modelId: opts.modelId,
    limit: 3,
    includeSticky: true,
  });
  for (const l of lessons) touchLesson(l.id);

  const fix = suggestedFixForFailure(opts.tool, opts.error);
  const lines = [
    '',
    '[Caprigo stumble-to-walk]',
    `Tool \`${opts.tool}\` failed (signature hit #${opts.count}).`,
    `Error: ${scrubSecrets(opts.error).slice(0, 280)}`,
    `REQUIRED FIX: ${fix}`,
  ];
  if (opts.profile) {
    lines.push(`Model profile: ${profileOneLiner(opts.profile)}`);
  }
  if (lessons.length) {
    lines.push('Known lessons:');
    for (const l of lessons) {
      lines.push(`- ${l.cause.slice(0, 100)} → ${l.fix.slice(0, 100)}`);
    }
  }
  if (opts.escalate) {
    lines.push(
      'ESCALATE: same failure category twice+. Do NOT repeat identical arguments.',
      'In one line name the likely cause, then call a DIFFERENT tool or clearly different args.',
      'If truly blocked, set STATE: blocked with what the user must fix.'
    );
  } else {
    lines.push(
      'DIAGNOSE in one short line, then RETRY with a corrected tool call NOW.',
      'Do not ask the user whether to continue — stumble forward.'
    );
  }
  return lines.join('\n');
}

/** User-visible nudge (weak local models ignore system-only suffixes). */
export function buildStumbleRetryUserMessage(opts: {
  tool: string;
  error: string;
  count: number;
  escalate: boolean;
}): string {
  const fix = suggestedFixForFailure(opts.tool, opts.error);
  return [
    `[Caprigo stumble #${opts.count}] ${opts.tool} failed: ${scrubSecrets(opts.error).slice(0, 200)}`,
    `Do this now: ${fix}`,
    opts.escalate
      ? 'Change args or tool — identical retry is forbidden. Do not ask permission.'
      : 'Call the corrected tool immediately. Do not ask permission.',
  ].join('\n');
}

export function noteStumbleSuccess(
  state: StumbleState,
  opts?: { modelId?: string; action?: string; learnedFix?: string }
): void {
  if (!state.hadFailure) {
    updateWorking({
      last_action: opts?.action || 'ok',
      next_step: undefined,
      blockers: [],
    });
    return;
  }
  updateWorking({
    last_action: opts?.action || 'recovered after stumble',
    next_step: undefined,
    blockers: [],
  });
  if (state.lastSignature) {
    const lessons = recallLessons({ signature: state.lastSignature, limit: 1, includeSticky: true });
    if (lessons[0]) touchLesson(lessons[0].id);
    // Strengthen lesson with what actually worked
    if (opts?.learnedFix || state.lastTool) {
      recordLesson({
        signature: state.lastSignature,
        cause: scrubSecrets(state.lastError || 'tool failed').slice(0, 400),
        fix: (opts?.learnedFix || suggestedFixForFailure(state.lastTool || 'tool', state.lastError || '')).slice(
          0,
          400
        ),
        tools: state.lastTool ? [state.lastTool] : [],
        tags: ['sticky', 'auto', 'stumble', 'recovered'],
        modelId: opts?.modelId,
      });
    }
  }
  recordEpisode({
    kind: 'success',
    summary: opts?.action || 'recovered after tool failure',
    modelId: opts?.modelId,
    signature: state.lastSignature,
  });
  state.hadFailure = false;
}

export function recordBlockedLesson(opts: {
  summary: string;
  tools?: string[];
  modelId?: string;
  signature?: string;
}): void {
  const sig =
    opts.signature ||
    normalizeErrorSignature('blocked', opts.summary);
  recordLesson({
    signature: sig,
    cause: scrubSecrets(opts.summary).slice(0, 400),
    fix: 'Unblock with user input, install missing dep, or change strategy; do not loop the same failure.',
    tools: opts.tools || [],
    tags: ['blocked', 'auto', 'sticky'],
    modelId: opts.modelId,
  });
  recordEpisode({
    kind: 'blocked',
    summary: scrubSecrets(opts.summary).slice(0, 300),
    modelId: opts.modelId,
    signature: sig,
  });
  updateWorking({
    last_action: 'blocked',
    blockers: [scrubSecrets(opts.summary).slice(0, 200)],
    next_step: 'wait for user or change strategy',
  });
}
