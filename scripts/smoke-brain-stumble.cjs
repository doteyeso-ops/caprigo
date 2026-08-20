const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
};

const {
  scrubSecrets,
  recordLesson,
  recallLessons,
  updateWorking,
  resetWorkingMemory,
  buildBrainPromptBlock,
  brainStatusSummary,
} = require('../packages/agent/dist/brain');
const {
  normalizeErrorSignature,
  noteStumbleFailure,
  createStumbleState,
  buildStumbleRetryPrompt,
} = require('../packages/agent/dist/stumble');

assert(scrubSecrets('Bearer sk-abc123xyz and password=secret').includes('***'), 'scrub');
assert(!scrubSecrets('Bearer sk-abc123xyz').includes('sk-abc'), 'scrub token');

resetWorkingMemory();
updateWorking({ goal: 'test goal', next_step: 'step1' });
const st = brainStatusSummary();
assert(st.working.goal === 'test goal', 'working goal');

const lesson = recordLesson({
  signature: 'write_file|path outside scopes',
  cause: 'fake /network_devices path',
  fix: 'use list_lan_devices or arp -a',
  tools: ['list_directory'],
  tags: ['lan'],
});
assert(lesson.id, 'lesson id');
const hit = recallLessons({ query: 'network_devices lan', limit: 3 });
assert(hit.length >= 1, 'recall');

const block = buildBrainPromptBlock({ query: 'lan devices' });
assert(block.includes('Caprigo Brain'), 'prompt block');
assert(block.length < 2500, 'prompt budget');

const stumble = createStumbleState();
const sig = normalizeErrorSignature('list_directory', 'Path C:\\network_devices is outside');
const n1 = noteStumbleFailure(stumble, 'list_directory', 'Path C:\\network_devices is outside');
assert(n1.count === 1 && !n1.escalate, 'first fail');
const n2 = noteStumbleFailure(stumble, 'list_directory', 'Path C:\\network_devices is outside');
assert(n2.escalate, 'escalate');
assert(n1.signature === sig || n2.signature.includes('list_directory'), 'sig');

const prompt = buildStumbleRetryPrompt({
  signature: n2.signature,
  count: n2.count,
  escalate: true,
  tool: 'list_directory',
  error: 'outside scopes',
});
assert(/stumble-to-walk/i.test(prompt), 'stumble prompt');

const {
  ensureCoreLessons,
  looksLikeKnowledgeRefusal,
  userLikelyNeedsWeb,
  usedOnlyLocalSearch,
} = (() => {
  const brain = require('../packages/agent/dist/brain');
  const mp = require('../packages/agent/dist/model-profile');
  return { ...brain, ...mp };
})();

ensureCoreLessons();
const sticky = recallLessons({ query: 'AI meetups Nashville', limit: 5, includeSticky: true });
assert(
  sticky.some(l => /web_search|refusal|events/i.test(l.signature + l.fix)),
  'sticky web lessons recalled for meetup query'
);
const block2 = buildBrainPromptBlock({ query: 'find AI meetups near Nashville' });
assert(/MUST follow|web_search/i.test(block2), 'brain block teaches web_search');

assert(looksLikeKnowledgeRefusal("I don't have specific information about that."), 'soft refusal');
assert(userLikelyNeedsWeb('AI meetups Nashville'), 'nashville needs web');
assert(usedOnlyLocalSearch(['search_files', 'list_directory']), 'wrong local tools');

console.log('OK brain-stumble');
