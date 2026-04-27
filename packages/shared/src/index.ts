/**
 * Shared types for Caprigo Core (runtime engine)
 */

export { caprigoDataRoot } from './caprigo-paths';
export { caprigoEnv } from './caprigo-env';
export { caprigoWorkspaceRoot, resolvePathUnderWorkspaceRoot } from './caprigo-workspace';
export {
  caprigoPermissionsPath,
  caprigoPermissions,
  resolveCaprigoToolPath,
  checkCaprigoPathAccess,
  checkCaprigoShellCommand,
  type CaprigoPermissionsManifest,
  type CaprigoFileScope,
} from './caprigo-permissions';
export { openAICompatibleRequestHeaders, openAICompatibleUserAgent } from './openai-compat-headers';

/** Declared offline script in the catalog (manifest or scan). */
export interface OfflineScriptCatalogItem {
  id: string;
  name: string;
  description: string;
  /** Path relative to offline scripts root (e.g. hello.mjs or sub/foo.mjs). */
  relPath: string;
  /** How the gateway spawns the file: node, python, python3, powershell, shell */
  interpreter: string;
}

/** Optional metadata when role is `offline` (local script run, not sent to the LLM). */
export interface OfflineMessageMeta {
  scriptId: string;
  scriptName?: string;
  exitCode: number;
  ok: boolean;
  stderr?: string;
}

/** Cross-agent coordination line (visible in Chat; included in LLM context as fleet context). */
export type OrchestrationKind = 'directive' | 'update' | 'reply';

export interface OrchestrationMeta {
  peerSessionId: string;
  /** Short display hint (e.g. other agent name); optional. */
  peerLabel?: string;
  kind: OrchestrationKind;
  /** This session sent (`out`) or received (`in`) the message. */
  channel: 'out' | 'in';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'offline' | 'orchestration';
  content: string;
  timestamp: number;
  offline?: OfflineMessageMeta;
  orchestration?: OrchestrationMeta;
}

/** Preset tuning for RAM/VRAM and reply length. `custom` uses `maxTokens` + `ollamaNumCtx` explicitly. */
export type OptimizationProfile = 'light' | 'balanced' | 'high' | 'custom';

/** Built-in resource presets (max tokens per reply + Ollama KV context window). */
export const OPTIMIZATION_PRESETS: Record<'light' | 'balanced' | 'high', { maxTokens: number; ollamaNumCtx: number }> = {
  light: { maxTokens: 1024, ollamaNumCtx: 4096 },
  balanced: { maxTokens: 2048, ollamaNumCtx: 8192 },
  high: { maxTokens: 4096, ollamaNumCtx: 16384 },
};

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  /** Resource tuning; presets set `maxTokens` and `ollamaNumCtx` together. Default: balanced. */
  optimizationProfile?: OptimizationProfile;
  /**
   * Ollama `num_ctx` (context / KV window). Only used when the LLM backend is Ollama.
   * Remote APIs use `maxTokens` only.
   */
  ollamaNumCtx?: number;
  /** Laptop-first resource mode: caps context/outputs and reduces tool-loop pressure. */
  laptopMode?: boolean;
}

/** Two fleet roles only: task agent vs orchestrator. */
export type FleetAssignment = 'agent' | 'orchestrator';

/** Normalize legacy `standard` and missing role to `agent`. */
export function normalizeFleetAssignment(role: string | undefined | null): FleetAssignment {
  if (role === 'orchestrator') return 'orchestrator';
  return 'agent';
}

