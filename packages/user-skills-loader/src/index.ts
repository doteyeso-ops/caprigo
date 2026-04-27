/**
 * User Skills Loader
 *
 * Loads skills from a user directory at runtime. This is the engine's "mod" system—
 * users drop skill files into ~/.caprigo/skills/ or ./skills/.
 *
 * Skill format: A .js or .cjs file that exports:
 *   - module.exports = Skill
 *   - module.exports = Skill[]
 *   - export default Skill | Skill[]
 */

import * as path from 'path';
import * as fs from 'fs';
import { Skill, caprigoDataRoot, caprigoEnv } from '@caprigo/shared';

export { loadAgentSkills } from './agent-skills';

export interface LoadResult {
  loaded: Skill[];
  failed: { path: string; error: string }[];
}

/**
 * Walk up from cwd looking for a `skills` directory (monorepo / nested cwd safe).
 */
function findSkillsDirWalkingUp(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'skills');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return path.resolve(candidate);
      }
    } catch {
      /* ignore */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Get the user skills directory. Resolution order:
 * 1. CAPRIGO_SKILLS_DIR env var
 * 2. ./skills walking up from cwd (finds repo `skills/` when cwd is packages/gateway, etc.)
 * 3. <caprigoDataRoot>/skills (see shared caprigoDataRoot)
 */
export function getSkillsDir(): string {
  const fromEnv = caprigoEnv('SKILLS_DIR');
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  const found = findSkillsDirWalkingUp();
  if (found) {
    return found;
  }
  return path.join(caprigoDataRoot(), 'skills');
}

/**
 * Load all skills from the user skills directory.
 * Creates the directory if it doesn't exist.
 * Never throws—returns failed loads in the result.
 */
export function loadUserSkills(skillsDir?: string): LoadResult {
  const dir = skillsDir || getSkillsDir();
  const result: LoadResult = { loaded: [], failed: [] };

  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      // Directory doesn't exist and we couldn't create it—no user skills
      return result;
    }
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    return result;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('_')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Try index.js or index.cjs inside the directory
      const indexJs = path.join(fullPath, 'index.js');
      const indexCjs = path.join(fullPath, 'index.cjs');
      if (fs.existsSync(indexJs)) {
        loadSkillFile(indexJs, result);
      } else if (fs.existsSync(indexCjs)) {
        loadSkillFile(indexCjs, result);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
      loadSkillFile(fullPath, result);
    }
  }

  return result;
}

/**
 * Load and validate a single skill file (absolute path). Does not register with an Agent.
 */
export function loadSkillsFromFile(filePath: string): LoadResult {
  const abs = path.resolve(filePath);
  const result: LoadResult = { loaded: [], failed: [] };
  loadSkillFile(abs, result);
  return result;
}

function loadSkillFile(filePath: string, result: LoadResult): void {
  try {
    // Clear require cache for this file so we get fresh load on restart
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    const skillOrSkills = mod.default ?? mod;

    if (Array.isArray(skillOrSkills)) {
      for (const s of skillOrSkills) {
        if (isValidSkill(s)) {
          result.loaded.push(s);
        } else {
          result.failed.push({ path: filePath, error: 'Invalid skill: missing name, description, or execute' });
        }
      }
    } else if (isValidSkill(skillOrSkills)) {
      result.loaded.push(skillOrSkills);
    } else {
      result.failed.push({ path: filePath, error: 'Module must export Skill or Skill[]' });
    }
  } catch (err: any) {
    result.failed.push({ path: filePath, error: err?.message ?? String(err) });
  }
}

function isValidSkill(s: any): s is Skill {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.name === 'string' &&
    typeof s.description === 'string' &&
    typeof s.execute === 'function'
  );
}
