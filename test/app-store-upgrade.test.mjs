import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_RETRY_MS, appQuery, authDatabase, ensureAppStore } from '../lib/app-db.mjs';
import { createConversationStore } from '../lib/conversations.mjs';
import { CHAT_QUERIES_MARKER } from '../lib/app-db-schema.mjs';
import { withEnv } from './helpers.mjs';

// An app database in the shape `npm run db:migrate` left it before the SQL log existed (v0.6.2):
// chat_message without queries or queries_dropped, and no chat_queries view. It is not a SQL
// engine: it knows which columns each table has, refuses a statement naming a missing one as
// DuckDB would, and applies the migration's ADD COLUMN and CREATE VIEW statements.
const MAIN_MESSAGE_COLUMNS = ['id', 'conversation_id', 'role', 'content', 'reply_to', 'status', 'tools', 'model_tier', 'model_provider', 'model_id', 'route_reason',
  'input_tokens', 'output_tokens', 'worked_ms', 'feedback', 'feedback_at', 'feedback_reason', 'feedback_note', 'dive_state', 'group_names', 'group_ids', 'topic', 'data_gap', 'classified_at', 'created_at'];
function mainShapeStore({ failMigration = false } = {}) {
  const tables = { chat_message: new Set(MAIN_MESSAGE_COLUMNS), chat_conversation: new Set(['id', 'user_id', 'user_label', 'dive_key', 'title', 'created_at', 'updated_at', 'session_id']) };
  const views = new Map([['chat_questions', []]]);
  const rows = { chat_message: [], chat_conversation: [] };
  const sent = [];
  const missing = (table, names) => names.map(name => name.trim()).filter(name => !tables[table].has(name));
  const pool = {
    on() {},
    connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
    async query(text, values = []) {
      sent.push(text);
      if (/FROM duckdb_columns\(\)/.test(text)) return { rows: (views.get('chat_queries') ?? []).includes(CHAT_QUERIES_MARKER) ? [{ '?column?': 1 }] : [] };
      if (/^(CREATE|ALTER)\b/.test(text) && failMigration) throw Object.assign(new Error('Catalog Error: cannot alter'), { code: 'XX000' });
      let match = /^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/.exec(text);
      if (match) { tables[match[1]]?.add(match[2]); return { rows: [] }; }
      match = /^CREATE OR REPLACE VIEW (\w+) AS([\s\S]*)$/.exec(text);
      if (match) {
        // A view over a missing column fails, as in DuckDB.
        if (/a\.queries\b/.test(match[2]) && !tables.chat_message.has('queries')) throw new Error('Binder Error: Values list "a" does not have a column named "queries"');
        views.set(match[1], [...match[2].matchAll(/ AS (\w+)/g)].map(found => found[1]));
        return { rows: [] };
      }
      if (/^(CREATE|ALTER)\b/.test(text)) return { rows: [] };
      match = /^INSERT INTO (\w+) \(([^)]*)\)/.exec(text);
      if (match) {
        const names = match[2].split(',').map(name => name.trim());
        const absent = missing(match[1], names);
        if (absent.length) throw new Error(`Binder Error: Table "${match[1]}" does not have a column with name "${absent[0]}"`);
        rows[match[1]].push(Object.fromEntries(names.map((name, index) => [name, values[/\$(\d+)/.exec(text.split('VALUES')[1].split(',')[index])[1] - 1]])));
        return { rows: [] };
      }
      match = /^SELECT ([\s\S]*?) FROM (chat_message|chat_conversation) WHERE (conversation_id|id) = \$1/.exec(text);
      if (match) {
        const absent = missing(match[2], match[1].split(','));
        if (absent.length) throw new Error(`Binder Error: Referenced column "${absent[0]}" not found`);
        return { rows: rows[match[2]].filter(row => row[match[3]] === values[0]) };
      }
      return { rows: [] };
    },
  };
  return { pool, tables, views, sent };
}

