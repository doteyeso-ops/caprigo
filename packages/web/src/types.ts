export interface TaskRow {
  taskId: string;
  status: string;
  done: boolean;
  permissionWait?: boolean;
}

export type TaskState = 'continue' | 'done' | 'blocked';

/** Catalog entry from GET /api/offline-scripts (disk scripts, no LLM). */
export interface LocalScriptItem {
  id: string;
  name: string;
  description: string;
  relPath: string;
  interpreter: string;
}

/** @deprecated Use LocalScriptItem */
export type OfflineScriptItem = LocalScriptItem;

/** Entry from GET /api/skills */
export interface SkillListItem {
  name: string;
  description: string;
  source: 'core' | 'user' | 'marketplace' | 'mcp' | 'agentskill';
  /** When imported from Vibes-Coded (see `.vibes-source.json`). */
  vibesListingId?: string | null;
  vibesTitle?: string | null;
}

export interface AgentCardModel {
  id: string;
  displayName: string;
  createdAt: number;
  status: 'idle' | 'thinking' | 'error';
  tasks: TaskRow[];
  messageCount: number;
  lastError?: string;
  /** Short description for cards and builder. */
  description?: string;
  /** Optional “what this agent is for” (UI only; not the global engine system prompt). */
  objective?: string;
  /** Explicit task progress for the current objective. */
  taskState?: TaskState;
  /** Short checkpoint note for the current objective. */
  taskSummary?: string;
  /** Last time the task checkpoint was updated. */
  taskCheckpointAt?: number;
  /** Markdown path relative to gateway workspace; merged into LLM system prompt for this agent. */
  agentInstructionsPath?: string;
  /** Inline markdown task / playbook for this agent (LLM system prompt). */
  agentInstructionsMarkdown?: string;
  /** Local script ids linked to this agent (runs history and/or builder). */
  assignedOfflineScripts?: string[];
  /** Preferred script for Workspace Run / builder (catalog id). */
  primaryOfflineScriptId?: string | null;
  /** Whitelisted skill names for chat tools; null/omitted = all registered skills. */
  assignedSkills?: string[] | null;
  /** `llm` = server model (Ollama / OpenAI-compatible); `offline` = disk scripts only, no chat LLM. */
  runtimeMode?: 'llm' | 'offline';
  /** Task `agent` vs fleet `orchestrator` (coordinates chained agents only). */
  agentRole?: 'agent' | 'orchestrator';
  linkedOrchestratorId?: string | null;
  /** Per-session model override; null = use engine default from Settings. */
  model?: string | null;
  /** Resolved model id used for chat (override or engine default). */
  effectiveModel?: string;
}

/** Fields accepted by PATCH /api/sessions/:id (builder + fleet). */
export type SessionPatchPayload = {
  displayName?: string;
  description?: string | null;
  objective?: string | null;
  /** Relative path to a `.md` file under the workspace root; `null` clears. */
  agentInstructionsPath?: string | null;
  /** Inline markdown instructions; `null` clears. */
  agentInstructionsMarkdown?: string | null;
  runtimeMode?: 'llm' | 'offline';
  agentRole?: 'agent' | 'orchestrator';
  linkedOrchestratorId?: string | null;
  assignedSkills?: string[];
  primaryOfflineScriptId?: string | null;
  assignedOfflineScripts?: string[];
  /** Per-session chat model; null clears override (engine default). */
  model?: string | null;
};

export interface HealthPayload {
  status?: string;
  skills?: number;
  llm?: {
    provider?: string;
    ollama_url?: string | null;
    ollama?: string | null;
    openai_base?: string | null;
    openai_api_key_set?: boolean | null;
    openai?: string | null;
    /** Last GET /v1/models status from health probe (null if error before response). */
    openai_probe_http_status?: number | null;
    /** Truncated body or error message when probe is not “ok”. */
    openai_probe_detail?: string | null;
    /** From gateway env `CAPRIGO_LLM_BADGE` (optional status label). */
    badge?: string | null;
  };
  vibes?: {
    api_base?: string;
    api_key_set?: boolean;
    local_packs_dir?: string | null;
  };
}

/** Engine resource tuning; presets map to max reply tokens + Ollama context. */
export type OptimizationProfile = 'light' | 'balanced' | 'high' | 'custom';

export interface RuntimePayload {
  /** Node `process.platform` from the gateway host (`win32`, `darwin`, `linux`, …). */
  hostPlatform?: string;
  /** Base directory for resolving `agentInstructionsPath` on each session. */
  workspaceRoot?: string;
  /** MCP stdio bridges (Model Context Protocol). */
  mcp?: {
    configPath: string;
    servers: Array<{
      id: string;
      enabled: boolean;
      ok: boolean;
      toolCount: number;
      error?: string;
    }>;
  };
  engine: {
    id: string;
    name: string;
    model: string;
    temperature: number | null;
    maxTokens: number | null;
    optimizationProfile?: OptimizationProfile;
    /** Ollama KV/context size; null when not applicable. */
    ollamaNumCtx?: number | null;
    /** Laptop-first lower-resource mode. */
    laptopMode?: boolean;
    systemPrompt?: string;
  };
  skillsDir: string;
  skillCount: number;
  llmProvider: string;
  /** From gateway env `CAPRIGO_LLM_BADGE` (optional status label). */
  llmBadge?: string | null;
  llmConnection?: {
    provider: 'ollama' | 'openai_compatible';
    ollamaUrl: string;
    openaiBase: string;
    openaiApiKeySet: boolean;
  };
}

export interface ExecutionTraceEntry {
  ts: number;
  skill: string;
  ok: boolean;
  durationMs: number;
  sessionId?: string;
  error?: string;
  paramsSummary?: string;
  rationale?: string;
  resultSummary?: string;
  outputChars?: number;
}

export interface ExecutionTraceTotals {
  count: number;
  failures: number;
  durationMs: number;
  outputChars: number;
  estimatedContextTokens?: number;
  estimatedOutputTokens?: number;
  estimatedTotalTokens?: number;
  pressure?: 'light' | 'watch' | 'heavy';
  costSignal?: 'low' | 'watch' | 'high';
}

export interface MemoryEntry {
  key: string;
  timestamp: number;
  value: unknown;
}

export interface MemoryPayload {
  entries: MemoryEntry[];
  count: number;
  query?: string;
  error?: string;
}

