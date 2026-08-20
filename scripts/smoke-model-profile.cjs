const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
};

const {
  canonicalModelId,
  heuristicProfile,
  parseHandshakeReply,
  resolveToolMode,
  looksLikeDialectRefusal,
  contentHasEmbeddedTools,
  observeDialectFlip,
  getCachedProfile,
} = require('../packages/agent/dist/model-profile');

assert(canonicalModelId('llama-3-groq-8b-tool-use:2') === 'llama-3-groq-8b-tool-use', 'canonical');
assert(canonicalModelId('foo@q4_k_m') === 'foo@q4_k_m', 'keep quant');

const groq = heuristicProfile('llama-3-groq-8b-tool-use');
assert(resolveToolMode(groq).dialect === 'openai', 'groq openai');
assert(resolveToolMode(groq).useNativeTools === true, 'groq native tools');
assert(groq.quirks.includes('openai_tool_use_model'), 'groq quirk');

const trained = heuristicProfile('meine-gehorsame-coding-ki', { trainedForToolUse: true });
assert(resolveToolMode(trained).dialect === 'openai', 'trained openai');

assert(parseHandshakeReply('XML') === 'xml', 'handshake xml');
assert(parseHandshakeReply('I prefer OPENAI tools') === 'openai', 'handshake openai');
assert(parseHandshakeReply('maybe') === null, 'handshake null');

assert(
  looksLikeDialectRefusal(
    "I'm sorry, but I don't have access to tools that can directly measure internet speed."
  ),
  'refusal'
);
assert(contentHasEmbeddedTools('{"name":"write_file","arguments":{}}'), 'embedded json');
assert(contentHasEmbeddedTools('<tool_call>{"name":"x"}</tool_call>'), 'embedded xml');

const flipped = observeDialectFlip('test-model-flip', 'openai', 'xml', 'refuses_openai_tools');
assert(flipped.dialect === 'xml' && flipped.source === 'observed', 'flip');
assert(getCachedProfile('test-model-flip')?.dialect === 'xml', 'cache');

console.log('OK model-profile');
