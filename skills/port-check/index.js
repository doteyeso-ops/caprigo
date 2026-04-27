/**
 * TCP port probe (same behavior as offline-scripts/port-check.mjs) — for chat/tools without spawning a process.
 */
const net = require('net');

function checkPort(host, port, timeoutMs = 5000) {
  return new Promise(resolve => {
    let done = false;
    const finish = payload => {
      if (done) return;
      done = true;
      resolve(payload);
    };
    const socket = net.connect({ host, port, family: 4 }, () => {
      finish({ open: true, note: 'connection accepted' });
      socket.end();
    });
    socket.setTimeout(timeoutMs);
    socket.on('error', err => finish({ open: false, reason: err.code || err.message }));
    socket.on('timeout', () => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      finish({ open: false, reason: 'timeout' });
    });
  });
}

module.exports = {
  name: 'check_tcp_port',
  description:
    'Check if a TCP host:port accepts connections (e.g. Ollama 11434, Caprigo gateway 18789). Params: host (default 127.0.0.1), port (number).',
  execute: async params => {
    const host = String(params?.host ?? '127.0.0.1');
    const port = parseInt(params?.port ?? 11434, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      return { success: false, error: 'Invalid port' };
    }
    const r = await checkPort(host, port);
    return { success: true, host, port, ...r };
  },
};
