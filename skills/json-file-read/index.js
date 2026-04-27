/**
 * Read a UTF-8 file and parse JSON (same idea as offline-scripts/json-prettify.mjs).
 */
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'json_file_read',
  description:
    'Read a JSON file from disk (param path), return parsed value and pretty string. Fails safely on invalid JSON.',
  execute: async params => {
    const rel = params?.path ?? params?.file;
    if (!rel || typeof rel !== 'string') {
      return { success: false, error: 'path (string) required' };
    }
    const abs = path.resolve(rel);
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      const value = JSON.parse(raw);
      return {
        success: true,
        path: abs,
        value,
        pretty: JSON.stringify(value, null, 2),
      };
    } catch (e) {
      return {
        success: false,
        path: abs,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
