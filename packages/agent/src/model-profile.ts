/**
 * Model Grapple — per-model tool dialect profiles (cache + LMS + heuristics + handshake + observed flip).
 */

import * as fs from 'fs';
import * as path from 'path';
import { caprigoDataRoot } from '@caprigo/shared';

export type ToolDialect = 'openai' | 'xml' | 'legacy' | 'auto';
export type ProfileSource = 'env' | 'lms' | 'heuristic' | 'handshake' | 'observed';
export type SystemFlavor = 'default' | 'xml_strict' | 'minimal';

export type ModelProfile = {
  modelId: string;
  dialect: ToolDialect;
  source: ProfileSource;
  trainedForToolUse?: boolean;
  vision?: boolean;
  quirks: string[];
  systemFlavor: SystemFlavor;
  toolChoiceOk: boolean;
  handshakeAt?: number;
  updatedAt: number;
  confidence: number;
};

type ProfileStore = { profiles: Record<string, ModelProfile> };

function profilesPath(): string {
  return path.join(caprigoDataRoot(), 'model-profiles.json');
}

let cache: ProfileStore | null = null;

function loadStore(): ProfileStore {
  if (cache) return cache;
  try {
    const p = profilesPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as ProfileStore;
      cache = { profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {} };
      return cache;
    }
  } catch {
    /* ignore */
  }
  cache = { profiles: {} };
  return cache;
}

function saveStore(store: ProfileStore): void {
  cache = store;
  try {
    const p = profilesPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    /* best-effort */
  }
}

/** Strip LM Studio instance suffixes like `:2`. */
export function canonicalModelId(modelId: string): string {
  return String(modelId || '')
    .trim()
    .replace(/:\d+$/, '');
}

function profileTtlMs(): number {
  const n = Number(process.env.CAPRIGO_PROFILE_TTL_MS || '');
  return Number.isFinite(n) && n > 0 ? n : 7 * 86400_000;
}

function envDialectOverride(): ToolDialect | null {
  const force = process.env.CAPRIGO_EMBEDDED_TOOLS?.trim();
  if (force === '1' || force === 'true') return 'xml';
  if (force === '0' || force === 'false') return 'openai';
  const d = (process.env.CAPRIGO_TOOL_DIALECT || '').trim().toLowerCase();
  if (d === 'openai' || d === 'xml' || d === 'legacy' || d === 'auto') return d;
  return null;
}

export function heuristicProfile(modelId: string, caps?: {
  trainedForToolUse?: boolean;
  vision?: boolean;
}): ModelProfile {
  const id = canonicalModelId(modelId);
  const lower = id.toLowerCase();
  const quirks: string[] = [];
  let dialect: ToolDialect = 'auto';
  let confidence = 0.45;
  let source: ProfileSource = 'heuristic';
  let toolChoiceOk = true;
  let systemFlavor: SystemFlavor = 'default';

  // Llama-3-Groq-*Tool-Use* and similar are OpenAI function-calling models.
  // Do NOT map them to XML — that disables tools[] and produces empty/useless turns on LMS.
  if (/tool-use|tool_use|function.?call|fc-|hermes-function/.test(lower)) {
    dialect = 'openai';
    confidence = 0.8;
    toolChoiceOk = true;
    systemFlavor = 'default';
    quirks.push('openai_tool_use_model');
  } else if (caps?.trainedForToolUse === true) {
    dialect = 'openai';
    confidence = 0.7;
    source = 'lms';
  } else if (caps?.trainedForToolUse === false) {
    dialect = 'xml';
    confidence = 0.55;
    source = 'lms';
    toolChoiceOk = false;
    systemFlavor = 'xml_strict';
    quirks.push('lms_not_trained_for_tool_use');
  } else if (/coder|instruct|abliterat/.test(lower)) {
    dialect = 'auto';
    confidence = 0.4;
    quirks.push('may_dump_code_in_chat');
  }

  if (caps?.vision) quirks.push('vision');

  return {
    modelId: id,
    dialect,
    source,
    trainedForToolUse: caps?.trainedForToolUse,
    vision: caps?.vision,
    quirks: [...new Set(quirks)],
    systemFlavor,
    toolChoiceOk,
    updatedAt: Date.now(),
    confidence,
  };
}

