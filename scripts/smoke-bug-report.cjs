/**
 * Smoke: bug reporter + unknown-skill lesson label helpers.
 */
const path = require('path');
const fs = require('fs');
const { writeAutoBugReport } = require('../packages/agent/dist/bug-report');
const { suggestedFixForFailure } = require('../packages/agent/dist/stumble');
const { resolveSkillName } = require('../packages/agent/dist/tool-dialect');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const fix = suggestedFixForFailure('unknown:search', 'Unknown skill "search"');
assert(/web_search/.test(fix) && /search_files/.test(fix), 'unknown skill fix text');

const p = writeAutoBugReport({
  sessionId: 'smoke',
  model: 'test',
  note: 'smoke',
  error: 'unknown:search failed',
  tools: ['unknown:search'],
  signature: 'unknown:search|x',
});
assert(fs.existsSync(p), 'auto bug file');
assert(fs.readFileSync(p, 'utf8').includes('unknown:search'), 'bug mentions skill');

const prefer = resolveSkillName('lookup', ['web_search', 'search_files'], { prefer: 'web' });
assert(prefer.name === 'web_search', 'prefer web');

console.log('OK bug-report-unknown', path.basename(p));
