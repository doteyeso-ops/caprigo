#!/usr/bin/env node
/**
 * TCP port probe — checks if something accepts connections (e.g. Ollama :11434, Caprigo gateway :18789).
 * Usage: node port-check.mjs [host] [port]
 * Defaults: 127.0.0.1 11434
 */
import net from 'net';

const host = process.argv[2] || '127.0.0.1';
const port = parseInt(process.argv[3] || '11434', 10);

if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.log(
    JSON.stringify(
      { ok: false, error: 'Invalid port. Usage: port-check [host] [port]', example: 'port-check 127.0.0.1 18789' },
      null,
      2
    )
  );
  process.exit(0);
}

const timeoutMs = 5000;
let done = false;

function finish(payload) {
  if (done) return;
  done = true;
  console.log(JSON.stringify(payload, null, 2));
}

const socket = net.connect({ host, port, family: 4 }, () => {
  finish({ ok: true, host, port, open: true, note: 'connection accepted' });
  socket.end();
});

socket.setTimeout(timeoutMs);

socket.on('error', err => {
  finish({
    ok: true,
    host,
    port,
    open: false,
    reason: err.code || err.message,
  });
});

socket.on('timeout', () => {
  try {
    socket.destroy();
  } catch {
    /* ignore */
  }
  finish({ ok: true, host, port, open: false, reason: 'timeout' });
});
