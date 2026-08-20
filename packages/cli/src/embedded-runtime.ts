/**
 * Embedded Caprigo runtime — Agent + LM Studio backend in-process (no gateway).
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Agent, harnessCoreSkills, closeBrowserSession, probeImageBackend, probeDesktopBackend, probeDesktopOcr, type TurnStats, type ModelProfile } from '@caprigo/agent';
import { createLLMBackendFromEnv, DEFAULT_LM_STUDIO_BASE } from '@caprigo/chat-backend';
import type { AgentActivityEvent, Session } from '@caprigo/shared';
import { caprigoEnv, caprigoWorkspaceRoot } from '@caprigo/shared';

export { probeImageBackend, probeDesktopBackend, probeDesktopOcr };

export function playwrightChromiumReady(): boolean {
  try {
    const base = path.join(
      process.env.LOCALAPPDATA || process.env.HOME || '',
      'ms-playwright'
    );
    if (!base || !fs.existsSync(base)) return false;
    for (const ent of fs.readdirSync(base)) {
      if (!ent.startsWith('chromium')) continue;
      const dir = path.join(base, ent);
      const candidates = [
        path.join(dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        path.join(dir, 'chrome-win64', 'chrome.exe'),
        path.join(dir, 'chrome-mac', 'Chromium.app'),
        path.join(dir, 'chrome-linux', 'chrome'),
        path.join(dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      ];
      if (candidates.some(c => fs.existsSync(c))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type EmbeddedRuntime = {
  agent: Agent;
  session: Session;
  model: string;
  providerId: string;
  workspace: string;
  processMessage: (
    text: string,
    onActivity?: (e: AgentActivityEvent) => void
  ) => Promise<{ response: string; stats: TurnStats | null }>;
  enableMission: (objective: string) => void;
  clearMission: () => void;
  setModel: (model: string) => void;
  ensureProfile: (opts?: { forceProbe?: boolean }) => Promise<ModelProfile>;
  getProfile: () => ModelProfile | null;
  clearBrainWorking: () => void;
  listSkills: () => string[];
  requestStop: () => void;
  /** Mid-turn STEER — returns false if no turn in flight (caller should queue). */
  steer: (text: string) => boolean;
  /** User/assistant turns for HUD session save/restore. */
  getTranscript: () => Array<{ role: 'user' | 'assistant'; content: string; timestamp?: number }>;
  replaceTranscript: (
    messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: number }>
  ) => void;
  clearTranscript: () => void;
  dispose: () => Promise<void>;
};

function loadRepoEnv(opts?: { override?: boolean }): void {
  // Best-effort: load repo-root .env if present (gateway normally does this).
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(__dirname, '../../../../.env'),
    ];
    const override = !!opts?.override;
    for (const envPath of candidates) {
      if (!fs.existsSync(envPath)) continue;
      const raw = fs.readFileSync(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        const key = t.slice(0, eq).trim();
        let val = t.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (override || !(key in process.env)) process.env[key] = val;
      }
      break;
    }
  } catch {
    /* ignore */
  }
}

