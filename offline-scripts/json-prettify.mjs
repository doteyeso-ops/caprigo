#!/usr/bin/env node
/**
 * Read a UTF-8 file, parse as JSON, print pretty JSON to stdout (validates structure).
 * Usage: node json-prettify.mjs <path-to.json>
 */
import fs from 'fs';
import path from 'path';

const file = process.argv[2];

if (!file) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: 'Missing path. Usage: json-prettify <file.json>',
      },
      null,
      2
    )
  );
  process.exit(0);
}

const abs = path.resolve(file);

try {
  const raw = fs.readFileSync(abs, 'utf8');
  const data = JSON.parse(raw);
  console.log(
    JSON.stringify(
      {
        ok: true,
        path: abs,
        formatted: data,
        pretty: JSON.stringify(data, null, 2),
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
        path: abs,
        error: e instanceof Error ? e.message : String(e),
      },
      null,
      2
    )
  );
}
