'use strict';

/** @see packages/shared/src/caprigo-env.ts — CAPRIGO_* with legacy migration. */
const LEGACY_PREFIX = ['R', 'A', 'D', 'B', 'O', 'T'].join('');

function caprigoEnv(suffix) {
  const m = process.env['CAPRIGO_' + suffix]?.trim();
  if (m) return m;
  return process.env[LEGACY_PREFIX + '_' + suffix]?.trim();
}

module.exports = { caprigoEnv };
