/**
 * Prompt briefing — Caprigo translates fat tool/history context into a short
 * inference prompt so LMS "prompt processing" (prefill) stays fast.
 *
 * A second LLM only helps if it sees *less* context; this module does the
 * translation in-harness (deterministic). Optional FAST_MODEL then answers.
 */

import type { UnifiedChatMessage } from '@caprigo/shared';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] || '');
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function toolOneLiner(content: string, toolName?: string): string {
  const raw = String(content || '').trim();
  if (!raw) return toolName ? `(${toolName} ok)` : '(tool ok)';
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o === 'object') {
      if (o.success === false) {
        return `${toolName || 'tool'} failed: ${truncate(String(o.error || 'error'), 120)}`;
      }
      if (typeof o.path === 'string') {
        return `${toolName || 'tool'} ok path=${truncate(o.path, 80)}`;
      }
      if (Array.isArray(o.related)) {
        return `${toolName || 'web_search'} ok ${o.related.length} hits`;
      }
      if (typeof o.summary === 'string' && o.summary.length > 20) {
        return `${toolName || 'tool'}: ${truncate(o.summary, 160)}`;
      }
      if (o.block_count != null) {
        return `${toolName || 'desktop_screenshot'} ok blocks=${o.block_count}`;
      }
    }
  } catch {
    /* plain text */
  }
  return `${toolName || 'tool'}: ${truncate(raw.replace(/\s+/g, ' '), 160)}`;
}

export function briefingEnabled(): boolean {
  const raw = String(process.env.CAPRIGO_PROMPT_BRIEF ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off' || raw === 'no');
}

/** Optional small model for final text-only answers after tools already ran. */
export function fastModelId(): string | null {
  const m = process.env.CAPRIGO_FAST_MODEL?.trim();
  return m || null;
}

/**
 * Compact conversation for LMS inference:
 * - Keep system + recent user/assistant turns
 * - Collapse older tool payloads to one-liners (biggest prefill win)
 * - Keep the last K tool rounds fuller for act→verify continuity
 */
export function compactMessagesForInference(
  messages: UnifiedChatMessage[],
  opts?: { keepFullToolRounds?: number; maxToolChars?: number }
): UnifiedChatMessage[] {
  if (!briefingEnabled() || messages.length < 3) return messages;

  const keepFull = opts?.keepFullToolRounds ?? envInt('CAPRIGO_BRIEF_FULL_TOOL_ROUNDS', 2, 0, 8);
  const maxToolChars = opts?.maxToolChars ?? envInt('CAPRIGO_BRIEF_TOOL_CHARS', 900, 200, 8000);

  // Indices of tool messages from the end
  const toolIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIdx.push(i);
  }
  const fullToolIdx = new Set(toolIdx.slice(-keepFull));

  return messages.map((m, i) => {
    if (m.role !== 'tool') {
      // Cap runaway assistant dumps
      if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 2500) {
        return { ...m, content: truncate(m.content, 2500) };
      }
      return m;
    }
    const name = (m as { tool_name?: string }).tool_name;
    const content = String(m.content || '');
    if (fullToolIdx.has(i) && content.length <= maxToolChars) {
      return m;
    }
    if (fullToolIdx.has(i)) {
      return { ...m, content: truncate(content, maxToolChars) };
    }
    return {
      ...m,
      content: toolOneLiner(content, name),
    };
  });
}

/** Rough char budget for deciding whether compaction mattered. */
export function messagesCharCount(messages: UnifiedChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    n += String(m.content || '').length;
    if (m.tool_calls?.length) n += JSON.stringify(m.tool_calls).length;
  }
  return n;
}
