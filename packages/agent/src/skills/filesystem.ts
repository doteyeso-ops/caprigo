import { Skill, resolveCaprigoToolPath, checkCaprigoPathAccess, caprigoWorkspaceRoot } from '@caprigo/shared';
import type { Dirent, Stats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

const SEARCH_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  'vendor',
]);
const MAX_FILE_BYTES = 512_000;

export const readFileSkill: Skill = {
  name: 'read_file',
  description: 'Read the contents of a file',
  execute: async (params: { path: string }) => {
    try {
      const filePath = resolveCaprigoToolPath(String(params.path || ''));
      const access = checkCaprigoPathAccess(filePath, 'read');
      if (!access.allowed) return { success: false, error: access.reason };
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const writeFileSkill: Skill = {
  name: 'write_file',
  description: 'Write content to a file',
  execute: async (params: { path: string; content: string }) => {
    try {
      const filePath = resolveCaprigoToolPath(String(params.path || ''));
      const access = checkCaprigoPathAccess(filePath, 'write');
      if (!access.allowed) return { success: false, error: access.reason };
      await fs.writeFile(filePath, params.content, 'utf-8');
      return { success: true, message: `File written to ${filePath}` };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const listDirectorySkill: Skill = {
  name: 'list_directory',
  description: 'List files and directories in a path',
  execute: async (params: { path?: string }) => {
    try {
      const dirPath = resolveCaprigoToolPath(String(params?.path || '.'), caprigoWorkspaceRoot());
      const access = checkCaprigoPathAccess(dirPath, 'read');
      if (!access.allowed) return { success: false, error: access.reason };
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const items = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
      return { success: true, items };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

/** Text search across files under a root (Hermes/OpenClaw-style codebase search; skips bulky dirs). */
export const searchFilesSkill: Skill = {
  name: 'search_files',
  description:
    'Search for a text substring in files under a directory. Returns matching file paths with line previews. Skips node_modules, .git, and common build folders.',
  toolParameters: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Directory to search (default: current working directory).' },
      query: { type: 'string', description: 'Literal text to find (case-sensitive unless case_insensitive).' },
      case_insensitive: { type: 'boolean', description: 'If true, case-insensitive match.' },
      file_extension: {
        type: 'string',
        description: 'Optional filter, e.g. ".ts" or ".md" (leading dot optional).',
      },
      max_results: { type: 'number', description: 'Cap on matches returned (default 40).' },
      max_files_scanned: { type: 'number', description: 'Cap on files read (default 8000).' },
    },
    required: ['query'],
  },
  execute: async (params: {
    root?: string;
    query: string;
    case_insensitive?: boolean;
    file_extension?: string;
    max_results?: number;
    max_files_scanned?: number;
  }) => {
    const queryRaw = String(params.query ?? '');
    if (!queryRaw) {
      return { success: false, error: 'query is required' };
    }
    const rootDir = resolveCaprigoToolPath(String(params.root || '.'), caprigoWorkspaceRoot());
    const rootAccess = checkCaprigoPathAccess(rootDir, 'read');
    if (!rootAccess.allowed) {
      return { success: false, error: rootAccess.reason };
    }
    let ext = params.file_extension ? String(params.file_extension).trim() : '';
    if (ext && !ext.startsWith('.')) ext = `.${ext}`;
    const maxResults = Math.min(Math.max(params.max_results ?? 40, 1), 200);
    const maxFiles = Math.min(Math.max(params.max_files_scanned ?? 8000, 100), 50_000);
    const ci = params.case_insensitive === true;
    const needle = ci ? queryRaw.toLowerCase() : queryRaw;

    const matches: Array<{ path: string; line: number; preview: string }> = [];
    let filesScanned = 0;

    const queue: string[] = [rootDir];
    while (queue.length > 0 && matches.length < maxResults && filesScanned < maxFiles) {
      const dir = queue.shift()!;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (filesScanned >= maxFiles || matches.length >= maxResults) break;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (SEARCH_IGNORE_DIRS.has(ent.name)) continue;
          queue.push(full);
          continue;
        }
        if (!ent.isFile()) continue;
        if (ext && !ent.name.toLowerCase().endsWith(ext.toLowerCase())) continue;
        filesScanned++;
        let st: Stats;
        try {
          st = await fs.stat(full);
        } catch {
          continue;
        }
        if (st.size > MAX_FILE_BYTES) continue;
        let text: string;
        try {
          text = await fs.readFile(full, 'utf-8');
        } catch {
          continue;
        }
        const hay = ci ? text.toLowerCase() : text;
        if (!hay.includes(needle)) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hl = ci ? line.toLowerCase() : line;
          if (hl.includes(needle)) {
            const preview = line.length > 240 ? `${line.slice(0, 237)}…` : line;
            matches.push({ path: full, line: i + 1, preview });
            if (matches.length >= maxResults) break;
          }
        }
      }
    }

    return {
      success: true,
      root: rootDir,
      query: queryRaw,
      files_scanned: filesScanned,
      matches,
      truncated: matches.length >= maxResults || filesScanned >= maxFiles,
    };
  },
};

/** Replace text in a file; default requires exactly one occurrence (OpenClaw-style surgical edit). */
export const searchReplaceSkill: Skill = {
  name: 'search_replace',
  description:
    'Replace text in a file. By default old_string must appear exactly once (set replace_all to change every occurrence).',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      old_string: { type: 'string', description: 'Text to find' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean', description: 'If true, replace all occurrences.' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  execute: async (params: { path: string; old_string: string; new_string: string; replace_all?: boolean }) => {
    try {
      const filePath = resolveCaprigoToolPath(String(params.path || ''));
      const access = checkCaprigoPathAccess(filePath, 'write');
      if (!access.allowed) return { success: false, error: access.reason };
      const oldStr = params.old_string ?? '';
      const newStr = params.new_string ?? '';
      if (!oldStr) {
        return { success: false, error: 'old_string cannot be empty' };
      }
      const content = await fs.readFile(filePath, 'utf-8');
      const replaceAll = params.replace_all === true;

      let next: string;
      let count: number;
      if (replaceAll) {
        const parts = content.split(oldStr);
        count = parts.length - 1;
        next = parts.join(newStr);
      } else {
        count = content.split(oldStr).length - 1;
        if (count === 0) {
          return { success: false, error: 'old_string not found in file' };
        }
        if (count > 1) {
          return {
            success: false,
            error: `old_string matched ${count} times; narrow the snippet or use replace_all`,
          };
        }
        next = content.replace(oldStr, newStr);
      }
      await fs.writeFile(filePath, next, 'utf-8');
      return { success: true, path: filePath, replacements: replaceAll ? count : 1 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const fileSystemSkills: Skill[] = [
  readFileSkill,
  writeFileSkill,
  listDirectorySkill,
  searchFilesSkill,
  searchReplaceSkill,
];
