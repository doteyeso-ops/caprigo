/**
 * Gateway - HTTP API for the agent engine
 */

import './env-bootstrap';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { Agent, coreSkills, createFleetSkills, readExecutionLogTail, appendExecutionLog, filterLeanSkills } from '@caprigo/agent';
import { OpenAICompatibleLLMBackend, OllamaLLMBackend } from '@caprigo/chat-backend';
import type { Skill, AgentConfig, Session } from '@caprigo/shared';
import {
  caprigoEnv,
  caprigoDataRoot,
  caprigoWorkspaceRoot,
  normalizeFleetAssignment,
  openAICompatibleRequestHeaders,
  readFileLedgerTail,
  summarizeTouchedFiles,
} from '@caprigo/shared';
import { loadUserSkills, loadAgentSkills, getSkillsDir, loadSkillsFromFile } from '@caprigo/user-skills-loader';
import {
  registerLaunchedAgent,
  removeLaunchedAgent,
  getLaunchedAgent,
  ensureLaunchedAgent,
  setAgentStatus,
  clearTasksForTurn,
  handleAgentActivity,
} from './launched-agents';
import {
  getOfflineScriptsDir,
  loadOfflineCatalog,
  resolveOfflineScriptAbs,
  runOfflineScriptFile,
} from './offline-scripts';
import { getOrchestrationFeed } from './orchestration-feed';
import { getSystemMonitorSnapshot } from './system-snapshot';
import {
  vibesBrowseListings,
  normalizeListingHits,
  vibesFetchImportPayload,
  extractCaprigoSkillCode,
  defaultVibesFolder,
  mapVibesMarketplaceBySkillName,
} from './vibes-import';
import { loadPersistedLLMConfig, savePersistedLLMConfig } from './llm-config-store';
import {
  loadMcpServers,
  saveMcpServers,
  validateMcpServersFile,
  mcpServersConfigPath,
} from './mcp-servers-store';
import {
  refreshMcpBridge,
  closeMcpBridge,
  getMcpServerStatuses,
  getMcpRegisteredSkillNames,
} from './mcp-bridge';

function offlineScriptIdSet(): Set<string> {
  try {
    return new Set(loadOfflineCatalog(getOfflineScriptsDir()).map(s => s.id));
  } catch {
    return new Set();
  }
}

function memoryStorePath(): string {
  return path.join(caprigoDataRoot(), 'memory.json');
}

function readMemoryStore(): Record<string, { value: unknown; timestamp: number }> {
  try {
    const file = memoryStorePath();
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { value: unknown; timestamp: number }>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function assertKnownOfflineScriptIds(ids: string[]): string | undefined {
  const valid = offlineScriptIdSet();
  for (const id of ids) {
    if (!valid.has(id)) return `Unknown offline script id: ${id}`;
  }
  return undefined;
}

/** Per-session model override vs engine default (for API responses). */
function sessionModelFields(s: Session) {
  const ov = s.model?.trim() || null;
  const em = ov || agent.getConfig().model;
  return { model: ov, effectiveModel: em };
}

function sessionTaskFields(s: Session) {
  const out: { taskState?: Session['taskState']; taskSummary?: string; taskCheckpointAt?: number } = {};
  if (s.taskState) out.taskState = s.taskState;
  if (s.taskSummary) out.taskSummary = s.taskSummary;
  if (typeof s.taskCheckpointAt === 'number') out.taskCheckpointAt = s.taskCheckpointAt;
  return out;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '512kb' }));

const PORT = parseInt(process.env.PORT || '18789', 10);
const HOST = process.env.CAPRIGO_BIND_HOST?.trim() || '127.0.0.1';
const API_TOKEN = process.env.CAPRIGO_API_TOKEN?.trim() || '';
const REQUEST_LOG_MODE = (process.env.CAPRIGO_REQUEST_LOG || 'smart').trim().toLowerCase();
const RATE_LIMIT_WINDOW_MS = Math.max(1_000, parseInt(process.env.CAPRIGO_RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000);
const RATE_LIMIT_MAX = Math.max(1, parseInt(process.env.CAPRIGO_RATE_LIMIT_MAX || '240', 10) || 240);
type RuntimeLLMProvider = 'ollama' | 'openai_compatible';

type RuntimeLLMConfig = {
  provider: RuntimeLLMProvider;
  ollamaUrl: string;
  openaiBase: string;
  openaiApiKey: string;
};

const DEFAULT_SYSTEM_PROMPT = [
  'You are Caprigo, a laptop-first autonomous agent runtime assistant.',
  '',
  'Identity and role:',
  '- You run inside Caprigo Core and help users complete real tasks using tools.',
  '- You are practical, concise, and execution-focused.',
  '- You are optimized for everyday hardware (laptops and low-end desktops).',
  '',
  'Core behavior:',
  '- Prefer tool-backed answers over speculation when facts can be checked.',
  '- Break work into short, reliable steps; avoid long monologues.',
  '- When a task depends on environment state, verify with tools before claiming success.',
  '- If something fails, explain the exact failure and the best next action.',
  '',
  'Tool usage:',
  '- Use available tools when they improve correctness, speed, or safety.',
  '- Choose the minimum number of tool calls needed to complete the task.',
  '- After tool results arrive, synthesize clearly and move the task forward.',
  '- After creating or editing files, you may call list_file_changes to track what you touched.',
  '',
  'Response style:',
  '- Be direct and useful. Prefer short, actionable output by default.',
  '- Include only necessary detail unless the user asks for deep explanation.',
  '- Never invent command output, file contents, or API results.',
  '',
  'MCP bridge tools (names starting with mcp_) call external Model Context Protocol servers on this machine — they can drive UI and shell with high privilege; use only when appropriate.',
  '',
  'Agent Skill tools (names starting with as_) load SKILL.md playbooks from skills/agentskills — follow their workflows using Caprigo tools; upstream text may mention other products (e.g. Hermes CLI); translate steps accordingly.',
].join('\n');

function isLoopbackIp(ip: string): boolean {
  const v = (ip || '').trim().toLowerCase();
  return v === '127.0.0.1' || v === '::1' || v === '::ffff:127.0.0.1';
}

function authHeaderToken(req: express.Request): string {
  const h = String(req.headers.authorization || '').trim();
  if (!h) return '';
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  return '';
}

type RateBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateBucket>();

function requestIp(req: express.Request): string {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return xff || req.ip || 'unknown';
}

function isQuietRequest(req: express.Request): boolean {
  if (req.method !== 'GET') return false;
  const path = req.path || '';
  return (
    path === '/health' ||
    path === '/readyz' ||
    path === '/api/runtime' ||
    path === '/api/sessions' ||
    path === '/api/system-monitor' ||
    path.startsWith('/api/orchestration-feed')
  );
}

function shouldLogRequest(req: express.Request): boolean {
  if (REQUEST_LOG_MODE === '0' || REQUEST_LOG_MODE === 'false' || REQUEST_LOG_MODE === 'off') return false;
  if (REQUEST_LOG_MODE === '1' || REQUEST_LOG_MODE === 'true' || REQUEST_LOG_MODE === 'verbose') return true;
  return !isQuietRequest(req);
}

function applyRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = requestIp(req);
  const key = `${ip}:${req.method}:${req.path}`;
  const now = Date.now();
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  if (current.count >= RATE_LIMIT_MAX) {
    const retrySeconds = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(1, retrySeconds)));
    return res.status(429).json({ error: 'Rate limit exceeded. Retry later.' });
  }
  current.count += 1;
  return next();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitBuckets.entries()) {
    if (v.resetAt <= now) rateLimitBuckets.delete(k);
  }
}, Math.min(30000, RATE_LIMIT_WINDOW_MS)).unref();

/** Protect mutating APIs. If token is configured, require it. Otherwise allow only local loopback callers. */
function requireMutationAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (API_TOKEN) {
    const token = String(req.headers['x-caprigo-token'] || '').trim() || authHeaderToken(req);
    if (token !== API_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized. Provide x-caprigo-token or Authorization: Bearer <token>.' });
    }
    return next();
  }
  if (!isLoopbackIp(req.ip || '')) {
    return res.status(403).json({
      error:
        'Mutating API calls are restricted to localhost unless CAPRIGO_API_TOKEN is configured.',
    });
  }
  return next();
}

app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const startedAt = Date.now();
  const reqId = randomUUID().slice(0, 12);
  const logThisRequest = shouldLogRequest(req);
  res.setHeader('x-request-id', reqId);
  res.on('finish', () => {
    if (!logThisRequest) return;
    const payload = {
      ts: new Date().toISOString(),
      reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - startedAt,
      ip: requestIp(req),
    };
    console.log(JSON.stringify(payload));
  });
  next();
});

app.use('/api', applyRateLimit);
app.use('/api', requireMutationAuth);

function normalizeProvider(raw: unknown): RuntimeLLMProvider {
  const p = String(raw || '').trim().toLowerCase();
  if (p === 'openai' || p === 'openai_compatible' || p === 'api' || p === 'http' || p === 'remote') {
    return 'openai_compatible';
  }
  return 'ollama';
}

/** Ollama API base (`OLLAMA_URL` or `CAPRIGO_OLLAMA_URL`). When set, overrides persisted Settings on startup. */
const envOllamaUrl = process.env.OLLAMA_URL?.trim() || caprigoEnv('OLLAMA_URL');

