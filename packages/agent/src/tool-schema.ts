/**
 * Map Caprigo skills to Ollama `tools` entries.
 */

import type { Skill } from '@caprigo/shared';

export function skillToOllamaTool(skill: Skill) {
  const parameters = skill.toolParameters ?? {
    type: 'object' as const,
    additionalProperties: true,
    description: 'Arguments for this tool as a JSON object.',
  };

  return {
    type: 'function' as const,
    function: {
      name: skill.name,
      description: skill.description,
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
