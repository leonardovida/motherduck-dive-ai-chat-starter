// Stand-in for the OpenAI Responses API. The first step reads the Dive state; the answer then
// quotes it, so tests can check that what the viewer selected reached the model. Questions
// containing "slowly" stream for several seconds (to test Stop), "break" fails the request and
// "flaky" fails the first two attempts at each question, which outlasts the chat route's one
// automatic retry, and then answers.
import http from 'node:http';

const lastQuestion = input => [...input].reverse().find(item => item.role === 'user')?.content?.map?.(part => part.text).join(' ') || '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function startModel({ port }) {
  let calls = 0;
  const attempts = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    calls += 1;
    const question = lastQuestion(body.input || []);
    if (/flaky/i.test(question) && body.stream) attempts.set(question, (attempts.get(question) || 0) + 1);
    const flaky = /flaky/i.test(question) && body.stream && attempts.get(question) <= 2;
    if (/break/i.test(question) || flaky) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'stand-in failure', type: 'server_error' } }));
      return;
    }
    if (!body.stream) {
      // Auto routing's classification request.
      const label = /why|driver|forecast/i.test(question) ? 'complex' : 'simple';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `r${calls}`, created_at: 1, model: body.model, output: [{ type: 'message', role: 'assistant', id: 'm', content: [{ type: 'output_text', text: JSON.stringify({ result: label }), annotations: [] }] }], usage: { input_tokens: 5, output_tokens: 1 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
    send({ type: 'response.created', response: { id: `r${calls}`, created_at: 1, model: body.model } });
    const result = (body.input || []).find(item => item.type === 'function_call_output');
    if (!result) {
      const item = { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'getDiveState', arguments: '{}', status: 'completed' };
      send({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } });
      send({ type: 'response.function_call_arguments.delta', item_id: 'fc1', output_index: 0, delta: '{}' });
      send({ type: 'response.output_item.done', output_index: 0, item });
    } else {
      let state = {};
      try { state = JSON.parse(result.output).state ?? {}; } catch {}
      const slow = /slowly/i.test(question);
      const text = slow
        ? Array.from({ length: 40 }, (_, index) => `word${index} `).join('')
        : `Stand-in answer from ${body.model}. The region filter is ${state.region ?? 'not set'}.`;
      send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm1' } });
      for (const word of text.split(/(?<= )/)) {
        if (res.destroyed) return;
        send({ type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: word });
        if (slow) await wait(250);
      }
      send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm1' } });
    }
    send({ type: 'response.completed', response: { usage: { input_tokens: 400, output_tokens: 40 } } });
    res.end('data: [DONE]\n\n');
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