const llmState: RuntimeLLMConfig = {
  provider: normalizeProvider(caprigoEnv('LLM_PROVIDER') || 'openai_compatible'),
  ollamaUrl: envOllamaUrl || 'http://localhost:11434',
  openaiBase:
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.OPENAI_API_BASE?.trim() ||
    'http://127.0.0.1:1234/v1',
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || caprigoEnv('OPENAI_API_KEY') || '',
};
const persistedLlmConfig = loadPersistedLLMConfig();
if (persistedLlmConfig) {
  llmState.provider = persistedLlmConfig.provider;
  // Persisted URL only when env did not pin Ollama (so .env remote host wins over old UI save).
  if (!envOllamaUrl) {
    llmState.ollamaUrl = persistedLlmConfig.ollamaUrl || llmState.ollamaUrl;
  }
  llmState.openaiBase = persistedLlmConfig.openaiBase || llmState.openaiBase;
  llmState.openaiApiKey = persistedLlmConfig.openaiApiKey || llmState.openaiApiKey;
}
const VIBES_API_BASE = process.env.VIBES_CODED_API_BASE || 'https://vibes-coded.com/api';

function openAIHealthTimeoutMs(): number {
  const raw = process.env.CAPRIGO_OPENAI_HEALTH_TIMEOUT_MS?.trim() || '40000';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5000 && n <= 120000 ? n : 40000;
}

function openAIModelsListUrl(): string {
  const base = llmState.openaiBase.replace(/\/$/, '');
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

/** Host responded in a way that usually means the API front is up (vs DNS/socket failure). */
function openAIDownstreamLooksReachable(httpStatus: number): boolean {
  return (
    (httpStatus >= 200 && httpStatus < 300) ||
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 429
  );
}
const VIBES_HAS_KEY = !!(process.env.VIBES_CODED_API_KEY?.trim() || caprigoEnv('VIBES_API_KEY'));
const VIBES_PACKS = caprigoEnv('VIBES_PACKS_DIR');

/** Optional UI label for the active LLM (e.g. LOCAL, TEAM). Set `CAPRIGO_LLM_BADGE`. */
const LLM_BADGE = process.env.CAPRIGO_LLM_BADGE?.trim() || null;

function createBackendFromRuntimeConfig(): OpenAICompatibleLLMBackend | OllamaLLMBackend {
  if (llmState.provider === 'openai_compatible') {
    return new OpenAICompatibleLLMBackend(llmState.openaiBase, llmState.openaiApiKey);
  }
  return new OllamaLLMBackend(llmState.ollamaUrl);
}

const llmBackend = createBackendFromRuntimeConfig();

// Create agent with default config
const boxProfile = /^(1|true|yes|box)$/i.test(String(process.env.CAPRIGO_BOX_PROFILE || ''));
const harnessProfile =
  !boxProfile && !/^(0|false|off|no)$/i.test(String(process.env.CAPRIGO_HARNESS_MODE ?? '1'));
const agent = new Agent(
  {
    id: 'main',
    name: 'Caprigo',
    model:
      process.env.DEFAULT_MODEL ||
      (llmState.provider === 'openai_compatible' ? 'local-model' : 'qwen3.5:latest'),
    temperature: 0.5,
    maxTokens: boxProfile ? 1024 : harnessProfile ? 4096 : 2048,
    optimizationProfile: boxProfile ? 'light' : 'balanced',
    ollamaNumCtx: boxProfile ? 4096 : 8192,
    laptopMode: boxProfile ? true : false,
    harnessMode: harnessProfile,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
  llmBackend
);
if (boxProfile) {
  console.log('[Gateway] CAPRIGO_BOX_PROFILE on — light + laptopMode (4k ctx, capped tools)');
} else if (harnessProfile) {
  console.log('[Gateway] Harness mode on — long-horizon tool budgets (LM Studio CLI profile)');
}

// Register core skills
coreSkills.forEach(skill => agent.registerSkill(skill));

/** Skill names contributed from user skills dir (for UI + GET /api/skills source). */
const userSkillNames = new Set<string>();
/** Hermes / agentskills.io-style SKILL.md instruction tools under skills/agentskills/. */
const agentSkillNames = new Set<string>();

// Load and register user skills
const userLoadResult = loadUserSkills();
userLoadResult.loaded.forEach((skill: Skill) => {
  agent.registerSkill(skill);
  userSkillNames.add(skill.name);
  console.log(`[Skills] Loaded user skill: ${skill.name}`);
});
userLoadResult.failed.forEach(({ path: p, error }: { path: string; error: string }) => {
  console.warn(`[Skills] Failed to load ${p}: ${error}`);
});

const skipHeavySkills =
  boxProfile || /^(1|true|yes)$/i.test(String(process.env.CAPRIGO_SKIP_AGENT_SKILLS || ''));
let agentSkillsLoaded = 0;
if (skipHeavySkills) {
  console.log('[Skills] Skipping agentskills + fleet (box / CAPRIGO_SKIP_AGENT_SKILLS)');
} else {
  const agentSkillsDir = path.join(getSkillsDir(), 'agentskills');
  const agentSkillsResult = loadAgentSkills(agentSkillsDir);
  agentSkillsResult.loaded.forEach((skill: Skill) => {
    agent.registerSkill(skill);
    agentSkillNames.add(skill.name);
    console.log(`[Agent skills] SKILL.md → ${skill.name}`);
  });
  agentSkillsResult.failed.forEach(({ path: p, error }: { path: string; error: string }) => {
    console.warn(`[Agent skills] Failed ${p}: ${error}`);
  });
  agentSkillsLoaded = agentSkillsResult.loaded.length;

  createFleetSkills(agent).forEach(s => {
    agent.registerSkill(s);
    console.log(`[Skills] Fleet tool: ${s.name}`);
  });
}

console.log(`[Skills] Directory: ${getSkillsDir()}`);
console.log(
  `[Skills] Total: ${agent.getSkills().length} (${coreSkills.length} core + ${userLoadResult.loaded.length} user + ${agentSkillsLoaded} agent-skill)`
);
console.log(`[Offline scripts] Directory: ${getOfflineScriptsDir()} (manifest.json or *.mjs/*.js scan)`);

agent.setActivitySink(handleAgentActivity);

const OFFLINE_SCRIPT_TIMEOUT_MS = Math.min(
  3_600_000,
  Math.max(
    5_000,
    parseInt(
      caprigoEnv('OFFLINE_SCRIPT_TIMEOUT_MS') ||
        '600000',
      10
    ) || 600000
  )
);

function runtimePayload() {
  const cfg = agent.getConfig();
  return {
    hostPlatform: process.platform,
    workspaceRoot: caprigoWorkspaceRoot(),
    mcp: {
      configPath: mcpServersConfigPath(),
      servers: getMcpServerStatuses(),
    },
    engine: {
      id: cfg.id,
      name: cfg.name,
      model: cfg.model,
      temperature: cfg.temperature ?? null,
      maxTokens: cfg.maxTokens ?? null,
      optimizationProfile: cfg.optimizationProfile ?? 'balanced',
      ollamaNumCtx: cfg.ollamaNumCtx ?? null,
      laptopMode: !!cfg.laptopMode,
      systemPrompt: cfg.systemPrompt ?? '',
    },
    skillsDir: getSkillsDir(),
    skillCount: agent.getSkills().length,
    leanTools: agent.isLeanToolsActive(),
    leanToolCount: agent.isLeanToolsActive() ? filterLeanSkills(agent.getSkills()).length : null,
    llmProvider: agent.getLLMProviderId(),
    llmBadge: LLM_BADGE,
    llmConnection: {
      provider: llmState.provider,
      ollamaUrl: llmState.ollamaUrl,
      openaiBase: llmState.openaiBase,
      openaiApiKeySet: !!llmState.openaiApiKey,
    },
  };
}

// Dashboard: safe runtime facts for the web UI (no secrets)
app.get('/api/runtime', (_: express.Request, res: express.Response) => {
  res.json(runtimePayload());
});

/** Installed Ollama model tags (local `ollama list` / manifests). Empty if provider is not Ollama or Ollama is unreachable. */
app.get('/api/ollama/models', async (_: express.Request, res: express.Response) => {
  const provider = agent.getLLMProviderId();
  const defaultModel = agent.getConfig().model;
  if (provider !== 'ollama') {
    return res.json({
      provider,
      models: [] as string[],
      defaultModel,
      ollamaUrl: null as string | null,
    });
  }
  const base = llmState.ollamaUrl.replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      return res.status(502).json({
        error: `Ollama returned HTTP ${r.status}`,
        provider: 'ollama',
        models: [],
        defaultModel,
        ollamaUrl: llmState.ollamaUrl,
      });
    }
    const j = (await r.json()) as { models?: Array<{ name?: string }> };
    const models = (j.models || [])
      .map(m => m.name)
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    models.sort((a, b) => a.localeCompare(b));
    res.json({ provider: 'ollama', models, defaultModel, ollamaUrl: llmState.ollamaUrl });
  } catch (e: any) {
    res.status(502).json({
      error: e?.message || 'Failed to reach Ollama',
      provider: 'ollama',
      models: [],
      defaultModel,
      ollamaUrl: llmState.ollamaUrl,
    });
  }
});

