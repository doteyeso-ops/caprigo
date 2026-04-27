/**
 * Cryptographic digest of UTF-8 text (SHA-256 hex). Useful for checksums, cache keys, comparing blobs.
 */
const crypto = require('crypto');

module.exports = {
  name: 'text_digest',
  description:
    'Compute SHA-256 hex digest of a string (params.text or params.message). Optional algorithm: sha256 (default) or sha384.',
  execute: async params => {
    const text = params?.text ?? params?.message ?? '';
    const algo = String(params?.algorithm || 'sha256').toLowerCase();
    if (algo !== 'sha256' && algo !== 'sha384') {
      return { success: false, error: 'algorithm must be sha256 or sha384' };
    }
    const hash = crypto.createHash(algo).update(String(text), 'utf8').digest('hex');
    return {
      success: true,
      algorithm: algo,
      hex: hash,
      lengthChars: String(text).length,
    };
  },
};
