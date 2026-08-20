const {
  parseEmbeddedJsonToolCalls,
  parseLegacyToolCall,
  resolveSkillName,
} = require('../packages/agent/dist/tool-dialect');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const allowed = ['write_file', 'read_file', 'execute_command', 'list_lan_devices', 'search_files'];

const groqBare = `\n{"id": 0, "name": "write_file", "arguments": {"path": "generated/bench/x.html", "content": "<html>ok</html>"}}\n`;
const a = parseEmbeddedJsonToolCalls(groqBare);
assert(a.length === 1 && a[0].function.name === 'write_file', 'groq bare json');
assert(JSON.parse(a[0].function.arguments).path.includes('x.html'), 'groq args');

const xml = `<tool_call>\n{"name":"read_file","arguments":{"path":"a.ts"}}\n</tool_call>`;
const b = parseEmbeddedJsonToolCalls(xml);
assert(b.length === 1 && b[0].function.name === 'read_file', 'xml tool_call');

const multi = [
  '{"id": 0, "name": "browser_navigate", "arguments": {"url": "https://speedtest.net"}}',
  '',
  '{"id": 1, "name": "execute_command", "arguments": {"command": "arp -a"}}',
].join('\n');
const m = parseEmbeddedJsonToolCalls(multi);
assert(m.length === 2, 'multi bare json count');
assert(m[0].function.name === 'browser_navigate', 'multi[0]');
assert(m[1].function.name === 'execute_command', 'multi[1]');

const alias = parseEmbeddedJsonToolCalls(
  '{"name":"write_file","arguments":{"target":"generated/x.txt","content":"hi"}}'
);
assert(JSON.parse(alias[0].function.arguments).path === 'generated/x.txt', 'target→path alias');

assert(resolveSkillName('write', allowed).name === 'write_file', 'alias write');
assert(resolveSkillName('arp', allowed).name === 'list_lan_devices', 'alias arp');
assert(resolveSkillName('google', [...allowed, 'web_search']).name === 'web_search', 'alias google');
assert(resolveSkillName('grep', allowed).name === 'search_files', 'alias grep');
assert('unknown' in resolveSkillName('nope_tool_xyz', allowed), 'unknown skill');

// Bare "search" must NOT alias-force search_files (ambiguous web vs local).
const bare = resolveSkillName('search', [...allowed, 'web_search']);
assert(!('name' in bare && bare.name === 'search_files' && bare.remappedFrom === 'search'), 'bare search not forced local');
assert('unknown' in bare || ('name' in bare && bare.name === 'web_search'), 'bare search → unknown or web');
if ('unknown' in bare) {
  assert(bare.suggestions.includes('web_search') || bare.suggestions.includes('search_files'), 'bare search suggests');
}

// Intent prefer remaps ambiguous search for learning + fewer unknown:* lessons.
const preferWeb = resolveSkillName('search', [...allowed, 'web_search'], { prefer: 'web' });
assert(preferWeb.name === 'web_search', 'prefer web → web_search');
const preferLocal = resolveSkillName('find', [...allowed, 'web_search'], { prefer: 'local' });
assert(preferLocal.name === 'search_files', 'prefer local → search_files');

const legacy = parseLegacyToolCall('TOOL: write_file\nPARAMS: {"path":"z.txt","content":"hi"}');
assert(legacy && legacy.tool === 'write_file', 'legacy TOOL:');

console.log('OK tool-dialect');