/** OpenAI-compatible `GET …/v1/models` (e.g. g4f `…/v1/models`, `…/api/gemini/v1/models`, OpenRouter, LM Studio). */
app.get('/api/openai/models', async (_: express.Request, res: express.Response) => {
  const provider = agent.getLLMProviderId();
  const defaultModel = agent.getConfig().model;
  if (provider !== 'openai_compatible' && provider !== 'openai') {
    return res.json({
      provider,
      models: [] as string[],
      defaultModel,
      baseUrl: null as string | null,
    });
  }
  const url = openAIModelsListUrl();
  const key = llmState.openaiApiKey || process.env.OPENAI_API_KEY?.trim() || caprigoEnv('OPENAI_API_KEY');
  const headers = openAICompatibleRequestHeaders({ bearerToken: key || null });
  try {
    const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(45000) });
    if (!r.ok) {
      return res.status(502).json({
        error: `Upstream returned HTTP ${r.status}`,
        provider,
        models: [] as string[],
        defaultModel,
        baseUrl: llmState.openaiBase,
      });
    }
    const j = (await r.json()) as { data?: Array<{ id?: string }> };
    const models = (j.data || [])
      .map(m => m.id)
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    models.sort((a, b) => a.localeCompare(b));
    res.json({ provider, models, defaultModel, baseUrl: llmState.openaiBase });
  } catch (e: any) {
    res.status(502).json({
      error: e?.message || 'Failed to fetch models',
      provider,
      models: [] as string[],
      defaultModel,
      baseUrl: llmState.openaiBase,
    });
  }
});

/** Host + gateway process stats for the system monitor widget (same host as the gateway). */
app.get('/api/system-monitor', (_: express.Request, res: express.Response) => {
  try {
    res.json(getSystemMonitorSnapshot());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read system stats' });
  }
});

// Live engine config (model, sampling, system prompt). LLM provider / env still require restart.
app.patch('/api/config', (req: express.Request, res: express.Response) => {
  const body = req.body || {};
  const patch: Partial<
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
  > = {};
  if (body.model !== undefined) patch.model = body.model;
  if (body.temperature !== undefined) patch.temperature = body.temperature;
  if (body.maxTokens !== undefined) patch.maxTokens = body.maxTokens;
  if (body.systemPrompt !== undefined) patch.systemPrompt = body.systemPrompt;
  if (body.name !== undefined) patch.name = body.name;
  if (body.optimizationProfile !== undefined) patch.optimizationProfile = body.optimizationProfile;
  if (body.ollamaNumCtx !== undefined) patch.ollamaNumCtx = body.ollamaNumCtx;
  if (body.laptopMode !== undefined) patch.laptopMode = !!body.laptopMode;
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      error:
        'No valid fields; send model, temperature, maxTokens, systemPrompt, name, optimizationProfile, ollamaNumCtx, and/or laptopMode',
    });
  }
  try {
    agent.updateConfig(patch);
    res.json(runtimePayload());
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Invalid config' });
  }
});

app.patch('/api/llm-config', (req: express.Request, res: express.Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const updates = body as Record<string, unknown>;
  let touched = false;
  const nextState: RuntimeLLMConfig = { ...llmState };

  if (updates.provider !== undefined) {
    const p = String(updates.provider).trim().toLowerCase();
    if (p !== 'ollama' && p !== 'openai' && p !== 'openai_compatible') {
      return res.status(400).json({ error: 'provider must be ollama or openai_compatible' });
    }
    nextState.provider = p === 'ollama' ? 'ollama' : 'openai_compatible';
    touched = true;
  }
  if (updates.ollamaUrl !== undefined) {
    const u = String(updates.ollamaUrl || '').trim();
    if (!u) return res.status(400).json({ error: 'ollamaUrl cannot be empty' });
    nextState.ollamaUrl = u;
    touched = true;
  }
  if (updates.openaiBase !== undefined) {
    const u = String(updates.openaiBase || '').trim();
    if (!u) return res.status(400).json({ error: 'openaiBase cannot be empty' });
    nextState.openaiBase = u;
    touched = true;
  }
  if (updates.openaiApiKey !== undefined) {
    nextState.openaiApiKey = String(updates.openaiApiKey || '').trim();
    touched = true;
  }
  if (!touched) {
    return res.status(400).json({
      error: 'No valid fields; send provider, ollamaUrl, openaiBase, and/or openaiApiKey',
    });
  }

  if (updates.defaultModel !== undefined) {
    const dm = String(updates.defaultModel || '').trim();
    if (!dm) return res.status(400).json({ error: 'defaultModel cannot be empty when provided' });
    try {
      agent.updateConfig({ model: dm });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || 'Invalid defaultModel' });
    }
  }
  llmState.provider = nextState.provider;
  llmState.ollamaUrl = nextState.ollamaUrl;
  llmState.openaiBase = nextState.openaiBase;
  llmState.openaiApiKey = nextState.openaiApiKey;
  savePersistedLLMConfig({
    provider: llmState.provider,
    ollamaUrl: llmState.ollamaUrl,
    openaiBase: llmState.openaiBase,
    openaiApiKey: llmState.openaiApiKey,
  });
  agent.setLLMBackend(createBackendFromRuntimeConfig());
  return res.json(runtimePayload());
});

/** MCP server definitions (stdio). Persisted under gateway/mcp-servers.json. */
app.get('/api/mcp-servers', (_: express.Request, res: express.Response) => {
  const file = loadMcpServers();
  res.json({
    configPath: mcpServersConfigPath(),
    servers: file.servers,
    status: getMcpServerStatuses(),
  });
});

app.patch('/api/mcp-servers', async (req: express.Request, res: express.Response) => {
  const v = validateMcpServersFile(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    saveMcpServers(v.data);
    await refreshMcpBridge(agent, v.data);
    res.json(runtimePayload());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'MCP refresh failed' });
  }
});

