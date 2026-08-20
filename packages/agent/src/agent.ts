/**
 * Agent - the engine core. Handles sessions, skills, and LLM conversation.
 */

import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  caprigoEnv,
  caprigoDataRoot,
  caprigoWorkspaceRoot,
  normalizeFleetAssignment,
  OPTIMIZATION_PRESETS,
  resolvePathUnderWorkspaceRoot,
  type AgentConfig,
  type Session,
  type Skill,
  type Message,
  type ChatLLMBackend,
  type UnifiedChatMessage,
  type UnifiedChatRequest,
  type UnifiedChatResponse,
  type AgentActivityEvent,
  type ChatStreamEvent,
  type OrchestrationKind,
  type TaskState,
} from '@caprigo/shared';
import { parseToolArguments, skillToOllamaTool } from './tool-schema';
import { logSkillExecution } from './execution-log';
import {
  parseEmbeddedJsonToolCalls as parseEmbeddedToolDialect,
  parseLegacyToolCall,
  resolveSkillName,
  stripEmbeddedToolNoise,
} from './tool-dialect';
import {
  buildBrainPromptBlock,
  ensureCoreLessons,
  recordEpisode,
  recordLesson,
  resetWorkingMemory,
  touchLesson,
  updateWorking,
} from './brain';
import {
  createStumbleState,
  buildStumbleRetryPrompt,
  buildStumbleRetryUserMessage,
  noteStumbleFailure,
  noteStumbleSuccess,
  recordBlockedLesson,
  stumbleEnabled,
  stumbleVerifyMax,
} from './stumble';
import { writeAutoBugReport } from './bug-report';
import {
  contentHasEmbeddedTools,
  coreToolNames,
  ensureModelProfile,
  getCachedProfile,
  looksLikeDesktopRefusal,
  looksLikeDialectRefusal,
  looksLikeKnowledgeRefusal,
  observeDialectFlip,
  profileOneLiner,
  promoteProfileAfterSuccess,
  resolveToolMode,
  shouldUseCoreToolsOnly,
  suggestedDesktopLaunchCommand,
  usedDesktopTools,
  usedOnlyLocalSearch,
  usedWebTools,
  userLikelyNeedsDesktop,
  userLikelyNeedsWeb,
  type ModelProfile,
} from './model-profile';
import { desktopDisabled, desktopPlatformOk } from './skills/desktop';
import {
  actionCardPromptBlock,
  parseActionCard,
} from './action-card';
import {
  compileMission,
  createMissionRuntime,
  formatHomeDoneAnswer,
  homeAutoDrainEnabled,
  homeEnabled,
  missionSystemSuffix,
  noteToolSuccess,
  proposeNextActions,
  verifyMission,
  type MissionRuntime,
  type MissionStep,
} from './harness-mission';
import {
  seedTodosFromMissionSteps,
  TodoStore,
} from './todo-store';
import { bindTodoStoreResolver } from './skills/todo';
import {
  buildEmptyAfterToolsNudge,
  buildNarrationStopNudge,
  looksLikeIntentNarration,
} from './hermes-recovery';
import {
  compactMessagesForInference,
  fastModelId,
} from './prompt-brief';

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n… (truncated)';
}

/** Compact one-line preview of tool args for HUD cards. */
function toolArgsPreview(name: string, args: Record<string, unknown>): string {
  const pathVal = toolPathArg(args);
  const base = pathVal ? path.basename(pathVal) : '';
  if (name === 'hash_edit') {
    const edits = Array.isArray(args.edits) ? args.edits : [];
    const first = edits[0] as { anchor?: string; action?: string } | undefined;
    const bit = first ? `${first.action || 'edit'} ${first.anchor || ''}`.trim() : `${edits.length} edits`;
    return [base, bit].filter(Boolean).join(' · ');
  }
  if (name === 'search_replace') {
    const oldS = String(args.old_string ?? '').slice(0, 40).replace(/\s+/g, ' ');
    return [base, oldS ? `«${oldS}»` : ''].filter(Boolean).join(' · ');
  }
  if (name === 'write_file' || name === 'read_file') {
    return pathVal || base || name;
  }
  if (name === 'execute_command' || name === 'shell') {
    return String(args.command ?? args.cmd ?? '').slice(0, 80);
  }
  if (name === 'search_files') {
    return String(args.query ?? '').slice(0, 60);
  }
  if (base) return base;
  try {
    return truncate(JSON.stringify(args), 80).replace(/\n/g, ' ');
  } catch {
    return name;
  }
}

function toolPathArg(args: Record<string, unknown>): string {
  if (typeof args.path === 'string') return args.path;
  if (typeof args.root === 'string') return args.root;
  if (typeof args.file === 'string') return args.file;
  return '';
}

function toolResultSummary(name: string, result: unknown, ok: boolean): string {
  if (!ok) {
    if (result && typeof result === 'object' && (result as any).error) {
      return String((result as any).error).slice(0, 120);
    }
    return 'failed';
  }
  if (!result || typeof result !== 'object') return 'done';
  const r = result as Record<string, unknown>;
  if (name === 'hash_edit' && r.edits_applied != null) {
    return `${r.edits_applied} edit(s)`;
  }
  if (name === 'search_replace' && r.replacements != null) {
    return `${r.replacements} replacement(s)`;
  }
  if (name === 'write_file') return 'written';
  if (name === 'web_search') {
    const related = Array.isArray(r.related) ? r.related.length : 0;
    const src = r.source ? String(r.source) : 'web';
    return related ? `${related} hits (${src})` : String(r.summary || 'searched').slice(0, 80);
  }
  if (name === 'read_file') {
    const c = String(r.content ?? '');
    const lines = c ? c.split('\n').length : 0;
    return r.annotated ? `${lines} lines (hashed)` : lines ? `${lines} lines` : 'read';
  }
  if (typeof r.message === 'string') return r.message.slice(0, 100);
  return 'done';
}

/** Shrink desktop_screenshot(+ocr) payload for the model prompt. */
function compactDesktopSightResult(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  const blocksRaw = Array.isArray(r.blocks)
    ? r.blocks
    : r.ocr && typeof r.ocr === 'object' && Array.isArray((r.ocr as Record<string, unknown>).blocks)
      ? ((r.ocr as Record<string, unknown>).blocks as unknown[])
      : [];
  const maxBlocks = Math.max(
    8,
    Math.min(24, Number(process.env.CAPRIGO_OCR_PROMPT_BLOCKS || 16) || 16)
  );
  const blocks = blocksRaw.slice(0, maxBlocks).map(b => {
    if (!b || typeof b !== 'object') return b;
    const o = b as Record<string, unknown>;
    return {
      text: String(o.text || '').slice(0, 48),
      cx: o.cx,
      cy: o.cy,
    };
  });
  return {
    success: r.success !== false,
    path: r.path,
    width: r.width,
    height: r.height,
    cursor: r.cursor,
    ocr_engine: r.ocr_engine || (r.ocr as Record<string, unknown> | undefined)?.engine,
    block_count: blocksRaw.length,
    blocks,
    note: 'Use block cx,cy with desktop_click. desktop_focus before desktop_type.',
  };
}

function leanPromptsEnabled(): boolean {
  const raw = String(process.env.CAPRIGO_LEAN_PROMPTS ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

/** Mission-kind tool allowlist — smaller tools[] = much faster LMS prefills. */
function missionToolAllowlist(kind: string | undefined): Set<string> | null {
  if (!kind) return null;
  const common = ['todo', 'brain_recall', 'brain_status', 'current_datetime'];
  switch (kind) {
    case 'desktop_ui':
      return new Set([
        ...common,
        'desktop_screenshot',
        'desktop_ocr',
        'desktop_find',
        'desktop_focus',
        'desktop_windows',
        'desktop_click',
        'desktop_move',
        'desktop_type',
        'desktop_hotkey',
        'desktop_key',
        'execute_command',
        'clipboard_read',
        'clipboard_write',
      ]);
    case 'web_lookup':
      return new Set([...common, 'web_search', 'web_fetch', 'http_get']);
    case 'file_write':
      return new Set([
        ...common,
        'write_file',
        'read_file',
        'list_directory',
        'hash_edit',
        'search_replace',
      ]);
    case 'browser':
      return new Set([
        ...common,
        'browser_navigate',
        'browser_snapshot',
        'browser_click',
        'browser_type',
        'browser_press',
        'browser_wait',
        'browser_screenshot',
      ]);
    case 'shell':
      return new Set([...common, 'execute_command', 'system_info', 'list_directory', 'read_file']);
    default:
      return null;
  }
}

/** Turn web_search skill payload into a direct user answer when the model still refuses. */
function formatWebSearchUserAnswer(result: unknown, query: string): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r.success === false) {
    return `Search failed for “${query}”: ${String(r.error || 'unknown error')}`;
  }
  const related = Array.isArray(r.related) ? (r.related as Array<{ text?: string; url?: string }>) : [];
  if (related.length) {
    const lines = related.slice(0, 10).map((item, i) => {
      const title = String(item.text || 'Result').trim();
      const url = String(item.url || '').trim();
      return url ? `${i + 1}. ${title}\n   ${url}` : `${i + 1}. ${title}`;
    });
    return `Here are web results for “${query}”:\n\n${lines.join('\n\n')}`;
  }
  const summary = String(r.summary || '').trim();
  if (summary.length > 40) return summary;
  return null;
}

function wroteFilesThisTurn(tools: string[]): boolean {
  return tools.some(t => /^(write_file|search_replace|hash_edit)$/.test(t));
}

/** True when the last mutating edit has no later read_file (ACT without VERIFY). */
function needsPostWriteVerify(tools: string[]): boolean {
  const lastWrite = Math.max(
    tools.lastIndexOf('write_file'),
    tools.lastIndexOf('hash_edit'),
    tools.lastIndexOf('search_replace')
  );
  if (lastWrite < 0) return false;
  return tools.lastIndexOf('read_file') < lastWrite;
}

function postWriteVerifyPrompt(): string {
  return [
    '[Caprigo harness — VERIFY]',
    'You changed files but did not read them back. Before finishing:',
    '1. Call read_file on each path you wrote/edited.',
    '2. If content is incomplete, uses "..." stubs, or is wrong — fix with hash_edit or write_file.',
    '3. Then confirm briefly with the path(s). Do not ask the user to continue.',
  ].join('\n');
}

/** Detect useful code left only in the assistant message (no write_file). */
function looksLikeCodeDump(text: string): boolean {
  const fences = text.matchAll(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/g);
  for (const m of fences) {
    if ((m[1] || '').trim().length >= 40) return true;
  }
  if (/<\s*script[\s>]/i.test(text) && /THREE\.|three\.js|function\s+\w+\s*\(/i.test(text) && text.length > 180) {
    return true;
  }
  if (/^(import |from |def |class |const |let |function )/m.test(text) && text.split('\n').length >= 8) {
    return true;
  }
  return false;
}

/** Model hands control back instead of retrying after a tool failure. */
function looksLikeConfirmationAsk(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  return (
    /would you like me to (try|continue|proceed|retry)/.test(t) ||
    /shall i (try|continue|proceed|retry)/.test(t) ||
    /want me to (try|continue|proceed|retry)/.test(t) ||
    /should i (try|continue|proceed|retry)/.test(t)
  );
}

function codeDumpRecoveryPrompt(): string {
  return [
    'SYSTEM: You dumped code into chat without calling write_file. Caprigo always saves code with the write_file tool — you are not blocked from writing files.',
    'Immediately call write_file now:',
    '- Pick a clear path under generated/ or scripts/ (HTML/Three.js → .html, Node → .js, Python → .py).',
    '- Put the FULL file contents in the write_file content argument.',
    'Do not say you cannot write files. Do not paste the full program into chat again — tool call only, then one short confirmation with the path.',
  ].join('\n');
}

/** Short user approvals that should advance work, not restart planning. */
function isAffirmationContinue(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/g, '');
  return /^(y|ya|ye|yes|yeah|yep|yup|sure|ok|okay|k|continue|go on|go ahead|proceed|do it|keep going|keep on|next|please continue|sounds good|affirmative|alright|all right)$/i.test(
    t
  );
}

function affirmationContinueDirective(raw: string): string {
  return [
    raw.trim(),
    '',
    '[Caprigo directive] The user approved continuation.',
    '- Do NOT repeat prior reasoning, plans, or the same tool sequence.',
    '- Take the next concrete NEW step with tools now.',
    '- Never ask whether to continue — keep working until done or blocked.',
  ].join('\n');
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = caprigoEnv(name);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function loadMemoryStore(): MemoryStore {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
      const parsed = JSON.parse(raw) as MemoryStore;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // ignore corrupt or unreadable memory file
  }
  return {};
}

