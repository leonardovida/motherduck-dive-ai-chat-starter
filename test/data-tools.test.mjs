import test from 'node:test';
import assert from 'node:assert/strict';
import { bindReadParameters, createDataTools, createChatReaderSession, withChatReader } from '../lib/chat-data.mjs';
import { receiveDiveExport } from '../src/lib/dive-export.mjs';

test('fixed SQL parameters become escaped literals', () => {
  assert.equal(bindReadParameters('SELECT $1, $2, $3', ["o'neil", 5, null]), "SELECT 'o''neil', 5, NULL");
  assert.throws(() => bindReadParameters('SELECT $1', [{}]), /invalid_query_value/);
  assert.throws(() => bindReadParameters('SELECT $1', ['a\0b']), /invalid_query_value/);
});

test('chat tools refuse to run without a chat database', async () => {
  await assert.rejects(withChatReader(null, async () => {}), /chat_data_not_configured/);
});

test('one answer reuses one lazy connection, and cancellation closes it', async () => {
  let connections = 0, queries = 0, ended = 0;
  class Client {
    constructor() { connections++; }
    on() {}
    async connect() {}
    async query() { queries++; return { rows: [{ n: queries }] }; }
    async end() { ended++; }
  }
  const controller = new AbortController();
  const reader = createChatReaderSession({ token: 'fixture', database: 'fixture' }, { Client, signal: controller.signal });
  assert.equal(connections, 0, 'unused readers never open connections');
  await Promise.all([reader.query('SELECT 1'), reader.query('SELECT 2')]);
  assert.equal(connections, 1);
  assert.equal(queries, 2);
  controller.abort();
  await reader.close();
  assert.equal(ended, 1, 'cleanup is idempotent');
  await assert.rejects(reader.query('SELECT 3'), { name: 'AbortError' });
});

test('SQL dollar literals are not mistaken for metadata parameters', async () => {
  const sent = [];
  class Client {
    on() {}
    async connect() {}
    async end() {}
    async query(sql) { sent.push(sql); return { rows: [] }; }
  }
  const reader = createChatReaderSession({ token: 'fixture', database: 'fixture' }, { Client });
  await reader.query("SELECT '$100' AS price_label");
  assert.equal(sent[0], "SELECT '$100' AS price_label");
  await reader.close();
});

test('failed connections and idle socket errors permit a fresh connection on retry', async () => {
  const clients = [];
  class Client {
    constructor() { clients.push(this); this.id = clients.length; }
    on(event, callback) { this.error = callback; }
    async connect() { if (this.id === 1) throw new Error('fixture connection failure'); }
    async query() { return { rows: [{ client: this.id }] }; }
    async end() { this.ended = true; }
  }
  const reader = createChatReaderSession({ token: 'fixture', database: 'fixture' }, { Client });
  await assert.rejects(reader.query('SELECT 1'));
  assert.deepEqual(await reader.query('SELECT 2'), [{ client: 2 }]);
  clients[1].error(new Error('fixture idle socket failure'));
  assert.deepEqual(await reader.query('SELECT 3'), [{ client: 3 }]);
  await reader.close();
  assert.ok(clients.every(client => client.ended));
});

test('a failed query retires its connection before the next tool attempt', async () => {
  let connections = 0, ended = 0;
  class Client {
    constructor() { this.id = ++connections; }
    on() {}
    async connect() {}
    async end() { ended++; }
    async query() { if (this.id === 1) throw new Error('fixture query timeout'); return { rows: [{ n: 1 }] }; }
  }
  const reader = createChatReaderSession({ token: 'fixture', database: 'fixture' }, { Client });
  await assert.rejects(reader.query('SELECT 1'));
  assert.equal(ended, 1);
  assert.deepEqual(await reader.query('SELECT 1'), [{ n: 1 }]);
  assert.equal(connections, 2);
  await reader.close();
});

test('runQuery wraps guarded SQL and reports truncation; guard errors return to the model', async () => {
  const sent = [];
  const tools = createDataTools(async (sql) => { sent.push(sql); return [{ n: 1 }, { n: 2 }, { n: 3 }]; });
  const result = await tools.runQuery({ sql: 'SELECT n FROM t', limit: 2 });
  assert.equal(sent[0], 'SELECT * FROM (SELECT n FROM t) AS assistant_query LIMIT 3');
  assert.deepEqual(result, { sql: 'SELECT n FROM t', columns: ['n'], rowCount: 2, truncated: true, rows: [{ n: 1 }, { n: 2 }] });
  const refused = await tools.runQuery({ sql: 'WITH x AS (SELECT 1) DELETE FROM t' });
  assert.match(refused.error, /read-only/);
  assert.equal(refused.sql, 'WITH x AS (SELECT 1) DELETE FROM t');
  assert.equal(sent.length, 1, 'refused SQL never reaches the database');
});

test('describeTable accepts plain identifiers only', async () => {
  const sent = [];
  const tools = createDataTools(async (sql, values = []) => { sent.push(bindReadParameters(sql, values)); return sql.includes('duckdb_columns') ? [{ column_name: 'id', data_type: 'INTEGER' }] : [{ id: 1 }]; });
  const result = await tools.describeTable({ table: 'sales.orders' });
  assert.equal(result.table, 'sales.orders');
  assert.match(sent[0], /schema_name='sales' AND table_name='orders'/);
  assert.equal(sent[1], 'SELECT * FROM "sales"."orders" LIMIT 5');
  assert.match((await tools.describeTable({ table: 'orders; DROP' })).error, /plain identifiers/);
  assert.equal(sent.length, 2);
});

test('Dive exports accept known formats from the frame only', () => {
  const frame = {};
  const pending = new Map();
  const event = (data) => ({ source: frame, origin: 'https://embed-motherduck.com', data });
  const bytes = (text) => new TextEncoder().encode(text).buffer;
  assert.deepEqual(receiveDiveExport(event({ type: 'export-started', requestId: 'r1', format: 'parquet', filename: 'orders.parquet' }), frame, pending), { type: 'started' });
  const bad = receiveDiveExport(event({ type: 'export-file', requestId: 'r1', format: 'parquet', filename: 'orders.parquet', data: bytes('nope'), byteLength: 4, mimeType: 'application/vnd.apache.parquet' }), frame, pending);
  assert.deepEqual(bad, { type: 'error' });
  receiveDiveExport(event({ type: 'export-started', requestId: 'r2', format: 'parquet', filename: 'orders.parquet' }), frame, pending);
  const good = receiveDiveExport(event({ type: 'export-file', requestId: 'r2', format: 'parquet', filename: 'orders.parquet', data: bytes('PAR1data'), byteLength: 8, mimeType: 'application/vnd.apache.parquet' }), frame, pending);
  assert.equal(good.type, 'file');
  for (const filename of ['../x.csv', '.hidden.csv', 'x.exe', 'x.json']) {
    assert.equal(receiveDiveExport(event({ type: 'export-started', requestId: 'r3', format: 'csv', filename }), frame, pending), null, filename);
  }
  assert.equal(receiveDiveExport({ ...event({ type: 'export-started', requestId: 'r4', format: 'csv', filename: 'a.csv' }), origin: 'https://evil.test' }, frame, pending), null);
});