// Health
app.get('/health', async (_: express.Request, res: express.Response) => {
  let ollamaOk: boolean | null = null;
  let openaiOk: boolean | null = null;
  let openaiProbeHttpStatus: number | null = null;
  let openaiProbeDetail: string | null = null;
  if (agent.getLLMProviderId() === 'ollama') {
    try {
      const r = await fetch(`${llmState.ollamaUrl.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      ollamaOk = r.ok;
    } catch {
      ollamaOk = false;
    }
  } else {
    try {
      const key = process.env.OPENAI_API_KEY?.trim() || caprigoEnv('OPENAI_API_KEY');
      const headers = openAICompatibleRequestHeaders({ bearerToken: (llmState.openaiApiKey || key) || null });
      const url = openAIModelsListUrl();
      const r = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(openAIHealthTimeoutMs()),
      });
      openaiProbeHttpStatus = r.status;
      openaiOk = openAIDownstreamLooksReachable(r.status);
      if (!openaiOk) {
        const t = await r.text();
        openaiProbeDetail = t
          ? t.replace(/\s+/g, ' ').trim().slice(0, 280)
          : `HTTP ${r.status}`;
      }
    } catch (e: any) {
      openaiOk = false;
      openaiProbeHttpStatus = null;
      openaiProbeDetail =
        e?.name === 'AbortError'
          ? `timeout after ${openAIHealthTimeoutMs()}ms (try CAPRIGO_OPENAI_HEALTH_TIMEOUT_MS)`
          : e?.message || String(e);
    }
  }
  res.json({
    status: 'ok',
    skills: agent.getSkills().length,
    llm: {
      provider: agent.getLLMProviderId(),
      ollama_url: agent.getLLMProviderId() === 'ollama' ? llmState.ollamaUrl : null,
      ollama: ollamaOk === null ? null : ollamaOk ? 'ok' : 'not reachable',
      openai_base: agent.getLLMProviderId() === 'ollama' ? null : llmState.openaiBase,
      openai_api_key_set: agent.getLLMProviderId() === 'ollama' ? null : !!llmState.openaiApiKey,
      openai: openaiOk === null ? null : openaiOk ? 'ok' : 'not reachable',
      openai_probe_http_status: agent.getLLMProviderId() !== 'ollama' ? openaiProbeHttpStatus : null,
      openai_probe_detail: agent.getLLMProviderId() !== 'ollama' ? openaiProbeDetail : null,
      badge: LLM_BADGE,
    },
    vibes: {
      api_base: VIBES_API_BASE,
      api_key_set: VIBES_HAS_KEY,
      local_packs_dir: VIBES_PACKS || null,
    },
  });
});

/** Readiness probe for orchestrators/process managers. */
app.get('/ready', (_: express.Request, res: express.Response) => {
  res.json({ status: 'ready' });
});

// Offline scripts — spawned locally, no LLM; first run assigns script to the session.
app.get('/api/offline-scripts', (_: express.Request, res: express.Response) => {
  const root = getOfflineScriptsDir();
  try {
    const scripts = loadOfflineCatalog(root);
    res.json({ scripts, scriptsDir: root });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list offline scripts' });
  }
});

app.post('/api/sessions/:id/offline/run', async (req: express.Request, res: express.Response) => {
  const sessionId = req.params.id;
  const scriptId = req.body?.scriptId;
  const extraArgs = Array.isArray(req.body?.args) ? req.body.args.map((a: unknown) => String(a)) : [];
  if (!scriptId || typeof scriptId !== 'string') {
    return res.status(400).json({ error: 'scriptId required' });
  }
  if (!agent.getSession(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const root = getOfflineScriptsDir();
  let catalog: ReturnType<typeof loadOfflineCatalog>;
  try {
    catalog = loadOfflineCatalog(root);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Failed to load catalog' });
  }
  const entry = catalog.find(s => s.id === scriptId);
  if (!entry) {
    return res.status(404).json({ error: 'Unknown offline script' });
  }

  let abs: string;
  try {
    abs = resolveOfflineScriptAbs(root, entry);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || 'Bad script path' });
  }

  const started = Date.now();
  const taskId = randomUUID();
  setAgentStatus(sessionId, 'thinking');
  handleAgentActivity({ type: 'task_start', sessionId, taskId, label: `local: ${entry.name}` });

  try {
    const result = await runOfflineScriptFile({
      scriptAbsPath: abs,
      interpreter: entry.interpreter,
      cwd: root,
      args: extraArgs,
      timeoutMs: OFFLINE_SCRIPT_TIMEOUT_MS,
    });
    const exitCode = result.exitCode ?? -1;
    const ok = !result.error && result.exitCode === 0;
    agent.appendOfflineRun(sessionId, {
      scriptId: entry.id,
      scriptName: entry.name,
      stdout: result.stdout,
      stderr: result.stderr + (result.error ? `\n(${result.error})` : ''),
      exitCode,
      ok,
    });
    appendExecutionLog({
      ts: Date.now(),
      skill: `local:${entry.id}`,
      ok,
      durationMs: Date.now() - started,
      sessionId,
      paramsSummary: JSON.stringify({ args: extraArgs }),
      rationale: `Run the local script ${entry.name}.`,
      resultSummary: `exit=${exitCode}${result.error ? ` | error=${result.error}` : ''}`,
      outputChars: (result.stdout || '').length + (result.stderr || '').length,
    });
    handleAgentActivity({
      type: 'task_end',
      sessionId,
      taskId,
      ok,
      detail: result.error,
    });
    setAgentStatus(sessionId, 'idle');
    res.json({
      ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
      assignedOfflineScripts: agent.getSession(sessionId)?.assignedOfflineScripts ?? [],
    });
  } catch (err: any) {
    handleAgentActivity({
      type: 'task_end',
      sessionId,
      taskId,
      ok: false,
      detail: err?.message,
    });
    setAgentStatus(sessionId, 'error', err?.message);
    res.status(500).json({ error: err?.message || 'Offline run failed' });
  }
});

function normalizeRuntimeMode(raw: unknown): 'llm' | 'offline' | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'llm' || s === 'online') return 'llm';
  if (s === 'offline' || s === 'local') return 'offline';
  return null;
}

// Create session (launched agent card)
app.post('/api/sessions', (req: express.Request, res: express.Response) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawName = (body as Record<string, unknown>).displayName;
  const displayName = typeof rawName === 'string' ? rawName.trim() : '';
  const rawModeInput = (body as Record<string, unknown>).runtimeMode;
  const modeOnCreate = normalizeRuntimeMode(rawModeInput);
  if (rawModeInput !== undefined && modeOnCreate === null) {
    return res.status(400).json({ error: 'runtimeMode must be "llm" or "offline" (or "local" for offline)' });
  }
  const rawSkills = (body as Record<string, unknown>).assignedSkills;
  const rawRole = (body as Record<string, unknown>).agentRole;
  const rawLinked = (body as Record<string, unknown>).linkedOrchestratorId;
  const rawDesc = (body as Record<string, unknown>).description;
  const rawObj = (body as Record<string, unknown>).objective;
  const rawPrimary = (body as Record<string, unknown>).primaryOfflineScriptId;
  const rawOffList = (body as Record<string, unknown>).assignedOfflineScripts;
  const rawModel = (body as Record<string, unknown>).model;

  if (rawSkills !== undefined && !Array.isArray(rawSkills)) {
    return res.status(400).json({ error: 'assignedSkills must be an array of strings' });
  }
  if (rawOffList !== undefined && !Array.isArray(rawOffList)) {
    return res.status(400).json({ error: 'assignedOfflineScripts must be an array of strings' });
  }

  agent
    .createSession()
    .then(session => {
      const sid = session.id;
      try {
        registerLaunchedAgent(sid, displayName || `Agent ${sid.slice(0, 8)}`);
        if (modeOnCreate === 'offline') {
          agent.setSessionRuntimeMode(sid, 'offline');
        }

        if (typeof rawDesc === 'string') {
          agent.setSessionDescription(sid, rawDesc);
        }
        if (typeof rawObj === 'string') {
          agent.setSessionObjective(sid, rawObj);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'agentInstructionsPath')) {
          const rawInstr = (body as Record<string, unknown>).agentInstructionsPath;
          if (rawInstr !== null && typeof rawInstr !== 'string') {
            throw new Error('agentInstructionsPath must be a string or null');
          }
          agent.setSessionAgentInstructionsPath(sid, rawInstr === null ? undefined : rawInstr);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'agentInstructionsMarkdown')) {
          const rawInstrMd = (body as Record<string, unknown>).agentInstructionsMarkdown;
          if (rawInstrMd !== null && typeof rawInstrMd !== 'string') {
            throw new Error('agentInstructionsMarkdown must be a string or null');
          }
          agent.setSessionAgentInstructionsMarkdown(sid, rawInstrMd === null ? undefined : rawInstrMd);
        }

        if (rawSkills !== undefined) {
          agent.setSessionAssignedSkills(
            sid,
            (rawSkills as unknown[]).map((x: unknown) => String(x))
          );
        }

        if (rawRole !== undefined) {
          const rs = String(rawRole).toLowerCase();
          if (rs !== 'agent' && rs !== 'orchestrator' && rs !== 'standard') {
            throw new Error('agentRole must be "agent", "orchestrator", or legacy "standard"');
          }
          agent.setSessionAgentRole(sid, rs === 'orchestrator' ? 'orchestrator' : 'agent');
        }

        if (rawLinked !== undefined) {
          if (rawLinked === null || rawLinked === '') {
            agent.setSessionLinkedOrchestrator(sid, null);
          } else if (typeof rawLinked === 'string') {
            agent.setSessionLinkedOrchestrator(sid, rawLinked.trim());
          } else {
            throw new Error('linkedOrchestratorId must be a string or null');
          }
        }

        if (rawPrimary !== undefined) {
          if (rawPrimary === null || rawPrimary === '') {
            agent.setSessionPrimaryOfflineScript(sid, null);
          } else if (typeof rawPrimary === 'string') {
            const pid = rawPrimary.trim();
            const bad = assertKnownOfflineScriptIds([pid]);
            if (bad) throw new Error(bad);
            agent.setSessionPrimaryOfflineScript(sid, pid);
          } else {
            throw new Error('primaryOfflineScriptId must be a string or null');
          }
        }

        if (rawOffList !== undefined) {
          const ids = (rawOffList as unknown[]).map((x: unknown) => String(x));
          const bad = assertKnownOfflineScriptIds(ids);
          if (bad) throw new Error(bad);
          agent.setSessionAssignedOfflineScripts(sid, ids);
        }

        if (rawModel !== undefined) {
          if (rawModel === null || rawModel === '') {
            agent.setSessionModel(sid, null);
          } else if (typeof rawModel === 'string') {
            agent.setSessionModel(sid, rawModel);
          } else {
            throw new Error('model must be a string or null');
          }
        }

        const la = getLaunchedAgent(sid)!;
        const s = agent.getSession(sid)!;
        const mf = sessionModelFields(s);
        res.json({
          id: sid,
          displayName: la.displayName,
          createdAt: la.createdAt,
          runtimeMode: s.runtimeMode ?? 'llm',
          description: s.description ?? '',
          objective: s.objective ?? '',
          agentInstructionsPath: s.agentInstructionsPath ?? '',
          agentInstructionsMarkdown: s.agentInstructionsMarkdown ?? '',
          primaryOfflineScriptId: s.primaryOfflineScriptId ?? null,
          assignedOfflineScripts: s.assignedOfflineScripts ?? [],
          assignedSkills: s.assignedSkills?.length ? [...s.assignedSkills] : null,
          agentRole: normalizeFleetAssignment(s.agentRole),
          linkedOrchestratorId: s.linkedOrchestratorId ?? null,
          ...sessionTaskFields(s),
          model: mf.model,
          effectiveModel: mf.effectiveModel,
        });
      } catch (e: any) {
        agent.removeSession(sid);
        removeLaunchedAgent(sid);
        res.status(400).json({ error: e?.message || 'Invalid session options' });
      }
    })
    .catch(err => {
      res.status(500).json({ error: err.message });
    });
});

// List launched agents + task state
app.get('/api/sessions', (_: express.Request, res: express.Response) => {
  const sessions = agent.getSessions();
  const out = sessions.map(s => {
    const la = getLaunchedAgent(s.id) || ensureLaunchedAgent(s.id);
    const mf = sessionModelFields(s);
    return {
      id: s.id,
      displayName: la.displayName,
      createdAt: la.createdAt,
      status: la.status,
      tasks: la.tasks,
      messageCount: s.messages.length,
      lastError: la.lastError,
      description: s.description ?? '',
      objective: s.objective ?? '',
      agentInstructionsPath: s.agentInstructionsPath ?? '',
      agentInstructionsMarkdown: s.agentInstructionsMarkdown ?? '',
      assignedOfflineScripts: s.assignedOfflineScripts ?? [],
      primaryOfflineScriptId: s.primaryOfflineScriptId ?? null,
      assignedSkills: s.assignedSkills?.length ? [...s.assignedSkills] : null,
      runtimeMode: s.runtimeMode === 'offline' ? 'offline' : 'llm',
      agentRole: normalizeFleetAssignment(s.agentRole),
      linkedOrchestratorId: s.linkedOrchestratorId ?? null,
      ...sessionTaskFields(s),
      model: mf.model,
      effectiveModel: mf.effectiveModel,
    };
  });
  res.json({ sessions: out });
});

app.get('/api/orchestration-feed', (req: express.Request, res: express.Response) => {
  const raw = req.query.limit;
  const limit = Math.min(80, Math.max(1, parseInt(String(raw || '40'), 10) || 40));
  res.json({ entries: getOrchestrationFeed(limit) });
});

app.get('/api/sessions/:id/activity', (req: express.Request, res: express.Response) => {
  const s = agent.getSession(req.params.id);
  if (!s) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const la = ensureLaunchedAgent(req.params.id);
  const mf = sessionModelFields(s);
  res.json({
    id: s.id,
    displayName: la.displayName,
    status: la.status,
    tasks: la.tasks,
    messageCount: s.messages.length,
    lastError: la.lastError,
    description: s.description ?? '',
    objective: s.objective ?? '',
    assignedOfflineScripts: s.assignedOfflineScripts ?? [],
    primaryOfflineScriptId: s.primaryOfflineScriptId ?? null,
    assignedSkills: s.assignedSkills?.length ? [...s.assignedSkills] : null,
    runtimeMode: s.runtimeMode === 'offline' ? 'offline' : 'llm',
    agentRole: normalizeFleetAssignment(s.agentRole),
    linkedOrchestratorId: s.linkedOrchestratorId ?? null,
    ...sessionTaskFields(s),
    model: mf.model,
    effectiveModel: mf.effectiveModel,
  });
});

app.get('/api/sessions/:id/messages', (req: express.Request, res: express.Response) => {
  const s = agent.getSession(req.params.id);
  if (!s) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({
    messages: s.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.offline ? { offline: m.offline } : {}),
      ...(m.orchestration ? { orchestration: m.orchestration } : {}),
    })),
  });
});

app.patch('/api/sessions/:id', (req: express.Request, res: express.Response) => {
  const id = req.params.id;
  if (!agent.getSession(id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawName = (body as Record<string, unknown>).displayName;
  const rawSkills = (body as Record<string, unknown>).assignedSkills;
  const rawModeInput = (body as Record<string, unknown>).runtimeMode;
  const rawRole = (body as Record<string, unknown>).agentRole;
  const rawLinked = (body as Record<string, unknown>).linkedOrchestratorId;
  const rawDesc = (body as Record<string, unknown>).description;
  const rawObj = (body as Record<string, unknown>).objective;
  const rawPrimary = (body as Record<string, unknown>).primaryOfflineScriptId;
  const rawOffList = (body as Record<string, unknown>).assignedOfflineScripts;
  const rawModel = (body as Record<string, unknown>).model;

  let touched = false;
  if (typeof rawName === 'string') {
    const la = ensureLaunchedAgent(id);
    la.displayName = rawName.trim() || la.displayName;
    touched = true;
  }
  if (rawDesc !== undefined) {
    if (rawDesc !== null && typeof rawDesc !== 'string') {
      return res.status(400).json({ error: 'description must be a string or null' });
    }
    agent.setSessionDescription(id, rawDesc === null ? undefined : rawDesc);
    touched = true;
  }
  if (rawObj !== undefined) {
    if (rawObj !== null && typeof rawObj !== 'string') {
      return res.status(400).json({ error: 'objective must be a string or null' });
    }
    agent.setSessionObjective(id, rawObj === null ? undefined : rawObj);
    touched = true;
  }
  // Use `in` so explicit `null` from JSON is handled (missing key stays undefined).
  if (Object.prototype.hasOwnProperty.call(body, 'agentInstructionsPath')) {
    const rawInstr = (body as Record<string, unknown>).agentInstructionsPath;
    if (rawInstr !== null && typeof rawInstr !== 'string') {
      return res.status(400).json({ error: 'agentInstructionsPath must be a string or null' });
    }
    agent.setSessionAgentInstructionsPath(id, rawInstr === null ? undefined : rawInstr);
    touched = true;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'agentInstructionsMarkdown')) {
    const rawInstrMd = (body as Record<string, unknown>).agentInstructionsMarkdown;
    if (rawInstrMd !== null && typeof rawInstrMd !== 'string') {
      return res.status(400).json({ error: 'agentInstructionsMarkdown must be a string or null' });
    }
    agent.setSessionAgentInstructionsMarkdown(id, rawInstrMd === null ? undefined : rawInstrMd);
    touched = true;
  }
  if (rawSkills !== undefined) {
    if (!Array.isArray(rawSkills)) {
      return res.status(400).json({ error: 'assignedSkills must be an array of strings' });
    }
    agent.setSessionAssignedSkills(
      id,
      rawSkills.map((x: unknown) => String(x))
    );
    touched = true;
  }
  const normalizedMode = normalizeRuntimeMode(rawModeInput);
  if (rawModeInput !== undefined && normalizedMode === null) {
    return res.status(400).json({ error: 'runtimeMode must be "llm" or "offline" (or "local" for offline)' });
  }
  if (normalizedMode !== null) {
    agent.setSessionRuntimeMode(id, normalizedMode);
    touched = true;
  }
  if (rawRole !== undefined) {
    const rs = String(rawRole).toLowerCase();
    if (rs !== 'agent' && rs !== 'orchestrator' && rs !== 'standard') {
      return res.status(400).json({
        error: 'agentRole must be "agent", "orchestrator", or legacy "standard" (treated as agent)',
      });
    }
    agent.setSessionAgentRole(id, rs === 'orchestrator' ? 'orchestrator' : 'agent');
    touched = true;
  }
  if (rawLinked !== undefined) {
    if (rawLinked === null || rawLinked === '') {
      agent.setSessionLinkedOrchestrator(id, null);
    } else if (typeof rawLinked === 'string') {
      try {
        agent.setSessionLinkedOrchestrator(id, rawLinked.trim());
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || 'Invalid linkedOrchestratorId' });
      }
    } else {
      return res.status(400).json({ error: 'linkedOrchestratorId must be a string or null' });
    }
    touched = true;
  }
  if (rawPrimary !== undefined) {
    if (rawPrimary === null || rawPrimary === '') {
      agent.setSessionPrimaryOfflineScript(id, null);
    } else if (typeof rawPrimary === 'string') {
      const pid = rawPrimary.trim();
      const bad = assertKnownOfflineScriptIds([pid]);
      if (bad) return res.status(400).json({ error: bad });
      agent.setSessionPrimaryOfflineScript(id, pid);
    } else {
      return res.status(400).json({ error: 'primaryOfflineScriptId must be a string or null' });
    }
    touched = true;
  }
  if (rawOffList !== undefined) {
    if (!Array.isArray(rawOffList)) {
      return res.status(400).json({ error: 'assignedOfflineScripts must be an array of strings' });
    }
    const ids = (rawOffList as unknown[]).map((x: unknown) => String(x));
    const bad = assertKnownOfflineScriptIds(ids);
    if (bad) return res.status(400).json({ error: bad });
    agent.setSessionAssignedOfflineScripts(id, ids);
    touched = true;
  }
  if (rawModel !== undefined) {
    if (rawModel === null || rawModel === '') {
      agent.setSessionModel(id, null);
    } else if (typeof rawModel === 'string') {
      agent.setSessionModel(id, rawModel);
    } else {
      return res.status(400).json({ error: 'model must be a string or null' });
    }
    touched = true;
  }
  if (!touched) {
    const keys =
      body && typeof body === 'object' && !Array.isArray(body)
        ? Object.keys(body as Record<string, unknown>)
        : [];
    const hint =
      keys.length > 0
        ? ` Unrecognized or empty values for: ${keys.join(', ')}.`
        : ' No JSON fields were applied (empty body or missing Content-Type: application/json).';
    return res.status(400).json({
      error: `Send at least one of: displayName, description, objective, agentInstructionsPath, agentInstructionsMarkdown, assignedSkills, runtimeMode, agentRole, linkedOrchestratorId, primaryOfflineScriptId, assignedOfflineScripts, model.${hint}`,
    });
  }
  const la = ensureLaunchedAgent(id);
  const s = agent.getSession(id)!;
  const mf = sessionModelFields(s);
  res.json({
    id,
    displayName: la.displayName,
    description: s.description ?? '',
    objective: s.objective ?? '',
    agentInstructionsPath: s.agentInstructionsPath ?? '',
    agentInstructionsMarkdown: s.agentInstructionsMarkdown ?? '',
    assignedSkills: s.assignedSkills?.length ? [...s.assignedSkills] : null,
    assignedOfflineScripts: s.assignedOfflineScripts ?? [],
    primaryOfflineScriptId: s.primaryOfflineScriptId ?? null,
    runtimeMode: s.runtimeMode === 'offline' ? 'offline' : 'llm',
    agentRole: normalizeFleetAssignment(s.agentRole),
    linkedOrchestratorId: s.linkedOrchestratorId ?? null,
    ...sessionTaskFields(s),
    model: mf.model,
    effectiveModel: mf.effectiveModel,
  });
});

/** Best-effort cancel for in-flight LLM turn (tool loop). */
app.post('/api/sessions/:id/stop', (req: express.Request, res: express.Response) => {
  const id = req.params.id;
  if (!agent.getSession(id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  agent.requestTurnCancel(id);
  setAgentStatus(id, 'idle');
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', (req: express.Request, res: express.Response) => {
  const id = req.params.id;
  const ok = agent.removeSession(id);
  removeLaunchedAgent(id);
  if (!ok) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ ok: true });
});

// Send message
app.post('/api/sessions/:id/messages', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  const sess = agent.getSession(id);
  if (!sess) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (sess.runtimeMode === 'offline') {
    return res.status(400).json({
      error:
        'This agent is offline-only. Switch it to LLM on the Workspace card to chat, or run disk scripts from that card.',
    });
  }
  clearTasksForTurn(id);
  setAgentStatus(id, 'thinking');
  const t0 = Date.now();
  try {
    const response = await agent.processMessage(id, message);
    setAgentStatus(id, 'idle');
    const stats = agent.getLastTurnStats();
    res.json({
      response,
      usage: stats
        ? {
            promptTokens: stats.promptTokens,
            completionTokens: stats.completionTokens,
            totalTokens: stats.totalTokens,
          }
        : undefined,
      meta: stats
        ? {
            llmCalls: stats.llmCalls,
            tools: stats.tools,
            elapsedMs: stats.elapsedMs,
            wallMs: Date.now() - t0,
          }
        : { wallMs: Date.now() - t0 },
    });
  } catch (err: any) {
    const msg = err?.message || 'Failed to process message';
    if (/offline-only/i.test(msg)) {
      setAgentStatus(id, 'idle');
      return res.status(400).json({ error: msg });
    }
    const isOllamaError =
      agent.getLLMProviderId() === 'ollama' &&
      /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|Ollama|timed out/i.test(msg);
    /** Only nudge env vars for connectivity / bad key — not 402 balance, quotas, or model errors. */
    const suggestOpenAiEnv =
      agent.getLLMProviderId() === 'openai_compatible' &&
      (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|getaddrinfo|network|ConnectTimeoutError/i.test(
        msg,
      ) ||
        /OpenAI-compatible API error \(\s*401\b|OpenAI-compatible API error \(\s*403\b/i.test(msg));
    const suggestProviderBalance =
      agent.getLLMProviderId() === 'openai_compatible' &&
      /\b402\b|PAYMENT_REQUIRED|Insufficient balance|insufficient credits|insufficient quota/i.test(msg);
    const suggestOpenAiTimeout =
      agent.getLLMProviderId() === 'openai_compatible' &&
      (/AbortError|aborted|operation was aborted/i.test(msg) || /timed out/i.test(msg));
    const hint = isOllamaError
      ? /timed out|CAPRIGO_OLLAMA_TIMEOUT_MS/i.test(msg)
        ? ''
        : ' Make sure Ollama is running (ollama serve) and you have a model (e.g. ollama pull qwen3:latest).'
      : suggestOpenAiEnv
        ? ' Check OPENAI_BASE_URL, OPENAI_API_KEY, and DEFAULT_MODEL for your provider.'
        : suggestProviderBalance
          ? ' Add credits or pollen at your API host, or pick a cheaper model in Settings.'
          : '';
    const openAiTimeoutHint = suggestOpenAiTimeout
      ? ' If the model was still generating, increase CAPRIGO_OPENAI_CHAT_TIMEOUT_MS (default 600000 ms) and restart the gateway.'
      : '';
    console.error('[Gateway] Message error:', msg);
    setAgentStatus(id, 'error', msg + hint + openAiTimeoutHint);
    res.status(500).json({ error: msg + hint + openAiTimeoutHint });
  }
});

/** SSE streaming variant of POST /messages — live status/token/think/tool events. */
app.post('/api/sessions/:id/messages/stream', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  const sess = agent.getSession(id);
  if (!sess) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (sess.runtimeMode === 'offline') {
    return res.status(400).json({
      error:
        'This agent is offline-only. Switch it to LLM on the Workspace card to chat, or run disk scripts from that card.',
    });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as express.Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as express.Response & { flushHeaders: () => void }).flushHeaders();
  }

  const writeEvent = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const anyRes = res as express.Response & { flush?: () => void };
    if (typeof anyRes.flush === 'function') anyRes.flush();
  };

  let streamedTokens = 0;
  let livePhase: 'thinking' | 'working' | 'streaming' | 'idle' | 'error' = 'thinking';
  const prevSink = handleAgentActivity;
  agent.setActivitySink(e => {
    prevSink(e);
    if (e.type === 'status') {
      if (
        e.phase === 'thinking' ||
        e.phase === 'working' ||
        e.phase === 'streaming' ||
        e.phase === 'idle' ||
        e.phase === 'error'
      ) {
        livePhase = e.phase;
      }
      writeEvent('status', { phase: e.phase, detail: e.detail, sessionId: e.sessionId });
    } else if (e.type === 'token') {
      streamedTokens += e.text?.length || 0;
      livePhase = 'streaming';
      writeEvent('token', { text: e.text, sessionId: e.sessionId });
    } else if (e.type === 'think') {
      writeEvent('think', { text: e.text, sessionId: e.sessionId });
    } else if (e.type === 'task_start') {
      livePhase = 'working';
      writeEvent('tool_start', {
        taskId: e.taskId,
        label: e.label,
        sessionId: e.sessionId,
      });
    } else if (e.type === 'task_end') {
      writeEvent('tool_end', {
        taskId: e.taskId,
        ok: e.ok,
        detail: e.detail,
        sessionId: e.sessionId,
      });
    }
  });

  clearTasksForTurn(id);
  setAgentStatus(id, 'thinking');
  writeEvent('status', { phase: 'thinking', sessionId: id });
  const t0 = Date.now();
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    if (livePhase !== 'thinking' && livePhase !== 'working') return;
    const sec = Math.round((Date.now() - t0) / 1000);
    writeEvent('status', { phase: livePhase, detail: `${sec}s`, sessionId: id });
  }, 1000);

  try {
    const response = await agent.processMessage(id, message);
    clearInterval(heartbeat);
    setAgentStatus(id, 'idle');
    if (response && streamedTokens === 0) {
      writeEvent('status', { phase: 'streaming', sessionId: id });
      writeEvent('token', { text: response, sessionId: id });
    }
    const stats = agent.getLastTurnStats();
    writeEvent('status', { phase: 'idle', sessionId: id });
    writeEvent('done', {
      response,
      usage: stats
        ? {
            promptTokens: stats.promptTokens,
            completionTokens: stats.completionTokens,
            totalTokens: stats.totalTokens,
          }
        : undefined,
      meta: stats
        ? {
            llmCalls: stats.llmCalls,
            tools: stats.tools,
            elapsedMs: stats.elapsedMs,
            wallMs: Date.now() - t0,
          }
        : { wallMs: Date.now() - t0 },
    });
  } catch (err: any) {
    clearInterval(heartbeat);
    const msg = err?.message || 'Failed to process message';
    if (/offline-only/i.test(msg)) {
      setAgentStatus(id, 'idle');
      writeEvent('error', { error: msg });
    } else {
      const isOllamaError =
        agent.getLLMProviderId() === 'ollama' &&
        /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|Ollama|timed out/i.test(msg);
      const suggestOpenAiEnv =
        agent.getLLMProviderId() === 'openai_compatible' &&
        (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|getaddrinfo|network|ConnectTimeoutError/i.test(
          msg
        ) ||
          /OpenAI-compatible API error \(\s*401\b|OpenAI-compatible API error \(\s*403\b/i.test(msg));
      const suggestProviderBalance =
        agent.getLLMProviderId() === 'openai_compatible' &&
        /\b402\b|PAYMENT_REQUIRED|Insufficient balance|insufficient credits|insufficient quota/i.test(msg);
      const suggestOpenAiTimeout =
        agent.getLLMProviderId() === 'openai_compatible' &&
        (/AbortError|aborted|operation was aborted/i.test(msg) || /timed out/i.test(msg));
      const hint = isOllamaError
        ? /timed out|CAPRIGO_OLLAMA_TIMEOUT_MS/i.test(msg)
          ? ''
          : ' Make sure Ollama is running (ollama serve) and you have a model (e.g. ollama pull qwen3:latest).'
        : suggestOpenAiEnv
          ? ' Check OPENAI_BASE_URL, OPENAI_API_KEY, and DEFAULT_MODEL for your provider.'
          : suggestProviderBalance
            ? ' Add credits or pollen at your API host, or pick a cheaper model in Settings.'
            : '';
      const openAiTimeoutHint = suggestOpenAiTimeout
        ? ' If the model was still generating, increase CAPRIGO_OPENAI_CHAT_TIMEOUT_MS (default 600000 ms) and restart the gateway.'
        : '';
      console.error('[Gateway] Stream message error:', msg);
      setAgentStatus(id, 'error', msg + hint + openAiTimeoutHint);
      writeEvent('error', { error: msg + hint + openAiTimeoutHint });
    }
  } finally {
    clearInterval(heartbeat);
    agent.setActivitySink(handleAgentActivity);
    if (!res.writableEnded) res.end();
  }
});

// Recent skill execution log (JSON lines, newest at end of array)
app.get('/api/execution-log', (req: express.Request, res: express.Response) => {
  const raw = req.query.limit;
  const limit = Math.min(500, Math.max(1, parseInt(String(raw || '100'), 10) || 100));
  try {
    const entries = readExecutionLogTail(limit);
    res.json({ entries, count: entries.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read log' });
  }
});

/** Files Caprigo wrote/edited via tools (durable JSONL under CAPRIGO_HOME). */
app.get('/api/file-ledger', (req: express.Request, res: express.Response) => {
  const raw = req.query.limit;
  const limit = Math.min(200, Math.max(1, parseInt(String(raw || '40'), 10) || 40));
  try {
    const touched = summarizeTouchedFiles(limit);
    const events = readFileLedgerTail(Math.min(limit * 2, 200));
    res.json({ touched, events, count: touched.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read file ledger' });
  }
});

app.get('/api/memory', (req: express.Request, res: express.Response) => {
  const rawLimit = parseInt(String(req.query.limit || '20'), 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const q = String(req.query.q || '').trim().toLowerCase();
  try {
    const store = readMemoryStore();
    const entries = Object.entries(store)
      .map(([key, entry]) => ({ key, ...entry }))
      .filter(entry => {
        if (!q) return true;
        const hay = JSON.stringify(entry).toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    res.json({ entries, count: entries.length, query: q });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read memory' });
  }
});

app.get('/api/memory/:key', (req: express.Request, res: express.Response) => {
  const key = String(req.params.key || '').trim();
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const store = readMemoryStore();
    const entry = store[key];
    if (!entry) return res.status(404).json({ error: 'Memory key not found' });
    res.json({ key, ...entry });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read memory' });
  }
});

function summarizeTraceEstimates(entries: Array<{
  durationMs?: number;
  outputChars?: number;
  paramsSummary?: string;
  rationale?: string;
  resultSummary?: string;
}>): {
  estimatedContextTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  pressure: 'light' | 'watch' | 'heavy';
  costSignal: 'low' | 'watch' | 'high';
} {
  const estimateTokens = (chars: number) => Math.max(0, Math.round(chars / 4));
  const totals = entries.reduce<{
    durationMs: number;
    outputChars: number;
    contextChars: number;
  }>(
    (acc, entry) => {
      acc.durationMs += entry.durationMs || 0;
      acc.outputChars += entry.outputChars || 0;
      acc.contextChars += (entry.paramsSummary?.length ?? 0) + (entry.rationale?.length ?? 0) + (entry.resultSummary?.length ?? 0);
      return acc;
    },
    { durationMs: 0, outputChars: 0, contextChars: 0 }
  );
  const estimatedContextTokens = estimateTokens(totals.contextChars);
  const estimatedOutputTokens = estimateTokens(totals.outputChars);
  const estimatedTotalTokens = estimatedContextTokens + estimatedOutputTokens;
  const pressure: 'light' | 'watch' | 'heavy' =
    totals.outputChars > 20000 || totals.durationMs > 45000 || entries.length >= 16
      ? 'heavy'
      : totals.outputChars > 8000 || totals.durationMs > 18000 || entries.length >= 8
        ? 'watch'
        : 'light';
  const costSignal: 'low' | 'watch' | 'high' =
    estimatedTotalTokens > 12000 || totals.durationMs > 45000
      ? 'high'
      : estimatedTotalTokens > 5000 || totals.durationMs > 18000
        ? 'watch'
        : 'low';
  return {
    estimatedContextTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    pressure,
    costSignal,
  };
}

app.get('/api/sessions/:id/execution-log', (req: express.Request, res: express.Response) => {
  const sessionId = req.params.id;
  if (!agent.getSession(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const raw = req.query.limit;
  const limit = Math.min(200, Math.max(1, parseInt(String(raw || '40'), 10) || 40));
  try {
    const entries = readExecutionLogTail(500).filter(entry => entry.sessionId === sessionId).slice(-limit);
    const totals = entries.reduce(
      (acc, entry) => {
        acc.count += 1;
        acc.durationMs += entry.durationMs || 0;
        acc.outputChars += entry.outputChars || 0;
        if (!entry.ok) acc.failures += 1;
        return acc;
      },
      { count: 0, failures: 0, durationMs: 0, outputChars: 0 }
    );
    const estimates = summarizeTraceEstimates(entries);
    res.json({ entries, count: entries.length, totals: { ...totals, ...estimates } });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to read session log' });
  }
});

app.get('/api/sessions/:id/execution-log/export', (req: express.Request, res: express.Response) => {
  const sessionId = req.params.id;
  const session = agent.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const format = String(req.query.format || 'markdown').toLowerCase();
  const entries = readExecutionLogTail(500).filter(entry => entry.sessionId === sessionId);
  const totals = entries.reduce(
    (acc, entry) => {
      acc.count += 1;
      acc.durationMs += entry.durationMs || 0;
      acc.outputChars += entry.outputChars || 0;
      if (!entry.ok) acc.failures += 1;
      return acc;
    },
    { count: 0, failures: 0, durationMs: 0, outputChars: 0 }
  );
  const estimates = summarizeTraceEstimates(entries);
  const payload = {
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      displayName: getLaunchedAgent(sessionId)?.displayName || 'Agent',
      runtimeMode: session.runtimeMode === 'offline' ? 'offline' : 'llm',
      agentRole: normalizeFleetAssignment(session.agentRole),
      ...sessionTaskFields(session),
      model: session.model || agent.getConfig().model,
      description: session.description || '',
      objective: session.objective || '',
    },
    totals: { ...totals, ...estimates },
    entries,
  };
  if (format === 'json') {
    return res.json(payload);
  }
  const lines: string[] = [
    `# Caprigo Trace Export`,
    '',
    `- Exported: ${payload.exportedAt}`,
    `- Agent: ${payload.session.displayName}`,
    `- Session ID: ${payload.session.id}`,
    `- Runtime: ${payload.session.runtimeMode}`,
    `- Fleet role: ${payload.session.agentRole}`,
    `- Model: ${payload.session.model}`,
    `- Tool calls: ${totals.count}`,
    `- Failures: ${totals.failures}`,
    `- Total duration (ms): ${totals.durationMs}`,
    `- Output chars: ${totals.outputChars}`,
    `- Estimated context tokens: ${estimates.estimatedContextTokens}`,
    `- Estimated output tokens: ${estimates.estimatedOutputTokens}`,
    `- Estimated total tokens: ${estimates.estimatedTotalTokens}`,
    `- Pressure: ${estimates.pressure}`,
    `- Cost signal: ${estimates.costSignal}`,
    '',
  ];
  if (payload.session.description) {
    lines.push(`## Description`, '', payload.session.description, '');
  }
  if (payload.session.objective) {
    lines.push(`## Objective`, '', payload.session.objective, '');
  }
  lines.push('## Entries', '');
  if (entries.length === 0) {
    lines.push('No trace entries recorded for this session yet.', '');
  } else {
    entries.forEach((entry, index) => {
      lines.push(`### ${index + 1}. ${entry.skill}`);
      lines.push(`- Time: ${new Date(entry.ts).toISOString()}`);
      lines.push(`- Status: ${entry.ok ? 'ok' : 'error'}`);
      lines.push(`- Duration: ${entry.durationMs} ms`);
      if (typeof entry.outputChars === 'number') lines.push(`- Output chars: ${entry.outputChars}`);
      if (entry.rationale) lines.push(`- Why: ${entry.rationale}`);
      if (entry.resultSummary) lines.push(`- Result: ${entry.resultSummary}`);
      if (entry.paramsSummary) lines.push(`- Params: ${entry.paramsSummary}`);
      if (entry.error) lines.push(`- Error: ${entry.error}`);
      lines.push('');
    });
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(lines.join('\n'));
});

/** Re-scan skills directory and register (handles cwd changes and new files without restart). */
function mergeUserSkillsFromDisk(): void {
  const result = loadUserSkills();
  const seen = new Set<string>();
  result.loaded.forEach((skill: Skill) => seen.add(skill.name));
  for (const name of Array.from(userSkillNames)) {
    if (!seen.has(name)) {
      agent.unregisterSkill(name);
      userSkillNames.delete(name);
    }
  }
  result.loaded.forEach((skill: Skill) => {
    agent.registerSkill(skill);
    userSkillNames.add(skill.name);
  });

  if (!skipHeavySkills) {
    const ar = loadAgentSkills(path.join(getSkillsDir(), 'agentskills'));
    const seenA = new Set(ar.loaded.map((s: Skill) => s.name));
    for (const name of Array.from(agentSkillNames)) {
      if (!seenA.has(name)) {
        agent.unregisterSkill(name);
        agentSkillNames.delete(name);
      }
    }
    ar.loaded.forEach((skill: Skill) => {
      agent.registerSkill(skill);
      agentSkillNames.add(skill.name);
    });
  }
}

const LOCAL_SKILLS_DB_FILE = '.caprigo-skills-db.json';

/** Persist a JSON snapshot of user (disk) skills next to the skills directory for tooling and backup. */
function persistLocalSkillsDatabase(): void {
  const root = getSkillsDir();
  const skills = agent.getSkills().map(s => ({
    name: s.name,
    description: s.description,
    source: (userSkillNames.has(s.name) ? 'user' : 'core') as 'user' | 'core',
  }));
  const localOnly = skills.filter(s => s.source === 'user');
  const payload = {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    skillsDir: root,
    count: localOnly.length,
    skills: localOnly,
  };
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    fs.writeFileSync(path.join(root, LOCAL_SKILLS_DB_FILE), JSON.stringify(payload, null, 2), 'utf8');
  } catch (e: any) {
    console.warn('[Skills] Could not write local skills database:', e?.message || e);
  }
}

// List skills (source: core = bundled engine, user = disk, marketplace = imported from Vibes-Coded)
app.get('/api/skills', (_: express.Request, res: express.Response) => {
  mergeUserSkillsFromDisk();
  const dir = getSkillsDir();
  const vibesMap = mapVibesMarketplaceBySkillName(dir);
  const mcpNames = new Set(getMcpRegisteredSkillNames());
  const skills = agent.getSkills().map(s => {
    const isUser = userSkillNames.has(s.name);
    const vm = isUser ? vibesMap.get(s.name) : undefined;
    const source: 'core' | 'user' | 'marketplace' | 'mcp' | 'agentskill' = mcpNames.has(s.name)
      ? 'mcp'
      : agentSkillNames.has(s.name)
        ? 'agentskill'
        : !isUser
          ? 'core'
          : vm
            ? 'marketplace'
            : 'user';
    return {
      name: s.name,
      description: s.description,
      source,
      ...(vm ? { vibesListingId: vm.listingId, vibesTitle: vm.title ?? null } : {}),
    };
  });
  persistLocalSkillsDatabase();
  res.json({
    skills,
    skillsDir: dir,
    localSkillsDbFile: path.join(dir, LOCAL_SKILLS_DB_FILE),
  });
});

/** Public marketplace search (proxies Vibes-Coded GET /listings). */
app.get('/api/vibes/listings', async (req: express.Request, res: express.Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const data = await vibesBrowseListings(VIBES_API_BASE, {
      q: q.q,
      page: q.page,
      page_size: q.page_size ?? q.pageSize,
      listing_kind: q.listing_kind ?? q.kind,
      category: q.category,
    });
    const normalized = normalizeListingHits(data);
    res.json({ raw: data, listings: normalized });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Vibes listings request failed' });
  }
});

function sanitizeSkillFolder(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(t)) return null;
  return t;
}

