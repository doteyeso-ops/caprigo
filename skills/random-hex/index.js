/**
 * Cryptographically strong random hex string (for tokens, correlation ids, nonces).
 */
const crypto = require('crypto');

module.exports = {
  name: 'random_hex',
  description:
    'Generate random hex bytes (params.bytes default 16, max 256). Returns { hex, bytes }.',
  execute: async params => {
    let n = parseInt(params?.bytes ?? params?.length ?? 16, 10);
    if (!Number.isFinite(n) || n < 1) n = 16;
    if (n > 256) n = 256;
    const buf = crypto.randomBytes(n);
    return { success: true, bytes: n, hex: buf.toString('hex') };
  },
};
