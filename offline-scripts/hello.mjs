#!/usr/bin/env node
/**
 * Sample offline script: runs under the gateway process cwd; stdout is captured.
 * Args: passed through from the UI (optional).
 */
const payload = {
  kind: 'caprigo-offline',
  message: 'Hello from offline script',
  argv: process.argv.slice(2),
  cwd: process.cwd(),
};
console.log(JSON.stringify(payload, null, 2));