function saveMemoryStore(store: MemoryStore): void {
  try {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    const tmp = `${MEMORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, MEMORY_FILE);
  } catch {
    // best effort
  }
}

function safeHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

const AGENT_INSTRUCTIONS_MAX_CHARS = envInt('AGENT_INSTRUCTIONS_MAX_CHARS', 24_000, 1_000, 200_000);
const AGENT_INLINE_INSTRUCTIONS_MAX_CHARS = envInt('INLINE_INSTRUCTIONS_MAX_CHARS', 12_000, 500, 100_000);
const GLOBAL_PROGRAM_GUIDE_MAX_CHARS = envInt('PROGRAM_GUIDE_MAX_CHARS', 16_000, 1_000, 200_000);
const HISTORY_RECENT_MESSAGES = envInt('HISTORY_RECENT_MESSAGES', 12, 4, 40);
const HISTORY_SUMMARY_MAX_CHARS = envInt('HISTORY_SUMMARY_MAX_CHARS', 6_000, 500, 40_000);
const TOOL_RESULT_MAX_CHARS = envInt('TOOL_RESULT_MAX_CHARS', 4_000, 300, 100_000);
const GLOBAL_PROGRAM_GUIDE_DEFAULT_PATH = 'CAPRIGO_LLM_GUIDE.md';
const MEMORY_FILE = path.join(caprigoDataRoot(), 'memory.json');

type MemoryStore = Record<string, { value: unknown; timestamp: number }>;

export type TurnStats = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCalls: number;
  tools: string[];
  elapsedMs: number;
};

export class Agent {
  private config: AgentConfig;
  private backend: ChatLLMBackend;
  private skills = new Map<string, Skill>();
  private sessions = new Map<string, Session>();
  /** Default when neither laptop nor harness overrides apply. */
  private readonly maxToolIterations = 8;
  /** Long-horizon CLI harness defaults (override via AgentConfig / env). */
  private readonly harnessToolIterations = 48;
  private readonly harnessTaskIterations = 40;
  private nativeToolsFailed = false;
  private activitySink?: (e: AgentActivityEvent) => void;
  /** Per-session cache: resolved abs path + mtime → loaded instruction text. */
  private instructionFileCache = new Map<
    string,
    { abs: string; mtimeMs: number; text: string; error?: string }
  >();
  /** Cached global Caprigo guide injected into every LLM session when present. */
  private globalProgramGuideCache?: { abs: string; mtimeMs: number; text: string; error?: string };
  /** User requested stop for in-flight `processMessage` (workspace Stop button). */
  private turnCancelRequested = new Set<string>();
  /** Mid-turn operator guidance (Hermes-style STEER) — drained after next tool boundary. */
  private turnSteerQueue = new Map<string, string[]>();
  private turnsInFlight = new Set<string>();
  /** Stats from the most recent `processMessage` (for CLI / API meta). */
  private lastTurnStats: TurnStats | null = null;
  /** Active model dialect profile for this agent (Model Grapple). */
  private activeProfile: ModelProfile | null = null;
  /** Per-session Hermes-style todo lists. */
  private todoStores = new Map<string, TodoStore>();

  constructor(config: AgentConfig, backend: ChatLLMBackend) {
    this.config = config;
    this.backend = backend;
    bindTodoStoreResolver(sessionId => {
      if (!sessionId) return null;
      return this.getTodoStore(sessionId);
    });
  }

  getTodoStore(sessionId: string): TodoStore {
    let s = this.todoStores.get(sessionId);
    if (!s) {
      s = new TodoStore();
      this.todoStores.set(sessionId, s);
    }
    return s;
  }

  getActiveProfile(): ModelProfile | null {
    return this.activeProfile || getCachedProfile(this.config.model || '');
  }

  /** Resolve/refresh model profile (handshake optional). */
  async ensureProfile(opts?: { forceProbe?: boolean }): Promise<ModelProfile> {
    const model = this.config.model || 'local-model';
    const openAiBase =
      process.env.OPENAI_BASE_URL?.trim() ||
      process.env.OPENAI_API_BASE?.trim() ||
      undefined;
    const profile = await ensureModelProfile(model, {
      forceProbe: opts?.forceProbe,
      openAiBaseUrl: openAiBase,
      chat: async req => {
        const res = await this.backend.chat({
          model: req.model,
          messages: req.messages,
          maxTokens: req.max_tokens || 16,
          temperature: 0,
        });
        return res.message?.content || '';
      },
    });
    this.activeProfile = profile;
    return profile;
  }

  /** Clear session working memory in Caprigo Brain (lessons/profiles persist). */
  clearBrainWorking(): void {
    resetWorkingMemory();
  }

  getLastTurnStats(): TurnStats | null {
    return this.lastTurnStats ? { ...this.lastTurnStats, tools: [...this.lastTurnStats.tools] } : null;
  }

  /** Live task cards / orchestration UI (optional). */
  setActivitySink(sink: ((e: AgentActivityEvent) => void) | undefined): void {
    this.activitySink = sink;
  }

  private emitActivity(e: AgentActivityEvent): void {
    try {
      this.activitySink?.(e);
    } catch {
      // never break the agent on UI
    }
  }

  getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  getLLMProviderId(): string {
    return this.backend.providerId;
  }

  /** Swap the active LLM backend without recreating sessions or skills. */
  setLLMBackend(backend: ChatLLMBackend): void {
    this.backend = backend;
    this.nativeToolsFailed = false;
  }

  registerSkill(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  unregisterSkill(name: string): boolean {
    return this.skills.delete(name);
  }

  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  async executeSkill(
    name: string,
    params: any,
    ctx?: { sessionId?: string }
  ): Promise<any> {
    const skill = this.skills.get(name);
    const started = Date.now();
    if (!skill) {
      const err = { success: false, error: `Unknown skill: ${name}` };
      logSkillExecution(name, params, started, err, ctx?.sessionId);
      return err;
    }
    if (ctx?.sessionId) {
      const sess = this.sessions.get(ctx.sessionId);
      if (sess) {
        const allowed = new Set(this.getSkillsForSession(sess).map(s => s.name));
        if (!allowed.has(name)) {
          const err = { success: false, error: `Skill not allowed for this session: ${name}` };
          logSkillExecution(name, params, started, err, ctx.sessionId);
          return err;
        }
      }
    }
    try {
      const result = await skill.execute(params || {}, ctx);
      logSkillExecution(name, params, started, result, ctx?.sessionId);
      return result;
    } catch (e: any) {
      logSkillExecution(name, params, started, { success: false, error: e?.message || String(e) }, ctx?.sessionId);
      throw e;
    }
  }

  /** Run one HOME bootstrap / auto-pick step with HUD task cards + prompt injection. */
  private async runHarnessStep(
    sessionId: string,
    step: MissionStep,
    toolsUsed: string[],
    messages: UnifiedChatMessage[],
    opts?: {
      assistantContent?: string;
      resultTransform?: (r: unknown) => unknown;
      emitBootstrap?: boolean;
    }
  ): Promise<{ ok: boolean; result: unknown }> {
    const taskId = uuidv4();
    const args = (step.args || {}) as Record<string, unknown>;
    this.emitActivity({
      type: 'task_start',
      sessionId,
      taskId,
      label: step.label || step.tool,
      tool: step.tool,
      argsPreview: toolArgsPreview(step.tool, args).slice(0, 80),
      path: toolPathArg(args) || undefined,
    });
    let result: unknown;
    try {
      result = await this.executeSkill(step.tool, args, { sessionId });
    } catch (err) {
      result = this.toToolErrorResult(err);
    }
    toolsUsed.push(step.tool);
    const ok = !(
      result &&
      typeof result === 'object' &&
      (result as Record<string, unknown>).success === false
    );
    if (ok) this.getTodoStore(sessionId).markToolDone(step.tool);
    this.emitActivity({
      type: 'task_end',
      sessionId,
      taskId,
      ok,
      detail: !ok ? String((result as Record<string, unknown>).error || 'failed') : undefined,
      summary: toolResultSummary(step.tool, result, ok),
    });
    if (opts?.emitBootstrap !== false) {
      this.emitActivity({
        type: 'mission_bootstrap',
        sessionId,
        tool: step.tool,
        ok,
      });
    }
    if (opts?.assistantContent != null) {
      messages.push({ role: 'assistant', content: opts.assistantContent });
    }
    const payload = opts?.resultTransform ? opts.resultTransform(result) : result;
    messages.push({
      role: 'tool',
      tool_call_id: `home_${step.tool}_${taskId.slice(0, 8)}`,
      tool_name: step.tool,
      content: this.formatToolResultForPrompt(payload),
    });
    return { ok, result };
  }

  async createSession(): Promise<Session> {
    const session: Session = {
      id: uuidv4(),
      agentId: this.config.id,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assignedOfflineScripts: [],
      runtimeMode: 'llm',
      agentRole: 'agent',
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Model id used for LLM calls for this session (per-session override or engine default). */
  modelForSession(session: Session): string {
    const m = session.model?.trim();
    return m || this.config.model;
  }

  /** CAPRIGO_HARNESS_MODE=1 (default on) enables long-horizon budgets unless laptopMode. */
  private envHarnessMode(): boolean {
    const raw = String(process.env.CAPRIGO_HARNESS_MODE ?? '1').trim().toLowerCase();
    if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
    return true;
  }

  /**
   * Treat the next user turn as a sticky mission: set objective and keep looping until done/blocked.
   */
  enableMissionLoop(sessionId: string, objective: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const t = objective.trim();
    if (!t) throw new Error('Mission objective required');
    session.objective = t;
    session.taskStartedAt = Date.now();
    session.taskState = 'continue';
    session.updatedAt = Date.now();
    updateWorking({ goal: t, next_step: 'start mission', blockers: [] });
  }

  clearMissionLoop(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.objective = undefined;
    session.homeMissionKind = undefined;
    session.homePlaybookId = undefined;
    session.taskState = undefined;
    session.taskSummary = undefined;
    session.taskCheckpointAt = undefined;
    session.taskStartedAt = undefined;
    session.updatedAt = Date.now();
  }

  setSessionModel(sessionId: string, model: string | null | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const t = model?.trim();
    session.model = t || undefined;
    session.updatedAt = Date.now();
  }

  /**
   * Lean tool set for CAPRIGO_BOX_PROFILE / laptopMode when session has no whitelist.
   * Keeps Ollama tool schemas small enough for 4k ctx on 16GB UMA boxes.
   */
  private boxDefaultSkillNames(): Set<string> {
    const fromEnv = process.env.CAPRIGO_BOX_SKILLS?.trim();
    const names = fromEnv
      ? fromEnv.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
      : [
          'read_file',
          'write_file',
          'list_directory',
          'search_files',
          'search_replace',
          'hash_edit',
          'list_file_changes',
          'repo_map',
          'execute_command',
          'current_datetime',
          'store_memory',
          'retrieve_memory',
          'list_memory_keys',
        ];
    return new Set(names);
  }

  /** Whitelist of skill names for this session, or all skills if unset / empty. */
  getSkillsForSession(session: Session): Skill[] {
    const all = this.getSkills();
    const pick = session.assignedSkills?.filter(Boolean);
    let skills: Skill[];
    if (pick?.length) {
      const set = new Set(pick);
      skills = all.filter(s => set.has(s.name));
    } else if (this.config.laptopMode) {
      const set = this.boxDefaultSkillNames();
      skills = all.filter(s => set.has(s.name));
    } else {
      skills = all;
    }
    const profile = this.activeProfile || getCachedProfile(this.config.model || '');
    if (profile && shouldUseCoreToolsOnly(profile)) {
      const core = coreToolNames();
      skills = skills.filter(s => core.has(s.name));
    }
    // HOME mission → only tools needed for that kind (big LMS prefill win).
    const allow = missionToolAllowlist(session.homeMissionKind);
    if (allow && allow.size > 0) {
      skills = skills.filter(s => allow.has(s.name));
      if (!skills.length) {
        // Safety: never send an empty tool list
        skills = all.filter(s => allow.has(s.name));
      }
    }
    return skills;
  }

  setSessionAssignedSkills(sessionId: string, names: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const valid = new Set(this.getSkills().map(s => s.name));
    const uniqInput = [...new Set(names.map(n => String(n).trim()).filter(Boolean))];
    const unknown = uniqInput.filter(n => !valid.has(n));
    if (unknown.length > 0) {
      throw new Error(`Unknown skills: ${unknown.join(', ')}`);
    }
    const uniq = uniqInput;
    session.assignedSkills = uniq.length > 0 ? uniq : undefined;
    session.updatedAt = Date.now();
  }

  setSessionRuntimeMode(sessionId: string, mode: 'llm' | 'offline'): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.runtimeMode = mode;
    session.updatedAt = Date.now();
  }

  setSessionAgentRole(sessionId: string, role: 'agent' | 'orchestrator'): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const wasOrchestrator = normalizeFleetAssignment(session.agentRole) === 'orchestrator';
    session.agentRole = role;
    if (role === 'orchestrator') {
      session.linkedOrchestratorId = undefined;
    } else if (wasOrchestrator) {
      for (const s of this.sessions.values()) {
        if (s.linkedOrchestratorId === sessionId) {
          s.linkedOrchestratorId = undefined;
          s.updatedAt = Date.now();
        }
      }
    }
    session.updatedAt = Date.now();
  }

  setSessionLinkedOrchestrator(sessionId: string, orchestratorSessionId: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (orchestratorSessionId === null || orchestratorSessionId === '') {
      session.linkedOrchestratorId = undefined;
    } else {
      if (!this.sessions.has(orchestratorSessionId)) {
        throw new Error(`Orchestrator session ${orchestratorSessionId} not found`);
      }
      if (orchestratorSessionId === sessionId) {
        throw new Error('An agent cannot report to itself');
      }
      const boss = this.sessions.get(orchestratorSessionId)!;
      if (normalizeFleetAssignment(boss.agentRole) !== 'orchestrator') {
        throw new Error('Fleet assignment of the target must be Orchestrator (not task agent)');
      }
      session.linkedOrchestratorId = orchestratorSessionId;
    }
    session.updatedAt = Date.now();
  }

  setSessionDescription(sessionId: string, value: string | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const t = value?.trim();
    session.description = t || undefined;
    session.updatedAt = Date.now();
  }

  setSessionObjective(sessionId: string, value: string | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const t = value?.trim();
    session.objective = t || undefined;
    session.taskStartedAt = session.objective ? Date.now() : undefined;
    session.updatedAt = Date.now();
    if (session.objective) {
      this.setSessionTaskProgress(sessionId, 'continue', undefined, Date.now());
    } else {
      this.setSessionTaskProgress(sessionId, undefined, undefined, undefined);
    }
  }

  private setSessionTaskProgress(
    sessionId: string,
    state: TaskState | undefined,
    summary?: string,
    checkpointAt?: number | undefined
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.taskState = state;
    session.taskSummary = summary !== undefined ? summary.trim() || undefined : undefined;
    session.taskCheckpointAt = checkpointAt;
    session.updatedAt = Date.now();
  }

  setSessionAgentInstructionsPath(sessionId: string, value: string | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const t = value?.trim();
    session.agentInstructionsPath = t || undefined;
    session.updatedAt = Date.now();
    this.instructionFileCache.delete(sessionId);
  }

  setSessionAgentInstructionsMarkdown(sessionId: string, value: string | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (value === undefined || value === null) {
      session.agentInstructionsMarkdown = undefined;
      session.updatedAt = Date.now();
      return;
    }
    let t = String(value).trim();
    if (t.length > AGENT_INLINE_INSTRUCTIONS_MAX_CHARS) {
      t = t.slice(0, AGENT_INLINE_INSTRUCTIONS_MAX_CHARS) + '\n… (truncated)';
    }
    session.agentInstructionsMarkdown = t || undefined;
    session.updatedAt = Date.now();
  }

  /** Request the current LLM turn to stop (best-effort; checked between tool iterations). */
  requestTurnCancel(sessionId: string): void {
    this.turnCancelRequested.add(sessionId);
  }

  /**
   * Inject operator guidance into an in-flight turn (Hermes STEER).
   * Applied after the next tool-result boundary. Returns false if no turn is running.
   */
  steerTurn(sessionId: string, guidance: string): boolean {
    const text = String(guidance || '').trim();
    if (!text || !this.turnsInFlight.has(sessionId)) return false;
    const q = this.turnSteerQueue.get(sessionId) || [];
    q.push(text.slice(0, 4000));
    this.turnSteerQueue.set(sessionId, q);
    this.emitActivity({ type: 'steer', sessionId, text: text.slice(0, 200) });
    return true;
  }

  private drainSteerIntoMessages(sessionId: string, messages: UnifiedChatMessage[]): void {
    const q = this.turnSteerQueue.get(sessionId);
    if (!q?.length) return;
    const batch = q.splice(0, q.length);
    const body = batch.map((g, i) => `${batch.length > 1 ? `${i + 1}. ` : ''}${g}`).join('\n');
    messages.push({
      role: 'user',
      content: [
        '[Caprigo STEER — trusted operator guidance for this turn]',
        body,
        'Adjust the plan to follow this. Prefer tools over narration.',
      ].join('\n'),
    });
  }

  /**
   * Load markdown instructions for system prompt (LLM sessions). Cached by mtime per session.
   */
  private loadAgentInstructionsBlock(session: Session): string {
    const rel = session.agentInstructionsPath?.trim();
    if (!rel) return '';
    const root = caprigoWorkspaceRoot();
    const abs = resolvePathUnderWorkspaceRoot(root, rel);
    if (!abs) {
      return `

## Agent instructions (file)
Could not resolve \`${rel}\` — path must stay under the workspace root (${root}).`;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch (e: any) {
      return `

## Agent instructions (file)
Could not read \`${rel}\`: ${e?.message || String(e)}`;
    }
    if (!st.isFile()) {
      return `

## Agent instructions (file)
Not a regular file: \`${rel}\``;
    }
    const hit = this.instructionFileCache.get(session.id);
    if (hit && hit.abs === abs && hit.mtimeMs === st.mtimeMs) {
      if (hit.error) {
        return `

## Agent instructions (file)
Could not read \`${rel}\`: ${hit.error}`;
      }
      return this.formatAgentInstructionsOk(rel, hit.text);
    }
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      const text =
        raw.length > AGENT_INSTRUCTIONS_MAX_CHARS
          ? raw.slice(0, AGENT_INSTRUCTIONS_MAX_CHARS) + '\n… (truncated)'
          : raw;
      this.instructionFileCache.set(session.id, { abs, mtimeMs: st.mtimeMs, text });
      return this.formatAgentInstructionsOk(rel, text);
    } catch (e: any) {
      const err = e?.message || String(e);
      this.instructionFileCache.set(session.id, { abs, mtimeMs: st.mtimeMs, text: '', error: err });
      return `

## Agent instructions (file)
Could not read \`${rel}\`: ${err}`;
    }
  }

  private formatAgentInstructionsOk(relPath: string, text: string): string {
    return `

## Agent instructions (markdown file)
The user assigned **${relPath}** (relative to the Caprigo workspace root). Follow these instructions for this session unless they conflict with safety or system policies; the user’s messages take precedence on a given turn.

${text}`;
  }

  private loadGlobalProgramGuideBlock(session: Session): string {
    if (session.runtimeMode === 'offline') return '';
    const root = caprigoWorkspaceRoot();
    const rel =
      caprigoEnv('LLM_GUIDE_PATH')?.trim() ||
      caprigoEnv('PROGRAM_GUIDE_PATH')?.trim() ||
      GLOBAL_PROGRAM_GUIDE_DEFAULT_PATH;
    const abs = resolvePathUnderWorkspaceRoot(root, rel);
    if (!abs) {
      return `

## Caprigo program guide
Configured guide path \`${rel}\` could not be resolved under the workspace root (${root}).`;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return '';
    }
    if (!st.isFile()) {
      return '';
    }
    const hit = this.globalProgramGuideCache;
    if (hit && hit.abs === abs && hit.mtimeMs === st.mtimeMs) {
      if (hit.error) {
        return `

## Caprigo program guide
Could not read \`${rel}\`: ${hit.error}`;
        }
      return this.formatGlobalProgramGuideOk(rel, hit.text);
    }
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      const text =
        raw.length > GLOBAL_PROGRAM_GUIDE_MAX_CHARS
            ? raw.slice(0, GLOBAL_PROGRAM_GUIDE_MAX_CHARS) + '\n... (truncated)'
            : raw;
      this.globalProgramGuideCache = { abs, mtimeMs: st.mtimeMs, text };
      return this.formatGlobalProgramGuideOk(rel, text);
    } catch (e: any) {
      const err = e?.message || String(e);
      this.globalProgramGuideCache = { abs, mtimeMs: st.mtimeMs, text: '', error: err };
      return `

## Caprigo program guide
Could not read \`${rel}\`: ${err}`;
    }
  }

  private formatGlobalProgramGuideOk(relPath: string, text: string): string {
    return `

## Caprigo program guide
Before acting, read and follow this Caprigo product/usage guide from **${relPath}** (relative to the Caprigo workspace root). Treat it as product-specific operating context for this machine and UI unless the user explicitly overrides a point.

${text}`;
  }

  private conversationLineForPrompt(m: Message): string | null {
    if (m.role === 'user') {
      return `- User: ${truncate(m.content.replace(/\s+/g, ' ').trim(), 240)}`;
    }
    if (m.role === 'assistant') {
      return `- Assistant: ${truncate(m.content.replace(/\s+/g, ' ').trim(), 240)}`;
    }
    if (m.role === 'orchestration' && m.orchestration) {
      const om = m.orchestration;
      const peer = om.peerLabel || `${om.peerSessionId.slice(0, 8)}...`;
      const dir = om.channel === 'out' ? 'to' : 'from';
      return `- Fleet ${om.kind} ${dir} ${peer}: ${truncate(m.content.replace(/\s+/g, ' ').trim(), 220)}`;
    }
    return null;
  }

  private buildCompactedHistoryBlock(messages: Message[]): string {
    const lines: string[] = [];
    let used = 0;
    for (const m of messages) {
      const line = this.conversationLineForPrompt(m);
      if (!line) continue;
      const next = used === 0 ? line.length : used + 1 + line.length;
      if (next > HISTORY_SUMMARY_MAX_CHARS) break;
      lines.push(line);
      used = next;
    }
    if (!lines.length) return '';
    return `Earlier conversation digest (${messages.length} older messages compressed). Use this as background only; the recent turns below are more important.\n${lines.join('\n')}`;
  }

  private buildPromptHistory(session: Session): UnifiedChatMessage[] {
    const taskStart = session.taskStartedAt ?? 0;
    const llmHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of session.messages) {
      if (taskStart && m.timestamp < taskStart) continue;
      if (m.role === 'user' || m.role === 'assistant') {
        llmHistory.push({ role: m.role, content: m.content });
      } else if (m.role === 'orchestration' && m.orchestration) {
        const om = m.orchestration;
        const peer = om.peerLabel || `${om.peerSessionId.slice(0, 8)}...`;
        const dir = om.channel === 'out' ? '->' : '<-';
        llmHistory.push({
          role: 'user',
          content: `[Fleet ${dir} ${peer} · ${om.kind}]\n${m.content}`,
        });
      }
    }

    if (llmHistory.length <= HISTORY_RECENT_MESSAGES) {
      return llmHistory.map(
        (m): UnifiedChatMessage => ({ role: m.role as 'user' | 'assistant', content: m.content })
      );
    }

    const recentHistory = llmHistory.slice(-HISTORY_RECENT_MESSAGES).map(
      (m): UnifiedChatMessage => ({ role: m.role as 'user' | 'assistant', content: m.content })
    );
    const olderCount = Math.max(0, session.messages.length - HISTORY_RECENT_MESSAGES);
    const digest = this.buildCompactedHistoryBlock(session.messages.slice(0, olderCount));
    return digest ? [{ role: 'system', content: digest }, ...recentHistory] : recentHistory;
  }

  private formatToolResultForPrompt(result: unknown): string {
    const raw = typeof result === 'string' ? result : JSON.stringify(result);
    if (!raw) return '';
    return truncate(raw, TOOL_RESULT_MAX_CHARS);
  }

  private loadInlineInstructionsBlock(session: Session): string {
    const raw = session.agentInstructionsMarkdown?.trim();
    if (!raw) return '';
    const text =
      raw.length > AGENT_INLINE_INSTRUCTIONS_MAX_CHARS
        ? raw.slice(0, AGENT_INLINE_INSTRUCTIONS_MAX_CHARS) + '\n... (truncated)'
        : raw;
    return `

## Task instructions (inline markdown)
Follow these for this session unless they conflict with safety or system policies.

${text}`;
  }

  /**
   * Injects card / builder description + objective into the system prompt so the model
   * treats them as mission scope and acceptance criteria (not just UI labels).
   */
  private buildSessionMissionBlock(session: Session): string {
    const desc = session.description?.trim();
    const obj = session.objective?.trim();
    if (!desc && !obj) return '';
    const parts: string[] = ['', '## Mission (from builder / agent card)', ''];
    if (desc) {
      parts.push(`**Summary:** ${desc}`, '');
    }
    if (obj) {
      parts.push(
        '**Objective / success criteria:**',
        obj,
        '',
        '*Treat this as the definition of “done” unless the user contradicts it on this turn. Prefer verifiable steps and state blockers early.*',
        ''
      );
    } else if (desc) {
      parts.push('*Stay scoped to the summary; ask if success criteria are ambiguous.*', '');
    }
    return parts.join('\n');
  }

  /**
   * Single-outcome focus, autonomy to choose tools, and explicit self-correction / learning rules.
   */
  private buildAutonomyAndResilienceBlock(session: Session): string {
    const obj = session.objective?.trim();
    const lines: string[] = ['', '## Autonomy & essential outcome', ''];
    if (obj) {
      lines.push(
        `**Primary deliverable:** ${obj}`,
        '',
        '- This is the **one essential outcome** for this session unless the user narrows or changes it on this turn.',
        '- You choose tools and ordering; work toward **done** = outcome satisfied with evidence, or a clear, justified blocker.',
        '- Prefer action (read, run, check) over long planning monologues.',
        ''
      );
    } else {
      lines.push(
        '- Infer the **single most important outcome** from the user’s latest message and prioritize it.',
        '- Use tools autonomously when they reduce uncertainty (files, commands, HTTP, memory).',
        ''
      );
    }
    lines.push(
      '## Self-correction & learning (stumble-to-walk)',
      '- If a tool returns `success: false` or an error, **do not** repeat the same call with identical arguments.',
      '- Briefly infer the cause (path, permissions, syntax, API shape), change inputs or strategy, then retry or switch tools.',
      '- If the same **category** of error happens twice, stop repeating; summarize for the user and propose alternatives.',
      '- Use Caprigo Brain: `brain_status` / `brain_remember` / `brain_recall` (and optional `store_memory`) so you remember goals and lessons across turns.',
      '- Prefer `save_skill_playbook` for reusable procedures; executable `create_skill` only when spawn is enabled.',
      '- After a successful lookup that previously failed, call `brain_remember` with a short lesson (signature + fix) so you do not refuse the same way again.',
      ''
    );
    return lines.join('\n');
  }

  private taskMemoryKey(session: Session): string | null {
    const objective = session.objective?.trim();
    if (!objective) return null;
    return `task:${safeHash(`${session.id}|${objective}`)}`;
  }

  private buildRelevantMemoryBlock(session: Session): string {
    const store = loadMemoryStore();
    const objective = session.objective?.trim();
    const objectiveHash = objective ? safeHash(objective) : null;
    const name = session.id?.trim();
    const matches: Array<{ key: string; value: unknown; timestamp: number }> = [];
    for (const [key, entry] of Object.entries(store)) {
      const v = entry.value as { objectiveHash?: unknown; agentName?: unknown; summary?: unknown } | undefined;
      const storedObjectiveHash = String(v?.objectiveHash || '').trim();
      const agentText = String(v?.agentName || '').trim().toLowerCase();
      if (objectiveHash && storedObjectiveHash && storedObjectiveHash === objectiveHash) {
        matches.push({ key, value: entry.value, timestamp: entry.timestamp });
        continue;
      }
      if (name && agentText && agentText === name.toLowerCase()) {
        matches.push({ key, value: entry.value, timestamp: entry.timestamp });
      }
    }
    if (matches.length === 0) return '';
    const lines = matches
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3)
      .map(item => {
        const raw = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
        const clipped = truncate(raw || '', 280).replace(/\n+/g, ' ');
        return `- ${item.key}: ${clipped}`;
      })
      .join('\n');
    return `

## Relevant memory
Use these remembered notes if they help this task:
${lines}`;
  }

  private persistTaskMemory(session: Session, state: 'continue' | 'done' | 'blocked' | null, summary: string): void {
    const key = this.taskMemoryKey(session);
    if (!key) return;
    const store = loadMemoryStore();
    const value = {
      sessionId: session.id,
      agentName: session.id || null,
      objective: session.objective?.trim() || null,
      objectiveHash: session.objective?.trim() ? safeHash(session.objective.trim()) : null,
      description: session.description?.trim() || null,
      state: state || 'continue',
      summary: truncate(summary.trim() || '(no summary)', 1200),
      updatedAt: new Date().toISOString(),
    };
    store[key] = { value, timestamp: Date.now() };
    saveMemoryStore(store);
  }

  private buildTransientToolFailureSuffix(): string {
    return `

### Priority note (this turn only)
The last tool batch included at least one **failure**. Read those tool results, adjust arguments or approach, then continue. Do not retry unchanged.`;
  }

  private buildProfilePromptLine(): string {
    const p = this.activeProfile || getCachedProfile(this.config.model || '');
    if (!p) return '';
    return `\n## Active model profile\n- ${profileOneLiner(p)}\n`;
  }

  setSessionPrimaryOfflineScript(sessionId: string, scriptId: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (scriptId === null || scriptId === '') {
      session.primaryOfflineScriptId = undefined;
    } else {
      session.primaryOfflineScriptId = scriptId;
    }
    session.updatedAt = Date.now();
  }

  /** Replace the list of linked offline script ids (e.g. builder-assigned history). */
  setSessionAssignedOfflineScripts(sessionId: string, ids: string[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const uniq = [...new Set(ids.map(x => String(x).trim()).filter(Boolean))];
    session.assignedOfflineScripts = uniq.length ? uniq : [];
    session.updatedAt = Date.now();
  }

  /**
   * Append paired orchestration lines to two sessions (visible in Chat + LLM context).
   */
  recordFleetExchange(
    fromSessionId: string,
    toSessionId: string,
    content: string,
    kind: OrchestrationKind,
    labels?: { fromLabel?: string; toLabel?: string }
  ): void {
    const from = this.sessions.get(fromSessionId);
    const to = this.sessions.get(toSessionId);
    if (!from || !to) throw new Error('Session not found');
    const ts = Date.now();

    const out: Message = {
      id: uuidv4(),
      role: 'orchestration',
      content,
      timestamp: ts,
      orchestration: {
        peerSessionId: toSessionId,
        peerLabel: labels?.toLabel,
        kind,
        channel: 'out',
      },
    };
    const inc: Message = {
      id: uuidv4(),
      role: 'orchestration',
      content,
      timestamp: ts,
      orchestration: {
        peerSessionId: fromSessionId,
        peerLabel: labels?.fromLabel,
        kind,
        channel: 'in',
      },
    };
    from.messages.push(out);
    to.messages.push(inc);
    from.updatedAt = ts;
    to.updatedAt = ts;

    this.emitActivity({
      type: 'orchestration_exchange',
      fromSessionId,
      toSessionId,
      kind,
      excerpt: content,
    });
  }

  private useNativeTools(): boolean {
    if (this.nativeToolsFailed) return false;
    const legacy = caprigoEnv('LEGACY_TOOLS_ONLY');
    if (legacy === '1' || legacy === 'true') return false;
    const profile = this.activeProfile || getCachedProfile(this.config.model || '');
    if (profile) {
      return resolveToolMode(profile).useNativeTools;
    }
    // Fallback before profile resolve
    if (this.preferEmbeddedToolDialectHeuristic()) return false;
    if (this.config.laptopMode) {
      const forceNative = process.env.CAPRIGO_FORCE_NATIVE_TOOLS?.trim();
      if (forceNative === '1' || forceNative === 'true') return true;
      return false;
    }
    return true;
  }

  /** Legacy name-heuristic (used only when no profile yet). */
  private preferEmbeddedToolDialectHeuristic(): boolean {
    const force = process.env.CAPRIGO_EMBEDDED_TOOLS?.trim();
    if (force === '1' || force === 'true') return true;
    if (force === '0' || force === 'false') return false;
    const model = String(this.config.model || '').toLowerCase();
    // Tool-use / FC models want OpenAI tools[] — do not force XML embedding.
    if (/tool-use|tool_use|function.?call|fc-|hermes-function/.test(model)) return false;
    return false;
  }

  private preferEmbeddedToolDialect(): boolean {
    const profile = this.activeProfile || getCachedProfile(this.config.model || '');
    if (profile) {
      const mode = resolveToolMode(profile);
      return mode.dialect === 'xml' || mode.dialect === 'legacy';
    }
    return this.preferEmbeddedToolDialectHeuristic();
  }

  private toolDialectFlavor(): 'openai' | 'xml' | 'legacy' {
    const profile = this.activeProfile || getCachedProfile(this.config.model || '');
    if (profile) return resolveToolMode(profile).dialect;
    return this.preferEmbeddedToolDialectHeuristic() ? 'xml' : 'openai';
  }

  private buildSystemPrompt(
    nativeTools: boolean,
    session: Session,
    ephemeralSuffix = '',
    turnQuery?: string
  ): string {
    const skills = this.getSkillsForSession(session);
    // Native tools[] already carry schemas — don't duplicate long descriptions in system (LMS prefill).
    const skillList =
      nativeTools && leanPromptsEnabled()
        ? skills.map(s => s.name).join(', ')
        : nativeTools
          ? skills.map(s => `- ${s.name}: ${String(s.description || '').slice(0, 100)}`).join('\n')
          : skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    const base = this.config.systemPrompt || 'You are a helpful AI assistant.';
    const envContext = leanPromptsEnabled()
      ? `

Environment: ${os.platform()}/${os.arch()} cwd=${process.cwd()} model=${this.config.model}
Rules: Use tools for real work. desktop_* = native UI (focus→act→screenshot). browser_* = URLs. web_search = world facts. write_file = code on disk. Never refuse Caprigo tools. Never ask to continue — ACT→VERIFY→done.`
      : `

Environment context:
- host_os: ${os.platform()} ${os.release()}
- cpu_arch: ${os.arch()}
- hostname: ${os.hostname()}
- cwd: ${process.cwd()}
- llm_provider: ${this.backend.providerId}
- default_model: ${this.config.model}
- laptop_mode: ${this.config.laptopMode ? 'on' : 'off'}

Behavior rules:
- Prefer short, tool-assisted steps over long speculative responses.`;
    const envContextLegacyTail = leanPromptsEnabled()
      ? ''
      : `
- You have a digital body on this machine: shell (execute_command), browser (browser_*), and desktop (desktop_* mouse/keyboard/screenshot on Windows). Never claim you cannot control the mouse, keyboard, or take a desktop screenshot when desktop skills are listed.
- Body routing:
  · Terminal / shell commands → execute_command (not typing into random windows unless the user asks for OS UI).
  · Web apps / URLs → browser_* (Playwright). Prefer browser_screenshot for page captures.
  · Native apps / anything outside Chromium → desktop_* . Loop: desktop_screenshot (ocr:true) or desktop_screenshot + desktop_ocr / desktop_find → desktop_click / desktop_type / desktop_hotkey → screenshot+ocr verify. Call desktop_focus (or desktop_windows) before typing so input does not hit Caprigo HUD. Use OCR block cx,cy for clicks — do not guess coordinates.
- You have write_file. Never claim you cannot create or save files. Put code on disk with write_file; do not dump full programs into chat.
- NEVER say you have "no direct information", "no access to the internet", or cannot look something up. Caprigo gives you web_search / web_fetch / browser. Call tools first; answer from tool results.
- If the user asks about events, meetups, news, people, places, docs, or anything outside this repo: web_search immediately (Brave HTML by default), then web_fetch only if a source needs more detail.
- Harness micro-loop (required for local models): ACT → VERIFY → CHURN.
  1. ACT: call tools (write_file / hash_edit / shell / desktop_*) to make progress.
  2. VERIFY: after edits, read_file the result (or run a quick check / desktop_screenshot). Do not trust memory of what you wrote.
  3. CHURN: if verify fails or work remains, fix and verify again — then stop. Never ask "shall I continue?".
- Never ask the user if they want you to continue, proceed, or keep going. Do the work; only stop when done, blocked, or you need a real decision (missing path, credentials, destructive confirm).
- If the user says yes / ok / continue / go ahead, treat it as approval to take the next NEW step. Do not restate prior reasoning or repeat the same plan.
- Search routing (critical): "search" alone is ambiguous.
  · WEB → web_search (then web_fetch): internet facts, news, docs, how-tos, "look up / google / what is…".
  · LOCAL → search_files: grep the workspace/repo ("find in the code", "search these files for TODO").
  · If unclear, prefer web_search for world knowledge; use search_files only when a path/repo/code context is implied.
- For a known documentation or article URL, use web_fetch. Use http_get for APIs and raw bodies. execute_command runs on the gateway host — check system_info when OS or paths matter.
- LAN / connected devices: call list_lan_devices (preferred). Do NOT invent filesystem paths like /network_devices. Fallback: execute_command with arp -a.
- Internet speed / speedtest: browser_navigate to https://www.speedtest.net, then browser_wait / browser_click / browser_snapshot. Do not refuse for lack of a dedicated speed tool.
- Clipboard: use clipboard_read / clipboard_write instead of fragile shell one-liners.
- For multi-step or heavy work, briefly say what you will do next (1–2 steps), then use tools; after partial progress, summarize what is done and what remains instead of going silent.
- On slow local hardware, favor smaller scoped tool calls over one enormous operation.
- Verify environment-dependent claims with tools when possible.
- Keep replies concise unless user explicitly requests detail.
- When a mission summary/objective is present below, align work to it and say when you believe it is satisfied.`;
    const taskProtocol = session.objective?.trim()
      ? `

### Task loop
This session has an objective. Treat it as a live task, not a one-shot answer.

- Do not stop at a partial result if useful follow-up work remains.
- Use tools, checkpoint progress, then continue if needed — without asking the user for permission to continue.
- End each response with exactly one state marker on its own line: STATE: continue, STATE: done, or STATE: blocked.
- When continuing, make the next step concrete, bounded, and NEW (never re-run the same reasoning).
- When done, verify the objective was actually satisfied before marking done.`
      : '';
    const assignment = normalizeFleetAssignment(session.agentRole);
    const fleetHint =
      assignment === 'orchestrator'
        ? (() => {
            const team = this.getSessions().filter(s => s.linkedOrchestratorId === session.id);
            const lines =
              team.length > 0
                ? team
                    .map(s => {
                      const hint = [s.description?.trim(), s.objective?.trim()]
                        .filter(Boolean)
                        .join(' · ');
                      const meta = hint ? ` — ${truncate(hint, 140)}` : '';
                      return `- \`${s.id}\` (${s.messages.length} msgs)${meta}`;
                    })
                    .join('\n')
                : '- *(none yet — link **Agent** sessions via Workspace **Chain to…** or session Details.)*';
            return `

### Fleet role: orchestrator
You coordinate **task agents chained to this session** only (their \`linkedOrchestratorId\` is you). **Delegate** implementation; do not do a worker’s full job in this chat unless the user explicitly asks for orchestration-only planning.

**Chained agents** (use these **full** session ids with \`fleet_message\`; call \`fleet_roster\` to refresh):
${lines}

**Tools:** \`fleet_roster\` → then \`fleet_message\` with:
- \`kind: "directive"\` — assign or reprioritize work (**clear outcome**, constraints, and what “done” means).
- \`kind: "reply"\` — answer an agent’s question or clarify after an \`update\`.

**Protocol:** Expect agents to send \`update\` (progress / blocked / done). Summarize fleet status for the user in short form. If nobody is chained, explain that the user must link agents first.

**Avoid:** Messaging sessions not chained to you; pasting huge code dumps that belong in a worker session.`;
          })()
        : session.linkedOrchestratorId
          ? `

### Fleet role: task agent (reporting up)
Your orchestrator session id is \`${session.linkedOrchestratorId}\` (prefix \`${session.linkedOrchestratorId.slice(0, 8)}…\`).

**When to use \`fleet_message\` to that id only:**
- \`kind: "update"\` — after meaningful progress, on blocker/tool failure you cannot fix, or when the current directive is **done** (include a short verifiable summary).
- \`kind: "reply"\` — when answering a direct question from the orchestrator.

**Execution:** Perform work with tools yourself; the orchestrator coordinates. Never send \`kind: "directive"\` (orchestrators only). If the user speaks to you directly, still honor mission and report up when the orchestrator’s task is affected.`
          : `

### Fleet role: task agent (standalone)
No orchestrator is linked. Own the user’s request end-to-end with tools. You may gain an orchestrator later via Workspace **Chain to…**; if so, follow the reporting rules above.`;

    const missionBlock = this.buildSessionMissionBlock(session);
    const autonomyBlock = this.buildAutonomyAndResilienceBlock(session);
    const memoryBlock = this.buildRelevantMemoryBlock(session);
    const brainBlock = buildBrainPromptBlock({
      query: [turnQuery, session.objective].filter(Boolean).join(' ').slice(0, 500) || undefined,
      modelId: this.config.model,
    });
    const profileBlock = this.buildProfilePromptLine();
    const todoBlock = (() => {
      const t = this.todoStores.get(session.id)?.formatForPrompt();
      return t ? `\n${t}\n` : '';
    })();
    const globalProgramGuideBlock = this.loadGlobalProgramGuideBlock(session);
    const instructionBlock =
      session.runtimeMode === 'offline'
        ? ''
        : `${this.loadAgentInstructionsBlock(session)}${this.loadInlineInstructionsBlock(session)}`;

    const common = `${base}${fleetHint}${missionBlock}${autonomyBlock}${brainBlock}${todoBlock}${profileBlock}${memoryBlock}${taskProtocol}${leanPromptsEnabled() ? '' : globalProgramGuideBlock}${instructionBlock}${envContext}${envContextLegacyTail}${ephemeralSuffix}`;

    if (nativeTools) {
      return `${common}

You have tools (functions). Call them when you need external data or actions. After receiving tool results, continue until you can answer the user clearly in plain language.
Never refuse file writes — you can call write_file. Never ask permission to continue; act with tools now.

If the API does not emit structured tool_calls, still invoke a tool by outputting ONLY:
<tool_call>
{"name":"tool_name","arguments":{...}}
</tool_call>

Available tools:
${skillList}`;
    }

    // Embedded / Groq-style dialect (Hermes-like): XML tool_call in content.
    if (this.toolDialectFlavor() === 'xml' || this.preferEmbeddedToolDialect()) {
      const toolDefs = skills
        .map(s =>
          JSON.stringify({
            type: 'function',
            function: {
              name: s.name,
              description: s.description,
              parameters: s.toolParameters || {
                type: 'object',
                additionalProperties: true,
              },
            },
          })
        )
        .join('\n');
      return `${common}

You are a function-calling agent. Tools are listed in <tools></tools>.
To act, output ONLY one or more <tool_call> blocks (no narration before the call):
<tool_call>
{"name":"<function-name>","arguments":{...}}
</tool_call>
Never refuse write_file. Never ask the user to continue — call tools now.

<tools>
${toolDefs}
</tools>

Tool summary:
${skillList}`;
    }

    return `${common}

You have access to tools (skills). When you need to use one, output exactly:
TOOL: skill_name
PARAMS: {"param": "value"}

Then wait for the result. After seeing the result, continue or use another tool.

Available tools:
${skillList}

If you need no tool, respond normally. Use PARAMS: {} for tools with no parameters.`;
  }

  private parseToolCall(text: string): { tool: string; params: any } | null {
    return parseLegacyToolCall(text);
  }

  private stripToolCallFromResponse(text: string): string {
    return stripEmbeddedToolNoise(text);
  }

  private persistAssistantMessage(session: Session, content: string): void {
    const text = content.trim();
    if (!text) return;
    session.messages.push({
      id: uuidv4(),
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
    });
    session.updatedAt = Date.now();
  }

  private extractTaskState(text: string): 'continue' | 'done' | 'blocked' | null {
    const match = text.match(/(?:^|\n)\s*STATE:\s*(continue|done|blocked)\b/i);
    if (!match) return null;
    return match[1].toLowerCase() as 'continue' | 'done' | 'blocked';
  }

  private buildTaskContinuationPrompt(session: Session, state: 'continue' | 'done' | 'blocked' | null): string {
    const objective = session.objective?.trim() || 'No explicit objective was provided.';
    const guidance =
      state === 'done'
        ? 'You said the task is done. Verify that against the objective before you stop.'
        : state === 'blocked'
          ? 'You said the task is blocked. Work the blocker with tools if possible, or state the minimal unblock step.'
          : 'Continue from current progress. Take the next concrete NEW step with tools. Do not restate the plan or ask the user to continue.';
    return [
      '[Task checkpoint]',
      `Objective: ${objective}`,
      guidance,
      'Keep going until the objective is satisfied or you are genuinely blocked.',
      'Do not ask "shall I continue?" — just act.',
      'End the next reply with exactly one state marker on its own line: STATE: continue, STATE: done, or STATE: blocked.',
    ].join('\n');
  }

  private toToolErrorResult(err: unknown): { success: false; error: string } {
    const message =
      err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
    return { success: false, error: message || 'Tool execution failed' };
  }

  /** Retrying without tools won't fix auth, unknown model, or missing route. */
  private shouldRetryChatWithoutTools(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\((401|403|404)\):/.test(msg)) return false;
    return true;
  }

  private async chatWithOptionalTools(
    body: UnifiedChatRequest,
    session: Session
  ): Promise<UnifiedChatResponse> {
    const tools = this.useNativeTools()
      ? this.getSkillsForSession(session).map(skillToOllamaTool)
      : undefined;
    if (tools?.length) {
      try {
        return await this.backend.chat({ ...body, tools });
      } catch (err) {
        if (!this.shouldRetryChatWithoutTools(err)) throw err;
        // Some local servers reject tool_choice — retry with tools but no forced choice.
        if (body.toolChoice != null) {
          try {
            const { toolChoice: _drop, ...rest } = body;
            return await this.backend.chat({ ...rest, tools });
          } catch (err2) {
            if (!this.shouldRetryChatWithoutTools(err2)) throw err2;
          }
        }
        this.nativeToolsFailed = true;
        const { toolChoice: _drop, ...rest } = body;
        return this.backend.chat({ ...rest });
      }
    }
    const { toolChoice: _drop, ...rest } = body;
    return this.backend.chat({ ...rest });
  }

  /** Prefer chatStream when the backend supports it; fall back to blocking chat. */
  private async chatWithOptionalToolsStreaming(
    body: UnifiedChatRequest,
    session: Session,
    sessionId: string
  ): Promise<UnifiedChatResponse> {
    const streamFn = this.backend.chatStream?.bind(this.backend);
    if (!streamFn) {
      return this.chatWithOptionalTools(body, session);
    }

    let enteredStreaming = false;
    const onEvent = (e: ChatStreamEvent) => {
      if (e.type === 'token' && e.text) {
        if (!enteredStreaming) {
          enteredStreaming = true;
          this.emitActivity({ type: 'status', sessionId, phase: 'streaming' });
        }
        this.emitActivity({ type: 'token', sessionId, text: e.text });
      } else if (e.type === 'think' && e.text) {
        this.emitActivity({ type: 'think', sessionId, text: e.text });
      }
    };

    const tools = this.useNativeTools()
      ? this.getSkillsForSession(session).map(skillToOllamaTool)
      : undefined;
    if (tools?.length) {
      try {
        return await streamFn({ ...body, tools }, onEvent);
      } catch (err) {
        if (!this.shouldRetryChatWithoutTools(err)) throw err;
        if (body.toolChoice != null) {
          try {
            const { toolChoice: _drop, ...rest } = body;
            enteredStreaming = false;
            return await streamFn({ ...rest, tools }, onEvent);
          } catch (err2) {
            if (!this.shouldRetryChatWithoutTools(err2)) throw err2;
          }
        }
        this.nativeToolsFailed = true;
        enteredStreaming = false;
        const { toolChoice: _drop, ...rest } = body;
        return await streamFn({ ...rest }, onEvent);
      }
    }
    const { toolChoice: _drop, ...rest } = body;
    return streamFn({ ...rest }, onEvent);
  }

  async processMessage(sessionId: string, userMessage: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.runtimeMode === 'offline') {
      throw new Error(
        'This agent is offline-only. Switch it to LLM on the Workspace card to chat, or run disk scripts from that card.'
      );
    }

    this.turnCancelRequested.delete(sessionId);
    this.turnSteerQueue.set(sessionId, []);
    this.turnsInFlight.add(sessionId);
    try {
    const turnStarted = Date.now();
    let promptTokens = 0;
    let completionTokens = 0;
    let llmCalls = 0;
    const toolsUsed: string[] = [];
    let codeDumpRecoveryUsed = 0;
    let verifyChurnUsed = 0;
    let knowledgeNudgeUsed = 0;
    let desktopNudgeUsed = 0;
    let emptyAfterToolsNudgeUsed = 0;
    let narrationNudgeUsed = 0;
    let lastForcedWebResult: unknown = null;
    let lastForcedWebQuery = '';
    /** One-shot tool_choice for the next LLM call (recovery / verify). */
    let nextToolChoice: UnifiedChatRequest['toolChoice'] | undefined;
    const desktopBodyReady = desktopPlatformOk() && !desktopDisabled();

    const stumbleOn = stumbleEnabled();
    const stumble = createStumbleState();
    const verifyMax = stumbleVerifyMax();

    ensureCoreLessons();
    updateWorking({
      last_action: 'user turn',
      next_step: session.objective?.trim() || userMessage.slice(0, 120),
    });

    const contentForModel = isAffirmationContinue(userMessage)
      ? affirmationContinueDirective(userMessage)
      : userMessage;

    // Persist what the user typed; inject harness directive only into the model turn.
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    session.messages.push(userMsg);
    session.updatedAt = Date.now();

    let iterations = 0;
    let fullResponse = '';
    let lastMeaningfulText = '';
    /** Applied on the *next* model step after tool results included a failure (one-shot nudge in system prompt). */
    let pendingToolFailureSuffix = '';
    const laptopMode = !!this.config.laptopMode;
    const harnessMode = !laptopMode && (!!this.config.harnessMode || this.envHarnessMode());
    const turnQuery = userMessage.slice(0, 400);

    // HOME first — may finish without any LMS prompt processing.
    let mission: MissionRuntime | null = null;
    let homeEarlyAnswer: string | null = null;
    const homeTrail: UnifiedChatMessage[] = [];
    if (homeEnabled() && harnessMode) {
      const plan = compileMission(userMessage, {
        objective: session.objective,
        force: !!session.objective?.trim(),
      });
      if (plan && (plan.bootstrap.length || plan.remaining.length || plan.kind !== 'general')) {
        mission = createMissionRuntime(plan);
        if (!session.objective?.trim()) {
          session.objective = plan.objective;
          session.taskStartedAt = Date.now();
          session.taskState = 'continue';
        }
        session.homeMissionKind = plan.kind;
        session.homePlaybookId = plan.playbookId;
        session.updatedAt = Date.now();
        updateWorking({
          goal: plan.objective,
          last_action: 'mission compiled',
          next_step: plan.bootstrap[0]?.tool || plan.remaining[0]?.tool || 'act',
          blockers: [],
        });
        this.emitActivity({
          type: 'mission_compiled',
          sessionId,
          kind: plan.kind,
          playbookId: plan.playbookId,
          objective: plan.objective.slice(0, 160),
        });
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: `HOME ${plan.playbookId || plan.kind}…`,
        });

        const todoStore = this.getTodoStore(sessionId);
        const seedSteps = [...plan.bootstrap, ...plan.remaining];
        if (seedSteps.length) {
          todoStore.write(seedTodosFromMissionSteps(seedSteps, plan.objective), false);
        }

        if (plan.bootstrap.length) {
          homeTrail.push({
            role: 'assistant',
            content: `(Caprigo HOME bootstrap: ${plan.playbookId || plan.kind})`,
          });
          for (const step of plan.bootstrap) {
            const transform =
              step.tool === 'desktop_screenshot' ? compactDesktopSightResult : undefined;
            const { result } = await this.runHarnessStep(sessionId, step, toolsUsed, homeTrail, {
              resultTransform: transform,
            });
            mission.lastResults[step.tool] = result;
            if (step.tool === 'web_search') {
              mission.webResult = result;
              mission.webQuery = String(step.args.query || plan.objective);
              lastForcedWebResult = result;
              lastForcedWebQuery = mission.webQuery;
            }
            noteToolSuccess(mission, step.tool);
            this.getTodoStore(sessionId).markToolDone(step.tool);
          }
          mission.bootstrapDone = true;
          homeTrail.push({
            role: 'user',
            content: [
              '[Caprigo HOME] Bootstrap tools already ran. Use their results.',
              'Continue with Action Cards or tool_calls to finish the objective.',
              'Do not refuse. Do not ask permission.',
            ].join(' '),
          });
        } else {
          mission.bootstrapDone = true;
        }

        if (homeAutoDrainEnabled()) {
          let verified = verifyMission(mission, toolsUsed, '', {
            formatWebAnswer: formatWebSearchUserAnswer,
          });
          if (verified.status !== 'pass') {
            this.emitActivity({
              type: 'status',
              sessionId,
              phase: 'working',
              detail: 'HOME auto-drain…',
            });
            while (mission.autoPickUsed < 6) {
              const next = proposeNextActions(mission, toolsUsed)[0];
              if (!next) break;
              mission.autoPickUsed += 1;
              this.emitActivity({
                type: 'mission_action',
                sessionId,
                tool: next.tool,
                source: 'auto',
              });
              const transform =
                next.tool === 'desktop_screenshot' ? compactDesktopSightResult : undefined;
              const { result, ok } = await this.runHarnessStep(
                sessionId,
                next,
                toolsUsed,
                homeTrail,
                { resultTransform: transform, emitBootstrap: false }
              );
              mission.lastResults[next.tool] = result;
              if (ok) noteToolSuccess(mission, next.tool);
              if (next.tool === 'web_search') {
                mission.webResult = result;
                lastForcedWebResult = result;
                lastForcedWebQuery = String(next.args.query || mission.plan.objective);
                mission.webQuery = lastForcedWebQuery;
              }
              verified = verifyMission(mission, toolsUsed, '', {
                formatWebAnswer: formatWebSearchUserAnswer,
              });
              if (verified.status === 'pass') break;
            }
          }
          verified = verifyMission(mission, toolsUsed, '', {
            formatWebAnswer: formatWebSearchUserAnswer,
          });
          this.emitActivity({
            type: 'mission_verified',
            sessionId,
            status: verified.status,
            detail: verified.detail,
          });
          if (verified.status === 'pass') {
            homeEarlyAnswer = formatHomeDoneAnswer(mission, verified.directAnswer);
            this.getTodoStore(sessionId).markCompleted('goal');
            this.persistAssistantMessage(session, homeEarlyAnswer);
            this.setSessionTaskProgress(sessionId, 'done', homeEarlyAnswer, Date.now());
            this.persistTaskMemory(session, 'done', homeEarlyAnswer);
            updateWorking({
              last_action: 'HOME auto-drain complete',
              next_step: '',
              blockers: [],
            });
          }
        }
      }
    }

    // Only hit LMS when HOME did not already finish the turn.
    if (!homeEarlyAnswer) {
      try {
        await this.ensureProfile();
      } catch {
        this.activeProfile = getCachedProfile(this.config.model || '');
      }
    }

    const messages: UnifiedChatMessage[] = homeEarlyAnswer
      ? []
      : [
          {
            role: 'system',
            content: this.buildSystemPrompt(this.useNativeTools(), session, '', turnQuery),
          },
          ...this.buildPromptHistory(session),
          ...homeTrail,
        ];
    const refreshSystem = (suffix = '') => {
      if (!messages.length || messages[0]?.role !== 'system') return;
      messages[0] = {
        role: 'system',
        content: this.buildSystemPrompt(this.useNativeTools(), session, suffix, turnQuery),
      };
    };
    if (!homeEarlyAnswer && contentForModel !== userMessage) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          messages[i] = { ...messages[i], content: contentForModel };
          break;
        }
      }
    }

    if (mission && !homeEarlyAnswer && homeTrail.length) {
      refreshSystem(missionSystemSuffix(mission.plan));
    }

    const toolIterationLimit = laptopMode
      ? 4
      : this.config.maxToolIterations ??
        (harnessMode ? this.harnessToolIterations : this.maxToolIterations);
    const taskMode = !!session.objective?.trim() || !!mission;
    const taskIterationLimit = laptopMode
      ? 6
      : this.config.maxTaskIterations ?? (harnessMode ? this.harnessTaskIterations : 10);
    const maxIterations = taskMode || mission ? taskIterationLimit : toolIterationLimit;
    const reqMaxTokens = laptopMode
      ? Math.min(this.config.maxTokens ?? 2048, 1024)
      : this.config.maxTokens ?? 2048;
    const reqNumCtx =
      this.backend.providerId === 'ollama'
        ? laptopMode
          ? Math.min(this.config.ollamaNumCtx ?? 8192, 4096)
          : this.config.ollamaNumCtx ?? 8192
        : undefined;

    const addUsage = (response: UnifiedChatResponse) => {
      llmCalls++;
      if (response.usage?.promptTokens != null) promptTokens += response.usage.promptTokens;
      if (response.usage?.completionTokens != null) completionTokens += response.usage.completionTokens;
    };

    if (homeEarlyAnswer) {
      fullResponse = homeEarlyAnswer;
    } else {
    while (iterations < maxIterations) {
      iterations++;

      if (this.turnCancelRequested.delete(sessionId)) {
        fullResponse = 'Stopped.';
        break;
      }

      if (messages[0]?.role === 'system') {
        const suf = pendingToolFailureSuffix;
        pendingToolFailureSuffix = '';
        messages[0] = {
          role: 'system',
          content: this.buildSystemPrompt(this.useNativeTools(), session, suf, turnQuery),
        };
      }

      const pendingChoice = nextToolChoice;
      const inferenceMessages = compactMessagesForInference(messages);
      const fast = fastModelId();
      // Small model only for text wrap-up after tools already ran (not for tool-calling turns).
      const useFast =
        !!fast && toolsUsed.length > 0 && pendingChoice == null && !this.turnCancelRequested.has(sessionId);
      const req: UnifiedChatRequest = {
        model: useFast ? fast! : this.modelForSession(session),
        messages: inferenceMessages,
        temperature: this.config.temperature ?? 0.7,
        maxTokens: reqMaxTokens,
        numCtx: reqNumCtx,
      };
      if (pendingChoice && this.useNativeTools()) {
        const profile = this.activeProfile || getCachedProfile(this.config.model || '');
        const okChoice = !profile || resolveToolMode(profile).toolChoiceOk;
        if (okChoice) {
          req.toolChoice = pendingChoice;
        }
        nextToolChoice = undefined;
      } else {
        nextToolChoice = undefined;
      }

      this.emitActivity({
        type: 'status',
        sessionId,
        phase: 'thinking',
        detail: useFast ? `fast:${fast}` : undefined,
      });
      const response = await this.chatWithOptionalToolsStreaming(req, session, sessionId);
      addUsage(response);
      if (this.turnCancelRequested.delete(sessionId)) {
        fullResponse = 'Stopped.';
        break;
      }
      const msg = response.message;
      const content = msg.content ?? '';

      const allowedNames = new Set(this.getSkillsForSession(session).map(s => s.name));

      const normalizeCalls = (
        calls: Array<{
          id?: string;
          type?: string;
          function: { name: string; arguments?: string | Record<string, unknown> };
        }>
      ) => {
        const out: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }> = [];
        for (const c of calls) {
          const argRaw = c.function.arguments;
          const argStr =
            typeof argRaw === 'string'
              ? argRaw
              : JSON.stringify(argRaw ?? {});
          const skillPrefer = userLikelyNeedsWeb(userMessage)
            ? ('web' as const)
            : /\b(code|repo|file|files|grep|codebase|local)\b/i.test(userMessage)
              ? ('local' as const)
              : undefined;
          const resolved = resolveSkillName(c.function.name, allowedNames, {
            prefer: skillPrefer,
          });
          if ('unknown' in resolved) {
            out.push({
              id: c.id || `unknown_${out.length}`,
              type: 'function',
              function: {
                name: '__unknown_skill__',
                arguments: JSON.stringify({
                  requested: resolved.unknown,
                  suggestions: resolved.suggestions,
                }),
              },
            });
            continue;
          }
          out.push({
            id: c.id || `call_${out.length}`,
            type: 'function',
            function: {
              name: resolved.name,
              arguments: argStr,
            },
          });
        }
        return out;
      };

      let tool_calls =
        msg.tool_calls?.length && this.useNativeTools()
          ? normalizeCalls(msg.tool_calls as any)
          : [];
      // Groq / non-native templates: tool JSON lands in content, not tool_calls.
      if (!tool_calls.length) {
        tool_calls = normalizeCalls(parseEmbeddedToolDialect(content));
      }
      // HOME Action Card → synthetic tool_calls when LMS ignores tools[].
      if (!tool_calls.length && mission) {
        const card = parseActionCard(content);
        if (card?.caprigo === 'action') {
          this.emitActivity({
            type: 'mission_action',
            sessionId,
            tool: card.tool,
            source: 'card',
          });
          tool_calls = normalizeCalls([
            {
              id: `card_${iterations}`,
              function: { name: card.tool, arguments: card.args },
            },
          ]);
        } else if (card?.caprigo === 'done') {
          fullResponse = card.answer;
          const verified = verifyMission(mission, toolsUsed, fullResponse, {
            formatWebAnswer: formatWebSearchUserAnswer,
          });
          this.emitActivity({
            type: 'mission_verified',
            sessionId,
            status: verified.status,
            detail: verified.detail,
          });
          if (verified.directAnswer) fullResponse = verified.directAnswer;
          if (verified.status === 'pass' || verified.status === 'blocked') {
            this.persistAssistantMessage(session, fullResponse);
            this.setSessionTaskProgress(
              sessionId,
              verified.status === 'pass' ? 'done' : 'blocked',
              fullResponse,
              Date.now()
            );
            break;
          }
        } else if (card?.caprigo === 'blocked') {
          fullResponse = `Blocked: ${card.reason}`;
          this.persistAssistantMessage(session, fullResponse);
          this.setSessionTaskProgress(sessionId, 'blocked', fullResponse, Date.now());
          this.emitActivity({
            type: 'mission_verified',
            sessionId,
            status: 'blocked',
            detail: card.reason,
          });
          break;
        }
      }

      if (tool_calls.length) {
        messages.push({
          role: 'assistant',
          content,
          tool_calls,
        });
        if (content.trim() && msg.tool_calls?.length) {
          this.persistAssistantMessage(session, content);
          lastMeaningfulText = content.trim();
        }
        let cancelledDuringTools = false;
        let anyToolFailed = false;
        let lastFailTool = '';
        let lastFailError = '';
        for (const call of tool_calls) {
          if (this.turnCancelRequested.delete(sessionId)) {
            fullResponse = 'Stopped.';
            cancelledDuringTools = true;
            break;
          }
          const name = call.function.name;
          const args = parseToolArguments(call.function.arguments);
          const requestedUnknown =
            name === '__unknown_skill__'
              ? String((args as Record<string, unknown>).requested || '').trim()
              : '';
          const displayTool =
            name === '__unknown_skill__'
              ? requestedUnknown
                ? `unknown:${requestedUnknown}`
                : 'unknown_skill'
              : name;
          toolsUsed.push(displayTool);
          const taskId = uuidv4();
          const preview = toolArgsPreview(displayTool, args as Record<string, unknown>);
          const filePath = toolPathArg(args as Record<string, unknown>) || undefined;
          this.emitActivity({
            type: 'task_start',
            sessionId,
            taskId,
            label: displayTool,
            tool: displayTool,
            argsPreview: preview,
            path: filePath,
          });
          this.emitActivity({
            type: 'status',
            sessionId,
            phase: 'working',
            detail: displayTool,
          });
          let result: any;
          try {
            if (name === '__unknown_skill__') {
              const requested = requestedUnknown;
              const suggestions = (args as Record<string, unknown>).suggestions;
              const sug = Array.isArray(suggestions)
                ? suggestions.map(String)
                : ['list_directory', 'execute_command', 'write_file'];
              const searchHint =
                /^(search|find|lookup)$/i.test(requested) &&
                sug.includes('web_search') &&
                sug.includes('search_files')
                  ? ' For "search": use web_search (internet) or search_files (local repo grep) — pick by intent.'
                  : '';
              result = {
                success: false,
                error: `Unknown skill "${requested}". Try one of: ${sug.join(', ')}.${searchHint}`,
              };
            } else {
              result = await this.executeSkill(name, args, { sessionId });
            }
          } catch (err) {
            result = this.toToolErrorResult(err);
          }
          const ok = !(
            result &&
            typeof result === 'object' &&
            (result as Record<string, unknown>).success === false
          );
          if (!ok) {
            anyToolFailed = true;
            lastFailTool = displayTool;
            lastFailError = String(
              (result && typeof result === 'object'
                ? (result as Record<string, unknown>).error
                : '') || 'failed'
            );
          }
          const detail =
            !ok && result && typeof result === 'object'
              ? String((result as Record<string, unknown>).error || 'failed')
              : undefined;
          this.emitActivity({
            type: 'task_end',
            sessionId,
            taskId,
            ok,
            detail,
            summary: toolResultSummary(name, result, ok),
          });
          if (mission && ok && name !== '__unknown_skill__') {
            noteToolSuccess(mission, name);
            mission.lastResults[name] = result;
            this.getTodoStore(sessionId).markToolDone(name);
            if (name === 'web_search') {
              mission.webResult = result;
              lastForcedWebResult = result;
              lastForcedWebQuery =
                String((args as Record<string, unknown>).query || mission.webQuery || userMessage);
              mission.webQuery = lastForcedWebQuery;
            }
          }
          const resultStr = this.formatToolResultForPrompt(
            name === 'desktop_screenshot' ? compactDesktopSightResult(result) : result
          );
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: name,
            content: resultStr,
          });
        }
        this.drainSteerIntoMessages(sessionId, messages);
        if (cancelledDuringTools) break;
        if (anyToolFailed) {
          if (stumbleOn) {
            const noted = noteStumbleFailure(stumble, lastFailTool || 'tool', lastFailError || 'failed', {
              modelId: this.config.model,
              autoLesson: true,
            });
            this.emitActivity({
              type: 'stumble_retry',
              sessionId,
              signature: noted.signature,
              count: noted.count,
              escalate: noted.escalate,
            });
            if (noted.lessonId) {
              this.emitActivity({
                type: 'lesson_saved',
                sessionId,
                signature: noted.signature,
              });
            }
            if (noted.escalate) {
              try {
                const bugPath = writeAutoBugReport({
                  sessionId,
                  model: this.config.model,
                  note: 'stumble escalate',
                  error: lastFailError,
                  tools: toolsUsed.slice(-8),
                  signature: noted.signature,
                });
                this.emitActivity({ type: 'bug_report', sessionId, path: bugPath });
              } catch {
                /* ignore */
              }
            }
            pendingToolFailureSuffix = buildStumbleRetryPrompt({
              signature: noted.signature,
              count: noted.count,
              escalate: noted.escalate,
              tool: lastFailTool || 'tool',
              error: lastFailError || 'failed',
              profile: this.activeProfile,
              modelId: this.config.model,
            });
            // Weak local models ignore system-only suffixes — put the fix in the turn.
            messages.push({
              role: 'user',
              content: buildStumbleRetryUserMessage({
                tool: lastFailTool || 'tool',
                error: lastFailError || 'failed',
                count: noted.count,
                escalate: noted.escalate,
              }),
            });
            if (this.useNativeTools()) nextToolChoice = 'required';
          } else {
            pendingToolFailureSuffix = this.buildTransientToolFailureSuffix();
          }
        } else if (toolsUsed.length) {
          noteStumbleSuccess(stumble, {
            modelId: this.config.model,
            action: toolsUsed.slice(-3).join(','),
            learnedFix:
              stumble.lastTool === 'write_file'
                ? 'write_file succeeded after failure — keep using workspace paths with full content; parents are auto-created.'
                : undefined,
          });
          promoteProfileAfterSuccess(this.config.model || '');
        }
        this.emitActivity({ type: 'status', sessionId, phase: 'thinking' });
        continue;
      }

      const legacy = this.parseToolCall(content);
      if (legacy && allowedNames.has(legacy.tool)) {
        if (this.turnCancelRequested.delete(sessionId)) {
          fullResponse = 'Stopped.';
          break;
        }
        const taskId = uuidv4();
        toolsUsed.push(legacy.tool);
        const preview = toolArgsPreview(legacy.tool, (legacy.params || {}) as Record<string, unknown>);
        const filePath = toolPathArg((legacy.params || {}) as Record<string, unknown>) || undefined;
        this.emitActivity({
          type: 'task_start',
          sessionId,
          taskId,
          label: `${legacy.tool} (text)`,
          tool: legacy.tool,
          argsPreview: preview,
          path: filePath,
        });
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: `${legacy.tool} (text)`,
        });
        let result: any;
        try {
          result = await this.executeSkill(legacy.tool, legacy.params, { sessionId });
        } catch (err) {
          result = this.toToolErrorResult(err);
        }
        const ok = !(
          result &&
          typeof result === 'object' &&
          (result as Record<string, unknown>).success === false
        );
        const detail =
          !ok && result && typeof result === 'object'
            ? String((result as Record<string, unknown>).error || 'failed')
            : undefined;
        this.emitActivity({
          type: 'task_end',
          sessionId,
          taskId,
          ok,
          detail,
          summary: toolResultSummary(legacy.tool, result, ok),
        });
        const resultStr = this.formatToolResultForPrompt(result);
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `[Tool result for ${legacy.tool}]: ${resultStr}`,
        });
        if (content.trim()) {
          this.persistAssistantMessage(session, content);
          lastMeaningfulText = content.trim();
        }
        if (!ok) pendingToolFailureSuffix = stumbleOn
          ? (() => {
              const noted = noteStumbleFailure(
                stumble,
                legacy.tool,
                String(detail || 'failed'),
                { modelId: this.config.model, autoLesson: true }
              );
              this.emitActivity({
                type: 'stumble_retry',
                sessionId,
                signature: noted.signature,
                count: noted.count,
                escalate: noted.escalate,
              });
              if (noted.lessonId) {
                this.emitActivity({
                  type: 'lesson_saved',
                  sessionId,
                  signature: noted.signature,
                });
              }
              messages.push({
                role: 'user',
                content: buildStumbleRetryUserMessage({
                  tool: legacy.tool,
                  error: String(detail || 'failed'),
                  count: noted.count,
                  escalate: noted.escalate,
                }),
              });
              if (this.useNativeTools()) nextToolChoice = 'required';
              return buildStumbleRetryPrompt({
                signature: noted.signature,
                count: noted.count,
                escalate: noted.escalate,
                tool: legacy.tool,
                error: String(detail || 'failed'),
                profile: this.activeProfile,
                modelId: this.config.model,
              });
            })()
          : this.buildTransientToolFailureSuffix();
        this.emitActivity({ type: 'status', sessionId, phase: 'thinking' });
        continue;
      }

      fullResponse = this.stripToolCallFromResponse(content) || content;
      if (fullResponse.trim()) lastMeaningfulText = fullResponse.trim();

      // Hermes: empty response after tool results → nudge continue (once).
      const priorWasTool = messages.slice(-8).some(m => m.role === 'tool');
      if (
        !String(content || '').trim() &&
        priorWasTool &&
        emptyAfterToolsNudgeUsed < 1 &&
        harnessMode
      ) {
        emptyAfterToolsNudgeUsed += 1;
        messages.push({ role: 'assistant', content: '(empty)' });
        messages.push({ role: 'user', content: buildEmptyAfterToolsNudge() });
        nextToolChoice = 'required';
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: 'empty-after-tools nudge…',
        });
        continue;
      }

      // Hermes: narration / plan without tools → force act (once) before treating as done.
      if (
        harnessMode &&
        narrationNudgeUsed < 1 &&
        looksLikeIntentNarration(fullResponse) &&
        !looksLikeKnowledgeRefusal(fullResponse) &&
        (mission || taskMode || userLikelyNeedsDesktop(userMessage) || userLikelyNeedsWeb(userMessage))
      ) {
        narrationNudgeUsed += 1;
        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({
          role: 'user',
          content: buildNarrationStopNudge(mission?.plan.objective || session.objective),
        });
        nextToolChoice = 'required';
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: 'narration-stop nudge…',
        });
        continue;
      }

      // HOME owns completion: verify → Action Card warn → harness auto-pick remaining steps.
      // Runs before dialect-flip / legacy force nudges so bootstrap missions finish on first turn.
      if (mission) {
        let verified = verifyMission(mission, toolsUsed, fullResponse, {
          formatWebAnswer: formatWebSearchUserAnswer,
        });
        this.emitActivity({
          type: 'mission_verified',
          sessionId,
          status: verified.status,
          detail: verified.detail,
        });
        if (verified.status === 'pass') {
          if (verified.directAnswer) fullResponse = verified.directAnswer;
          if (!String(fullResponse || '').trim()) {
            fullResponse = verified.directAnswer || `Done: ${mission.plan.objective}`;
          }
          this.persistAssistantMessage(session, fullResponse);
          this.setSessionTaskProgress(sessionId, 'done', fullResponse, Date.now());
          this.persistTaskMemory(session, 'done', fullResponse);
          if (stumbleOn) {
            noteStumbleSuccess(stumble, { modelId: this.config.model, action: 'HOME mission pass' });
          }
          break;
        }

        const proposed = proposeNextActions(mission, toolsUsed);
        if (proposed.length) {
          const hardRefuse =
            looksLikeDesktopRefusal(fullResponse) ||
            looksLikeKnowledgeRefusal(fullResponse) ||
            looksLikeDialectRefusal(fullResponse);
          // Soft chat → one Action Card warn. Hard refuse after bootstrap → auto-pick now.
          if (mission.cardWarnUsed < 1 && !hardRefuse) {
            mission.cardWarnUsed += 1;
            messages.push({ role: 'assistant', content: fullResponse || '(continuing mission)' });
            messages.push({
              role: 'user',
              content: actionCardPromptBlock(
                proposed.map(p => ({ tool: p.tool, args: p.args }))
              ),
            });
            refreshSystem(missionSystemSuffix(mission.plan));
            nextToolChoice = 'required';
            this.emitActivity({
              type: 'status',
              sessionId,
              phase: 'working',
              detail: 'HOME action card…',
            });
            this.emitActivity({
              type: 'mission_action',
              sessionId,
              tool: proposed[0].tool,
              source: 'propose',
            });
            continue;
          }
          if (mission.cardWarnUsed < 1) mission.cardWarnUsed = 1;

          // Model ignored tools + card — harness executes remaining steps.
          messages.push({ role: 'assistant', content: fullResponse || '(HOME auto-pick)' });
          while (mission.autoPickUsed < 4) {
            const next = proposeNextActions(mission, toolsUsed)[0];
            if (!next) break;
            mission.autoPickUsed += 1;
            this.emitActivity({
              type: 'mission_action',
              sessionId,
              tool: next.tool,
              source: 'auto',
            });
            const transform =
              next.tool === 'desktop_screenshot' ? compactDesktopSightResult : undefined;
            const { result, ok } = await this.runHarnessStep(sessionId, next, toolsUsed, messages, {
              resultTransform: transform,
              emitBootstrap: false,
            });
            mission.lastResults[next.tool] = result;
            if (ok) noteToolSuccess(mission, next.tool);
            if (next.tool === 'web_search') {
              mission.webResult = result;
              lastForcedWebResult = result;
              lastForcedWebQuery = String(next.args.query || mission.plan.objective);
              mission.webQuery = lastForcedWebQuery;
            }
            verified = verifyMission(mission, toolsUsed, fullResponse, {
              formatWebAnswer: formatWebSearchUserAnswer,
            });
            if (verified.status === 'pass') break;
          }

          verified = verifyMission(mission, toolsUsed, fullResponse, {
            formatWebAnswer: formatWebSearchUserAnswer,
          });
          this.emitActivity({
            type: 'mission_verified',
            sessionId,
            status: verified.status,
            detail: verified.detail,
          });
          if (verified.status === 'pass') {
            fullResponse =
              verified.directAnswer ||
              fullResponse ||
              `Done: ${mission.plan.objective}`;
            this.persistAssistantMessage(session, fullResponse);
            this.setSessionTaskProgress(sessionId, 'done', fullResponse, Date.now());
            this.persistTaskMemory(session, 'done', fullResponse);
            break;
          }
          // One optional LLM wrap-up — never infinite continue (this was the loop).
          if (mission.postActionLlmUsed < 1) {
            mission.postActionLlmUsed += 1;
            messages.push({
              role: 'user',
              content: [
                '[Caprigo HOME] Tools already ran. Give a short final status for the user now.',
                'Do not call more tools unless one concrete step remains. Prefer {"caprigo":"done","answer":"..."}.',
              ].join(' '),
            });
            nextToolChoice = undefined;
            continue;
          }
          fullResponse =
            fullResponse?.trim() ||
            formatHomeDoneAnswer(mission, verified.directAnswer) ||
            `Stopped after HOME steps for: ${mission.plan.objective} (${verified.detail})`;
          this.persistAssistantMessage(session, fullResponse);
          this.setSessionTaskProgress(sessionId, 'blocked', fullResponse, Date.now());
          this.persistTaskMemory(session, 'blocked', fullResponse);
          break;
        }

        if (verified.directAnswer) {
          fullResponse = verified.directAnswer;
          this.persistAssistantMessage(session, fullResponse);
          this.setSessionTaskProgress(sessionId, 'done', fullResponse, Date.now());
          break;
        }

        // Mission incomplete, nothing left to propose — stop (do not fall into STATE:continue churn).
        fullResponse =
          fullResponse?.trim() ||
          formatHomeDoneAnswer(mission) ||
          `Stopped: ${mission.plan.objective}`;
        this.persistAssistantMessage(session, fullResponse);
        this.setSessionTaskProgress(sessionId, 'blocked', fullResponse, Date.now());
        break;
      }

      // Model Grapple: mid-turn dialect flip when openai tools path is wrong
      if (
        !mission &&
        this.useNativeTools() &&
        !contentHasEmbeddedTools(content) &&
        looksLikeDialectRefusal(content) &&
        !wroteFilesThisTurn(toolsUsed) &&
        !(this.activeProfile?.quirks || []).includes('openai_tool_use_model')
      ) {
        const from = this.toolDialectFlavor();
        this.activeProfile = observeDialectFlip(
          this.config.model || '',
          from,
          'xml',
          'refuses_openai_tools'
        );
        this.nativeToolsFailed = true;
        recordEpisode({
          kind: 'dialect_flip',
          summary: `flipped ${from} → xml after refusal`,
          modelId: this.config.model,
        });
        this.emitActivity({
          type: 'dialect_flip',
          sessionId,
          from,
          to: 'xml',
          reason: 'refusal_without_tools',
        });
        refreshSystem(
          `\n[Caprigo] Switched tool dialect to XML for this model. Call tools via <tool_call> now.\n`
        );
        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({
          role: 'user',
          content:
            'Your previous reply refused tools. Caprigo flipped you to XML tool mode. Call the correct tool now using <tool_call>{"name":...,"arguments":{...}}</tool_call>.',
        });
        continue;
      }

      // If openai mode but content has embedded tools, parse them instead of finishing
      if (this.useNativeTools() && contentHasEmbeddedTools(content) && !(msg.tool_calls?.length)) {
        const embedded = parseEmbeddedToolDialect(content).filter(c =>
          allowedNames.has(c.function.name)
        );
        if (embedded.length) {
          // fall through by synthesizing tool_calls path: push and re-enter via loop
          messages.push({ role: 'assistant', content });
          for (const call of embedded) {
            if (this.turnCancelRequested.delete(sessionId)) {
              fullResponse = 'Stopped.';
              break;
            }
            const name = call.function.name;
            toolsUsed.push(name);
            const args = parseToolArguments(call.function.arguments);
            const taskId = uuidv4();
            this.emitActivity({
              type: 'task_start',
              sessionId,
              taskId,
              label: name,
              tool: name,
              argsPreview: toolArgsPreview(name, args as Record<string, unknown>),
              path: toolPathArg(args as Record<string, unknown>) || undefined,
            });
            let result: any;
            try {
              result = await this.executeSkill(name, args, { sessionId });
            } catch (err) {
              result = this.toToolErrorResult(err);
            }
            const ok = !(
              result &&
              typeof result === 'object' &&
              (result as Record<string, unknown>).success === false
            );
            this.emitActivity({
              type: 'task_end',
              sessionId,
              taskId,
              ok,
              detail: !ok
                ? String((result as Record<string, unknown>).error || 'failed')
                : undefined,
              summary: toolResultSummary(name, result, ok),
            });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              tool_name: name,
              content: this.formatToolResultForPrompt(result),
            });
            if (!ok && stumbleOn) {
              const errMsg = String((result as Record<string, unknown>).error || 'failed');
              const noted = noteStumbleFailure(stumble, name, errMsg, {
                modelId: this.config.model,
                autoLesson: true,
              });
              this.emitActivity({
                type: 'stumble_retry',
                sessionId,
                signature: noted.signature,
                count: noted.count,
                escalate: noted.escalate,
              });
              if (noted.lessonId) {
                this.emitActivity({
                  type: 'lesson_saved',
                  sessionId,
                  signature: noted.signature,
                });
              }
              pendingToolFailureSuffix = buildStumbleRetryPrompt({
                signature: noted.signature,
                count: noted.count,
                escalate: noted.escalate,
                tool: name,
                error: errMsg,
                profile: this.activeProfile,
                modelId: this.config.model,
              });
              messages.push({
                role: 'user',
                content: buildStumbleRetryUserMessage({
                  tool: name,
                  error: errMsg,
                  count: noted.count,
                  escalate: noted.escalate,
                }),
              });
              nextToolChoice = 'required';
            } else if (ok && stumbleOn && stumble.hadFailure) {
              noteStumbleSuccess(stumble, {
                modelId: this.config.model,
                action: name,
              });
            }
          }
          // Don't permanently flip openai tool-use models to XML just because LMS
          // ignored tools[] and the model echoed a JSON call in content.
          const skipFlip = (this.activeProfile?.quirks || []).includes('openai_tool_use_model');
          if (!skipFlip) {
            this.activeProfile = observeDialectFlip(
              this.config.model || '',
              'openai',
              'xml',
              'embedded_tools_in_content'
            );
            this.emitActivity({
              type: 'dialect_flip',
              sessionId,
              from: 'openai',
              to: 'xml',
              reason: 'embedded_in_content',
            });
            this.nativeToolsFailed = true;
          }
          refreshSystem();
          continue;
        }
      }

      // Harness: if the model dumped code without write_file, force recovery tool turn(s).
      if (
        harnessMode &&
        codeDumpRecoveryUsed < 2 &&
        !wroteFilesThisTurn(toolsUsed) &&
        looksLikeCodeDump(fullResponse)
      ) {
        codeDumpRecoveryUsed += 1;
        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({ role: 'user', content: codeDumpRecoveryPrompt() });
        nextToolChoice = 'required';
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: 'saving code to disk…',
        });
        continue;
      }

      // Force desktop body when model refuses / skips tools on an OS-UI ask.
      // Unreachable when an active HOME mission exists (that block always break/continue).
      const needsDesktop =
        desktopBodyReady &&
        userLikelyNeedsDesktop(userMessage);
      const noDesktopYet = !usedDesktopTools(toolsUsed);
      const desktopRefused =
        looksLikeDesktopRefusal(fullResponse) ||
        looksLikeKnowledgeRefusal(fullResponse) ||
        looksLikeDialectRefusal(fullResponse);
      const talkedInsteadOfActing =
        noDesktopYet &&
        toolsUsed.length === 0 &&
        String(fullResponse || '').trim().length > 12 &&
        !contentHasEmbeddedTools(fullResponse);
      if (
        desktopNudgeUsed < 2 &&
        needsDesktop &&
        noDesktopYet &&
        (desktopRefused || talkedInsteadOfActing)
      ) {
        desktopNudgeUsed += 1;
        const signature = 'os_ui_needs_desktop_screenshot_loop';
        const lesson = recordLesson({
          signature,
          cause: 'Model refused or answered without calling desktop_* on an OS UI request',
          fix: 'Harness runs desktop_screenshot(ocr:true) (+ launch if asked). Then desktop_focus / desktop_click(cx,cy) / desktop_type. Never claim no mouse/keyboard.',
          tools: [
            'desktop_screenshot',
            'desktop_ocr',
            'desktop_find',
            'desktop_focus',
            'desktop_click',
            'desktop_type',
            'desktop_hotkey',
            'execute_command',
          ],
          tags: ['sticky', 'auto', 'desktop', 'refusal'],
          modelId: this.config.model,
        });
        touchLesson(lesson.id);
        recordEpisode({
          kind: 'fail',
          summary: `Desktop skip/refuse on: ${userMessage.slice(0, 120)}`,
          modelId: this.config.model,
          signature,
        });
        updateWorking({
          last_action: 'desktop refusal → forced screenshot(+ocr)',
          next_step: 'act with desktop_click/type from OCR',
          blockers: [],
        });
        this.emitActivity({
          type: 'lesson_saved',
          sessionId,
          signature,
        });

        const launchCmd = suggestedDesktopLaunchCommand(userMessage);
        let launchedThisNudge = false;
        if (launchCmd && !toolsUsed.includes('execute_command')) {
          const launchTaskId = uuidv4();
          this.emitActivity({
            type: 'task_start',
            sessionId,
            taskId: launchTaskId,
            label: 'execute_command',
            tool: 'execute_command',
            argsPreview: launchCmd.slice(0, 80),
          });
          let launchResult: unknown;
          try {
            launchResult = await this.executeSkill(
              'execute_command',
              {
                command: `powershell -NoProfile -Command "${launchCmd.replace(/"/g, '\\"')}"`,
              },
              { sessionId }
            );
          } catch (err) {
            launchResult = this.toToolErrorResult(err);
          }
          toolsUsed.push('execute_command');
          launchedThisNudge = true;
          const launchOk = !(
            launchResult &&
            typeof launchResult === 'object' &&
            (launchResult as Record<string, unknown>).success === false
          );
          this.emitActivity({
            type: 'task_end',
            sessionId,
            taskId: launchTaskId,
            ok: launchOk,
            detail: !launchOk
              ? String((launchResult as Record<string, unknown>).error || 'failed')
              : undefined,
            summary: toolResultSummary('execute_command', launchResult, launchOk),
          });
          messages.push({ role: 'assistant', content: fullResponse || '(launching app)' });
          messages.push({
            role: 'tool',
            tool_call_id: `forced_desktop_launch_${desktopNudgeUsed}`,
            tool_name: 'execute_command',
            content: this.formatToolResultForPrompt(launchResult),
          });
        }

        const shotTaskId = uuidv4();
        this.emitActivity({
          type: 'task_start',
          sessionId,
          taskId: shotTaskId,
          label: 'desktop_screenshot',
          tool: 'desktop_screenshot',
          argsPreview: 'ocr:true',
        });
        let shotResult: unknown;
        try {
          shotResult = await this.executeSkill(
            'desktop_screenshot',
            { ocr: true, max_blocks: 80 },
            { sessionId }
          );
        } catch (err) {
          shotResult = this.toToolErrorResult(err);
        }
        toolsUsed.push('desktop_screenshot');
        const shotOk = !(
          shotResult &&
          typeof shotResult === 'object' &&
          (shotResult as Record<string, unknown>).success === false
        );
        this.emitActivity({
          type: 'task_end',
          sessionId,
          taskId: shotTaskId,
          ok: shotOk,
          detail: !shotOk
            ? String((shotResult as Record<string, unknown>).error || 'failed')
            : undefined,
          summary: toolResultSummary('desktop_screenshot', shotResult, shotOk),
        });

        if (!launchedThisNudge) {
          messages.push({ role: 'assistant', content: fullResponse || '(seeing desktop)' });
        }
        messages.push({
          role: 'tool',
          tool_call_id: `forced_desktop_shot_${desktopNudgeUsed}`,
          tool_name: 'desktop_screenshot',
          content: this.formatToolResultForPrompt(compactDesktopSightResult(shotResult)),
        });
        messages.push({
          role: 'user',
          content: [
            '[Caprigo] desktop_screenshot(ocr:true) was run for you (model refused / skipped desktop tools).',
            'You CAN control this PC: desktop_focus → desktop_click(cx,cy from blocks) / desktop_type / desktop_hotkey.',
            'Do not claim you lack a mouse, keyboard, or screenshot. Continue the user task now with tools.',
            shotOk ? '' : 'Screenshot failed — say so briefly; still try desktop_windows if useful.',
          ]
            .filter(Boolean)
            .join(' '),
        });
        refreshSystem(
          `\n[Caprigo] Forced desktop sight completed. Act with desktop_* tools; never refuse OS control.\n`
        );
        nextToolChoice = 'required';
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: 'acting from forced desktop screenshot…',
        });
        continue;
      }

      // Force tools when model claims ignorance / used wrong local search for a web question.
      // Unreachable when an active HOME mission exists (that block always break/continue).
      const needsWeb = userLikelyNeedsWeb(userMessage);
      const noWebYet = !usedWebTools(toolsUsed);
      const wrongLocal = usedOnlyLocalSearch(toolsUsed);
      const refused =
        looksLikeKnowledgeRefusal(fullResponse) || looksLikeDialectRefusal(fullResponse);
      if (
        knowledgeNudgeUsed < 2 &&
        needsWeb &&
        noWebYet &&
        (refused || wrongLocal)
      ) {
        knowledgeNudgeUsed += 1;
        const signature = wrongLocal
          ? 'wrong_tool_for_web_query'
          : 'knowledge_refusal_without_web_search';
        const lesson = recordLesson({
          signature,
          cause: wrongLocal
            ? 'Used local file search for an internet/world question'
            : 'Model claimed no information / no capability instead of using tools',
          fix: 'Harness runs web_search, then model answers from results. Never refuse for lack of training data.',
          tools: ['web_search', 'web_fetch'],
          tags: ['sticky', 'auto', 'web', 'refusal'],
          modelId: this.config.model,
        });
        touchLesson(lesson.id);
        recordEpisode({
          kind: 'fail',
          summary: `Refusal/wrong-tool on: ${userMessage.slice(0, 120)}`,
          modelId: this.config.model,
          signature,
        });
        updateWorking({
          last_action: 'knowledge refusal → forced web_search',
          next_step: 'answer from web_search results',
          blockers: [],
        });
        this.emitActivity({
          type: 'lesson_saved',
          sessionId,
          signature,
        });

        const searchQuery = userMessage.replace(/\s+/g, ' ').trim().slice(0, 200);
        const taskId = uuidv4();
        this.emitActivity({
          type: 'task_start',
          sessionId,
          taskId,
          label: 'web_search',
          tool: 'web_search',
          argsPreview: searchQuery.slice(0, 80),
        });
        let searchResult: unknown;
        try {
          searchResult = await this.executeSkill(
            'web_search',
            { query: searchQuery },
            { sessionId }
          );
        } catch (err) {
          searchResult = this.toToolErrorResult(err);
        }
        toolsUsed.push('web_search');
        lastForcedWebResult = searchResult;
        lastForcedWebQuery = searchQuery;
        const searchOk = !(
          searchResult &&
          typeof searchResult === 'object' &&
          (searchResult as Record<string, unknown>).success === false
        );
        this.emitActivity({
          type: 'task_end',
          sessionId,
          taskId,
          ok: searchOk,
          detail: !searchOk
            ? String((searchResult as Record<string, unknown>).error || 'failed')
            : undefined,
          summary: toolResultSummary('web_search', searchResult, searchOk),
        });

        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({
          role: 'tool',
          tool_call_id: `forced_web_${knowledgeNudgeUsed}`,
          tool_name: 'web_search',
          content: this.formatToolResultForPrompt(searchResult),
        });
        messages.push({
          role: 'user',
          content: [
            '[Caprigo] web_search was run for you (model refused / skipped tools).',
            'Answer the user from these results only. List concrete names/URLs.',
            'Do not say you lack capability or internet access.',
            searchOk ? '' : 'If search failed, say so briefly and suggest a tighter query.',
          ]
            .filter(Boolean)
            .join(' '),
        });
        refreshSystem(
          `\n[Caprigo] Forced web_search completed. Summarize results for the user now.\n`
        );
        nextToolChoice = undefined;
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: 'answering from forced web_search…',
        });
        continue;
      }

      this.persistAssistantMessage(session, fullResponse);

      // After a failed tool, model must not ask permission — force another attempt.
      if (
        stumbleOn &&
        stumble.hadFailure &&
        looksLikeConfirmationAsk(fullResponse) &&
        codeDumpRecoveryUsed < 2
      ) {
        codeDumpRecoveryUsed += 1;
        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({
          role: 'user',
          content: [
            '[Caprigo] Do not ask whether to continue.',
            'Retry the failed tool now with a corrected path/args (write_file auto-creates folders; prefer generated/…).',
            'Put FULL file contents — no stubs. Then stop with the path.',
          ].join(' '),
        });
        nextToolChoice = 'required';
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: 'retry after confirmation-ask…',
        });
        continue;
      }

      // Harness: ACT → VERIFY — multi-churn after edits
      if (
        harnessMode &&
        verifyChurnUsed < verifyMax &&
        needsPostWriteVerify(toolsUsed)
      ) {
        verifyChurnUsed += 1;
        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({ role: 'user', content: postWriteVerifyPrompt() });
        nextToolChoice = 'required';
        this.emitActivity({
          type: 'status',
          sessionId,
          phase: 'working',
          detail: `verify edits (${verifyChurnUsed}/${verifyMax})…`,
        });
        continue;
      }

      if (!taskMode) {
        break;
      }

      // HOME already set session.objective — do NOT open-end STATE:continue churn (infinite loop).
      // Explicit /loop missions without an active HOME plan still use STATE markers below.
      if (mission) {
        break;
      }

      const state = this.extractTaskState(fullResponse);
      this.persistTaskMemory(session, state, fullResponse);
      this.setSessionTaskProgress(sessionId, state || 'continue', fullResponse, Date.now());
      if (state === 'blocked') {
        recordBlockedLesson({
          summary: fullResponse,
          tools: toolsUsed.slice(-5),
          modelId: this.config.model,
          signature: stumble.lastSignature,
        });
        this.emitActivity({
          type: 'lesson_saved',
          sessionId,
          signature: stumble.lastSignature || 'blocked',
        });
      }
      // Require an explicit STATE: continue — missing marker used to default to continue forever.
      if (state !== 'continue' || iterations >= taskIterationLimit) {
        break;
      }

      messages.push({ role: 'assistant', content: fullResponse });
      messages.push({ role: 'user', content: this.buildTaskContinuationPrompt(session, state) });
    }
    } // end else (!homeEarlyAnswer)

    let assistantText = fullResponse.trim();
    // If model still refuses after we already fetched web results, answer from the tool payload.
    if (
      lastForcedWebResult &&
      (!assistantText ||
        looksLikeKnowledgeRefusal(assistantText) ||
        looksLikeDialectRefusal(assistantText))
    ) {
      const direct = formatWebSearchUserAnswer(
        lastForcedWebResult,
        lastForcedWebQuery || userMessage
      );
      if (direct) {
        assistantText = direct;
        this.persistAssistantMessage(session, assistantText);
      }
    }
    if (!assistantText) {
      if (taskMode) {
        const checkpoint = lastMeaningfulText || 'no final response was produced';
        assistantText = `Blocked: ${checkpoint}. Continue from the latest checkpoint.`;
        this.persistTaskMemory(session, 'blocked', assistantText);
        this.setSessionTaskProgress(sessionId, 'blocked', assistantText, Date.now());
        recordBlockedLesson({
          summary: assistantText,
          tools: toolsUsed.slice(-5),
          modelId: this.config.model,
        });
      } else {
        const dialect = this.toolDialectFlavor();
        const native = this.useNativeTools();
        assistantText =
          `I could not produce a response (empty model output · dialect=${dialect} · tools=${native ? 'openai' : 'off'} · llmCalls=${llmCalls}). ` +
          `Try /clear, /profile probe, or switch model. If LM Studio errors on tools, schemas may be invalid — check Caps Dialect is openai for tool-use models.`;
      }
    }

    // End-of-turn learning: persist corrections so the next turn starts wiser.
    if (userLikelyNeedsDesktop(userMessage) && desktopBodyReady) {
      if (usedDesktopTools(toolsUsed) && !looksLikeDesktopRefusal(assistantText)) {
        const hit = recordLesson({
          signature: 'os_ui_needs_desktop_screenshot_loop',
          cause: 'User asked for OS / desktop UI control',
          fix: 'desktop_screenshot(ocr:true) → desktop_focus → desktop_click(cx,cy)/desktop_type → verify. Prefer browser_* for URLs.',
          tools: ['desktop_screenshot', 'desktop_focus', 'desktop_click', 'desktop_type'],
          tags: ['sticky', 'desktop'],
          modelId: this.config.model,
        });
        touchLesson(hit.id);
        recordEpisode({
          kind: 'success',
          summary: `desktop tools used for: ${userMessage.slice(0, 100)}`,
          modelId: this.config.model,
          signature: 'os_ui_needs_desktop_screenshot_loop',
        });
        updateWorking({
          last_action: 'acted via desktop_*',
          next_step: '',
          blockers: [],
        });
        if (stumbleOn) noteStumbleSuccess(stumble, { modelId: this.config.model, action: 'desktop tools ok' });
      } else if (!usedDesktopTools(toolsUsed) && looksLikeDesktopRefusal(assistantText)) {
        const hit = recordLesson({
          signature: 'os_ui_needs_desktop_screenshot_loop',
          cause: 'Ended turn still refusing without desktop_*',
          fix: 'Next time call desktop_screenshot immediately for OS UI tasks.',
          tools: ['desktop_screenshot', 'desktop_click', 'desktop_type'],
          tags: ['sticky', 'auto', 'desktop', 'refusal'],
          modelId: this.config.model,
        });
        touchLesson(hit.id);
        recordEpisode({
          kind: 'fail',
          summary: `still refused without desktop: ${userMessage.slice(0, 100)}`,
          modelId: this.config.model,
          signature: 'os_ui_needs_desktop_screenshot_loop',
        });
        this.emitActivity({
          type: 'lesson_saved',
          sessionId,
          signature: 'os_ui_needs_desktop_screenshot_loop',
        });
      }
    }

    if (userLikelyNeedsWeb(userMessage)) {
      if (usedWebTools(toolsUsed) && !looksLikeKnowledgeRefusal(assistantText)) {
        const hit = recordLesson({
          signature: 'local_events_need_web_search',
          cause: 'User asked a world/local/current question',
          fix: 'web_search first, then answer from results. Do not refuse.',
          tools: ['web_search', 'web_fetch'],
          tags: ['sticky', 'web', 'events'],
          modelId: this.config.model,
        });
        touchLesson(hit.id);
        recordEpisode({
          kind: 'success',
          summary: `web tools used for: ${userMessage.slice(0, 100)}`,
          modelId: this.config.model,
          signature: 'local_events_need_web_search',
        });
        updateWorking({
          last_action: 'answered via web_search',
          next_step: '',
          blockers: [],
        });
        if (stumbleOn) noteStumbleSuccess(stumble, { modelId: this.config.model, action: 'web tools ok' });
      } else if (!usedWebTools(toolsUsed) && looksLikeKnowledgeRefusal(assistantText)) {
        const hit = recordLesson({
          signature: 'knowledge_refusal_without_web_search',
          cause: 'Ended turn still refusing without web_search',
          fix: 'Next time call web_search immediately for this class of question.',
          tools: ['web_search', 'web_fetch'],
          tags: ['sticky', 'auto', 'web', 'refusal'],
          modelId: this.config.model,
        });
        touchLesson(hit.id);
        recordEpisode({
          kind: 'fail',
          summary: `still refused without web: ${userMessage.slice(0, 100)}`,
          modelId: this.config.model,
          signature: 'knowledge_refusal_without_web_search',
        });
        this.emitActivity({
          type: 'lesson_saved',
          sessionId,
          signature: 'knowledge_refusal_without_web_search',
        });
      }
    }

    this.lastTurnStats = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      llmCalls,
      tools: toolsUsed,
      elapsedMs: Date.now() - turnStarted,
    };

    this.emitActivity({ type: 'status', sessionId, phase: 'idle' });
    return assistantText;
    } finally {
      this.turnsInFlight.delete(sessionId);
      this.turnSteerQueue.delete(sessionId);
    }
  }

  /**
   * Record a finished offline script run. Does not call the LLM. Assigns the script id to the session.
   */
  appendOfflineRun(
    sessionId: string,
    payload: {
      scriptId: string;
      scriptName: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      ok: boolean;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const list = session.assignedOfflineScripts ?? (session.assignedOfflineScripts = []);
    if (!list.includes(payload.scriptId)) list.push(payload.scriptId);

    const maxBody = 24000;
    let body = '';
    if (payload.stdout.trim()) body += `stdout:\n${truncate(payload.stdout, maxBody)}\n`;
    if (payload.stderr.trim()) body += `stderr:\n${truncate(payload.stderr, 8000)}\n`;
    if (!body.trim()) body = '(no output)';
    const head = `[Local script: ${payload.scriptName}] exit ${payload.exitCode}${payload.ok ? '' : ' (failed)'}\n\n`;
    const content = head + truncate(body, maxBody);

    const msg: Message = {
      id: uuidv4(),
      role: 'offline',
      content,
      timestamp: Date.now(),
      offline: {
        scriptId: payload.scriptId,
        scriptName: payload.scriptName,
        exitCode: payload.exitCode,
        ok: payload.ok,
        stderr: payload.stderr.trim() ? truncate(payload.stderr, 2000) : undefined,
      },
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
  }

  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Update engine fields in memory (applies to the next message; no gateway restart).
   */
  updateConfig(
    updates: Partial<
      Pick<
        AgentConfig,
        | 'model'
        | 'temperature'
        | 'maxTokens'
        | 'systemPrompt'
        | 'name'
        | 'optimizationProfile'
        | 'ollamaNumCtx'
        | 'laptopMode'
      >
    >
  ): AgentConfig {
    const next = { ...this.config };

    if (updates.optimizationProfile !== undefined) {
      const p = updates.optimizationProfile;
      if (p !== 'light' && p !== 'balanced' && p !== 'high' && p !== 'custom') {
        throw new Error('optimizationProfile must be light, balanced, high, or custom');
      }
    }

    const presetId = updates.optimizationProfile;
    const appliesPreset =
      presetId === 'light' || presetId === 'balanced' || presetId === 'high';

    if (appliesPreset) {
      const pr = OPTIMIZATION_PRESETS[presetId];
      next.optimizationProfile = presetId;
      next.maxTokens = pr.maxTokens;
      next.ollamaNumCtx = pr.ollamaNumCtx;
    } else {
      if (presetId === 'custom') {
        next.optimizationProfile = 'custom';
      }
      if (updates.maxTokens !== undefined) {
        const n = Math.floor(Number(updates.maxTokens));
        if (!Number.isFinite(n) || n < 1) throw new Error('maxTokens must be an integer ≥ 1');
        next.maxTokens = Math.min(200000, n);
        if (!appliesPreset) next.optimizationProfile = 'custom';
      }
      if (updates.ollamaNumCtx !== undefined) {
        const n = Math.floor(Number(updates.ollamaNumCtx));
        if (!Number.isFinite(n) || n < 512) throw new Error('ollamaNumCtx must be an integer ≥ 512');
        next.ollamaNumCtx = Math.min(262144, n);
        if (!appliesPreset) next.optimizationProfile = 'custom';
      }
    }

    if (updates.model !== undefined) {
      const m = String(updates.model).trim();
      if (!m) throw new Error('model cannot be empty');
      next.model = m;
    }
    if (updates.temperature !== undefined) {
      const t = Number(updates.temperature);
      if (!Number.isFinite(t)) throw new Error('temperature must be a number');
      next.temperature = Math.min(2, Math.max(0, t));
    }
    if (updates.systemPrompt !== undefined) {
      next.systemPrompt = String(updates.systemPrompt);
    }
    if (updates.name !== undefined) {
      const nm = String(updates.name).trim();
      if (!nm) throw new Error('name cannot be empty');
      next.name = nm;
    }
    if (updates.laptopMode !== undefined) {
      next.laptopMode = !!updates.laptopMode;
    }

    this.config = next;
    return this.getConfig();
  }
}
