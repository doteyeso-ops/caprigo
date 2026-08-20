/**
 * HOME smoke — compile, action cards, verify (no LLM).
 */
const {
  compileMission,
  createMissionRuntime,
  proposeNextActions,
  verifyMission,
  homeEnabled,
  homeAutoDrainEnabled,
  formatHomeDoneAnswer,
  noteToolSuccess,
} = require('../packages/agent/dist/harness-mission');
const { parseActionCard, actionCardPromptBlock } = require('../packages/agent/dist/action-card');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(homeEnabled(), 'HOME enabled by default');
assert(homeAutoDrainEnabled(), 'auto-drain on');

const notepad = compileMission('open notepad and type hello world');
assert(notepad, 'notepad plan');
assert(notepad.playbookId === 'desktop_notepad_type', 'notepad playbook');
assert(notepad.bootstrap.some(s => s.tool === 'execute_command'), 'launch bootstrap');
assert(notepad.bootstrap.some(s => s.tool === 'desktop_screenshot'), 'shot bootstrap');
assert(notepad.remaining.some(s => s.tool === 'desktop_type'), 'type remaining');
assert(notepad.slots.type_text === 'hello world', `type slot got ${notepad.slots.type_text}`);
assert(formatHomeDoneAnswer(createMissionRuntime(notepad)).includes('hello world'), 'done text');

const web = compileMission('list car dealers in Gallatin');
assert(web && web.playbookId === 'web_answer', 'web playbook');
assert(web.bootstrap[0].tool === 'web_search', 'web bootstrap');

const html = compileMission('write an html sunset animation file');
assert(html && html.playbookId === 'write_html_file', 'html playbook');
assert(html.remaining.some(s => s.tool === 'write_file'), 'write remaining');

const rt = createMissionRuntime(notepad);
rt.bootstrapDone = true;
const tools = ['execute_command', 'desktop_screenshot'];
let proposed = proposeNextActions(rt, tools);
assert(proposed[0]?.tool === 'desktop_focus', `propose focus got ${proposed[0]?.tool}`);

// Loop guard: already-attempted tools must not be re-proposed (failed focus used to loop forever).
const afterFocusAttempt = proposeNextActions(rt, [
  'execute_command',
  'desktop_screenshot',
  'desktop_focus',
]);
assert(
  afterFocusAttempt[0]?.tool === 'desktop_type',
  `skip attempted focus, got ${afterFocusAttempt[0]?.tool}`
);
assert(!afterFocusAttempt.some(s => s.tool === 'desktop_focus'), 'no focus re-propose loop');
assert(typeof rt.postActionLlmUsed === 'number', 'postActionLlmUsed counter');

const v0 = verifyMission(rt, tools, '');
assert(v0.status === 'continue', 'not done before type');

tools.push('desktop_focus', 'desktop_type', 'desktop_screenshot');
noteToolSuccess(rt, 'desktop_focus');
noteToolSuccess(rt, 'desktop_type');
noteToolSuccess(rt, 'desktop_screenshot');
const v1 = verifyMission(rt, tools, 'Typed hello world into Notepad.');
assert(v1.status === 'pass', `should pass after type: ${v1.detail}`);

const webRt = createMissionRuntime(web);
webRt.webResult = {
  success: true,
  related: [{ text: 'Dealer A', url: 'https://example.com' }],
};
webRt.webQuery = 'list car dealers in Gallatin';
const vWeb = verifyMission(webRt, ['web_search'], '', {
  formatWebAnswer: (result, query) => {
    const r = result;
    return `Here are web results for “${query}”:\n\n1. ${r.related[0].text}`;
  },
});
assert(vWeb.status === 'pass' && vWeb.directAnswer, 'web harness answer');

const card = parseActionCard(
  'Sure.\n```json\n{"caprigo":"action","tool":"desktop_type","args":{"text":"hi"}}\n```'
);
assert(card && card.caprigo === 'action' && card.tool === 'desktop_type', 'parse card');
const done = parseActionCard('{"caprigo":"done","answer":"All set"}');
assert(done && done.caprigo === 'done', 'parse done');
assert(
  actionCardPromptBlock([{ tool: 'desktop_focus', args: { title: 'Notepad' } }]).includes(
    'desktop_focus'
  ),
  'prompt'
);

console.log('OK harness-mission');
