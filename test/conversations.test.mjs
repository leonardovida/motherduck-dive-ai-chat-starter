import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationStore, recordingEnabled, retentionDays, toolReceipts } from '../lib/conversations.mjs';

// A fake query function that records SQL and answers the few lookups the store makes.
function fakeQuery(existing = null) {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.startsWith('SELECT user_id, dive_key FROM chat_conversation')) return existing ? [existing] : [];
    return [];
  };
  return { calls, query };
}
const viewer = { id: 'user-1', name: 'Alice', username: 'alice' };

test('recording is on in accounts mode unless switched off; retention is bounded', () => {
  assert.equal(recordingEnabled({}), false);
  assert.equal(recordingEnabled({ MOTHERDUCK_APP_TOKEN: 't' }), true);
  assert.equal(recordingEnabled({ MOTHERDUCK_APP_TOKEN: 't', CHAT_HISTORY: 'OFF' }), false);
  assert.equal(retentionDays({}), null);
  assert.equal(retentionDays({ CHAT_RETENTION_DAYS: '30' }), 30);
  assert.equal(retentionDays({ CHAT_RETENTION_DAYS: '-1' }), null);
  assert.equal(retentionDays({ CHAT_RETENTION_DAYS: '99999' }), 3650);
});

test('a new conversation stores its title and the question with parameters', async () => {
  const { calls, query } = fakeQuery();
  const id = await createConversationStore(query).startTurn({ conversationId: 'conv-12345678', viewer, diveKey: 'overview', question: "What's  selected?" });
  assert.equal(id, 'conv-12345678');
  const insert = calls.find(call => call.text.startsWith('INSERT INTO chat_conversation'));
  assert.deepEqual(insert.values.slice(0, 5), ['conv-12345678', 'user-1', 'alice', 'overview', "What's selected?"]);
  assert.ok(calls.some(call => call.text.startsWith('INSERT INTO chat_message') && call.values[3] === "What's  selected?"));
  assert.ok(calls.every(call => !call.text.includes("What's")), 'values are never interpolated into SQL');
});

test('a viewer cannot append to someone else\'s conversation', async () => {
  const { calls, query } = fakeQuery({ user_id: 'someone-else', dive_key: 'overview' });
  const id = await createConversationStore(query).startTurn({ conversationId: 'conv-12345678', viewer, diveKey: 'overview', question: 'Hi' });
  assert.notEqual(id, 'conv-12345678');
  assert.equal(calls.find(call => call.text.startsWith('INSERT INTO chat_conversation')).values[0], id);
});

test('an existing conversation of the same viewer is continued', async () => {
  const { calls, query } = fakeQuery({ user_id: 'user-1', dive_key: 'overview' });
  assert.equal(await createConversationStore(query).startTurn({ conversationId: 'conv-12345678', viewer, diveKey: 'overview', question: 'And March?' }), 'conv-12345678');
  assert.ok(calls.some(call => call.text.startsWith('UPDATE chat_conversation SET updated_at')));
  assert.ok(!calls.some(call => call.text.startsWith('INSERT INTO chat_conversation')));
});

test('answers store compact SQL receipts, never result rows', async () => {
  const steps = [{ content: [
    { type: 'tool-call', toolName: 'runQuery', input: { sql: 'SELECT 1' } },
    { type: 'tool-result', toolName: 'runQuery', input: { sql: 'SELECT count(*) FROM t', purpose: 'count rows' }, output: { sql: 'SELECT count(*) FROM t', rowCount: 1, truncated: false, rows: [{ secret: 'value' }] } },
    { type: 'tool-result', toolName: 'describeTable', input: { table: 'main.t' }, output: { error: 'No table main.t in this database.' } },
    { type: 'tool-error', toolName: 'runQuery', input: { sql: 'SELECT boom' } },
  ] }];
  const receipts = toolReceipts(steps);
  assert.deepEqual(receipts, [
    { tool: 'runQuery', sql: 'SELECT count(*) FROM t', purpose: 'count rows', rowCount: 1, truncated: false },
    { tool: 'describeTable', table: 'main.t', error: 'No table main.t in this database.' },
    { tool: 'runQuery', sql: 'SELECT boom', error: 'The tool failed.' },
  ]);
  assert.ok(!JSON.stringify(receipts).includes('secret'));
  const { calls, query } = fakeQuery();
  await createConversationStore(query).finishTurn({ conversationId: 'conv-12345678', answer: 'One row.', tools: receipts, model: { key: 'luna', provider: 'anthropic', id: 'claude-haiku-5-5' }, routeReason: 'rules: lookup', usage: { inputTokens: 10, outputTokens: 3 }, workedMs: 1234.4 });
  const values = calls[0].values;
  assert.deepEqual(values.slice(2, 4), ['assistant', 'One row.']);
  assert.deepEqual(values.slice(5, 12), ['luna', 'anthropic', 'claude-haiku-5-5', 'rules: lookup', 10, 3, 1234]);
});

test('listing filters with parameters and escapes LIKE wildcards; bad ids are refused', async () => {
  const { calls, query } = fakeQuery();
  const store = createConversationStore(query);
  await store.list({ userId: 'user-1', diveKey: 'overview', search: '50%_off', limit: 1000 });
  assert.deepEqual(calls[0].values, ['user-1', 'overview', '%50\\%\\_off%', 200, 0]);
  assert.match(calls[0].text, /c\.user_id = \$1 AND c\.dive_key = \$2 AND c\.title ILIKE \$3/);
  assert.equal(await store.get("x'; DROP TABLE"), null);
  assert.equal(await store.remove('short'), false);
});
