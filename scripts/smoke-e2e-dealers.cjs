/**
 * E2E: local dealers query must return real web results even if model refuses tools.
 */
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

function loadEnv() {
  const fs = require('fs');
  const p = path.resolve('.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

async function main() {
  loadEnv();
  const {
    looksLikeKnowledgeRefusal,
    looksLikeDialectRefusal,
    userLikelyNeedsWeb,
  } = require('../packages/agent/dist/model-profile');
  const refusal =
    "I'm sorry but I do not have the capability to perform this task for you, I am happy to help you with any other queries you may have.";
  const user = 'give me a list of car dealers in gallatin tennessee.';
  assert(userLikelyNeedsWeb(user), 'needsWeb dealers query');
  assert(looksLikeDialectRefusal(refusal), 'dialect refusal');
  assert(looksLikeKnowledgeRefusal(refusal), 'knowledge refusal includes capability');

  const { createEmbeddedRuntime } = require('../packages/cli/dist/embedded-runtime');
  const rt = await createEmbeddedRuntime({ displayName: 'e2e-dealers' });
  const events = [];
  const { response, stats } = await rt.processMessage(user, e => {
    if (e.type === 'task_start' || e.type === 'task_end' || e.type === 'lesson_saved') {
      events.push(e);
    }
  });
  console.log('tools', stats.tools);
  console.log('tokens', stats.promptTokens, stats.completionTokens, 'ms', stats.elapsedMs);
  console.log('events', events.map(e => e.type + ':' + (e.tool || e.signature || '')));
  console.log('response_head', String(response).slice(0, 600));

  assert(stats.tools.includes('web_search'), 'must run web_search');
  const lower = String(response).toLowerCase();
  assert(!/do not have the capability/.test(lower), 'must not return capability refusal');
  assert(
    /toyota|honda|ford|nissan|subaru|dealer|gallatin|http/i.test(response),
    'must include dealer/web evidence'
  );
  console.log('OK e2e-dealers');
  await rt.dispose();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
