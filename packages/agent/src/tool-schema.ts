/**
 * Map Caprigo skills to Ollama `tools` entries.
 */

import type { Skill } from '@caprigo/shared';

export function skillToOllamaTool(skill: Skill) {
  const raw = skill.toolParameters ?? {
    type: 'object' as const,
    additionalProperties: true,
    description: 'Arguments for this tool as a JSON object.',
  };

  // LM Studio (and strict OpenAI-compatible validators) require `properties` to be an object.
  const parameters = {
    ...raw,
    type: (raw as { type?: string }).type || 'object',
    properties:
      (raw as { properties?: Record<string, unknown> }).properties &&
      typeof (raw as { properties?: unknown }).properties === 'object'
        ? (raw as { properties: Record<string, unknown> }).properties
        : {},
  };

  // Long descriptions dominate LMS prefill cost; keep tools[] lean (full text stays in skill docs).
  const maxDesc = Math.max(
    60,
    Math.min(400, Number(process.env.CAPRIGO_TOOL_DESC_CHARS || 140) || 140)
  );
  let description = String(skill.description || skill.name);
  if (description.length > maxDesc) {
    description = description.slice(0, maxDesc - 1).trimEnd() + '…';
  }

  return {
    type: 'function' as const,
    function: {
      name: skill.name,
      description,
      parameters,
    },
  };
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return {};
    try {
      const parsed = JSON.parse(t) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  return {};
}
