/**
 * Safe snapshot of Caprigo-related environment (no secret values).
 */
const { caprigoEnv } = require('../_caprigo-env.js');

module.exports = {
  name: 'caprigo_env_flags',
  description:
    'Return non-secret Caprigo / LLM env: provider, dirs, Ollama URL, model, port, whether API keys are set (not the keys).',
  execute: async () => {
    const pick = keys => {
      const o = {};
      for (const k of keys) {
        if (process.env[k] !== undefined) o[k] = process.env[k];
      }
      return o;
    };

    const paths = pick([
      'CAPRIGO_HOME',
      'CAPRIGO_SKILLS_DIR',
      'CAPRIGO_OFFLINE_SCRIPTS_DIR',
      'CAPRIGO_VIBES_PACKS_DIR',
      'CAPRIGO_EXECUTION_LOG_PATH',
    ]);

    const flags = {
      CAPRIGO_LLM_PROVIDER: caprigoEnv('LLM_PROVIDER') || null,
      DEFAULT_MODEL: process.env.DEFAULT_MODEL || null,
      OLLAMA_URL: process.env.OLLAMA_URL || null,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || null,
      PORT: process.env.PORT || null,
      CAPRIGO_EXECUTION_LOG: caprigoEnv('EXECUTION_LOG') || null,
      NODE_ENV: process.env.NODE_ENV || null,
    };

    const secrets = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || caprigoEnv('OPENAI_API_KEY') ? 'set' : 'unset',
      VIBES_CODED_API_KEY: process.env.VIBES_CODED_API_KEY || caprigoEnv('VIBES_API_KEY') ? 'set' : 'unset',
    };

    return {
      success: true,
      paths,
      flags,
      secretsPresence: secrets,
    };
  },
};
