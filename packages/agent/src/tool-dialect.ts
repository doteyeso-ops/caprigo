/**
 * Normalize tool-call dialects into a common shape.
 * Covers: OpenAI tool_calls (handled upstream), Groq/XML <tool_call>, bare JSON, TOOL:/PARAMS:.
 */

export type NormalizedToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

function makeId(i: number): string {
  return `embedded_${i}_${Date.now().toString(36)}`;
}

function looksLikeToolObj(o: Record<string, unknown>): boolean {
  if (typeof o.name === 'string' && o.name.trim()) return true;
  if (o.function && typeof o.function === 'object') {
    const n = (o.function as Record<string, unknown>).name;
    return typeof n === 'string' && !!n.trim();
  }
  return false;
}

/** Scan text for top-level JSON objects (brace-balanced; string-aware). */
export function extractJsonObjects(text: string): unknown[] {
  const objs: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, j + 1);
          try {
            objs.push(JSON.parse(slice));
          } catch {
            /* ignore malformed */
          }
          i = j + 1;
          closed = true;
          break;
        }
      }
    }
    if (!closed) break;
  }
  return objs;
}

function pushObj(
  out: NormalizedToolCall[],
  raw: unknown
): void {
  if (!raw || typeof raw !== 'object') return;
  const o = raw as Record<string, unknown>;
  const name = String(
    o.name ||
      (o.function && typeof o.function === 'object'
        ? (o.function as Record<string, unknown>).name
        : '') ||
      ''
  ).trim();
  if (!name) return;
  let args: unknown = o.arguments ?? o.parameters;
  if (
    args == null &&
    o.function &&
    typeof o.function === 'object' &&
    (o.function as Record<string, unknown>).arguments != null
  ) {
    args = (o.function as Record<string, unknown>).arguments;
  }
  // Normalize common local-model arg aliases.
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const a = { ...(args as Record<string, unknown>) };
    if (a.path == null && a.target != null) a.path = a.target;
    if (a.path == null && a.file != null) a.path = a.file;
    if (a.path == null && a.filepath != null) a.path = a.filepath;
    if (a.command == null && a.cmd != null) a.command = a.cmd;
    if (a.command == null && a.shell != null) a.command = a.shell;
    if (a.url == null && a.uri != null) a.url = a.uri;
    if (a.url == null && a.href != null) a.url = a.href;
    if (a.query == null && a.q != null) a.query = a.q;
    if (a.content == null && a.text != null && typeof a.text === 'string') {
      a.content = a.text;
    }
    if (a.prompt == null && a.description != null) a.prompt = a.description;
    args = a;
  }
  out.push({
    id: makeId(out.length),
    type: 'function',
    function: {
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    },
  });
}

