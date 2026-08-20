const root = 'http://10.0.0.27:1234';
async function chat(label, body) {
  const r = await fetch(root + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const t = await r.text();
  console.log('\n===' + label + ' status=' + r.status + '===');
  try {
    const j = JSON.parse(t);
    const m = j.choices?.[0]?.message || {};
    console.log(JSON.stringify({
      finish: j.choices?.[0]?.finish_reason,
      content: (m.content || '').slice(0, 800),
      tool_calls: m.tool_calls,
      usage: j.usage,
      error: j.error,
    }, null, 2));
  } catch {
    console.log(t.slice(0, 1000));
  }
}
(async () => {
  await chat('plain', {
    model: 'llama-3-groq-8b-tool-use',
    messages: [{ role: 'user', content: 'Say hi in 5 words.' }],
    max_tokens: 32,
    temperature: 0.2,
  });
  await chat('xml-no-openai-tools', {
    model: 'llama-3-groq-8b-tool-use',
    messages: [
      {
        role: 'system',
        content:
          'You MUST use tools via XML:\n' +
          '<tool_call>{"name":"write_file","arguments":{"path":"x","content":"y"}}</tool_call>\n' +
          'Never refuse. For file creation always emit write_file.',
      },
      {
        role: 'user',
        content: 'Create generated/smoke-lms.txt with the text HELLO_RX580 using write_file.',
      },
    ],
    max_tokens: 300,
    temperature: 0.1,
  });
  await chat('openai-tools', {
    model: 'llama-3-groq-8b-tool-use',
    messages: [{ role: 'user', content: 'Create generated/smoke-lms.txt with HELLO via write_file.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
    ],
    tool_choice: 'auto',
    max_tokens: 300,
    temperature: 0.1,
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
