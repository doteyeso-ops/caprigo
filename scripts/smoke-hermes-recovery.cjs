const { TodoStore, seedTodosFromMissionSteps } = require('../packages/agent/dist/todo-store');
const {
  looksLikeIntentNarration,
  buildNarrationStopNudge,
  buildEmptyAfterToolsNudge,
} = require('../packages/agent/dist/hermes-recovery');
const { compileMission } = require('../packages/agent/dist/harness-mission');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(looksLikeIntentNarration("I'll open Notepad and type hello for you."), 'narration');
assert(looksLikeIntentNarration('Let me search for car dealers next.'), 'let me');
assert(!looksLikeIntentNarration('Here are three dealers in Gallatin.'), 'not narration');
assert(buildNarrationStopNudge('open notepad').includes('tool call'), 'nudge');
assert(buildEmptyAfterToolsNudge().includes('empty'), 'empty nudge');

const plan = compileMission('open notepad and type hello world');
assert(plan, 'plan');
const seeded = seedTodosFromMissionSteps(
  [...plan.bootstrap, ...plan.remaining],
  plan.objective
);
assert(seeded.length >= 3, 'seeded todos');
const store = new TodoStore();
store.write(seeded, false);
assert(store.formatForPrompt().includes('Active task list'), 'prompt block');
store.markToolDone('execute_command');
store.markToolDone('desktop_screenshot');
const active = store.read().filter(i => i.status === 'pending' || i.status === 'in_progress');
assert(active.length >= 1, 'still has remaining');

console.log('OK hermes-recovery');
