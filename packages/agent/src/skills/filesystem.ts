import {
  Skill,
  resolveCaprigoToolPath,
  checkCaprigoPathAccess,
  caprigoWorkspaceRoot,
  recordFileChange,
  readFileLedgerTail,
  summarizeTouchedFiles,
} from '@caprigo/shared';
import type { Dirent, Stats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as ts from 'typescript';
import { annotateWithHashes, applyHashEdits, type HashEditOp } from './hashline';

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
const REPO_MAP_FILE_BYTES = 256_000;

type RepoSymbol = { line: number; kind: string; name: string; signature: string };
type RankedCandidate = {
  path: string;
  score: number;
  reasons: string[];
  top_symbol_matches?: Array<{ name: string; kind: string; line: number; score: number }>;
};

function normalizeExtensionFilter(raw: unknown): string {
  const ext = String(raw ?? '').trim();
  if (!ext) return '';
  return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

function tokenizeQuery(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .toLowerCase()
        .split(/[^a-z0-9_]+/i)
        .map(token => token.trim())
        .filter(token => token.length >= 2)
    )
  );
}

function isIgnoredDir(name: string, includeHidden = false): boolean {
  if (SEARCH_IGNORE_DIRS.has(name)) return true;
  if (!includeHidden && name.startsWith('.')) return true;
  return false;
}

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return false;
  return !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.exe', '.dll', '.bin'].includes(ext);
}

function isTsLikeFile(filePath: string): boolean {
  return ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase());
}

function signatureFromLine(lines: string[], line: number): string {
  const raw = lines[Math.max(0, line - 1)] || '';
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

function extractRepoSymbolsFromTsAst(filePath: string, text: string): RepoSymbol[] {
  const scriptKind =
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX
    : filePath.endsWith('.jsx') ? ts.ScriptKind.JSX
    : filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs') ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = text.split(/\r?\n/);
  const symbols: RepoSymbol[] = [];

  const pushSymbol = (node: ts.Node, kind: string, name: string | undefined) => {
    if (!name) return;
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const line = pos.line + 1;
    symbols.push({
      line,
      kind,
      name,
      signature: signatureFromLine(lines, line),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node)) {
      pushSymbol(node, 'class', node.name?.text);
    } else if (ts.isInterfaceDeclaration(node)) {
      pushSymbol(node, 'interface', node.name.text);
    } else if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol(node, 'type', node.name.text);
    } else if (ts.isEnumDeclaration(node)) {
      pushSymbol(node, 'enum', node.name.text);
    } else if (ts.isFunctionDeclaration(node)) {
      pushSymbol(node, 'function', node.name?.text);
    } else if (ts.isMethodDeclaration(node)) {
      pushSymbol(node, 'method', ts.isIdentifier(node.name) ? node.name.text : undefined);
    } else if (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
      const initializer = (node as ts.PropertyDeclaration | ts.PropertyAssignment).initializer;
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        pushSymbol(node, 'function', name);
      }
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          pushSymbol(decl, 'function', decl.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return symbols;
}

function extractRepoSymbols(filePath: string, text: string): RepoSymbol[] {
  if (isTsLikeFile(filePath)) {
    try {
      const astSymbols = extractRepoSymbolsFromTsAst(filePath, text);
      if (astSymbols.length > 0) return astSymbols;
    } catch {
      // fall through
    }
  }

  const lines = text.split(/\r?\n/);
  const symbols: RepoSymbol[] = [];
  const patterns: Array<{ kind: string; regex: RegExp }> = [
    { kind: 'class', regex: /^\s*(?:export\s+)?class\s+([A-Za-z_][\w]*)\b.*$/ },
    { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_][\w]*)\b.*$/ },
    { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_][\w]*)\b.*$/ },
    { kind: 'enum', regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_][\w]*)\b.*$/ },
    { kind: 'function', regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)\b.*$/ },
    { kind: 'function', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>.*$/ },
    { kind: 'function', regex: /^\s*(?:export\s+)?const\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?[A-Za-z_][\w]*\s*=>.*$/ },
    { kind: 'method', regex: /^\s*(?:async\s+)?([A-Za-z_][\w]*)\s*\([^)]*\)\s*[:{].*$/ },
    { kind: 'python-class', regex: /^\s*class\s+([A-Za-z_][\w]*)\b.*$/ },
    { kind: 'python-def', regex: /^\s*def\s+([A-Za-z_][\w]*)\s*\(.*$/ },
    { kind: 'python-def', regex: /^\s*async\s+def\s+([A-Za-z_][\w]*)\s*\(.*$/ },
    { kind: 'rust-fn', regex: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)\s*\(.*$/ },
    { kind: 'go-func', regex: /^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(.*$/ },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('*')) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (!match) continue;
      const name = match[1];
      symbols.push({
        line: i + 1,
        kind: pattern.kind,
        name,
        signature: line.length > 160 ? `${line.slice(0, 157)}...` : line,
      });
      break;
    }
  }

  return symbols;
}

