const {
  compactMessagesForInference,
  briefingEnabled,
  fastModelId,
} = require('../packages/agent/dist/prompt-brief');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(briefingEnabled(), 'brief on');
process.env.CAPRIGO_FAST_MODEL = 'google/gemma-3-4b';
assert(fastModelId() === 'google/gemma-3-4b', 'fast model');

const fat = JSON.stringify({
  success: true,
  path: 'x.png',
  blocks: Array.from({ length: 80 }, (_, i) => ({ text: 'Block' + i, cx: i, cy: i })),
});
const messages = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'ok', tool_calls: [] },
  { role: 'tool', tool_name: 'desktop_screenshot', content: fat },
  { role: 'tool', tool_name: 'web_search', content: JSON.stringify({ success: true, related: [{ text: 'a' }, { text: 'b' }] }) },
  { role: 'assistant', content: 'more' },
  { role: 'tool', tool_name: 'desktop_type', content: '{"success":true}' },
];
const out = compactMessagesForInference(messages, { keepFullToolRounds: 1 });
const oldShot = out.find(m => m.tool_name === 'desktop_screenshot');
assert(oldShot && oldShot.content.length < fat.length / 2, 'old tool compacted');
const lastTool = out.filter(m => m.role === 'tool').pop();
assert(lastTool && lastTool.content.includes('success'), 'last tool kept');
console.log('OK prompt-brief');
