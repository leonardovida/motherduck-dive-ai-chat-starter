// A tool call the model gets wrong (here, a limit below the minimum) is reported back to the model,
// which then answers. That answer must count as answered, not failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { COOKIE, signSession } from '../lib/security.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
// A Responses API stand-in: the first step calls runQuery with invalid input, the next answers,
// and the non-streamed call returns follow-up questions.
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'r-f', created_at: 1, model: body.model, output: [{ type: 'message', role: 'assistant', id: 'mf', content: [{ type: 'output_text', text: JSON.stringify({ questions: ['Which table has the most rows?'] }), annotations: [] }] }], usage: { input_tokens: 5, output_tokens: 5 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'response.created', response: { id: 'r', created_at: 1, model: body.model } });
  if (!body.input.some(item => item.type === 'function_call_output')) {
    const item = { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'runQuery', arguments: '{"sql":"SELECT 1","limit":0}', status: 'completed' };
    send({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } });
    send({ type: 'response.function_call_arguments.delta', item_id: 'fc1', output_index: 0, delta: item.arguments });
    send({ type: 'response.output_item.done', output_index: 0, item });
  } else {
    send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm1' } });
    send({ type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta: 'Recovered answer.' });
    send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm1' } });
  }
  send({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5 } } });
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
test.after(() => server.close());
for (const name of ['ANTHROPIC_API_KEY', 'CHAT_DEFAULT_MODEL', 'CHAT_MODELS', 'CHAT_PROVIDER', 'MOTHERDUCK_APP_TOKEN']) delete process.env[name];
Object.assign(process.env, { SESSION_SECRET: SECRET, OPENAI_API_KEY: 'fixture-key', OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, CHAT_FOLLOW_UPS: 'true', MOTHERDUCK_CHAT_TOKEN: 'fixture-chat-token', DIVE_OVERVIEW_CHAT_DATABASE: 'demo_db' });
const { POST } = await import('../app/api/chat/route.js');

test('an answer that recovers from a failed tool call is not treated as failed', async () => {
  const response = await POST(new Request('https://demo.test/api/chat', {
    method: 'POST',
    headers: { cookie: `${COOKIE}=${signSession(SECRET)}`, origin: 'https://demo.test', host: 'demo.test', 'content-type': 'application/json' },
    body: JSON.stringify({ dive: 'overview', model: 'sol', state: {}, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Count rows' }] }] }),
  }));
  const chunks = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  assert.ok(chunks.some(chunk => chunk.type === 'tool-input-error'), 'the invalid call is shown as a failed step');
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join(''), 'Recovered answer.');
  assert.ok(!chunks.some(chunk => chunk.type === 'error'));
  assert.deepEqual(chunks.find(chunk => chunk.type === 'data-followups')?.data.questions, ['Which table has the most rows?'], 'only answered runs get follow-ups');
});