function folderUnderSkillsRoot(root: string, folder: string): string | null {
  const target = path.resolve(root, folder);
  const rel = path.relative(path.resolve(root), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function extractListingTitleFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.title === 'string') return o.title;
  const ip = o.importPayload;
  if (ip && typeof ip === 'object' && typeof (ip as Record<string, unknown>).title === 'string') {
    return (ip as Record<string, unknown>).title as string;
  }
  return null;
}

/**
 * Write skill JS to `<skillsDir>/<folder>/index.js`, register tools, optional `.vibes-source.json`.
 * Clears `.vibes-source.json` when saving a non-Vibes skill over a folder that had one.
 */
function persistSkillFolderToAgent(
  folder: string,
  code: string,
  vibesMeta?: { listingId: string; title?: string }
): { ok: true; skills: Skill[]; path: string } | { ok: false; error: string } {
  if (code.length > 400_000) {
    return { ok: false, error: 'code too large (max 400k chars)' };
  }
  const root = getSkillsDir();
  try {
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    const abs = folderUnderSkillsRoot(root, folder);
    if (!abs) {
      return { ok: false, error: 'invalid folder' };
    }
    const indexPath = path.join(abs, 'index.js');
    const tmpPath = `${indexPath}.tmp`;

    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(tmpPath, code, 'utf8');

    const trial = loadSkillsFromFile(tmpPath);
    if (trial.failed.length) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      return { ok: false, error: trial.failed[0]?.error || 'Invalid skill module' };
    }
    if (trial.loaded.length === 0) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      return { ok: false, error: 'Module must export at least one valid skill' };
    }

    if (fs.existsSync(indexPath)) {
      const prev = loadSkillsFromFile(indexPath);
      prev.loaded.forEach(s => {
        agent.unregisterSkill(s.name);
        userSkillNames.delete(s.name);
      });
    }

    fs.copyFileSync(tmpPath, indexPath);
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }

    delete require.cache[require.resolve(indexPath)];
    const fin = loadSkillsFromFile(indexPath);
    if (fin.failed.length || fin.loaded.length === 0) {
      return { ok: false, error: fin.failed[0]?.error || 'Reload failed after save' };
    }
    fin.loaded.forEach((s: Skill) => {
      agent.registerSkill(s);
      userSkillNames.add(s.name);
    });

    const vibesMetaPath = path.join(abs, '.vibes-source.json');
    if (vibesMeta) {
      fs.writeFileSync(
        vibesMetaPath,
        JSON.stringify(
          {
            listingId: vibesMeta.listingId,
            title: vibesMeta.title ?? null,
            skillNames: fin.loaded.map(s => s.name),
            importedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } else if (fs.existsSync(vibesMetaPath)) {
      try {
        fs.unlinkSync(vibesMetaPath);
      } catch {
        /* ignore */
      }
    }

    persistLocalSkillsDatabase();
    return { ok: true, skills: fin.loaded, path: indexPath };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to save skill' };
  }
}

/** Import a Vibes-Coded listing’s Caprigo skill artifact into the local skills directory. */
app.post('/api/vibes/install', async (req: express.Request, res: express.Response) => {
  const disVib =
    caprigoEnv('DISABLE_VIBES_INSTALL');
  if (disVib === '1' || disVib === 'true') {
    return res.status(403).json({
      error: 'Vibes install disabled (set CAPRIGO_DISABLE_VIBES_INSTALL)',
    });
  }
  const listingId = req.body?.listingId ?? req.body?.listing_id;
  if (listingId === undefined || listingId === null || listingId === '') {
    return res.status(400).json({ error: 'listingId required' });
  }
  const lid = String(listingId);
  const folderRaw = req.body?.folder;
  const folder =
    (typeof folderRaw === 'string' && sanitizeSkillFolder(folderRaw)) || defaultVibesFolder(lid);

  const key =
    process.env.VIBES_CODED_API_KEY?.trim() || caprigoEnv('VIBES_API_KEY');
  try {
    const payload = await vibesFetchImportPayload(VIBES_API_BASE, lid, key);
    if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).success === false) {
      return res.status(502).json({
        error: String((payload as Record<string, unknown>).error || 'Vibes API error'),
        detail: payload,
      });
    }
    const code = extractCaprigoSkillCode(payload);
    if (!code) {
      return res.status(422).json({
        error:
          'No Caprigo skill module found in the Vibes import response. Try VIBES_CODED_API_KEY for paid listings, or pick a listing that ships a Caprigo runtime artifact.',
      });
    }
    const title = extractListingTitleFromPayload(payload);
    const result = persistSkillFolderToAgent(folder, code, { listingId: lid, title: title ?? undefined });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    mergeUserSkillsFromDisk();
    console.log(`[Vibes] Installed listing ${lid} → ${folder} (${result.skills.map(s => s.name).join(', ')})`);
    res.json({
      ok: true,
      folder,
      path: result.path,
      skills: result.skills.map(s => ({
        name: s.name,
        description: s.description,
        source: 'marketplace' as const,
      })),
    });
  } catch (e: any) {
    console.error('[Vibes] install:', e);
    res.status(500).json({ error: e?.message || 'Vibes install failed' });
  }
});

