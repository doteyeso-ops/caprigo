/**
 * Lean tool allowlist for 8GB / scrap-GPU agents.
 * Unrestricted sessions otherwise inject core + vibes_* + as_* + mcp_* schemas every turn.
 */

import { caprigoEnv, type Skill } from '@caprigo/shared';

/** Core operator tools that fit a small KV window. Explicit assignedSkills always win. */
export const LEAN_SKILL_ALLOWLIST: readonly string[] = [
  'read_file',
  'write_file',
  'list_directory',
  'search_files',
  'search_replace',
  'execute_command',
  'system_info',
  'current_datetime',
  'http_get',
  'http_post',
  'web_search',
  'web_fetch',
  'store_memory',
  'retrieve_memory',
  'list_memory_keys',
  'fleet_message',
  'fleet_roster',
] as const;

const LEAN_SET = new Set(LEAN_SKILL_ALLOWLIST);

/**
 * Lean mode when CAPRIGO_LEAN_TOOLS=1/true, or when laptopMode is on
 * (unless CAPRIGO_LEAN_TOOLS=0/false forces off).
 */
export function isLeanToolsActive(laptopMode: boolean): boolean {
  const raw = (caprigoEnv('LEAN_TOOLS') || process.env.CAPRIGO_LEAN_TOOLS || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  return !!laptopMode;
}

export function filterLeanSkills(skills: Skill[]): Skill[] {
  return skills.filter(s => LEAN_SET.has(s.name));
}
