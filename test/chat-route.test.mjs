// Drives the real /api/chat route against a local fake OpenAI Responses server.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { COOKIE, signSession } from '../lib/security.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const seen = [];
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  seen.push(body);
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'r-follow', created_at: 1, model: body.model, output: [{ type: 'message', role: 'assistant', id: 'm-follow', content: [{ type: 'output_text', text: JSON.stringify({ questions: ['Which table has the most rows?', 'Show the latest records.'] }), annotations: [] }] }], usage: { input_tokens: 5, output_tokens: 5 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'response.created', response: { id: `r${seen.length}`, created_at: 1, model: body.model } });
  const hasToolResult = body.input.some(item => item.type === 'function_call_output');
  if (!hasToolResult) {
    // First step: ask for the Dive state.
    const item = { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'getDiveState', arguments: '{}', status: 'completed' };
    send({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } });
    send({ type: 'response.function_call_arguments.delta', item_id: 'fc1', output_index: 0, delta: '{}' });
    send({ type: 'response.output_item.done', output_index: 0, item });
  } else {
    send({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm1' } });
    for (const delta of ['The Dive shows ', 'the Second option.']) send({ type: 'response.output_text.delta', item_id: 'm1', output_index: 0, delta });
    send({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm1' } });
  }
  send({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5 } } });
  res.end('data: [DONE]\n\n');
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
test.after(() => server.close());
Object.assign(process.env, {
  SESSION_SECRET: SECRET,
  OPENAI_API_KEY: 'fixture-openai-key',
  OPENAI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
  OPENAI_MODEL: 'gpt-6-luna',
  CHAT_FOLLOW_UPS: 'true',
  MOTHERDUCK_CHAT_TOKEN: 'fixture-chat-token',
  DIVE_OVERVIEW_CHAT_DATABASE: 'demo_db',
});
delete process.env.OPENAI_CHAT_MODELS;
delete process.env.DIVE_EXPLORER_CHAT_DATABASE;

const { GET, POST } = await import('../app/api/chat/route.js');
const headers = { cookie: `${COOKIE}=${signSession(SECRET)}`, origin: 'https://demo.test', host: 'demo.test', 'content-type': 'application/json' };
const post = (body, extra = {}) => POST(new Request('https://demo.test/api/chat', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) }));
const base = { dive: 'overview', state: { example_choice: 'Second' }, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'What is selected?' }] }] };

test('the model catalog requires a session', async () => {
  assert.equal((await GET(new Request('https://demo.test/api/chat'))).status, 401);
  const catalog = await (await GET(new Request('https://demo.test/api/chat', { headers }))).json();
  assert.deepEqual(catalog, { models: ['auto', 'luna', 'sol', 'astra'], defaultModel: 'luna', recording: false });
});

test('bad requests fail before any model call', async () => {
  seen.length = 0;
  assert.equal((await post({ ...base, model: 'gpt-4o' })).status, 400);
  assert.equal((await post({ ...base, dive: 'nope' })).status, 400);
  assert.equal((await post(base, { origin: 'https://attacker.test' })).status, 403);
  const off = await post({ ...base, dive: 'explorer' });
  assert.equal(off.status, 503);
  assert.deepEqual(await off.json(), { error: 'chat_data_not_configured' });
  assert.equal(seen.length, 0);
});

test('a tool step and an answer stream in order, then follow-ups and one finish', async () => {
  seen.length = 0;
  const response = await post({ ...base, model: 'sol' });
  assert.equal(response.status, 200);
  const chunks = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  const types = chunks.map(chunk => chunk.type);
  assert.equal(types[0], 'start');
  assert.deepEqual(chunks[0].messageMetadata, { model: 'sol', auto: false });
  const output = chunks.find(chunk => chunk.type === 'tool-output-available');
  assert.deepEqual(output.output, { dive: 'Overview', state: { example_choice: 'Second' } });
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join(''), 'The Dive shows the Second option.');
  assert.ok(types.indexOf('data-followups') > types.lastIndexOf('text-end'));
  assert.equal(types.at(-1), 'finish');
  assert.equal(types.filter(type => type === 'finish').length, 1);
  assert.equal(typeof chunks.at(-1).messageMetadata.workedMs, 'number');

  const [first, second, followUp] = seen;
  assert.equal(first.model, 'gpt-6.1-sol');
  assert.equal(first.reasoning?.effort, 'medium');
  assert.equal(first.reasoning?.summary, 'detailed');
  assert.equal(first.store, false);
  assert.deepEqual(first.tools.map(tool => tool.name).sort(), ['describeTable', 'getDiveState', 'listTables', 'runQuery']);
  assert.ok(second.input.some(item => item.type === 'function_call_output'));
  assert.equal(followUp.model, 'gpt-6-luna');
  assert.equal(followUp.text?.format?.type, 'json_schema');
});

test('auto routes a schema lookup to the fastest tier and reports why', async () => {
  seen.length = 0;
  const response = await post({ ...base, model: 'auto', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Which tables can you query?' }] }] });
  assert.equal(response.status, 200);
  const chunks = (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  assert.equal(chunks[0].messageMetadata.model, 'luna');
  assert.equal(chunks[0].messageMetadata.auto, true);
  assert.match(chunks[0].messageMetadata.routeReason, /^rules: /);
  assert.equal(seen[0].model, 'gpt-6-luna');
  assert.equal(seen[0].reasoning?.effort, 'low');
});