/** Create or update `<skillsDir>/<folder>/index.js` and hot-register with the agent. */
app.post('/api/user-skills', (req: express.Request, res: express.Response) => {
  const disUp = caprigoEnv('DISABLE_SKILL_UPLOAD');
  if (disUp === '1' || disUp === 'true') {
    return res.status(403).json({
      error: 'Skill upload disabled (set CAPRIGO_DISABLE_SKILL_UPLOAD)',
    });
  }
  const folder = sanitizeSkillFolder(req.body?.folder);
  const code = req.body?.code;
  if (!folder || typeof code !== 'string') {
    return res.status(400).json({ error: 'folder (slug, e.g. my_tool) and code (string) required' });
  }

  const result = persistSkillFolderToAgent(folder, code);
  if (!result.ok) {
    const status = result.error.includes('too large') ? 400 : result.error.includes('Reload') ? 500 : 400;
    return res.status(status).json({ error: result.error });
  }

  console.log(`[Skills] Saved user skill file: ${result.path} (${result.skills.map(s => s.name).join(', ')})`);
  res.json({
    ok: true,
    path: result.path,
    skills: result.skills.map(s => ({ name: s.name, description: s.description, source: 'user' as const })),
  });
});

// Serve web dashboard (if built)
const webDist = path.join(__dirname, '../../web/dist');
try {
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        etag: false,
        lastModified: false,
        setHeaders(res) {
          res.setHeader('Cache-Control', 'no-store');
        },
      })
    );
    app.get('*', (_: express.Request, res: express.Response) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }
} catch {
  // Ignore if web not built
}

