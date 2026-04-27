#!/usr/bin/env node
/**
 * List files in a directory sorted by mtime (newest first). No recursion.
 * Usage: node dir-recent.mjs [dir] [limit]
 * Defaults: . and 25
 */
import fs from 'fs';
import path from 'path';

const dir = path.resolve(process.argv[2] || '.');
const limit = Math.min(100, Math.max(1, parseInt(process.argv[3] || '25', 10) || 25));

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
      rel: path.relative(process.cwd(), full) || full,
      size: st.size,
      mtimeMs: st.mtimeMs,
      mtime: st.mtime.toISOString(),
    });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const slice = files.slice(0, limit);

  console.log(
    JSON.stringify(
      {
        ok: true,
        directory: dir,
        cwd: process.cwd(),
        count: files.length,
        showing: slice.length,
        limit,
        files: slice,
      },
      null,
      2
    )
  );
} catch (e) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        directory: dir,
        error: e instanceof Error ? e.message : String(e),
      },
      null,
      2
    )
  );
}
