/**
 * Caprigo Brain — structured working memory + lessons + short episodes.
 * File: <caprigoDataRoot>/brain.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { caprigoDataRoot } from '@caprigo/shared';
import { invalidateMemoryCache, upsertMemoryKey } from './skills/memory';

export type BrainWorking = {
  goal?: string;
  last_action?: string;
  next_step?: string;
  blockers?: string[];
  updatedAt?: number;
};

export type BrainLesson = {
  id: string;
  signature: string;
  cause: string;
  fix: string;
  tools: string[];
  tags: string[];
  modelId?: string;
  hits: number;
  createdAt: number;
  lastUsedAt: number;
};

export type BrainEpisode = {
  id: string;
  kind: 'fail' | 'success' | 'blocked' | 'dialect_flip';
  summary: string;
  modelId?: string;
  signature?: string;
  at: number;
};

export type BrainStore = {
  working: BrainWorking;
  lessons: BrainLesson[];
  episodes: BrainEpisode[];
};

const MAX_LESSONS = 200;
const MAX_EPISODES = 50;

function brainPath(): string {
  return path.join(caprigoDataRoot(), 'brain.json');
}

function emptyBrain(): BrainStore {
  return { working: {}, lessons: [], episodes: [] };
}

let cache: BrainStore | null = null;

export function scrubSecrets(text: string): string {
  return String(text || '')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9]{8,}/g, 'sk-***')
    .replace(/(password|passwd|pwd|api[_-]?key|token)\s*[=:]\s*\S+/gi, '$1=***')
    .slice(0, 800);
}

export function loadBrain(): BrainStore {
  if (cache) return cache;
  try {
    const p = brainPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<BrainStore>;
      cache = {
        working: raw.working && typeof raw.working === 'object' ? raw.working : {},
        lessons: Array.isArray(raw.lessons) ? raw.lessons : [],
        episodes: Array.isArray(raw.episodes) ? raw.episodes : [],
      };
      return cache;
    }
  } catch {
    /* ignore */
  }
  cache = emptyBrain();
  return cache;
}

function saveBrain(store: BrainStore): void {
  cache = store;
  try {
    const p = brainPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    /* best-effort */
  }
}

export function resetWorkingMemory(): BrainWorking {
  const store = loadBrain();
  store.working = { updatedAt: Date.now() };
  saveBrain(store);
  return store.working;
}

export function updateWorking(patch: Partial<BrainWorking>): BrainWorking {
  const store = loadBrain();
  const blockers =
    patch.blockers !== undefined
      ? patch.blockers.map(b => scrubSecrets(String(b))).slice(0, 8)
      : store.working.blockers;
  store.working = {
    ...store.working,
    ...patch,
    goal: patch.goal !== undefined ? scrubSecrets(String(patch.goal)).slice(0, 400) : store.working.goal,
    last_action:
      patch.last_action !== undefined
        ? scrubSecrets(String(patch.last_action)).slice(0, 400)
        : store.working.last_action,
    next_step:
      patch.next_step !== undefined
        ? scrubSecrets(String(patch.next_step)).slice(0, 400)
        : store.working.next_step,
    blockers,
    updatedAt: Date.now(),
  };
  saveBrain(store);
  return store.working;
}

function lessonId(signature: string): string {
  return crypto.createHash('sha1').update(signature).digest('hex').slice(0, 12);
}

export function recordLesson(input: {
  signature: string;
  cause: string;
  fix: string;
  tools?: string[];
  tags?: string[];
  modelId?: string;
  syncMemory?: boolean;
}): BrainLesson {
  const store = loadBrain();
  const signature = scrubSecrets(input.signature).slice(0, 160).toLowerCase();
  const id = lessonId(signature);
  const now = Date.now();
  const existing = store.lessons.find(l => l.id === id || l.signature === signature);
  let lesson: BrainLesson;
  if (existing) {
    existing.cause = scrubSecrets(input.cause).slice(0, 400) || existing.cause;
    existing.fix = scrubSecrets(input.fix).slice(0, 400) || existing.fix;
    existing.tools = [...new Set([...(existing.tools || []), ...(input.tools || [])])].slice(0, 12);
    existing.tags = [...new Set([...(existing.tags || []), ...(input.tags || [])])].slice(0, 12);
    if (input.modelId) existing.modelId = input.modelId;
    existing.hits = (existing.hits || 0) + 1;
    existing.lastUsedAt = now;
    lesson = existing;
  } else {
    lesson = {
      id,
      signature,
      cause: scrubSecrets(input.cause).slice(0, 400),
      fix: scrubSecrets(input.fix).slice(0, 400),
      tools: [...new Set(input.tools || [])].slice(0, 12),
      tags: [...new Set(input.tags || [])].slice(0, 12),
      modelId: input.modelId,
      hits: 1,
      createdAt: now,
      lastUsedAt: now,
    };
    store.lessons.unshift(lesson);
    if (store.lessons.length > MAX_LESSONS) store.lessons.length = MAX_LESSONS;
  }
  saveBrain(store);

  if (input.syncMemory !== false) {
    const key = `lesson_${id}`;
    upsertMemoryKey(key, {
      signature: lesson.signature,
      cause: lesson.cause,
      fix: lesson.fix,
      tools: lesson.tools,
      modelId: lesson.modelId,
    });
    invalidateMemoryCache();
  }
  return lesson;
}

