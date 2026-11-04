// A tiny OpenAI-compatible Chat Completions server, like a self-hosted vLLM or Ollama endpoint.
// The first streamed step calls the first tool offered; once a tool result is in the
// conversation it streams a short answer. Requests are recorded for assertions.
import http from 'node:http';

export async function startFakeOpenAICompatible({ answer = ['The Dive shows ', 'the Second option.'], status = 200, errorBody = null } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    seen.push({ url: req.url, headers: req.headers, body });
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(errorBody ?? { error: { message: 'failed' } }));
      return;
    }
    const tool = body.tools?.[0]?.function?.name;
    const hasToolResult = (body.messages ?? []).some(message => message.role === 'tool');
    const chunk = (delta, finish = null) => ({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
    if (!body.stream) {
      const message = tool && !hasToolResult
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool, arguments: JSON.stringify(tool === 'ping' ? { value: 'ok' } : {}) } }] }
        : { role: 'assistant', content: answer.join('') };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (tool && !hasToolResult) {
      send(chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: tool, arguments: '' } }] }));
      send(chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }));
      send(chunk({}, 'tool_calls'));
    } else {
      send(chunk({ role: 'assistant', content: '' }));
      for (const delta of answer) send(chunk({ content: delta }));
      send(chunk({}, 'stop'));
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise(resolve => server.close(resolve)) };
}
