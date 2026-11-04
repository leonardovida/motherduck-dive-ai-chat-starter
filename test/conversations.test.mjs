import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationOwner, createConversationStore, failedText, recordingEnabled, retentionDays, toolReceipts } from '../lib/conversations.mjs';
import { createInsights, fillDays, insightFilter } from '../lib/insights.mjs';
import { createStatements } from '../lib/app-db-schema.mjs';
import { authOptions } from '../lib/auth.mjs';

// A fake query function that records SQL and answers the few lookups the store makes.
function fakeQuery(existing = null) {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.startsWith('SELECT user_id, dive_key, session_id FROM chat_conversation')) return existing ? [existing] : [];
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
  assert.deepEqual(values.slice(13), [null, 'answered']);
});

test('a question keeps the asker\'s groups and Dive state; an answer links to it with its outcome', async () => {
  const { calls, query } = fakeQuery();
  const store = createConversationStore(query);
  const asker = { ...viewer, groups: [{ id: 'g1', name: 'Acme' }, { id: 'g2', name: 'Finance' }] };
  await store.startTurn({ conversationId: 'conv-12345678', viewer: asker, diveKey: 'overview', question: 'Why?', questionId: 'question-1', state: { region: 'EMEA' } });
  const question = calls.find(call => call.text.startsWith('INSERT INTO chat_message'));
  assert.deepEqual(question.values.slice(0, 6), ['question-1', 'conv-12345678', 'user', 'Why?', '{"region":"EMEA"}', '["Acme","Finance"]']);
  // An empty or very large state is not kept.
  await store.startTurn({ conversationId: 'conv-12345678', viewer, diveKey: 'overview', question: 'And?', state: { blob: 'x'.repeat(9000) } });
  assert.deepEqual(calls.filter(call => call.text.startsWith('INSERT INTO chat_message')).at(-1).values.slice(4, 6), [null, '[]']);
  calls.length = 0;
  await store.finishTurn({ conversationId: 'conv-12345678', answerId: 'answer-1', replyTo: 'question-1', status: 'stopped', answer: failedText(false) });
  assert.deepEqual([calls[0].values[0], calls[0].values[3], ...calls[0].values.slice(13)], ['answer-1', '[Stopped before an answer.]', 'question-1', 'stopped']);
  await store.finishTurn({ conversationId: 'conv-12345678', status: 'nonsense', answer: 'x' });
  assert.equal(calls.at(-2).values[14], 'answered');
});

test('feedback is only set on an answer in the viewer\'s own conversation', async () => {
  const calls = [];
  const query = async (text, values) => { calls.push({ text, values }); return values[6] === 'user-1' ? [{ id: values[4] }] : []; };
  const store = createConversationStore(query);
  assert.equal(await store.setFeedback({ viewer, conversationId: 'conv-12345678', answerId: 'answer-12345', value: -1 }), true);
  assert.match(calls[0].text, /role = 'assistant'/);
  assert.match(calls[0].text, /SELECT id FROM chat_conversation WHERE user_id = \$7\)/);
  assert.deepEqual([calls[0].values[0], ...calls[0].values.slice(2)], [-1, null, null, 'answer-12345', 'conv-12345678', 'user-1']);
  assert.equal(await store.setFeedback({ viewer: { id: 'someone-else' }, conversationId: 'conv-12345678', answerId: 'answer-12345', value: 1 }), false);
  // Clearing stores no rating and no time.
  await store.setFeedback({ viewer, conversationId: 'conv-12345678', answerId: 'answer-12345', value: 0 });
  assert.deepEqual(calls.at(-1).values.slice(0, 2), [null, null]);
  calls.length = 0;
  for (const bad of [{ value: 2 }, { value: '1' }, { answerId: "x'; --" }, { conversationId: 'short' }]) {
    assert.equal(await store.setFeedback({ viewer, conversationId: 'conv-12345678', answerId: 'answer-12345', value: 1, ...bad }), false);
  }
  assert.equal(calls.length, 0);
});

test('the conversation list can show only those needing attention', async () => {
  const { calls, query } = fakeQuery();
  const store = createConversationStore(query);
  await store.list({});
  assert.doesNotMatch(calls[0].text, /HAVING/);
  assert.match(calls[0].text, /negative_count/);
  await store.list({ attention: true });
  assert.match(calls[1].text, /HAVING count\(\*\) FILTER \(WHERE .*m\.feedback = -1\) > 0/);
});

