/**
 * List files in a directory by mtime descending (same idea as offline-scripts/dir-recent.mjs).
 */
const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'list_recent_files',
  description:
    'List files in a directory (non-recursive), newest first. Params: path (default .), limit (default 25, max 100).',
  execute: async params => {
    const dir = path.resolve(params?.path ?? params?.dir ?? '.');
    const limit = Math.min(100, Math.max(1, parseInt(params?.limit ?? 25, 10) || 25));
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        const full = path.join(dir, e.name);
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        files.push({
          name: e.name,
          size: st.size,
          mtime: st.mtime.toISOString(),
          mtimeMs: st.mtimeMs,
        });
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return {
        success: true,
        directory: dir,
        limit,
        files: files.slice(0, limit),
        totalFiles: files.length,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