const ACCOUNTS = { MOTHERDUCK_APP_TOKEN: 'app', SHARED_PASSWORD_ADMIN: undefined, SESSION_SECRET: 'unit-test-secret-with-at-least-32-characters', APP_URL: 'https://demo.test' };
async function withStore(store, fn) {
  globalThis.__diveChatAppPool = store.pool;
  delete globalThis.__diveChatAppReady; delete globalThis.__diveChatAppFailed;
  try { return await withEnv(ACCOUNTS, fn); }
  finally { delete globalThis.__diveChatAppPool; delete globalThis.__diveChatAppReady; delete globalThis.__diveChatAppFailed; }
}
const viewer = { id: 'user-1', name: 'Alice', username: 'alice' };
const queries = [{ sql: 'SELECT 1', tool: 'runQuery', sent: true, started_at: '2026-11-01T10:00:00.000Z', rows: 1, ms: 3, truncated: false }];

test('an accounts-mode database from before the SQL log saves answers and opens conversations after first use', async () => {
  const store = mainShapeStore();
  await withStore(store, async () => {
    const conversations = createConversationStore();
    const id = await conversations.startTurn({ viewer, diveKey: 'overview', question: 'How many rows?' });
    await conversations.finishTurn({ conversationId: id, answer: 'One.', queries, queriesDropped: 2 });
    const conversation = await conversations.get(id);
    assert.deepEqual(conversation.messages.map(message => message.role), ['user', 'assistant']);
    assert.deepEqual(conversation.messages[1].queries, queries);
    assert.equal(conversation.messages[1].queries_dropped, 2);
    assert.ok(store.tables.chat_message.has('queries') && store.tables.chat_message.has('queries_dropped'));
    assert.ok(store.views.get('chat_queries').includes(CHAT_QUERIES_MARKER));
    // The check runs once per server instance; the migration only when it was needed.
    const checks = store.sent.filter(text => /duckdb_columns/.test(text)).length;
    await appQuery('SELECT id FROM chat_conversation WHERE id = $1', ['x']);
    assert.equal(store.sent.filter(text => /duckdb_columns/.test(text)).length, checks);
    assert.equal(checks, 1);
  });
});

test('an up-to-date accounts-mode database is checked once and not migrated', async () => {
  const store = mainShapeStore();
  store.tables.chat_message.add('queries').add('queries_dropped');
  store.views.set('chat_queries', [CHAT_QUERIES_MARKER]);
  await withStore(store, async () => {
    await appQuery('SELECT id FROM chat_conversation WHERE id = $1', ['x']);
    await appQuery('SELECT id FROM chat_conversation WHERE id = $1', ['y']);
    assert.deepEqual(store.sent.filter(text => /^(CREATE|ALTER)\b/.test(text)), []);
    assert.equal(store.sent.filter(text => /duckdb_columns/.test(text)).length, 1);
  });
});

test('in accounts mode a failed upgrade is logged once and never fails the request', async () => {
  const store = mainShapeStore({ failMigration: true });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await withStore(store, async () => {
      // Sign-in still reaches the database, and a plain query still answers.
      const connection = await authDatabase().connect();
      assert.equal(typeof connection.query, 'function', 'Better Auth gets its connection');
      assert.deepEqual(await appQuery('SELECT id FROM chat_conversation WHERE id = $1', ['x']), []);
      assert.deepEqual(await appQuery('SELECT id FROM chat_conversation WHERE id = $1', ['x']), []);
      assert.equal(errors.filter(([event]) => event === 'app_store_upgrade_failed').length, 1, 'one log line per attempt, not per request');
      // The failure is remembered, then tried again.
      const checks = () => store.sent.filter(text => /duckdb_columns/.test(text)).length;
      assert.equal(checks(), 1);
      await assert.rejects(ensureAppStore(process.env), /cannot alter/);
      assert.equal(checks(), 1);
      await assert.rejects(ensureAppStore(process.env, { now: () => Date.now() + STORE_RETRY_MS + 1 }), /cannot alter/);
      assert.equal(checks(), 2);
    });
  } finally { console.error = original; }
});