function scoreTextAgainstTokens(text: string, tokens: string[]): { score: number; matched: string[] } {
  if (!tokens.length) return { score: 0, matched: [] };
  const lower = text.toLowerCase();
  const matched = tokens.filter(token => lower.includes(token));
  return {
    score: matched.length,
    matched,
  };
}

export const readFileSkill: Skill = {
  name: 'read_file',
  description:
    'Read a file. By default each line is annotated as `NNN:hhh|text` (line number + content hash) so you can edit with hash_edit. Pass annotate=false for raw text.',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      annotate: {
        type: 'boolean',
        description: 'If true (default), prefix lines with NNN:hhh| for hash_edit anchors. Set false for raw.',
      },
    },
    required: ['path'],
  },
  execute: async (params: { path: string; annotate?: boolean }) => {
    try {
      const filePath = resolveCaprigoToolPath(String(params.path || ''));
      const access = checkCaprigoPathAccess(filePath, 'read');
      if (!access.allowed) return { success: false, error: access.reason };
      const content = await fs.readFile(filePath, 'utf-8');
      const annotate = params.annotate !== false;
      if (!annotate) return { success: true, path: filePath, content, annotated: false };
      return {
        success: true,
        path: filePath,
        content: annotateWithHashes(content),
        annotated: true,
        edit_hint:
          'Edit with hash_edit using anchors like "a7c" or "42:a7c". Prefer hash_edit over search_replace when anchors are available.',
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const writeFileSkill: Skill = {
  name: 'write_file',
  description:
    'Write content to a file. Creates parent directories automatically. Prefer paths under generated/ (e.g. generated/sunset.html). Put the FULL file text in content — never stubs or "..." placeholders.',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write (prefer generated/... )' },
      content: { type: 'string', description: 'Full file contents (never omit; never use ... placeholders)' },
    },
    required: ['path', 'content'],
  },
  execute: async (params: {
    path?: string;
    content?: string;
    target?: string;
    file?: string;
    filepath?: string;
  }) => {
    try {
      const content = params.content;
      if (content == null || typeof content !== 'string') {
        return {
          success: false,
          error:
            'write_file requires string "content". Call again with path and the FULL file text (no ellipsis stubs).',
        };
      }
      const pathArg = String(
        params.path || params.target || params.file || params.filepath || ''
      ).trim();
      if (!pathArg) {
        return { success: false, error: 'write_file requires "path"' };
      }
      const filePath = resolveCaprigoToolPath(pathArg);
      const access = checkCaprigoPathAccess(filePath, 'write');
      if (!access.allowed) return { success: false, error: access.reason };
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      recordFileChange({
        action: 'write',
        path: filePath,
        bytes: Buffer.byteLength(content, 'utf8'),
      });
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
    'LOCAL codebase/disk text search only — find a substring inside files under a directory (grep-like). Use when the user means the repo/workspace/files on disk ("search the code for X", "find TODO in this project"). Do NOT use for internet/news/how-to questions — use web_search for those.',
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

/** Hash-anchored surgical edits — preferred after read_file (annotated). */
export const hashEditSkill: Skill = {
  name: 'hash_edit',
  description:
    'Edit a file by content-hash anchors from read_file (format NNN:hhh|line). More reliable than search_replace for local models. Actions: replace, delete, insert_after, insert_before.',
  toolParameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      edits: {
        type: 'array',
        description: 'List of edits applied in one write (anchors resolved against current file).',
        items: {
          type: 'object',
          properties: {
            anchor: {
              type: 'string',
              description: 'Hash (a7c), line:hash (42:a7c), or line number (42)',
            },
            action: {
              type: 'string',
              description: 'replace | delete | insert_after | insert_before',
            },
            content: {
              type: 'string',
              description: 'New text for replace/insert (may be multi-line)',
            },
          },
          required: ['anchor', 'action'],
        },
      },
    },
    required: ['path', 'edits'],
  },
  execute: async (params: { path: string; edits: HashEditOp[] }) => {
    try {
      const filePath = resolveCaprigoToolPath(String(params.path || ''));
      const access = checkCaprigoPathAccess(filePath, 'write');
      if (!access.allowed) return { success: false, error: access.reason };
      const before = await fs.readFile(filePath, 'utf-8');
      const result = applyHashEdits(before, params.edits || []);
      if ('error' in result) return { success: false, error: result.error };
      await fs.writeFile(filePath, result.content, 'utf-8');
      recordFileChange({
        action: 'replace',
        path: filePath,
        replacements: result.applied.length,
        bytes: Buffer.byteLength(result.content, 'utf8'),
      });
      return {
        success: true,
        path: filePath,
        edits_applied: result.applied.length,
        applied: result.applied,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
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
      recordFileChange({
        action: 'replace',
        path: filePath,
        replacements: replaceAll ? count : 1,
        bytes: Buffer.byteLength(next, 'utf8'),
      });
      return { success: true, path: filePath, replacements: replaceAll ? count : 1 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

/** Durable ledger of files Caprigo created/edited (survives gateway restarts). */
export const listFileChangesSkill: Skill = {
  name: 'list_file_changes',
  description:
    'List files Caprigo recently created or edited (write_file / hash_edit / search_replace). Use this to keep track of work across the session.',
  toolParameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max unique paths (default 30).' },
      detail: {
        type: 'boolean',
        description: 'If true, also return raw recent ledger events.',
      },
    },
  },
  execute: async (params: { limit?: number; detail?: boolean }) => {
    const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
    const touched = summarizeTouchedFiles(limit);
    const out: Record<string, unknown> = {
      success: true,
      touched_count: touched.length,
      touched,
    };
    if (params.detail === true) {
      out.recent_events = readFileLedgerTail(Math.min(limit * 2, 100));
    }
    return out;
  },
};

export const repoMapSkill: Skill = {
  name: 'repo_map',
  description:
    'Build a compact structural map of a codebase. Returns files plus high-signal symbol definitions like classes, functions, interfaces, and methods without reading whole files into prompt context.',
  toolParameters: {
    type: 'object',
    properties: {
      root: { type: 'string', description: 'Directory to map (default: current working directory).' },
      file_extension: {
        type: 'string',
        description: 'Optional extension filter, e.g. ".ts", ".py", ".go".',
      },
      max_files: { type: 'number', description: 'Max files to inspect (default 160).' },
      max_symbols: { type: 'number', description: 'Max symbol rows returned (default 320).' },
      include_hidden: { type: 'boolean', description: 'If true, include dot-directories and dot-files.' },
    },
  },
  execute: async (params: {
    root?: string;
    file_extension?: string;
    max_files?: number;
    max_symbols?: number;
    include_hidden?: boolean;
  }) => {
    try {
      const rootDir = resolveCaprigoToolPath(String(params.root || '.'), caprigoWorkspaceRoot());
      const access = checkCaprigoPathAccess(rootDir, 'read');
      if (!access.allowed) return { success: false, error: access.reason };

      const ext = normalizeExtensionFilter(params.file_extension);
      const maxFiles = Math.min(Math.max(params.max_files ?? 160, 20), 1000);
      const maxSymbols = Math.min(Math.max(params.max_symbols ?? 320, 20), 2000);
      const includeHidden = params.include_hidden === true;

      const queue: string[] = [rootDir];
      const files: Array<{ path: string; symbols: RepoSymbol[] }> = [];
      let scannedFiles = 0;
      let totalSymbols = 0;

      while (queue.length > 0 && scannedFiles < maxFiles && totalSymbols < maxSymbols) {
        const dir = queue.shift()!;
        let entries: Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const ent of entries) {
          if (scannedFiles >= maxFiles || totalSymbols >= maxSymbols) break;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (isIgnoredDir(ent.name, includeHidden)) continue;
            queue.push(full);
            continue;
          }
          if (!ent.isFile()) continue;
          if (!includeHidden && ent.name.startsWith('.')) continue;
          if (ext && path.extname(ent.name).toLowerCase() !== ext) continue;
          if (!isProbablyTextFile(full)) continue;

          scannedFiles++;
          let st: Stats;
          try {
            st = await fs.stat(full);
          } catch {
            continue;
          }
          if (st.size > REPO_MAP_FILE_BYTES) continue;

          let text: string;
          try {
            text = await fs.readFile(full, 'utf-8');
          } catch {
            continue;
          }

          const symbols = extractRepoSymbols(full, text);
          if (!symbols.length) continue;
          const remaining = Math.max(0, maxSymbols - totalSymbols);
          const clipped = symbols.slice(0, remaining);
          totalSymbols += clipped.length;
          files.push({
            path: path.relative(rootDir, full) || path.basename(full),
            symbols: clipped,
          });
        }
      }

      return {
        success: true,
        root: rootDir,
        files_scanned: scannedFiles,
        files_with_symbols: files.length,
        symbols_returned: totalSymbols,
        truncated: scannedFiles >= maxFiles || totalSymbols >= maxSymbols,
        files,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
};

export const codebaseContextSkill: Skill = {
  name: 'codebase_context',
  description:
    'Retrieve compact codebase context for a coding task. Combines a repo map with text search to suggest likely files and symbols before reading full files.',
  toolParameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you are trying to find or change in the codebase.' },
      root: { type: 'string', description: 'Directory to analyze (default: current working directory).' },
      file_extension: { type: 'string', description: 'Optional extension filter such as ".ts", ".py", or ".go".' },
      case_insensitive: { type: 'boolean', description: 'If true, text search is case-insensitive.' },
      max_results: { type: 'number', description: 'Max search matches returned (default 12).' },
      max_files: { type: 'number', description: 'Max files to inspect for repo map (default 120).' },
      max_symbols: { type: 'number', description: 'Max symbols returned from repo map (default 180).' },
    },
    required: ['query'],
  },
  execute: async (params: {
    query: string;
    root?: string;
    file_extension?: string;
    case_insensitive?: boolean;
    max_results?: number;
    max_files?: number;
    max_symbols?: number;
  }) => {
    try {
      const queryRaw = String(params.query ?? '').trim();
      if (!queryRaw) return { success: false, error: 'query is required' };
      const queryTokens = tokenizeQuery(queryRaw);

      const rootDir = resolveCaprigoToolPath(String(params.root || '.'), caprigoWorkspaceRoot());
      const access = checkCaprigoPathAccess(rootDir, 'read');
      if (!access.allowed) return { success: false, error: access.reason };

      const ext = normalizeExtensionFilter(params.file_extension);
      const maxFiles = Math.min(Math.max(params.max_files ?? 120, 20), 600);
      const maxSymbols = Math.min(Math.max(params.max_symbols ?? 180, 20), 1200);
      const maxResults = Math.min(Math.max(params.max_results ?? 12, 1), 60);
      const ci = params.case_insensitive === true;
      const needle = ci ? queryRaw.toLowerCase() : queryRaw;

      const queue: string[] = [rootDir];
      const mapFiles: Array<{ path: string; symbols: RepoSymbol[] }> = [];
      const hits: Array<{ path: string; line: number; preview: string }> = [];
      let filesScanned = 0;
      let totalSymbols = 0;

      while (queue.length > 0 && filesScanned < maxFiles && (totalSymbols < maxSymbols || hits.length < maxResults)) {
        const dir = queue.shift()!;
        let entries: Dirent[];
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const ent of entries) {
          if (filesScanned >= maxFiles) break;
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (isIgnoredDir(ent.name, false)) continue;
            queue.push(full);
            continue;
          }
          if (!ent.isFile()) continue;
          if (ent.name.startsWith('.')) continue;
          if (ext && path.extname(ent.name).toLowerCase() !== ext) continue;
          if (!isProbablyTextFile(full)) continue;

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

          if (st.size <= REPO_MAP_FILE_BYTES && totalSymbols < maxSymbols) {
            const symbols = extractRepoSymbols(full, text);
            if (symbols.length > 0) {
              const remaining = Math.max(0, maxSymbols - totalSymbols);
              const clipped = symbols.slice(0, remaining);
              totalSymbols += clipped.length;
              mapFiles.push({
                path: path.relative(rootDir, full) || path.basename(full),
                symbols: clipped,
              });
            }
          }

          if (hits.length < maxResults) {
            const hay = ci ? text.toLowerCase() : text;
            if (hay.includes(needle)) {
              const lines = text.split(/\r?\n/);
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const test = ci ? line.toLowerCase() : line;
                if (!test.includes(needle)) continue;
                const preview = line.length > 240 ? `${line.slice(0, 237)}...` : line;
                hits.push({
                  path: path.relative(rootDir, full) || path.basename(full),
                  line: i + 1,
                  preview,
                });
                if (hits.length >= maxResults) break;
              }
            }
          }
        }
      }

      const ranked = new Map<string, RankedCandidate>();
      const touchCandidate = (filePath: string): RankedCandidate => {
        let current = ranked.get(filePath);
        if (!current) {
          current = { path: filePath, score: 0, reasons: [] };
          ranked.set(filePath, current);
        }
        return current;
      };

      for (const hit of hits) {
        const candidate = touchCandidate(hit.path);
        candidate.score += 8;
        if (!candidate.reasons.includes('direct_text_hit')) candidate.reasons.push('direct_text_hit');
        const previewScore = scoreTextAgainstTokens(hit.preview, queryTokens);
        candidate.score += previewScore.score * 2;
      }

      for (const file of mapFiles) {
        const candidate = touchCandidate(file.path);
        const pathScore = scoreTextAgainstTokens(file.path, queryTokens);
        if (pathScore.score > 0) {
          candidate.score += pathScore.score * 3;
          if (!candidate.reasons.includes('path_token_match')) candidate.reasons.push('path_token_match');
        }

        const symbolMatches = file.symbols
          .map(symbol => {
            const nameScore = scoreTextAgainstTokens(symbol.name, queryTokens);
            const sigScore = scoreTextAgainstTokens(symbol.signature, queryTokens);
            const fullText = `${symbol.name} ${symbol.signature}`.toLowerCase();
            let score = nameScore.score * 5 + sigScore.score * 2;
            if (fullText.includes(queryRaw.toLowerCase())) score += 10;
            return {
              name: symbol.name,
              kind: symbol.kind,
              line: symbol.line,
              score,
            };
          })
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        if (symbolMatches.length > 0) {
          candidate.score += symbolMatches.reduce((sum, item) => sum + item.score, 0);
          candidate.top_symbol_matches = symbolMatches.slice(0, 3);
          if (!candidate.reasons.includes('symbol_match')) candidate.reasons.push('symbol_match');
        }
      }

      const rankedCandidates = Array.from(ranked.values())
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      return {
        success: true,
        root: rootDir,
        query: queryRaw,
        files_scanned: filesScanned,
        candidate_files: rankedCandidates.map(item => item.path),
        ranked_candidates: rankedCandidates,
        search_hits: hits,
        repo_map: mapFiles,
        truncated: filesScanned >= maxFiles || totalSymbols >= maxSymbols || hits.length >= maxResults,
        next_step_hint:
          'Use ranked_candidates plus search_hits to choose 1-3 files for read_file. Prefer the highest-scoring files before loading full files.',
      };
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
  hashEditSkill,
  searchReplaceSkill,
  listFileChangesSkill,
  repoMapSkill,
  codebaseContextSkill,
];
