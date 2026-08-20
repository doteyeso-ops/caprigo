/**
 * Caprigo Brain skills + learned playbook / gated executable skill spawn.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Skill, caprigoDataRoot } from '@caprigo/shared';
import {
  brainStatusSummary,
  recallLessons,
  recordLesson,
  resetWorkingMemory,
  updateWorking,
} from '../brain';

function skillsRoot(): string {
  const env = process.env.CAPRIGO_SKILLS_DIR?.trim();
  if (env) return path.resolve(env);
  const repo = path.resolve(process.cwd(), 'skills');
  if (fs.existsSync(repo)) return repo;
  return path.join(caprigoDataRoot(), 'skills');
}

function slugify(s: string): string {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'skill'
  );
}

export const brainStatusSkill: Skill = {
  name: 'brain_status',
  description:
    'Show Caprigo Brain working memory (what am I doing?) plus recent lessons. Use when resuming or unsure of the current goal.',
  toolParameters: { type: 'object', properties: {} },
  execute: async () => {
    const s = brainStatusSummary();
    return { success: true, ...s };
  },
};

export const brainRememberSkill: Skill = {
  name: 'brain_remember',
  description:
    'Update working memory (goal/last_action/next_step/blockers) and/or record a structured lesson for future turns.',
  toolParameters: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      last_action: { type: 'string' },
      next_step: { type: 'string' },
      blockers: { type: 'array', items: { type: 'string' } },
      clear_working: { type: 'boolean', description: 'Reset working memory' },
      lesson_signature: { type: 'string', description: 'If set, also record a lesson' },
      lesson_cause: { type: 'string' },
      lesson_fix: { type: 'string' },
      lesson_tools: { type: 'array', items: { type: 'string' } },
      lesson_tags: { type: 'array', items: { type: 'string' } },
    },
  },
  execute: async params => {
    try {
      if (params.clear_working) resetWorkingMemory();
      const working = updateWorking({
        goal: params.goal,
        last_action: params.last_action,
        next_step: params.next_step,
        blockers: params.blockers,
      });
      let lesson = null;
      if (params.lesson_signature && params.lesson_cause && params.lesson_fix) {
        lesson = recordLesson({
          signature: String(params.lesson_signature),
          cause: String(params.lesson_cause),
          fix: String(params.lesson_fix),
          tools: params.lesson_tools,
          tags: params.lesson_tags,
        });
      }
      return { success: true, working, lesson };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const brainRecallSkill: Skill = {
  name: 'brain_recall',
  description: 'Search Caprigo Brain lessons by query, signature, or tags.',
  toolParameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      signature: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
    },
  },
  execute: async params => {
    const lessons = recallLessons({
      query: params.query,
      signature: params.signature,
      tags: params.tags,
      limit: params.limit,
    });
    return { success: true, count: lessons.length, lessons };
  },
};

export const saveSkillPlaybookSkill: Skill = {
  name: 'save_skill_playbook',
  description:
    'Save a reusable procedure as an Agent Skill playbook (SKILL.md) under the skills directory. Prefer this over inventing executable code.',
  toolParameters: {
    type: 'object',
    required: ['name', 'description', 'body'],
    properties: {
      name: { type: 'string', description: 'Short skill name / slug' },
      description: { type: 'string' },
      body: { type: 'string', description: 'Markdown playbook steps' },
    },
  },
  execute: async params => {
    try {
      const name = slugify(String(params.name || ''));
      const description = String(params.description || '').trim() || name;
      const body = String(params.body || '').trim();
      if (!body) return { success: false, error: 'body required' };
      const dir = path.join(skillsRoot(), `learned-${name}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'SKILL.md');
      const md = `---
name: ${name}
description: ${description.replace(/\n/g, ' ').slice(0, 200)}
---

# ${name}

${description}

${body}
`;
      fs.writeFileSync(file, md, 'utf8');
      return { success: true, path: file, message: `Playbook written to ${file}` };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const createSkillSkill: Skill = {
  name: 'create_skill',
  description:
    'Write an executable user skill (index.js). Requires CAPRIGO_ALLOW_SKILL_SPAWN=1. Prefer save_skill_playbook otherwise.',
  toolParameters: {
    type: 'object',
    required: ['name', 'description', 'code'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      code: {
        type: 'string',
        description: 'CommonJS module exporting a Skill or Skill[]',
      },
    },
  },
  execute: async params => {
    if (!/^(1|true|yes)$/i.test(String(process.env.CAPRIGO_ALLOW_SKILL_SPAWN || ''))) {
      return {
        success: false,
        error:
          'Executable skill spawn disabled. Set CAPRIGO_ALLOW_SKILL_SPAWN=1 or use save_skill_playbook.',
      };
    }
    try {
      const name = slugify(String(params.name || ''));
      const code = String(params.code || '');
      if (!code.trim()) return { success: false, error: 'code required' };
      const dir = path.join(skillsRoot(), `learned-${name}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'index.js');
      fs.writeFileSync(file, code, 'utf8');
      return {
        success: true,
        path: file,
        message: `Skill written to ${file}. Restart Caprigo / reload skills to use it.`,
      };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const brainSkills: Skill[] = [
  brainStatusSkill,
  brainRememberSkill,
  brainRecallSkill,
  saveSkillPlaybookSkill,
  createSkillSkill,
];