test('saved conversations read status, ratings, groups and state', async () => {
  const query = async text => (text.startsWith('SELECT id, user_id') ? [{ id: 'conv-12345678', title: 't' }] : [
    { id: 'q', role: 'user', content: 'Why?', tools: null, dive_state: '{"region":"EMEA"}', group_names: '["Acme"]', status: null },
    { id: 'a', role: 'assistant', content: '[The answer failed.]', tools: '[]', status: 'failed', feedback: null },
    { id: 'b', role: 'assistant', content: 'Fine', tools: '[]', status: 'answered', feedback: 1 },
  ]);
  const { messages } = await createConversationStore(query).get('conv-12345678');
  assert.deepEqual(messages.map(m => m.status), [null, 'failed', 'answered']);
  assert.deepEqual(messages[0].dive_state, { region: 'EMEA' });
  assert.deepEqual(messages[0].group_names, ['Acme']);
});

test('insights use whole UTC days, parameters for every filter, and fill empty days', () => {
  const now = new Date('2026-11-03T15:00:00Z');
  const filter = insightFilter({ days: '7', diveKey: 'overview', group: "Acme' OR 1=1", now });
  assert.equal(filter.since.toISOString(), '2026-10-28T00:00:00.000Z');
  assert.deepEqual(filter.values.slice(1), ['overview', "Acme' OR 1=1"]);
  assert.doesNotMatch(filter.where, /Acme|overview/);
  assert.equal(insightFilter({ days: '99999', now }).days, 365);
  assert.equal(insightFilter({ days: 'abc', now }).days, 30);
  const days = fillDays([{ day: '2026-11-01', questions: 4, unsuccessful: 1, negative: 0 }], filter);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map(d => d.questions), [0, 0, 0, 0, 4, 0, 0]);
  assert.equal(days.at(-1).day, '2026-11-03');
});

test('the insights summary reads the chat_questions view and drops the grouping key', async () => {
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    if (text.includes('AS askers, count(DISTINCT conversation_id)')) return [{ questions: 2 }];
    if (text.includes('AS normalized')) return [{ normalized: 'why', question: 'Why?', questions: 2 }];
    return [];
  };
  const summary = await createInsights(query).summary({ days: 7, now: new Date('2026-11-03T15:00:00Z') });
  assert.equal(summary.totals.questions, 2);
  assert.deepEqual(summary.frequent, [{ question: 'Why?', questions: 2 }]);
  assert.equal(summary.daily.length, 7);
  assert.ok(calls.every(call => call.text.includes('FROM chat_questions') || call.text.includes('FROM (')));
  assert.ok(calls.every(call => call.values[0] instanceof Date));
});

test('the migration creates each table, adds its nullable columns to older databases, then the view', () => {
  const statements = createStatements(authOptions({ SESSION_SECRET: 'unit-test-secret-with-at-least-32-characters' }));
  const sql = statements.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_message \(id VARCHAR PRIMARY KEY, conversation_id VARCHAR NOT NULL, .*reply_to VARCHAR, status VARCHAR, .*group_ids JSON, /);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS access_group_member \(group_id VARCHAR NOT NULL, .*PRIMARY KEY \(group_id, user_id\)\)/);
  for (const column of ['reply_to', 'status', 'feedback', 'dive_state', 'group_names', 'topic']) assert.match(sql, new RegExp(`ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS ${column} `));
  // Required columns exist from creation and are never added later.
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS \w+ \w+ NOT NULL/);
  // Answers pair with their question by reply_to only, which DuckDB runs as a hash join.
  assert.match(sql, /LEFT JOIN chat_message a ON a\.reply_to = q\.id AND a\.role = 'assistant'/);
  assert.doesNotMatch(sql, /lead\(/);
  assert.equal(statements.at(-1).startsWith('CREATE OR REPLACE VIEW chat_questions'), true);
});

