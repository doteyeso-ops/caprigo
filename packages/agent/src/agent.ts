/**
 * Agent - the engine core. Handles sessions, skills, and LLM conversation.
 */

import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as fs from 'fs';
import {
  caprigoEnv,
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
  type OrchestrationKind,
} from '@caprigo/shared';
import { parseToolArguments, skillToOllamaTool } from './tool-schema';
import { logSkillExecution } from './execution-log';

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n… (truncated)';
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = caprigoEnv(name);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const AGENT_INSTRUCTIONS_MAX_CHARS = envInt('AGENT_INSTRUCTIONS_MAX_CHARS', 24_000, 1_000, 200_000);
const AGENT_INLINE_INSTRUCTIONS_MAX_CHARS = envInt('INLINE_INSTRUCTIONS_MAX_CHARS', 12_000, 500, 100_000);
const GLOBAL_PROGRAM_GUIDE_MAX_CHARS = envInt('PROGRAM_GUIDE_MAX_CHARS', 16_000, 1_000, 200_000);
const HISTORY_RECENT_MESSAGES = envInt('HISTORY_RECENT_MESSAGES', 12, 4, 40);
const HISTORY_SUMMARY_MAX_CHARS = envInt('HISTORY_SUMMARY_MAX_CHARS', 6_000, 500, 40_000);
const TOOL_RESULT_MAX_CHARS = envInt('TOOL_RESULT_MAX_CHARS', 4_000, 300, 100_000);
const GLOBAL_PROGRAM_GUIDE_DEFAULT_PATH = 'CAPRIGO_LLM_GUIDE.md';

export class Agent {
  private config: AgentConfig;
  private backend: ChatLLMBackend;
  private skills = new Map<string, Skill>();
  private sessions = new Map<string, Session>();
  private readonly maxToolIterations = 8;
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

  constructor(config: AgentConfig, backend: ChatLLMBackend) {
    this.config = config;
    this.backend = backend;
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

  setSessionModel(sessionId: string, model: string | null | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const t = model?.trim();
    session.model = t || undefined;
    session.updatedAt = Date.now();
  }

  /** Whitelist of skill names for this session, or all skills if unset / empty. */
  getSkillsForSession(session: Session): Skill[] {
    const all = this.getSkills();
    const pick = session.assignedSkills?.filter(Boolean);
    if (!pick?.length) return all;
    const set = new Set(pick);
    return all.filter(s => set.has(s.name));
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
    const llmHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of session.messages) {
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
      '## Self-correction & learning',
      '- If a tool returns `success: false` or an error, **do not** repeat the same call with identical arguments.',
      '- Briefly infer the cause (path, permissions, syntax, API shape), change inputs or strategy, then retry or switch tools.',
      '- If the same **category** of error happens twice, stop repeating; summarize for the user and propose alternatives.',
      '- Optional: use `store_memory` with stable keys (e.g. `lesson_<topic>`) to retain fixes that apply across turns on this machine.',
      ''
    );
    return lines.join('\n');
  }

  private buildTransientToolFailureSuffix(): string {
    return `

### Priority note (this turn only)
The last tool batch included at least one **failure**. Read those tool results, adjust arguments or approach, then continue. Do not retry unchanged.`;
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
    return true;
  }

  private buildSystemPrompt(nativeTools: boolean, session: Session, ephemeralSuffix = ''): string {
    const skillList = this.getSkillsForSession(session)
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');
    const base = this.config.systemPrompt || 'You are a helpful AI assistant.';
    const envContext = `

Environment context:
- host_os: ${os.platform()} ${os.release()}
- cpu_arch: ${os.arch()}
- hostname: ${os.hostname()}
- cwd: ${process.cwd()}
- llm_provider: ${this.backend.providerId}
- default_model: ${this.config.model}
- laptop_mode: ${this.config.laptopMode ? 'on' : 'off'}

Behavior rules:
- Prefer short, tool-assisted steps over long speculative responses.
- For facts and current events, use web_search first; for a known documentation or article URL, use web_fetch. Use http_get for APIs and raw bodies. execute_command runs on the gateway host — check system_info when OS or paths matter.
- For multi-step or heavy work, briefly say what you will do next (1–2 steps), then use tools; after partial progress, summarize what is done and what remains instead of going silent.
- On slow local hardware, favor smaller scoped tool calls over one enormous operation.
- Verify environment-dependent claims with tools when possible.
- Keep replies concise unless user explicitly requests detail.
- When a mission summary/objective is present below, align work to it and say when you believe it is satisfied.`;
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
    const globalProgramGuideBlock = this.loadGlobalProgramGuideBlock(session);
    const instructionBlock =
      session.runtimeMode === 'offline'
        ? ''
        : `${this.loadAgentInstructionsBlock(session)}${this.loadInlineInstructionsBlock(session)}`;

    if (nativeTools) {
      return `${base}${fleetHint}${missionBlock}${autonomyBlock}${globalProgramGuideBlock}${instructionBlock}${envContext}${ephemeralSuffix}

You have tools (functions). Call them when you need external data or actions. After receiving tool results, continue until you can answer the user clearly in plain language.

Available tools:
${skillList}`;
    }

    return `${base}${fleetHint}${missionBlock}${autonomyBlock}${globalProgramGuideBlock}${instructionBlock}${envContext}${ephemeralSuffix}

You have access to tools (skills). When you need to use one, output exactly:
TOOL: skill_name
PARAMS: {"param": "value"}

Then wait for the result. After seeing the result, continue or use another tool.

Available tools:
${skillList}

If you need no tool, respond normally. Use PARAMS: {} for tools with no parameters.`;
  }

