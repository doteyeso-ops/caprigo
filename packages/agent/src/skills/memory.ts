import * as fs from 'fs';
import * as path from 'path';
import { Skill, caprigoDataRoot } from '@caprigo/shared';

const MEMORY_FILE = path.join(caprigoDataRoot(), 'memory.json');

type MemoryStore = Record<string, { value: unknown; timestamp: number }>;

let cache: MemoryStore | null = null;

function loadStore(): MemoryStore {
  if (cache) return cache;
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
      cache = JSON.parse(raw) as MemoryStore;
      return cache;
    }
  } catch {
    // ignore corrupt file
  }
  cache = {};
  return cache;
}

function saveStore(): void {
  const store = loadStore();
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${MEMORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmp, MEMORY_FILE);
  } catch {
    // best-effort
  }
}

export const storeMemorySkill: Skill = {
  name: 'store_memory',
  description:
    'Store a value in persistent memory with a key (survives gateway restarts). Use for lessons learned (e.g. lesson_<topic>) after tool failures so you do not repeat mistakes.',
  toolParameters: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string', description: 'Unique key for this memory entry' },
      value: { description: 'Any JSON-serializable value to remember' },
    },
    additionalProperties: false,
  },
  execute: async (params: { key: string; value: unknown }) => {
    const store = loadStore();
    store[params.key] = { value: params.value, timestamp: Date.now() };
    saveStore();
    return { success: true, message: `Stored: ${params.key}` };
  },
};

export const retrieveMemorySkill: Skill = {
  name: 'retrieve_memory',
  description: 'Retrieve a value from persistent memory by key',
  toolParameters: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string' },
    },
    additionalProperties: false,
  },
  execute: async (params: { key: string }) => {
    const store = loadStore();
    const entry = store[params.key];
    if (!entry) return { success: false, error: `No value for key: ${params.key}` };
    return { success: true, value: entry.value };
  },
};

export const listMemoryKeysSkill: Skill = {
  name: 'list_memory_keys',
  description: 'List all keys in persistent memory',
  toolParameters: {
    type: 'object',
    additionalProperties: true,
  },
  execute: async () => {
    const store = loadStore();
    return { success: true, keys: Object.keys(store) };
  },
};

export const memorySkills: Skill[] = [storeMemorySkill, retrieveMemorySkill, listMemoryKeysSkill];