export async function createEmbeddedRuntime(opts?: {
  displayName?: string;
  model?: string;
  objective?: string;
}): Promise<EmbeddedRuntime> {
  loadRepoEnv({ override: true });

  const backend = createLLMBackendFromEnv();
  const model =
    opts?.model?.trim() ||
    process.env.DEFAULT_MODEL?.trim() ||
    (backend.providerId === 'openai_compatible' ? 'local-model' : 'qwen3.5:latest');

  const harness =
    !/^(0|false|off|no)$/i.test(String(process.env.CAPRIGO_HARNESS_MODE ?? '1'));

  const agent = new Agent(
    {
      id: 'cli-embedded',
      name: opts?.displayName || 'Caprigo CLI',
      model,
      temperature: harness ? 0.3 : 0.5,
      maxTokens: harness ? 4096 : 2048,
      optimizationProfile: 'balanced',
      harnessMode: harness,
      laptopMode: false,
      systemPrompt: [
        'You are Caprigo, a local autonomous agent for people who want work done in plain language.',
        'You have a digital body: filesystem, shell (execute_command), web (web_search / web_fetch), browser (browser_*), desktop (desktop_* on Windows — mouse/keyboard/screenshot), memory, Caprigo Brain.',
        '',
        'Body routing:',
        '- Terminal / shell commands → execute_command.',
        '- URLs / web UI → browser_*. Prefer browser_screenshot for pages.',
        '- Native OS apps / desktop UI → desktop_*. Loop: desktop_screenshot with ocr:true (or desktop_ocr / desktop_find) → click cx,cy / type / hotkey → screenshot+ocr verify. desktop_focus before typing.',
        '- Never claim you cannot move the mouse, type keys, screenshot, or OCR the desktop when desktop_* skills are available.',
        '',
        'Search routing:',
        '- web_search = internet (look up / google / facts / docs / meetups / news). search_files = local repo grep only.',
        '- Bare "search X" about the world → web_search. "search the code/files for X" → search_files.',
        '- NEVER say you have no information or no internet — call web_search / web_fetch first, then answer from results.',
        '',
        'CRITICAL — code and scripts (non-negotiable):',
        '- You CAN write files. Never say you cannot create/save scripts or that you lack file access.',
        '- Never paste useful code only into chat. Always call write_file first with the full contents.',
        '- Prefer clear paths: generated/, scripts/, or a path the user named. HTML/Three.js → .html; Node → .js; Python → .py.',
        '- After write_file, briefly tell the user the path and how to open/run it — do not re-dump the whole file in chat.',
        '- If you already drafted code in your head, still call write_file; chat is not storage.',
        '- read_file returns lines as NNN:hhh|text (hash anchors). Prefer hash_edit with those anchors to change code.',
        '- Use search_replace only when hash anchors are unavailable.',
        '',
        'CRITICAL — no confirmation loops:',
        '- Never ask “want me to continue?”, “shall I proceed?”, or similar.',
        '- Just do the next step. If the user says yes/ok/continue, advance with a NEW action — do not re-think the same plan.',
        '',
        'Harness loop (ACT → VERIFY → CHURN / stumble-to-walk):',
        '- ACT with tools (write_file / hash_edit / shell / desktop_*).',
        '- VERIFY by read_file (or a quick run / desktop_screenshot) after every meaningful edit — do not trust what you think you wrote.',
        '- On tool failure: diagnose, change approach, retry (do not repeat identical args). Use brain_remember for lessons.',
        '- CHURN: fix failures, then stop with a short path confirmation. Do not hand control back with “shall I continue?”.',
        '',
        'Prefer evidence over guesses. Self-correct after tool failures. For long missions, keep going until the objective is satisfied.',
      ].join('\n'),
    },
    backend
  );

  for (const skill of harnessCoreSkills) {
    agent.registerSkill(skill);
  }

  // Skip heavy agentskills / vibes by default (CAPRIGO_LOAD_EXTRA_SKILLS=1 to enable later).

  const session = await agent.createSession();
  if (opts?.objective?.trim()) {
    agent.enableMissionLoop(session.id, opts.objective.trim());
  }

  // Warm model profile (non-blocking failure OK)
  try {
    await agent.ensureProfile();
  } catch {
    /* ignore */
  }

  const workspace = caprigoWorkspaceRoot();

  const runtime: EmbeddedRuntime = {
    agent,
    session,
    model: agent.modelForSession(session),
    providerId: backend.providerId,
    workspace,
    async processMessage(text, onActivity) {
      if (onActivity) agent.setActivitySink(onActivity);
      else agent.setActivitySink(undefined);
      try {
        const response = await agent.processMessage(session.id, text);
        return { response, stats: agent.getLastTurnStats() };
      } finally {
        agent.setActivitySink(undefined);
      }
    },
    enableMission(objective: string) {
      agent.enableMissionLoop(session.id, objective);
    },
    clearMission() {
      agent.clearMissionLoop(session.id);
    },
    setModel(next: string) {
      agent.setSessionModel(session.id, next);
      runtime.model = agent.modelForSession(session);
      void agent.ensureProfile().catch(() => undefined);
    },
    ensureProfile(opts) {
      return agent.ensureProfile(opts);
    },
    getProfile() {
      return agent.getActiveProfile();
    },
    clearBrainWorking() {
      agent.clearBrainWorking();
    },
    listSkills() {
      return agent.getSkills().map(s => s.name);
    },
    requestStop() {
      agent.requestTurnCancel(session.id);
    },
    steer(text: string) {
      return agent.steerTurn(session.id, text);
    },
    getTranscript() {
      return session.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        }));
    },
    replaceTranscript(messages) {
      session.messages = messages.map(m => ({
        id: randomUUID(),
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now(),
      }));
      session.updatedAt = Date.now();
    },
    clearTranscript() {
      session.messages = [];
      session.updatedAt = Date.now();
    },
    async dispose() {
      await closeBrowserSession();
    },
  };
  return runtime;
}

export function describeLmStudioTarget(): string {
  return (
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_API_BASE?.trim() ||
    DEFAULT_LM_STUDIO_BASE
  );
}

/** Strip LM Studio load-instance suffixes (`model:2`) so the picker shows unique catalog keys. */
export function canonicalLmStudioModelId(id: string): string {
  const s = id.trim();
  // Keep quant tags like `name@q4_k_m`; only strip trailing `:digits` instance ids.
  return s.replace(/:\d+$/, '');
}

function dedupeLmStudioModelIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = canonicalLmStudioModelId(raw);
    if (!id || /embed/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export async function probeLmStudio(baseUrl?: string): Promise<{
  ok: boolean;
  base: string;
  models: string[];
  error?: string;
}> {
  const base = (baseUrl || describeLmStudioTarget()).replace(/\/$/, '');
  const root = base.replace(/\/v1$/i, '');

  // Prefer REST catalog keys (one row per downloaded model). /v1/models also lists
  // every loaded instance as `key:2`, `key:3`, … which clutters the Caprigo picker.
  try {
    const catalogRes = await fetch(`${root}/api/v1/models`, { signal: AbortSignal.timeout(8000) });
    if (catalogRes.ok) {
      const catalog = (await catalogRes.json()) as {
        models?: Array<{ key?: string; type?: string; display_name?: string }>;
      };
      const keys = (catalog.models || [])
        .filter(m => m.type !== 'embedding' && m.key)
        .map(m => String(m.key));
      if (keys.length) {
        return { ok: true, base, models: dedupeLmStudioModelIds(keys) };
      }
    }
  } catch {
    /* fall through to OpenAI-compatible list */
  }

  const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
  try {
    const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return { ok: false, base, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = dedupeLmStudioModelIds((data.data || []).map(m => String(m.id || '')));
    return { ok: true, base, models };
  } catch (err) {
    return {
      ok: false,
      base,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Re-export for TUI doctor line. */
export function harnessProviderLabel(): string {
  const p = (caprigoEnv('LLM_PROVIDER') || 'openai_compatible').toLowerCase();
  if (p === 'ollama') return 'ollama';
  return 'lmstudio/openai_compatible';
}