/** Parse tool calls embedded in assistant text (Groq / XML / bare JSON). */
export function parseEmbeddedJsonToolCalls(text: string): NormalizedToolCall[] {
  const out: NormalizedToolCall[] = [];
  if (!text?.trim()) return out;

  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    try {
      pushObj(out, JSON.parse(m[1]));
    } catch {
      /* ignore */
    }
  }
  if (out.length) return out;

  // Groq / LM Studio often emit one or more bare {"name","arguments"} objects.
  for (const obj of extractJsonObjects(text)) {
    if (obj && typeof obj === 'object' && looksLikeToolObj(obj as Record<string, unknown>)) {
      pushObj(out, obj);
    }
  }
  if (out.length) return out;

  // invoke tool_name with {...}  (some small models)
  const invoke = text.match(
    /(?:call|invoke|use)\s+(?:the\s+)?[`']?([\w.-]+)[`']?\s+(?:tool\s+)?(?:with\s+)?(\{[\s\S]*\})/i
  );
  if (invoke) {
    try {
      pushObj(out, { name: invoke[1], arguments: JSON.parse(invoke[2]) });
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Legacy Caprigo text tools. */
export function parseLegacyToolCall(text: string): { tool: string; params: Record<string, unknown> } | null {
  const toolMatch = text.match(/TOOL:\s*([\w-]+)/i);
  if (!toolMatch) return null;
  const tool = toolMatch[1];
  let params: Record<string, unknown> = {};
  const paramsMatch = text.match(/PARAMS:\s*(\{[\s\S]*?\})/);
  if (paramsMatch) {
    try {
      params = JSON.parse(paramsMatch[1]);
    } catch {
      /* empty */
    }
  }
  return { tool, params };
}

export function stripEmbeddedToolNoise(text: string): string {
  return text
    .replace(/TOOL:\s*[\w-]+[\s\S]*?PARAMS:\s*\{[^}]*\}/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/^\s*\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*\}\s*$/m, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

const SKILL_ALIASES: Record<string, string> = {
  read: 'read_file',
  write: 'write_file',
  edit: 'hash_edit',
  ls: 'list_directory',
  list: 'list_directory',
  dir: 'list_directory',
  // Do NOT map bare "search" — ambiguous (web vs local). Prefer explicit aliases:
  grep: 'search_files',
  find_in_files: 'search_files',
  find_files: 'search_files',
  codebase_search: 'search_files',
  google: 'web_search',
  duckduckgo: 'web_search',
  websearch: 'web_search',
  search_web: 'web_search',
  bing: 'web_search',
  shell: 'execute_command',
  bash: 'execute_command',
  cmd: 'execute_command',
  run: 'execute_command',
  exec: 'execute_command',
  browse: 'browser_navigate',
  open_url: 'browser_navigate',
  navigate: 'browser_navigate',
  screenshot: 'browser_screenshot',
  desktop_shot: 'desktop_screenshot',
  screenshot_desktop: 'desktop_screenshot',
  mouse: 'desktop_click',
  mouse_click: 'desktop_click',
  mouse_move: 'desktop_move',
  hotkey: 'desktop_hotkey',
  type_keys: 'desktop_type',
  ocr: 'desktop_ocr',
  read_screen: 'desktop_ocr',
  find_on_screen: 'desktop_find',
  image: 'generate_image',
  draw: 'generate_image',
  lan: 'list_lan_devices',
  network: 'list_lan_devices',
  devices: 'list_lan_devices',
  arp: 'list_lan_devices',
  clipboard: 'clipboard_read',
  paste: 'clipboard_read',
  copy: 'clipboard_write',
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export type ResolveSkillPrefer = 'web' | 'local';

/** Map invented/near-miss tool names onto real skills. */
export function resolveSkillName(
  rawName: string,
  allowed: Iterable<string>,
  opts?: { prefer?: ResolveSkillPrefer }
): { name: string; remappedFrom?: string } | { unknown: string; suggestions: string[] } {
  const allowedList = [...allowed];
  const allowedSet = new Set(allowedList);
  const raw = String(rawName || '').trim();
  if (!raw) return { unknown: raw, suggestions: allowedList.slice(0, 8) };
  if (allowedSet.has(raw)) return { name: raw };

  const lower = raw.toLowerCase().replace(/[\s.]+/g, '_');
  if (allowedSet.has(lower)) return { name: lower, remappedFrom: raw };

  const alias = SKILL_ALIASES[lower] || SKILL_ALIASES[raw.toLowerCase()];
  if (alias && allowedSet.has(alias)) return { name: alias, remappedFrom: raw };

  // Ambiguous short names (web vs local) — prefer by intent when known; else surface both.
  if (lower === 'search' || lower === 'find' || lower === 'lookup') {
    const suggestions = ['web_search', 'search_files'].filter(s => allowedSet.has(s));
    if (opts?.prefer === 'web' && allowedSet.has('web_search')) {
      return { name: 'web_search', remappedFrom: raw };
    }
    if (opts?.prefer === 'local' && allowedSet.has('search_files')) {
      return { name: 'search_files', remappedFrom: raw };
    }
    if (suggestions.length > 1) {
      return { unknown: raw, suggestions };
    }
    if (suggestions.length === 1) return { name: suggestions[0], remappedFrom: raw };
  }

  // fuzzy: prefer contains, then small edit distance
  const contains = allowedList.filter(
    s => s.includes(lower) || lower.includes(s) || s.replace(/_/g, '') === lower.replace(/_/g, '')
  );
  if (contains.length === 1) return { name: contains[0], remappedFrom: raw };
  if (contains.length > 1) {
    // Prefer web_search when both web_search and search_files match "search*"
    const ordered = [...contains].sort((a, b) => {
      if (a === 'web_search') return -1;
      if (b === 'web_search') return 1;
      return a.localeCompare(b);
    });
    return { unknown: raw, suggestions: ordered.slice(0, 5) };
  }

  let best: string | null = null;
  let bestDist = Infinity;
  for (const s of allowedList) {
    const d = levenshtein(lower, s.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (best && bestDist <= 2 && bestDist < lower.length) {
    return { name: best, remappedFrom: raw };
  }

  const suggestions = allowedList
    .map(s => ({ s, d: levenshtein(lower, s.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(x => x.s);
  return { unknown: raw, suggestions };
}
