/**
 * Read the last N lines from Caprigo skill execution log (JSONL).
 */
const fs = require('fs');
const path = require('path');
const { caprigoEnv } = require('../_caprigo-env.js');
const { caprigoDataRoot } = require('../_caprigo-data-root.js');

function getLogPath() {
  const logFlag = caprigoEnv('EXECUTION_LOG');
  if (logFlag === '0' || logFlag === 'false') {
    return null;
  }
  const pathOverride = caprigoEnv('EXECUTION_LOG_PATH');
  if (pathOverride) {
    return path.resolve(pathOverride);
  }
  return path.join(caprigoDataRoot(), 'executions.jsonl');
}

module.exports = {
  name: 'caprigo_execution_tail',
  description:
    'Return the last N entries from executions.jsonl (skill, ok, durationMs, sessionId). Params: limit (default 20, max 100).',
  execute: async params => {
    const limit = Math.min(100, Math.max(1, parseInt(params?.limit ?? 20, 10) || 20));
    const file = getLogPath();
    if (!file) {
      return { success: true, disabled: true, reason: 'CAPRIGO_EXECUTION_LOG is off' };
    }
    if (!fs.existsSync(file)) {
      return { success: true, file, exists: false, entries: [] };
    }
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const slice = lines.slice(-limit);
      const entries = [];
      for (const line of slice) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          entries.push({ parseError: true, raw: line.slice(0, 200) });
        }
      }
      return {
        success: true,
        file,
        totalLines: lines.length,
        returned: entries.length,
        entries,
      };
    } catch (e) {
      return { success: false, file, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
