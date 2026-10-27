import pg from 'pg';
import { guardQuery, IDENTIFIER, quoteIdentifier } from './sql-guard.mjs';

const RESULT_CHARS = 40000;

// PG endpoint metadata cannot always resolve a remote query with unbound parameters.
// Only fixed application SQL reaches this helper; values become escaped SQL literals.
export function bindReadParameters(text, values = []) {
  return text.replace(/\$(\d+)/g, (_, index) => {
    const value = values[Number(index) - 1];
    if (value === null) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string' || value.includes('\0')) throw new Error('invalid_query_value');
    return `'${value.replaceAll("'", "''")}'`;
  });
}

// One lazy connection per answer, reused across tool steps and never across viewers.
export function createChatReaderSession(chat, { env = process.env, signal, Client = pg.Client } = {}) {
  let client, connected;
  const ending = new Map();
  let closed = false;
  const retire = (active) => {
    if (!active) return Promise.resolve();
    if (client === active) { client = undefined; connected = undefined; }
    if (!ending.has(active)) ending.set(active, Promise.resolve().then(() => active.end()).catch(() => {}));
    return ending.get(active);
  };
  const close = () => {
    closed = true;
    signal?.removeEventListener('abort', close);
    const latest = retire(client);
    return Promise.all([latest, ...ending.values()]);
  };
  signal?.addEventListener('abort', close, { once: true });
  return {
    close,
    async query(text, values = []) {
      if (closed || signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (!chat?.token || !chat?.database) throw new Error('chat_data_not_configured');
      if (!client) {
        const fresh = new Client({
          host: env.MOTHERDUCK_PG_HOST || 'pg.us-east-1-aws.motherduck.com', port: 5432, user: 'postgres', password: chat.token, database: chat.database,
          ssl: { rejectUnauthorized: true }, application_name: 'dive-ai-chat-starter', connectionTimeoutMillis: 15000, query_timeout: 15000, keepAlive: true,
        });
        client = fresh;
        fresh.on('error', () => { void retire(fresh); });
        connected = Promise.resolve().then(() => fresh.connect());
      }
      const active = client, ready = connected;
      try {
        await ready;
        if (closed || signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
        return (await active.query(values.length ? bindReadParameters(text, values) : text)).rows;
      } catch (error) {
        // A timed-out or broken client must not poison the model's next tool attempt.
        await retire(active);
        throw error;
      }
    },
  };
}

export async function withChatReader(chat, run, env = process.env) {
  if (!chat?.token || !chat?.database) throw new Error('chat_data_not_configured');
  const reader = createChatReaderSession(chat, { env });
  try { return await run(reader.query); }
  finally { await reader.close(); }
}

// Keeps tool results small enough for the model; BigInt-like values arrive as strings from pg.
function compact(rows) {
  const out = [];
  let size = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    if (size + json.length > RESULT_CHARS) return { rows: out, clipped: true };
    out.push(row); size += json.length + 1;
  }
  return { rows: out, clipped: false };
}

export function createDataTools(query) {
  return {
    async listTables() {
      const rows = await query(`SELECT schema_name,table_name,'table' AS kind,estimated_size::BIGINT AS estimated_rows,column_count FROM duckdb_tables() WHERE database_name=current_database() UNION ALL SELECT schema_name,view_name,'view',NULL,column_count FROM duckdb_views() WHERE database_name=current_database() AND NOT internal ORDER BY 1,2 LIMIT 200`);
      return { tables: rows };
    },
    async describeTable({ table }) {
      const parts = String(table ?? '').split('.');
      if (parts.length > 2 || !parts.every(part => IDENTIFIER.test(part))) return { error: 'Use table or schema.table with plain identifiers.' };
      const [schema, name] = parts.length === 2 ? parts : ['main', parts[0]];
      const columns = await query(`SELECT column_name,data_type,is_nullable FROM duckdb_columns() WHERE database_name=current_database() AND schema_name=$1 AND table_name=$2 ORDER BY column_index`, [schema, name]);
      if (!columns.length) return { error: `No table ${schema}.${name} in this database.` };
      const sample = await query(`SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(name)} LIMIT 5`);
      return { table: `${schema}.${name}`, columns, sample: compact(sample).rows };
    },
    async runQuery({ sql, limit }) {
      let guarded;
      try { guarded = guardQuery(sql, limit); } catch (error) { return { error: error.message, sql: String(sql ?? '').slice(0, 2000) }; }
      const rows = await query(guarded.wrapped);
      const truncated = rows.length > guarded.limit;
      const { rows: kept, clipped } = compact(rows.slice(0, guarded.limit));
      return { sql: guarded.sql, columns: Object.keys(rows[0] ?? {}), rowCount: kept.length, truncated: truncated || clipped, rows: kept };
    },
  };
}