let httpServer: Server | undefined;
let shuttingDown = false;

const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Gateway] ${signal} received, shutting down...`);
  void (async () => {
    try {
      await closeMcpBridge();
    } catch (e: any) {
      console.warn('[MCP] Shutdown close error:', e?.message || e);
    }
    if (!httpServer) {
      process.exit(0);
      return;
    }
    httpServer.close(err => {
      if (err) {
        console.error('[Gateway] Shutdown error:', err);
        process.exit(1);
        return;
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  })();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

void (async () => {
  try {
    await refreshMcpBridge(agent, loadMcpServers());
  } catch (e: any) {
    console.error('[MCP] Initial connection failed:', e?.message || e);
  }

  httpServer = app.listen(PORT, HOST, () => {
    console.log(`[Gateway] Caprigo Core running on http://localhost:${PORT}`);
    console.log(`[Gateway] Bind host: ${HOST}`);
    console.log(
      `[Gateway] LLM: ${agent.getLLMProviderId()}${
        agent.getLLMProviderId() === 'ollama' ? ` (${llmState.ollamaUrl})` : ` (${llmState.openaiBase})`
      }`
    );
    console.log(`[Gateway] Add skills to: ${getSkillsDir()}`);
    console.log(`[Gateway] MCP config: ${mcpServersConfigPath()} (${getMcpServerStatuses().length} server rows)`);
    console.log(
      `[Gateway] Vibes-Coded: api=${VIBES_API_BASE} key=${VIBES_HAS_KEY ? 'set' : 'unset'} packs=${VIBES_PACKS || '(unset)'}`
    );
  });
})();