export function touchLesson(idOrSignature: string): void {
  const store = loadBrain();
  const key = idOrSignature.toLowerCase();
  const hit = store.lessons.find(l => l.id === key || l.signature === key);
  if (!hit) return;
  hit.hits += 1;
  hit.lastUsedAt = Date.now();
  saveBrain(store);
}

export function recallLessons(opts: {
  query?: string;
  signature?: string;
  tags?: string[];
  modelId?: string;
  limit?: number;
  /** Always surface lessons tagged sticky/refusal/auto even without query match. */
  includeSticky?: boolean;
}): BrainLesson[] {
  const store = loadBrain();
  const limit = Math.min(10, Math.max(1, opts.limit ?? 5));
  const q = String(opts.query || '')
    .toLowerCase()
    .trim();
  const sig = String(opts.signature || '')
    .toLowerCase()
    .trim();
  const tags = (opts.tags || []).map(t => t.toLowerCase());
  const modelId = opts.modelId?.toLowerCase();
  const includeSticky = opts.includeSticky !== false;

  const scored = store.lessons.map(lesson => {
    let score = 0;
    const lessonTags = lesson.tags.map(x => x.toLowerCase());
    const sticky =
      lessonTags.includes('sticky') ||
      lessonTags.includes('refusal') ||
      lessonTags.includes('always');
    if (includeSticky && sticky) score += 40;
    if (sig && (lesson.signature === sig || lesson.signature.includes(sig) || sig.includes(lesson.signature))) {
      score += 50;
    }
    if (q) {
      const blob = `${lesson.signature} ${lesson.cause} ${lesson.fix} ${lesson.tags.join(' ')}`.toLowerCase();
      for (const part of q.split(/\s+/).filter(p => p.length > 2)) {
        if (blob.includes(part)) score += 8;
      }
    }
    if (tags.length) {
      for (const t of tags) {
        if (lessonTags.includes(t)) score += 10;
      }
    }
    if (modelId && lesson.modelId?.toLowerCase() === modelId) score += 5;
    score += Math.min(10, lesson.hits || 0);
    score += Math.max(0, 5 - Math.floor((Date.now() - (lesson.lastUsedAt || 0)) / (86400_000 * 7)));
    // Baseline so recent lessons still appear when query is empty or weak
    if (!q && !sig && !tags.length) score += 1;
    return { lesson, score, sticky };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || b.lesson.lastUsedAt - a.lesson.lastUsedAt)
    .slice(0, limit)
    .map(s => s.lesson);
}

/** Ensure core anti-refusal lessons exist (idempotent). */
export function ensureCoreLessons(): void {
  recordLesson({
    signature: 'knowledge_refusal_without_web_search',
    cause: 'Model claimed no information / no internet instead of using tools',
    fix: 'Call web_search with the user query, then web_fetch top URLs. Never refuse for lack of training data.',
    tools: ['web_search', 'web_fetch'],
    tags: ['sticky', 'auto', 'web', 'refusal'],
  });
  recordLesson({
    signature: 'local_events_need_web_search',
    cause: 'User asks for meetups/events/news/local info',
    fix: 'web_search first (Brave HTML), then web_fetch 1–2 links. Do not answer from memory alone.',
    tools: ['web_search', 'web_fetch'],
    tags: ['sticky', 'web', 'events'],
  });
  recordLesson({
    signature: 'wrong_tool_for_web_query',
    cause: 'Used search_files/list_directory for an internet question',
    fix: 'Use web_search for world knowledge; search_files only for repo/code text.',
    tools: ['web_search'],
    tags: ['sticky', 'auto', 'web', 'refusal'],
  });
  recordLesson({
    signature: 'os_ui_needs_desktop_screenshot_loop',
    cause: 'OS / native-app UI tasks without seeing the screen or focusing the window',
    fix: 'desktop_screenshot with ocr:true (or desktop_ocr/desktop_find) → decide from blocks → desktop_focus then desktop_click(cx,cy)/desktop_type/desktop_hotkey → screenshot+ocr to verify. Prefer browser_* for URLs; execute_command for terminal.',
    tools: [
      'desktop_screenshot',
      'desktop_ocr',
      'desktop_find',
      'desktop_focus',
      'desktop_windows',
      'desktop_click',
      'desktop_type',
      'desktop_hotkey',
    ],
    tags: ['sticky', 'auto', 'desktop', 'body', 'ocr'],
  });
  recordLesson({
    signature: 'desktop_type_into_wrong_window',
    cause: 'Typed into IDE/HUD because focus was stolen or Notepad was never activated',
    fix: 'Call desktop_focus with the app title (click:true) immediately before desktop_type; prefer paste:true for reliability; OCR-verify the marker text. Never type without focus.',
    tools: ['desktop_focus', 'desktop_type', 'desktop_windows', 'desktop_screenshot'],
    tags: ['sticky', 'auto', 'desktop', 'body'],
  });
  recordLesson({
    signature: 'write_file|enoent parent missing',
    cause: 'write_file failed because parent directory did not exist',
    fix: 'write_file auto-creates parent folders — retry same path with FULL content, or use generated/<file>. Never ask the user to continue.',
    tools: ['write_file'],
    tags: ['sticky', 'auto', 'stumble', 'files'],
  });
}

export function recordEpisode(ep: Omit<BrainEpisode, 'id' | 'at'> & { id?: string; at?: number }): void {
  const store = loadBrain();
  store.episodes.unshift({
    id: ep.id || crypto.randomBytes(4).toString('hex'),
    kind: ep.kind,
    summary: scrubSecrets(ep.summary).slice(0, 400),
    modelId: ep.modelId,
    signature: ep.signature ? scrubSecrets(ep.signature).slice(0, 160) : undefined,
    at: ep.at || Date.now(),
  });
  if (store.episodes.length > MAX_EPISODES) store.episodes.length = MAX_EPISODES;
  saveBrain(store);
}

/** Compact prompt block — hard-capped for 8k models. */
export function buildBrainPromptBlock(opts?: {
  query?: string;
  signature?: string;
  modelId?: string;
}): string {
  const store = loadBrain();
  const w = store.working;
  const lines: string[] = ['', '## Caprigo Brain', ''];

  const workingBits: string[] = [];
  if (w.goal) workingBits.push(`goal: ${String(w.goal).slice(0, 400)}`);
  if (w.last_action) workingBits.push(`last: ${String(w.last_action).slice(0, 200)}`);
  if (w.next_step) workingBits.push(`next: ${String(w.next_step).slice(0, 200)}`);
  if (w.blockers?.length) workingBits.push(`blockers: ${w.blockers.slice(0, 3).join('; ').slice(0, 200)}`);
  if (workingBits.length) {
    lines.push('### Working memory', ...workingBits.map(b => `- ${b}`), '');
  } else {
    lines.push('### Working memory', '- (empty)', '');
  }

  const lessons = recallLessons({
    query: opts?.query,
    signature: opts?.signature,
    modelId: opts?.modelId,
    limit: 5,
    includeSticky: true,
  });
  if (lessons.length) {
    lines.push('### Lessons (MUST follow when relevant — these are hard-won corrections)');
    for (const l of lessons) {
      const one = `- [${l.signature}] ${l.fix.slice(0, 160)}`.slice(0, 200);
      lines.push(one);
    }
    lines.push('');
    lines.push(
      'If a lesson says to call a tool, call that tool before answering. Do not restate the old refusal.'
    );
    lines.push('');
  }
  return lines.join('\n');
}

export function brainStatusSummary(): {
  working: BrainWorking;
  lessonCount: number;
  recentLessons: BrainLesson[];
  recentEpisodes: BrainEpisode[];
} {
  const store = loadBrain();
  return {
    working: store.working,
    lessonCount: store.lessons.length,
    recentLessons: store.lessons.slice(0, 5),
    recentEpisodes: store.episodes.slice(0, 5),
  };
}
