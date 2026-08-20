/**
 * Caprigo Action Card — constrained response protocol when models ignore tools[].
 * Prefer native tool_calls; else parse a card; else harness proposes/auto-picks.
 */

export type ActionCard =
  | { caprigo: 'action'; tool: string; args: Record<string, unknown>; reason?: string }
  | { caprigo: 'done'; answer: string }
  | { caprigo: 'blocked'; reason: string };

function tryParseObject(raw: string): Record<string, unknown> | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Extract first balanced `{...}` from text (tolerant of prose wrappers). */
export function extractJsonObject(text: string): string | null {
  const s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    if (inner.startsWith('{')) return inner;
  }
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeCard(obj: Record<string, unknown>): ActionCard | null {
  const kind = String(obj.caprigo || obj.kind || '').toLowerCase();
  if (kind === 'action' || kind === 'tool' || (obj.tool && !kind)) {
    const tool = String(obj.tool || obj.name || '').trim();
    if (!tool) return null;
    let args: Record<string, unknown> = {};
    if (obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args)) {
      args = obj.args as Record<string, unknown>;
    } else if (obj.arguments && typeof obj.arguments === 'object' && !Array.isArray(obj.arguments)) {
      args = obj.arguments as Record<string, unknown>;
    } else if (typeof obj.arguments === 'string') {
      const parsed = tryParseObject(obj.arguments);
      if (parsed) args = parsed;
    }
    return {
      caprigo: 'action',
      tool,
      args,
      reason: obj.reason != null ? String(obj.reason) : undefined,
    };
  }
  if (kind === 'done' || kind === 'complete' || kind === 'finish') {
    const answer = String(obj.answer || obj.content || obj.message || '').trim();
    return { caprigo: 'done', answer: answer || 'Done.' };
  }
  if (kind === 'blocked' || kind === 'fail' || kind === 'error') {
    return { caprigo: 'blocked', reason: String(obj.reason || obj.error || 'blocked').trim() };
  }
  return null;
}

/** Parse Action Card from model text. Returns null if none found. */
export function parseActionCard(content: string): ActionCard | null {
  const raw = String(content || '');
  if (!raw.trim()) return null;
  const direct = tryParseObject(raw);
  if (direct) {
    const card = normalizeCard(direct);
    if (card) return card;
  }
  const extracted = extractJsonObject(raw);
  if (extracted) {
    const obj = tryParseObject(extracted);
    if (obj) {
      const card = normalizeCard(obj);
      if (card) return card;
    }
  }
  return null;
}

export function actionCardPromptBlock(proposed?: Array<{ tool: string; args?: Record<string, unknown> }>): string {
  const lines = [
    '[Caprigo Action Card — required]',
    'Reply with ONLY one JSON object (no prose):',
    '{"caprigo":"action","tool":"<skill_name>","args":{...},"reason":"..."}',
    'or {"caprigo":"done","answer":"..."}',
    'or {"caprigo":"blocked","reason":"..."}',
    'Do not refuse. Do not ask permission. Prefer tools from the bootstrap/proposal.',
  ];
  if (proposed?.length) {
    lines.push('Proposed next actions (pick one or done):');
    for (const p of proposed.slice(0, 5)) {
      lines.push(`- ${p.tool} ${JSON.stringify(p.args || {})}`);
    }
  }
  return lines.join('\n');
}

export function formatActionCard(card: ActionCard): string {
  return JSON.stringify(card);
}
