const root = 'http://10.0.0.27:1234';
const model = 'llama-3-groq-8b-tool-use';

(async () => {
  const cat = await (await fetch(`${root}/api/v1/models`)).json();
  const m = (cat.models || []).find(x => x.key === model);
  console.log(
    'META',
    JSON.stringify(
      {
        key: m?.key,
        arch: m?.architecture,
        quant: m?.quantization,
        capabilities: m?.capabilities,
        trained_for_tool_use: m?.trained_for_tool_use,
      },
      null,
      2
    )
  );

  const tool = {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a file to disk',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  };

  const sys = [
    'You are a function calling AI model. You are provided with function signatures within <tools></tools> XML tags.',
    "You may call one or more functions to assist with the user query. Don't make assumptions about what values to plug into functions.",
    'Here are the available tools:',
    '<tools>',
    JSON.stringify(tool),
    '</tools>',
    'For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags as follows:',
    '<tool_call>',
    '{"name": <function-name>, "arguments": <args-json-object>}',
    '</tool_call>',
  ].join('\n');

  const r = await fetch(`${root}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 400,
      messages: [
        { role: 'system', content: sys },
        {
          role: 'user',
          content:
            'Write generated/bench/groq-xml.html with content <html>ok</html> using write_file now.',
        },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json();
  const msg = j.choices?.[0]?.message || {};
  console.log(
    'XML_FMT',
    JSON.stringify(
      {
        finish: j.choices?.[0]?.finish_reason,
        tool_calls: msg.tool_calls || null,
        content: String(msg.content || '').slice(0, 600),
      },
      null,
      2
    )
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
