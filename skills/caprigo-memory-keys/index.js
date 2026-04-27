/**
 * List keys in Caprigo persistent memory file (values omitted for privacy).
 */
const fs = require('fs');
const path = require('path');
const { caprigoDataRoot } = require('../_caprigo-data-root.js');

module.exports = {
  name: 'caprigo_memory_keys',
  description:
    'List keys stored in Caprigo persistent memory file (not the values). Optional maxKeys (default 200).',
  execute: async params => {
    const maxKeys = Math.min(5000, Math.max(1, parseInt(params?.maxKeys ?? 200, 10) || 200));
    const file = path.join(caprigoDataRoot(), 'memory.json');
    if (!fs.existsSync(file)) {
      return { success: true, file, exists: false, keys: [] };
    }
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') {
        return { success: true, file, keys: [] };
      }
      const keys = Object.keys(obj).slice(0, maxKeys);
      return { success: true, file, keyCount: keys.length, keys };
    } catch (e) {
      return { success: false, file, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
