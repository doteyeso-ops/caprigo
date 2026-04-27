/**
 * Load Agent Skills (SKILL.md) from a directory tree — compatible with
 * agentskills.io / Nous Hermes-style folders under `<skillsDir>/agentskills/`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Skill } from '@caprigo/shared';
import { parseSkillMd, toolNameFromAgentSkillPath } from './skill-md';

const MAX_BODY_RETURN = 120_000;

function walkSkillMdRoots(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const hasSkill = entries.some(e => e.isFile() && e.name === 'SKILL.md');
  const hasCode = entries.some(e => e.isFile() && (e.name === 'index.js' || e.name === 'index.cjs'));
  if (hasSkill && !hasCode) {
    out.push(dir);
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    walkSkillMdRoots(path.join(dir, e.name), out);
  }
}

export function loadAgentSkills(agentskillsRoot: string): {
  loaded: Skill[];
  failed: { path: string; error: string }[];
  names: string[];
} {
  const result = { loaded: [] as Skill[], failed: [] as { path: string; error: string }[] };
  const names: string[] = [];

  if (!fs.existsSync(agentskillsRoot)) {
    return { ...result, names };
  }
  const stat = fs.statSync(agentskillsRoot);
  if (!stat.isDirectory()) {
    return { ...result, names };
  }

  const roots: string[] = [];
  walkSkillMdRoots(agentskillsRoot, roots);

  const usedNames = new Set<string>();

  for (const root of roots) {
    const skillFile = path.join(root, 'SKILL.md');
    let raw: string;
    try {
      raw = fs.readFileSync(skillFile, 'utf8');
    } catch (err: any) {
      result.failed.push({ path: skillFile, error: err?.message ?? String(err) });
      continue;
    }

    const parsed = parseSkillMd(raw);
    if (!parsed) {
      result.failed.push({ path: skillFile, error: 'Missing or invalid YAML frontmatter (expected --- … ---)' });
      continue;
    }

    const rel = path.relative(agentskillsRoot, root);
    const relPosix = rel.split(path.sep).join('/');
    let tool = toolNameFromAgentSkillPath(relPosix);
    const fmNameRaw = (parsed.skillName || parsed.frontmatter.name || '').trim().toLowerCase();
    if (fmNameRaw && /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{1,64}$/.test(fmNameRaw)) {
      const fromFm = `as_${fmNameRaw.replace(/-/g, '_')}`.slice(0, 64);
      if (fromFm.length > 3) tool = fromFm;
    }

    let unique = tool;
    let n = 2;
    while (usedNames.has(unique)) {
      unique = `${tool}_${n}`.slice(0, 64);
      n += 1;
    }
    usedNames.add(unique);

    const descFromFm = (parsed.skillDescription || parsed.frontmatter.description || '').trim();
    const description =
      (descFromFm
        ? `${descFromFm} `
        : `Instruction skill from ${relPosix || 'SKILL.md'}. `) +
      'Call this tool to load the full SKILL.md playbook into context (curl, APIs, workflows). ' +
      'Adapt Hermes-only commands to Caprigo tools (execute_command, http_request, etc.).';

    const body = parsed.body.trim();
    const skillRoot = root;

    const skill: Skill = {
      name: unique,
      description,
      executionType: 'local',
      toolParameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          include_frontmatter: {
            type: 'boolean',
            description: 'If true, include YAML frontmatter in the returned text (default false).',
          },
        },
      },
      execute: async (params: { include_frontmatter?: boolean }) => {
        const inc = !!params?.include_frontmatter;
        let text = inc ? raw.trim() : body;
        if (text.length > MAX_BODY_RETURN) {
          text =
            text.slice(0, MAX_BODY_RETURN) +
            `\n\n… [truncated at ${MAX_BODY_RETURN} chars; read files under skill folder with filesystem tools]`;
        }
        return {
          success: true,
          skill: unique,
          source: 'agentskill',
          skillPath: skillRoot,
          content: text,
          note:
            'This playbook may reference Hermes CLI or other agents; use Caprigo equivalents (shell, HTTP, MCP).',
        };
      },
    };

    result.loaded.push(skill);
    names.push(unique);
  }

  return { ...result, names };
}
