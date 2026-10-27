import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareChatHistory } from '../src/lib/chat-history.mjs';

test('long conversations omit tool payloads and retain the newest question within request bounds', () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'user' : 'assistant', parts: [
    { type: 'text', text: `message ${i}: ` + 'a'.repeat(12000) },
    { type: 'tool-runQuery', output: { rows: 'private tool payload'.repeat(10000) } },
  ] }));
  const history = prepareChatHistory(messages);
  assert.ok(history.length <= 16);
  assert.equal(history.at(-1).id, 'm39');
  assert.equal(history.at(-1).role, 'user');
  const body = JSON.stringify({ messages: history, state: { filter: 'x'.repeat(8192) } });
  assert.ok(body.length < 100000);
  assert.equal(body.includes('private tool payload'), false);
});

test('tool-only messages cannot crowd a user question out of the narrative window', () => {
  const history = prepareChatHistory([
    { id: 'a', role: 'assistant', parts: [{ type: 'tool-runQuery', output: {} }] },
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'What changed?' }] },
  ]);
  assert.deepEqual(history.map(message => message.id), ['u']);
});

test('JSON escaping cannot exceed the history budget', () => {
  const history = prepareChatHistory(Array.from({ length: 20 }, (_, id) => ({
    id, role: 'user', parts: [{ type: 'text', text: '\u0001"\\'.repeat(4000) }],
  })));
  assert.ok(JSON.stringify(history).length < 60000);
});

test('UTF-8 conversations leave room for state and message envelopes', () => {
  const history = prepareChatHistory(Array.from({ length: 30 }, () => ({
    id: '问'.repeat(200), role: 'user', parts: [{ type: 'text', text: '问题'.repeat(6000) }],
  })));
  const body = JSON.stringify({ messages: history, state: { filter: '问'.repeat(8000) }, dive: 'overview' });
  assert.ok(new TextEncoder().encode(body).byteLength < 100000);
});
