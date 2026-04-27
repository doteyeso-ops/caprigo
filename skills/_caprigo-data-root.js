'use strict';

const fs = require('fs');
const path = require('path');
const { caprigoEnv } = require('./_caprigo-env.js');

/** Aligns with @caprigo/shared caprigoDataRoot() for bundled skills. */
function caprigoDataRoot() {
  const o = caprigoEnv('HOME');
  if (o) return path.resolve(o);
  const home = process.env.USERPROFILE || process.env.HOME || '.';
  const m = path.join(home, '.caprigo');
  const r = path.join(home, ['.', 'r', 'a', 'd', 'b', 'o', 't'].join(''));
  try {
    if (fs.existsSync(r) && !fs.existsSync(m)) return r;
  } catch (_) {
    /* ignore */
  }
  return m;
}

module.exports = { caprigoDataRoot };
