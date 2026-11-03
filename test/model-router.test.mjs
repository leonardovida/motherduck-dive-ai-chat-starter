import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoute, escalation, routeQuestion, ruleRoute } from '../lib/model-router.mjs';

const ALL = ['luna', 'sol', 'astra'];
const ask = (...questions) => questions.flatMap((text, index) => [
  { id: `u${index}`, role: 'user', parts: [{ type: 'text', text }] },
  ...(index < questions.length - 1 ? [{ id: `a${index}`, role: 'assistant', parts: [{ type: 'text', text: 'An answer.' }] }] : []),
]);

test('lookups about the Dive or schema go to the fastest tier', () => {
  for (const question of ['What does this Dive show?', 'Which tables can you query?', 'What is selected?', 'How many rows are there?']) {
    assert.equal(ruleRoute({ messages: ask(question), enabled: ALL }).tier, 'luna', question);
  }
});

test('comparisons and aggregations go to the balanced tier', () => {
  assert.equal(ruleRoute({ messages: ask('Compare revenue per month for the top 5 regions'), enabled: ALL }).tier, 'sol');
  assert.equal(ruleRoute({ messages: ask('Show the trend over time vs last year'), enabled: ALL }).tier, 'sol');
});

test('open-ended analysis and multi-part requests go to the deepest tier', () => {
  assert.equal(ruleRoute({ messages: ask('Why did churn rise, and what are the drivers?'), enabled: ALL }).tier, 'astra');
  assert.equal(ruleRoute({ messages: ask('Which segments grew? Which shrank? What changed in March?'), enabled: ALL }).tier, 'astra');
  assert.equal(ruleRoute({ messages: ask('Why did churn rise?'), enabled: ['luna', 'sol'] }).tier, 'sol', 'clamps to the deepest enabled tier');
});

test('short follow-ups keep the previous tier; mixed signals defer to the classifier', () => {
  assert.equal(ruleRoute({ messages: ask('Compare revenue by region over time', 'and for March?'), enabled: ALL, previousTier: 'astra' }).tier, 'astra');
  assert.equal(ruleRoute({ messages: ask('Tell me about the orders'), enabled: ALL }).tier, null);
});

test('the classifier maps its label to a tier and falls back to the middle tier', async () => {
  let call;
  const generate = async options => { call = options; return { output: 'complex' }; };
  assert.deepEqual(await classifyRoute({ messages: ask('Tell me about the orders'), enabled: ALL, model: 'fake', generate }), { tier: 'astra', reason: 'classifier: complex' });
  assert.equal(call.maxOutputTokens, 16);
  assert.match(call.prompt, /Tell me about the orders/);
  assert.deepEqual(await classifyRoute({ messages: ask('x'), enabled: ALL, model: 'fake', generate: async () => { throw new Error('down'); } }), { tier: 'sol', reason: 'classifier unavailable: balanced default' });
  assert.equal((await classifyRoute({ messages: ask('x'), enabled: ['luna', 'sol'], model: 'fake', generate: async () => ({ output: 'complex' }) })).tier, 'sol');
});

test('routing uses rules first and calls the classifier only for mixed signals', async () => {
  let classified = 0;
  const classify = async () => { classified++; return { tier: 'sol', reason: 'classifier: moderate' }; };
  assert.equal((await routeQuestion({ messages: ask('Which tables can you query?'), enabled: ALL, classify })).tier, 'luna');
  assert.equal(classified, 0);
  assert.equal((await routeQuestion({ messages: ask('Tell me about the orders'), enabled: ALL, classify })).tier, 'sol');
  assert.equal(classified, 1);
});

test('a struggling cheaper tier escalates once per step', () => {
  const failedQuery = { content: [{ type: 'tool-result', toolName: 'runQuery', output: { error: 'Binder Error' } }] };
  const ok = { content: [{ type: 'tool-result', toolName: 'listTables', output: { tables: [] } }] };
  assert.deepEqual(escalation({ steps: [failedQuery], tier: 'luna', enabled: ALL }), { tier: 'sol', reason: 'escalated: 1 failed tool call' });
  assert.equal(escalation({ steps: [ok, ok], tier: 'luna', enabled: ALL }), null);
  assert.equal(escalation({ steps: [ok, ok, ok, ok], tier: 'luna', enabled: ALL }).tier, 'sol');
  assert.equal(escalation({ steps: [failedQuery], tier: 'sol', enabled: ALL }), null);
  assert.equal(escalation({ steps: [failedQuery, { content: [{ type: 'tool-error', toolName: 'runQuery' }] }], tier: 'sol', enabled: ALL }).tier, 'astra');
  assert.equal(escalation({ steps: [failedQuery], tier: 'astra', enabled: ALL }), null);
  assert.equal(escalation({ steps: [failedQuery], tier: 'luna', enabled: ['luna'] }), null);
});
