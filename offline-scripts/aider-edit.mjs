#!/usr/bin/env node
/**
 * Offline Caprigo script: run Aider against workspace files (box-mini).
 * Usage via Caprigo offline run or: node offline-scripts/aider-edit.mjs "message" file1 file2
 */
import { spawn } from 'child_process';
import path from 'path';

const args = process.argv.slice(2);
const message = args[0] || 'Improve the code with minimal changes.';
const files = args.slice(1);

const aider =
  process.env.AIDER_BIN ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'aider.exe');

const env = {
  ...process.env,
  OLLAMA_API_BASE: process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434',
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
};

const aiderArgs = [
  '--model',
  process.env.AIDER_MODEL || 'ollama_chat/qwen2.5:7b',
  '--yes-always',
  '--no-auto-lint',
  '--message',
  message,
  ...files,
];

const child = spawn(aider, aiderArgs, { stdio: 'inherit', env, shell: false });
child.on('exit', code => process.exit(code ?? 1));