export interface Session {
  id: string;
  agentId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  /** Offline script ids linked to this agent (assigned on first successful run). */
  assignedOfflineScripts?: string[];
  /**
   * If set and non-empty, only these tool names are exposed to the LLM and may execute for this session.
   * If omitted or empty, all registered skills apply.
   */
  assignedSkills?: string[];
  /**
   * `llm` — chat uses the configured model (Ollama, OpenAI-compatible, etc.).
   * `offline` — no LLM; disk scripts only (`POST .../offline/run`). Default when omitted: `llm`.
   */
  runtimeMode?: 'llm' | 'offline';
  /**
   * Fleet assignment: `agent` runs tasks and reports up; `orchestrator` coordinates sessions linked to it.
   * Legacy value `standard` is treated as `agent`.
   */
  agentRole?: FleetAssignment | 'standard';
  /** When set, this agent session reports to this orchestrator session id (workspace chain or Details). */
  linkedOrchestratorId?: string;
  /** Short description for the Agent Builder and cards (UI-first; optional). */
  description?: string;
  /** Optional “what this agent is for” note; not the global engine system prompt. */
  objective?: string;
  /**
   * Preferred offline script id from the catalog (Workspace Run / builder).
   * Distinct from `assignedOfflineScripts`, which also records scripts after a successful run.
   */
  primaryOfflineScriptId?: string | null;
  /**
   * When set, chat for this session uses this model id (Ollama tag or remote model name).
   * When omitted, the engine default from `PATCH /api/config` applies.
   */
  model?: string;
  /**
   * Optional path to a markdown file (relative to `CAPRIGO_WORKSPACE`, default gateway cwd)
   * whose contents are injected into the system prompt for LLM chat on this session.
   */
  agentInstructionsPath?: string;
  /**
   * Optional inline markdown merged into the LLM system prompt (after file-based instructions).
   */
  agentInstructionsMarkdown?: string;
}

/**
 * JSON Schema fragment for the `parameters` object in Ollama/OpenAI-style tool definitions.
 * When omitted, the engine uses a permissive object schema so the model can pass arbitrary keys.
 */
export interface SkillToolParameters {
  type?: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
}

/** A skill is a capability the agent can execute. Users create skills; the engine runs them. */
export interface Skill {
  name: string;
  description: string;
  /** Second arg is set for in-process tools (e.g. fleet) that need the calling session id. */
  execute: (params: any, meta?: { sessionId?: string }) => Promise<any>;
  /** Optional: tighter parameter schema for native tool/function calling. */
  toolParameters?: SkillToolParameters;
  /**
   * Optional marketplace metadata (roadmap: standardized skill contract).
   * Caprigo Core skills are mostly `local`; HTTP tools are `api` or `hybrid`.
   */
  executionType?: 'local' | 'api' | 'hybrid';
  /** Optional Vibes-Coded listing id when this skill wraps a marketplace listing. */
  vibesListingId?: string;
}

/** Tool call in a normalized shape (Ollama + OpenAI-compatible). */
export interface UnifiedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments?: Record<string, unknown> | string;
    index?: number;
  };
}

/** Message line for LLM backends (Ollama / OpenAI-style APIs). */
export interface UnifiedChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: UnifiedToolCall[];
  /** OpenAI-style tool result linkage */
  tool_call_id?: string;
  /** Ollama-style tool result linkage */
  tool_name?: string;
}

export interface UnifiedChatRequest {
  model: string;
  messages: UnifiedChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
  /** Ollama `num_ctx`; omit for APIs that only support `max_tokens`. */
  numCtx?: number;
}

export interface UnifiedChatResponse {
  message: {
    role: string;
    content?: string | null;
    tool_calls?: UnifiedToolCall[];
  };
}

/** Pluggable LLM: local Ollama or any OpenAI-compatible HTTP API. */
export interface ChatLLMBackend {
  chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  /** Short label for logging and /health (e.g. ollama, openai_compatible). */
  readonly providerId: string;
}

/** One row in the agent “task card” (Solana-style tool activity). */
export interface TaskActivity {
  taskId: string;
  /** Primary line, usually the skill name or step label */
  status: string;
  done: boolean;
  /** Reserved for future approval flows */
  permissionWait?: boolean;
}

/** Emitted during processMessage so the gateway/UI can show live task cards. */
export type AgentActivityEvent =
  | { type: 'task_start'; sessionId: string; taskId: string; label: string }
  | { type: 'task_end'; sessionId: string; taskId: string; ok: boolean; detail?: string }
  | {
      type: 'orchestration_exchange';
      fromSessionId: string;
      toSessionId: string;
      kind: string;
      excerpt: string;
    };