test('listing filters with parameters and escapes LIKE wildcards; bad ids are refused', async () => {
  const { calls, query } = fakeQuery();
  const store = createConversationStore(query);
  await store.list({ userId: 'user-1', diveKey: 'overview', search: '50%_off', limit: 1000 });
  assert.deepEqual(calls[0].values, ['user-1', 'overview', '%50\\%\\_off%', 200, 0]);
  assert.match(calls[0].text, /c\.user_id = \$1 AND c\.dive_key = \$2 AND \(c\.title ILIKE \$3 .* s\.role = 'user' AND s\.content ILIKE \$3/);
  assert.equal(await store.get("x'; DROP TABLE"), null);
  assert.equal(await store.remove('short'), false);
});

test('a thumbs down keeps its reason and note; other ratings and unknown reasons do not', async () => {
  const calls = [];
  const query = async (text, values) => { calls.push({ text, values }); return [{ id: 'x' }]; };
  const store = createConversationStore(query);
  const base = { viewer, conversationId: 'conv-12345678', answerId: 'answer-12345' };
  await store.setFeedback({ ...base, value: -1, reason: 'wrong_numbers', note: '  March is off by 10%  ' });
  assert.deepEqual(calls[0].values.slice(2, 4), ['wrong_numbers', 'March is off by 10%']);
  await store.setFeedback({ ...base, value: 1, reason: 'wrong_numbers', note: 'x' });
  assert.deepEqual(calls[1].values.slice(2, 4), [null, null]);
  assert.equal(await store.setFeedback({ ...base, value: -1, reason: 'DROP TABLE' }), false);
  assert.equal(calls.length, 2);
});

test('in a public demo a conversation also belongs to the visitor session', async () => {
  const existing = { user_id: 'user-1', dive_key: 'overview', session_id: 'session-a' };
  const { calls, query } = fakeQuery(existing);
  const store = createConversationStore(query);
  // Another visitor on the shared account cannot continue it.
  const id = await store.startTurn({ conversationId: 'conv-12345678', viewer, diveKey: 'overview', question: 'Hi', sessionId: 'session-b' });
  assert.notEqual(id, 'conv-12345678');
  assert.equal(calls.find(call => call.text.startsWith('INSERT INTO chat_conversation')).values[6], 'session-b');
  // Nor rate its answers.
  calls.length = 0;
  await store.setFeedback({ viewer, conversationId: 'conv-12345678', answerId: 'answer-12345', value: 1, sessionId: 'session-b' });
  assert.match(calls[0].text, /user_id = \$7 AND session_id = \$8/);
  assert.equal(calls[0].values[7], 'session-b');
  // Outside a demo the session is not part of ownership.
  assert.deepEqual(conversationOwner({ id: 'u', sessionId: 's' }), { userId: 'u', sessionId: null });
  assert.deepEqual(conversationOwner({ id: 'u', sessionId: 's' }, true), { userId: 'u', sessionId: 's' });
});

test('a person reads only their own conversation; deleting a person can remove all of theirs', async () => {
  const rows = { 'conv-12345678': { id: 'conv-12345678', user_id: 'user-1', session_id: 'session-a' } };
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    if (text.startsWith('SELECT id, user_id')) return rows[values[0]] ? [rows[values[0]]] : [];
    if (text.startsWith('DELETE FROM chat_conversation WHERE user_id')) return [{ id: 'a' }, { id: 'b' }];
    return [];
  };
  const store = createConversationStore(query);
  assert.ok(await store.getOwn('conv-12345678', { userId: 'user-1', sessionId: null }));
  assert.equal(await store.getOwn('conv-12345678', { userId: 'user-2', sessionId: null }), null);
  assert.equal(await store.getOwn('conv-12345678', { userId: 'user-1', sessionId: 'session-b' }), null);
  assert.equal(await store.removeForUser('user-1'), 2);
  assert.match(calls.at(-2).text, /DELETE FROM chat_message WHERE conversation_id IN \(SELECT id FROM chat_conversation WHERE user_id = \$1\)/);
  assert.equal(await store.removeForUser(''), 0);
});

test('a question records group ids beside group names', async () => {
  const { calls, query } = fakeQuery();
  await createConversationStore(query).startTurn({ conversationId: 'conv-12345678', viewer: { ...viewer, groups: [{ id: 'g1', name: 'Acme' }] }, diveKey: 'overview', question: 'Why?' });
  const insert = calls.find(call => call.text.startsWith('INSERT INTO chat_message'));
  assert.deepEqual(insert.values.slice(5, 7), ['["Acme"]', '["g1"]']);
});

test('Retry reuses the last question and replaces its failed answer, only in the viewer\'s own conversation', async () => {
  const database = ({ owner = 'user-1', last = { id: 'q-1', content: 'Why?' }, answered = false } = {}) => {
    const calls = [];
    const query = async (text, values = []) => {
      calls.push({ text, values });
      if (text.startsWith('SELECT user_id, dive_key, session_id FROM chat_conversation')) return [{ user_id: owner, dive_key: 'overview', session_id: null }];
      if (text.startsWith('SELECT id, content FROM chat_message')) return last ? [last] : [];
      if (text.startsWith('SELECT 1 AS found FROM chat_message WHERE reply_to')) return answered ? [{ found: 1 }] : [];
      return [];
    };
    return { calls, store: createConversationStore(query) };
  };
  const turn = { conversationId: 'conv-12345678', viewer, diveKey: 'overview', question: 'Why?' };
  const retried = database();
  assert.equal(await retried.store.retryTurn(turn), 'q-1');
  assert.deepEqual(retried.calls.find(call => call.text.startsWith('DELETE FROM chat_message WHERE reply_to')).values, ['q-1']);
  assert.ok(!retried.calls.some(call => call.text.startsWith('INSERT')), 'the question is not saved twice');
  for (const [why, options] of [['someone else\'s', { owner: 'user-2' }], ['a different question', { last: { id: 'q-1', content: 'What?' } }], ['already answered', { answered: true }], ['nothing asked yet', { last: null }]]) {
    const other = database(options);
    assert.equal(await other.store.retryTurn(turn), null, why);
    assert.ok(!other.calls.some(call => call.text.startsWith('DELETE')), why);
  }
});
