/**
 * Parse a JSON string safely; returns structured success/failure (no throw to the model).
 */
module.exports = {
  name: 'parse_json_safe',
  description:
    'Parse JSON from params.json (string). Returns { success, value } or { success: false, error, line }.',
  execute: async params => {
    const raw = params?.json ?? params?.text ?? '';
    if (typeof raw !== 'string') {
      return { success: false, error: 'params.json must be a string' };
    }
    try {
      const value = JSON.parse(raw);
      return { success: true, value };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg };
    }
  },
};