  private parseToolCall(text: string): { tool: string; params: any } | null {
    const toolMatch = text.match(/TOOL:\s*([\w-]+)/i);
    const paramsMatch = text.match(/PARAMS:\s*(\{[\s\S]*?\})/);
    if (!toolMatch) return null;
    const tool = toolMatch[1];
    let params: any = {};
    if (paramsMatch) {
      try {
        params = JSON.parse(paramsMatch[1]);
      } catch (_) {}
    }
    return { tool, params };
  }

  private stripToolCallFromResponse(text: string): string {
    return text
      .replace(/TOOL:\s*[\w-]+[\s\S]*?PARAMS:\s*\{[^}]*\}/gi, '')
      .replace(/\n\s*\n/g, '\n')
      .trim();
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
        this.nativeToolsFailed = true;
        return this.backend.chat({ ...body });
      }
    }
    return this.backend.chat({ ...body });
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

    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    session.messages.push(userMsg);
    session.updatedAt = Date.now();

    const llmHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of session.messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        llmHistory.push({ role: m.role, content: m.content });
      } else if (m.role === 'orchestration' && m.orchestration) {
        const om = m.orchestration;
        const peer = om.peerLabel || `${om.peerSessionId.slice(0, 8)}…`;
        const dir = om.channel === 'out' ? '→' : '←';
        llmHistory.push({
          role: 'user',
          content: `[Fleet ${dir} ${peer} · ${om.kind}]\n${m.content}`,
        });
      }
    }
    const messages: UnifiedChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(this.useNativeTools(), session, '') },
      ...this.buildPromptHistory(session),
    ];

    let iterations = 0;
    let fullResponse = '';
    /** Applied on the *next* model step after tool results included a failure (one-shot nudge in system prompt). */
    let pendingToolFailureSuffix = '';
    const laptopMode = !!this.config.laptopMode;
    const toolIterationLimit = laptopMode ? 4 : this.maxToolIterations;
    const reqMaxTokens = laptopMode
      ? Math.min(this.config.maxTokens ?? 2048, 1024)
      : this.config.maxTokens ?? 2048;
    const reqNumCtx =
      this.backend.providerId === 'ollama'
        ? laptopMode
          ? Math.min(this.config.ollamaNumCtx ?? 8192, 4096)
          : this.config.ollamaNumCtx ?? 8192
        : undefined;

    while (iterations < toolIterationLimit) {
      iterations++;

      if (this.turnCancelRequested.delete(sessionId)) {
        fullResponse = 'Stopped.';
        break;
      }

      if (messages[0]?.role === 'system') {
        const suf = pendingToolFailureSuffix;
        pendingToolFailureSuffix = '';
        messages[0] = { role: 'system', content: this.buildSystemPrompt(this.useNativeTools(), session, suf) };
      }

      const req: UnifiedChatRequest = {
        model: this.modelForSession(session),
        messages,
        temperature: this.config.temperature ?? 0.7,
        maxTokens: reqMaxTokens,
        numCtx: reqNumCtx,
      };

      const response = await this.chatWithOptionalTools(req, session);
      if (this.turnCancelRequested.delete(sessionId)) {
        fullResponse = 'Stopped.';
        break;
      }
      const msg = response.message;
      const content = msg.content ?? '';

      const allowedNames = new Set(this.getSkillsForSession(session).map(s => s.name));

      if (msg.tool_calls?.length && this.useNativeTools()) {
        const tool_calls = msg.tool_calls.filter(c => allowedNames.has(c.function.name));
        if (tool_calls.length === 0) {
          messages.push({ role: 'assistant', content });
          continue;
        }
        messages.push({
          role: 'assistant',
          content,
          tool_calls,
        });
        let cancelledDuringTools = false;
        let anyToolFailed = false;
        for (const call of tool_calls) {
          if (this.turnCancelRequested.delete(sessionId)) {
            fullResponse = 'Stopped.';
            cancelledDuringTools = true;
            break;
          }
          const name = call.function.name;
          const args = parseToolArguments(call.function.arguments);
          const taskId = uuidv4();
          this.emitActivity({ type: 'task_start', sessionId, taskId, label: name });
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
          if (!ok) anyToolFailed = true;
          const detail =
            !ok && result && typeof result === 'object'
              ? String((result as Record<string, unknown>).error || 'failed')
              : undefined;
          this.emitActivity({ type: 'task_end', sessionId, taskId, ok, detail });
          const resultStr = this.formatToolResultForPrompt(result);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: name,
            content: resultStr,
          });
        }
        if (cancelledDuringTools) break;
        if (anyToolFailed) pendingToolFailureSuffix = this.buildTransientToolFailureSuffix();
        continue;
      }

      const legacy = this.parseToolCall(content);
      if (legacy && allowedNames.has(legacy.tool)) {
        if (this.turnCancelRequested.delete(sessionId)) {
          fullResponse = 'Stopped.';
          break;
        }
        const taskId = uuidv4();
        this.emitActivity({ type: 'task_start', sessionId, taskId, label: `${legacy.tool} (text)` });
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
        this.emitActivity({ type: 'task_end', sessionId, taskId, ok, detail });
        const resultStr = this.formatToolResultForPrompt(result);
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `[Tool result for ${legacy.tool}]: ${resultStr}`,
        });
        if (!ok) pendingToolFailureSuffix = this.buildTransientToolFailureSuffix();
        continue;
      }

      fullResponse = this.stripToolCallFromResponse(content) || content;
      break;
    }

    const assistantText = fullResponse.trim() || 'I could not produce a response. Please retry.';
    const assistantMsg: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: assistantText,
      timestamp: Date.now(),
    };
    session.messages.push(assistantMsg);
    session.updatedAt = Date.now();

    return assistantText;
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
