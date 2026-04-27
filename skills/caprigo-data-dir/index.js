/**
 * Inspect the Caprigo data directory: exists, size hints, top-level file names.
 */
const fs = require('fs');
const path = require('path');
const { caprigoDataRoot } = require('../_caprigo-data-root.js');

module.exports = {
  name: 'caprigo_data_dir_stats',
  description:
    'Report Caprigo data directory (~/.caprigo by default): exists, top-level files/dirs with sizes (bytes). No file contents.',
  execute: async () => {
    const root = caprigoDataRoot();
    if (!fs.existsSync(root)) {
      return { success: true, path: root, exists: false, entries: [] };
    }
    const st = fs.statSync(root);
    const entries = [];
    try {
      const names = fs.readdirSync(root);
      for (const name of names) {
        const full = path.join(root, name);
        try {
          const s = fs.statSync(full);
          entries.push({
            name,
            type: s.isDirectory() ? 'dir' : 'file',
            size: s.isFile() ? s.size : null,
            mtime: s.mtime.toISOString(),
          });
        } catch {
          entries.push({ name, type: '?' });
        }
      }
    } catch (e) {
      return { success: false, path: root, error: e instanceof Error ? e.message : String(e) };
    }
    return {
      success: true,
      path: root,
      exists: true,
      isDirectory: st.isDirectory(),
      entryCount: entries.length,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
};