export function getCachedProfile(modelId: string): ModelProfile | null {
  const id = canonicalModelId(modelId);
  const store = loadStore();
  const p = store.profiles[id];
  if (!p) return null;
  const age = Date.now() - (p.updatedAt || 0);
  if (age > profileTtlMs()) return null;
  // Provisional handshake must not stick as high-confidence for full TTL
  if (p.source === 'handshake' && p.confidence < 0.7 && age > 86400_000) return null;
  return p;
}

export function saveProfile(profile: ModelProfile): ModelProfile {
  const store = loadStore();
  const id = canonicalModelId(profile.modelId);
  const next = { ...profile, modelId: id, updatedAt: Date.now() };
  store.profiles[id] = next;
  saveStore(store);
  return next;
}

export function parseHandshakeReply(text: string): ToolDialect | null {
  const t = String(text || '').toUpperCase();
  if (/\bOPENAI\b/.test(t)) return 'openai';
  if (/\bXML\b/.test(t)) return 'xml';
  if (/\bLEGACY\b/.test(t)) return 'legacy';
  return null;
}

export type LmsModelCaps = {
  key: string;
  trainedForToolUse?: boolean;
  vision?: boolean;
};

/** Best-effort fetch of LMS capability flags for one model. */
export async function fetchLmsCaps(modelId: string, openAiBaseUrl?: string): Promise<LmsModelCaps | null> {
  const id = canonicalModelId(modelId);
  const base = (openAiBaseUrl || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1')
    .replace(/\/$/, '')
    .replace(/\/v1$/i, '');
  try {
    const headers: Record<string, string> = {};
    const key = process.env.OPENAI_API_KEY?.trim() || process.env.LM_API_TOKEN?.trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(`${base}/api/v1/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      models?: Array<{
        key?: string;
        capabilities?: { trained_for_tool_use?: boolean; vision?: boolean };
      }>;
    };
    const hit = (j.models || []).find(m => canonicalModelId(String(m.key || '')) === id);
    if (!hit) return null;
    return {
      key: String(hit.key),
      trainedForToolUse: hit.capabilities?.trained_for_tool_use,
      vision: hit.capabilities?.vision,
    };
  } catch {
    return null;
  }
}

export type ChatFn = (req: {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  max_tokens?: number;
}) => Promise<string>;

function handshakeMode(): 'off' | 'on' | 'always' {
  const v = (process.env.CAPRIGO_MODEL_HANDSHAKE || '1').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return 'off';
  if (v === 'always') return 'always';
  return 'on';
}

/**
 * Resolve profile: env → cache → LMS/heuristic → optional handshake.
 * `forceProbe` ignores cache confidence (HUD /profile probe).
 */
export async function ensureModelProfile(
  modelId: string,
  opts?: { forceProbe?: boolean; chat?: ChatFn; openAiBaseUrl?: string }
): Promise<ModelProfile> {
  const id = canonicalModelId(modelId);
  const envD = envDialectOverride();
  if (envD) {
    return saveProfile({
      modelId: id,
      dialect: envD,
      source: 'env',
      quirks: [],
      systemFlavor: envD === 'xml' ? 'xml_strict' : 'default',
      toolChoiceOk: envD === 'openai' || envD === 'auto',
      updatedAt: Date.now(),
      confidence: 1,
    });
  }

  const cached = getCachedProfile(id);
  const mode = handshakeMode();
  if (
    cached &&
    !opts?.forceProbe &&
    mode !== 'always' &&
    cached.confidence >= 0.7 &&
    cached.source !== 'handshake'
  ) {
    return cached;
  }
  if (cached && !opts?.forceProbe && mode !== 'always' && cached.confidence >= 0.85) {
    return cached;
  }

  const caps = await fetchLmsCaps(id, opts?.openAiBaseUrl);
  let profile = heuristicProfile(id, {
    trainedForToolUse: caps?.trainedForToolUse,
    vision: caps?.vision,
  });
  if (caps) {
    profile.trainedForToolUse = caps.trainedForToolUse;
    profile.vision = caps.vision;
    if (caps.trainedForToolUse === true || caps.trainedForToolUse === false) {
      profile.source = 'lms';
    }
  }

  const needHandshake =
    opts?.forceProbe ||
    mode === 'always' ||
    (mode === 'on' && profile.confidence < 0.7 && !!opts?.chat);

  if (needHandshake && opts?.chat) {
    try {
      const reply = await opts.chat({
        model: id,
        max_tokens: 16,
        messages: [
          {
            role: 'system',
            content:
              'You are configuring Caprigo tool-call format. Reply with ONLY one token: OPENAI or XML or LEGACY.',
          },
          {
            role: 'user',
            content:
              'OPENAI = OpenAI tools[] / tool_calls. XML = <tool_call>{"name":...}</tool_call> in content. LEGACY = TOOL:/PARAMS:. Which will you use?',
          },
        ],
      });
      const parsed = parseHandshakeReply(reply);
      if (parsed) {
        profile = {
          ...profile,
          dialect: parsed,
          source: 'handshake',
          confidence: 0.6,
          handshakeAt: Date.now(),
          systemFlavor: parsed === 'xml' ? 'xml_strict' : parsed === 'legacy' ? 'minimal' : 'default',
          toolChoiceOk: parsed === 'openai',
          quirks:
            parsed === 'xml'
              ? [...new Set([...profile.quirks, 'handshake_xml'])]
              : profile.quirks,
        };
      }
    } catch {
      /* keep heuristic */
    }
  }

  // Prefer stronger cached observed over weaker handshake if not forcing
  if (cached && !opts?.forceProbe && cached.source === 'observed' && cached.confidence >= profile.confidence) {
    return cached;
  }

  return saveProfile(profile);
}

/** Effective dialect for request shaping (`auto` resolved). */
export function resolveToolMode(profile: ModelProfile): {
  dialect: Exclude<ToolDialect, 'auto'>;
  useNativeTools: boolean;
  toolChoiceOk: boolean;
  systemFlavor: SystemFlavor;
} {
  let dialect: Exclude<ToolDialect, 'auto'> =
    profile.dialect === 'auto'
      ? profile.trainedForToolUse
        ? 'openai'
        : 'xml'
      : profile.dialect;

  if (dialect === 'openai' && profile.quirks.includes('refuses_openai_tools')) {
    dialect = 'xml';
  }

  return {
    dialect,
    useNativeTools: dialect === 'openai',
    toolChoiceOk: dialect === 'openai' && profile.toolChoiceOk !== false,
    systemFlavor:
      dialect === 'xml' ? 'xml_strict' : dialect === 'legacy' ? 'minimal' : profile.systemFlavor,
  };
}

export function looksLikeDialectRefusal(content: string): boolean {
  const t = String(content || '').toLowerCase();
  if (!t.trim()) return false;
  return (
    /i('m| am) sorry/.test(t) &&
    /(do not have|don't have|cannot|can't).{0,40}(access|capability|tool)/.test(t)
  );
}

/** Model claims ignorance / no internet / no capability instead of calling web_search. */
export function looksLikeKnowledgeRefusal(content: string): boolean {
  const t = String(content || '').toLowerCase();
  if (!t.trim() || t.length > 3500) return false;
  // Groq-style canned refusal ("no capability to perform this task")
  if (looksLikeDialectRefusal(t)) return true;
  if (/do not have the capability|don't have the capability/.test(t)) return true;
  if (/not (able|capable) to (perform|do|help with) this (task|request)/.test(t)) return true;
  return (
    /no direct (access|information|knowledge|data)/.test(t) ||
    /don'?t have (access to )?(real[- ]?time|current|live|up[- ]?to[- ]?date)/.test(t) ||
    /do not have (access to )?(real[- ]?time|current|live|the internet|web)/.test(t) ||
    /cannot (search|look up|browse|access|perform) (the )?(internet|web|online|this task|that)/.test(t) ||
    /i (do not|don't) have .{0,40}(information|data|access|details|capability).{0,40}(about|on|regarding|for|to)/.test(
      t
    ) ||
    /i (do not|don't) have specific (information|details|data)/.test(t) ||
    /as an ai.{0,60}(cannot|can't|don't|do not).{0,40}(browse|search|access|look up)/.test(t) ||
    /unable to (search|look up|find|browse|provide|perform).{0,50}(internet|web|online|current|real[- ]?time|specific|this|that|task)/.test(
      t
    ) ||
    /i('m| am) (not able|unable) to (access|retrieve|search|provide|perform).{0,40}(web|internet|online|real[- ]?time|current|this|that|task)/.test(
      t
    ) ||
    /knowledge cutoff|training (data|cutoff)|as of my (last|knowledge)/.test(t) ||
    /without (access to |being able to )?(browse|search|look up)/.test(t) ||
    /i (recommend|suggest) (you |that you )?(search|google|look up)/.test(t) ||
    /i('m| am) not (able to|in a position to) (find|locate|retrieve|give you)/.test(t) ||
    (/you (can|could|may) (try |search |google |look up)/.test(t) &&
      /(i (can't|cannot|don't|do not)|unable|no access)/.test(t))
  );
}

/** User wants OS mouse/keyboard/screenshot — not web search / not in-browser. */
export function userLikelyNeedsDesktop(userMessage: string): boolean {
  const t = String(userMessage || '').toLowerCase().trim();
  if (!t) return false;
  // Explicit web / URL → browser_* or web_search, not desktop_*
  if (/https?:\/\//.test(t)) return false;
  if (/\b(web_search|duckduckgo|search the (web|internet)|look up online)\b/.test(t)) return false;
  if (/\b(repo|codebase|this (file|folder|project)|search_files|write_file)\b/.test(t)) return false;

  return (
    /\b(computer[- ]?use|digital body|desktop_|control (my |the )?(pc|computer|desktop|mouse|keyboard))\b/.test(
      t
    ) ||
    /\b(take (a )?screenshot|screenshot (my |the )?(screen|desktop)|what('?s| is) on (my |the )?screen|read (my |the )?screen|ocr (the )?screen)\b/.test(
      t
    ) ||
    /\b(click|double[- ]?click|right[- ]?click|move (the )?cursor|move (the )?mouse)\b/.test(t) ||
    /\b(type (into|in)|press (ctrl|alt|win|shift|enter|tab|esc)|hotkey|alt\+tab|win\+e|win\+r)\b/.test(
      t
    ) ||
    /\b(open|launch|start|run)\b.{0,48}\b(notepad|calc(ulator)?|paint|mspaint|explorer|file explorer|task manager|settings|cmd|powershell|terminal)\b/.test(
      t
    ) ||
    /\b(focus|switch to)\b.{0,40}\b(window|app|notepad|chrome|edge|discord|slack)\b/.test(t) ||
    /\b(use (the )?(mouse|keyboard)|on (my |the )?desktop)\b/.test(t)
  );
}

/** PowerShell one-liner to launch a common app, or null. */
export function suggestedDesktopLaunchCommand(userMessage: string): string | null {
  const t = String(userMessage || '').toLowerCase();
  if (!/\b(open|launch|start|run)\b/.test(t)) return null;
  if (/\bnotepad\b/.test(t)) return 'Start-Process notepad; Start-Sleep -Seconds 1';
  if (/\b(calc|calculator)\b/.test(t)) return 'Start-Process calc; Start-Sleep -Seconds 1';
  if (/\b(mspaint|paint)\b/.test(t)) return 'Start-Process mspaint; Start-Sleep -Seconds 1';
  if (/\b(file explorer|explorer)\b/.test(t)) return 'Start-Process explorer; Start-Sleep -Seconds 1';
  if (/\btask manager\b/.test(t)) return 'Start-Process taskmgr; Start-Sleep -Seconds 1';
  return null;
}

/** Model claims it cannot control OS UI. */
export function looksLikeDesktopRefusal(content: string): boolean {
  const t = String(content || '').toLowerCase();
  if (!t.trim() || t.length > 3500) return false;
  if (looksLikeKnowledgeRefusal(t) || looksLikeDialectRefusal(t)) return true;
  return (
    /cannot (control|move|use|access|take).{0,40}(mouse|keyboard|screen|desktop|screenshot)/.test(t) ||
    /don'?t have .{0,30}(mouse|keyboard|desktop|computer[- ]?use|gui)/.test(t) ||
    /no (access|ability|way) to (control|click|type|screenshot)/.test(t) ||
    /i('m| am) (just|only) a (text|language) model/.test(t) ||
    /you('ll| will) (need|have) to (do|click|type|open) (that|it|this) yourself/.test(t)
  );
}

export function usedDesktopTools(toolsUsed: string[]): boolean {
  return toolsUsed.some(t => /^desktop_/.test(t));
}

/** User message likely needs live/world lookup. */
export function userLikelyNeedsWeb(userMessage: string): boolean {
  const t = String(userMessage || '').toLowerCase();
  if (!t.trim()) return false;
  // OS / computer-use asks are not web lookups
  if (userLikelyNeedsDesktop(userMessage)) return false;
  if (/\b(repo|codebase|this (file|folder|project)|in the (src|code)|search_files)\b/.test(t)) {
    return false;
  }
  return (
    /\b(search|look up|google|brave|find|list|meetup|meetups|event|events|news|weather|who is|what is|near|nearby|tonight|this week|current|latest|docs? for|conference|hackathon)\b/.test(
      t
    ) ||
    /\b(dealer|dealers|dealership|restaurant|restaurants|store|stores|shop|shops|hotel|hotels|clinic|hospital|pharmacy|plumber|lawyer|attorney|school|university|church)\b/.test(
      t
    ) ||
    /\b(how (do|to)|where (can|do|is|are)|when is|what's happening|give me (a )?list)\b/.test(t) ||
    /\b(nashville|gallatin|austin|seattle|nyc|london|tennessee|\btn\b)\b/.test(t)
  );
}

export function usedWebTools(toolsUsed: string[]): boolean {
  return toolsUsed.some(t =>
    /^(web_search|web_fetch|browser_navigate|browser_snapshot|http_get)$/.test(t)
  );
}

export function usedOnlyLocalSearch(toolsUsed: string[]): boolean {
  if (!toolsUsed.length) return false;
  const local = new Set(['search_files', 'list_directory', 'read_file', 'repo_map']);
  return toolsUsed.every(t => local.has(t)) && toolsUsed.some(t => t === 'search_files' || t === 'list_directory');
}

export function contentHasEmbeddedTools(content: string): boolean {
  const t = String(content || '');
  return /<tool_call>/i.test(t) || /"name"\s*:\s*"[a-z0-9_]+"/.test(t);
}

/** Mid-turn flip when openai path is wrong. */
export function observeDialectFlip(
  modelId: string,
  from: ToolDialect,
  to: Exclude<ToolDialect, 'auto'>,
  quirk: string
): ModelProfile {
  const prev = getCachedProfile(modelId) || heuristicProfile(modelId);
  return saveProfile({
    ...prev,
    modelId: canonicalModelId(modelId),
    dialect: to,
    source: 'observed',
    confidence: Math.max(0.85, prev.confidence || 0),
    toolChoiceOk: to === 'openai',
    systemFlavor: to === 'xml' ? 'xml_strict' : to === 'legacy' ? 'minimal' : 'default',
    quirks: [...new Set([...(prev.quirks || []), quirk, `flipped_from_${from}`])],
    updatedAt: Date.now(),
  });
}

/** Promote provisional handshake after successful tool use. */
export function promoteProfileAfterSuccess(modelId: string): ModelProfile | null {
  const p = getCachedProfile(modelId);
  if (!p) return null;
  if (p.source === 'handshake' || p.confidence < 0.85) {
    return saveProfile({
      ...p,
      source: p.source === 'handshake' ? 'observed' : p.source,
      confidence: Math.max(0.85, p.confidence),
      updatedAt: Date.now(),
    });
  }
  return p;
}

export function profileOneLiner(profile: ModelProfile): string {
  const mode = resolveToolMode(profile);
  const quirks = (profile.quirks || []).slice(0, 3).join(',');
  return `dialect ${mode.dialect} (${profile.source}, conf ${profile.confidence.toFixed(2)})${
    quirks ? ` quirks=${quirks}` : ''
  }`.slice(0, 180);
}

export function coreToolNames(): Set<string> {
  return new Set([
    'read_file',
    'write_file',
    'list_directory',
    'search_files',
    'hash_edit',
    'search_replace',
    'execute_command',
    'system_info',
    'web_search',
    'web_fetch',
    'http_get',
    'http_post',
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_press',
    'browser_wait',
    'browser_screenshot',
    'desktop_screenshot',
    'desktop_click',
    'desktop_move',
    'desktop_type',
    'desktop_hotkey',
    'desktop_key',
    'desktop_windows',
    'desktop_focus',
    'desktop_ocr',
    'desktop_find',
    'list_lan_devices',
    'clipboard_read',
    'clipboard_write',
    'brain_status',
    'brain_remember',
    'brain_recall',
    'store_memory',
    'retrieve_memory',
    'list_memory_keys',
    'todo',
    'current_datetime',
    'generate_image',
    'save_skill_playbook',
  ]);
}

export function shouldUseCoreToolsOnly(profile: ModelProfile): boolean {
  if (/^(1|true|yes)$/i.test(String(process.env.CAPRIGO_CORE_TOOLS_ONLY || ''))) return true;
  return (profile.quirks || []).includes('overwhelmed_by_tools');
}
