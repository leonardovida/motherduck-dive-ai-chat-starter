// Drives the real /api/chat route against a local fake self-hosted OpenAI-compatible server
// (Chat Completions with streaming and a tool call), with no OpenAI or Anthropic key set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, signSession } from '../lib/security.mjs';
import { startFakeOpenAICompatible } from './fake-openai-compatible.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const fake = await startFakeOpenAICompatible();
test.after(() => fake.close());
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'CHAT_DEFAULT_MODEL', 'CHAT_MODELS', 'CHAT_PROVIDER', 'MOTHERDUCK_APP_TOKEN', 'DIVE_EXPLORER_CHAT_DATABASE']) delete process.env[name];
Object.assign(process.env, {
  SESSION_SECRET: SECRET,
  OPENAI_COMPATIBLE_BASE_URL: fake.url,
  OPENAI_COMPATIBLE_API_KEY: 'fixture-self-hosted-key',
  OPENAI_COMPATIBLE_MODEL: 'local-model',
  CHAT_FOLLOW_UPS: 'false',
  MOTHERDUCK_CHAT_TOKEN: 'fixture-chat-token',
  DIVE_OVERVIEW_CHAT_DATABASE: 'demo_db',
});

const { GET, POST } = await import('../app/api/chat/route.js');
const headers = { cookie: `${COOKIE}=${signSession(SECRET)}`, origin: 'https://demo.test', host: 'demo.test', 'content-type': 'application/json' };
const base = { dive: 'overview', state: { example_choice: 'Second' }, messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'What is selected?' }] }] };
const chunksOf = async response => (await response.text()).split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));

test('a self-hosted endpoint alone configures chat, with the same model on every tier', async () => {
  const catalog = await (await GET(new Request('https://demo.test/api/chat', { headers }))).json();
  assert.deepEqual(catalog.models, ['auto', 'luna', 'sol', 'astra']);
});

test('the chat route streams a tool step and an answer from a self-hosted endpoint', async () => {
  fake.seen.length = 0;
  const response = await POST(new Request('https://demo.test/api/chat', { method: 'POST', headers, body: JSON.stringify({ ...base, model: 'astra' }) }));
  assert.equal(response.status, 200);
  const chunks = await chunksOf(response);
  assert.deepEqual(chunks[0].messageMetadata, { model: 'astra', auto: false });
  const output = chunks.find(chunk => chunk.type === 'tool-output-available');
  assert.deepEqual(output.output, { dive: 'Overview', state: { example_choice: 'Second' } });
  assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join(''), 'The Dive shows the Second option.');
  assert.equal(chunks.at(-1).type, 'finish');

  const [first, second] = fake.seen;
  assert.equal(first.url, '/v1/chat/completions');
  assert.equal(first.headers.authorization, 'Bearer fixture-self-hosted-key', 'the key goes to the base URL set beside it');
  assert.equal(first.body.model, 'local-model');
  assert.equal(first.body.stream, true);
  assert.equal('reasoning_effort' in first.body, false, 'self-hosted servers never receive a reasoning setting');
  assert.deepEqual(first.body.tools.map(tool => tool.function.name).sort(), ['describeTable', 'getDiveState', 'listTables', 'runQuery']);
  assert.ok(second.body.messages.some(message => message.role === 'tool'));
});

test('auto mode routes on the same endpoint without sending reasoning settings', async () => {
  fake.seen.length = 0;
  const response = await POST(new Request('https://demo.test/api/chat', { method: 'POST', headers, body: JSON.stringify({ ...base, model: 'auto', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Which tables can you query?' }] }] }) }));
  const chunks = await chunksOf(response);
  assert.equal(chunks[0].messageMetadata.model, 'luna');
  assert.ok(fake.seen.every(request => !('reasoning_effort' in request.body)));
});

test('the Test check reports a tool call from a self-hosted endpoint', async () => {
  const { testModel } = await import('../lib/model-test.mjs');
  const result = await testModel({ key: 'luna', provider: 'openai-compatible', id: 'local-model', options: {} });
  assert.equal(result.ok, true);
  assert.equal(result.toolCall, true);
});
