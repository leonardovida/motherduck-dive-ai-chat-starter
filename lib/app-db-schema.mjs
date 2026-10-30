import { getSchema } from 'better-auth/db';

// DuckDB DDL for the app store. Better Auth's own migrator introspects Postgres catalog functions
// that MotherDuck does not have, so the tables are generated here from Better Auth's schema.
// Statements are idempotent: run `npm run db:migrate` after every upgrade.
const TYPES = { string: 'VARCHAR', boolean: 'BOOLEAN', date: 'TIMESTAMPTZ', number: 'BIGINT', json: 'JSON', 'string[]': 'VARCHAR[]', 'number[]': 'BIGINT[]' };
export const quoteName = name => `"${String(name).replaceAll('"', '""')}"`;

const CHAT_TABLES = [
  `CREATE TABLE IF NOT EXISTS chat_conversation (id VARCHAR PRIMARY KEY, user_id VARCHAR NOT NULL, user_label VARCHAR, dive_key VARCHAR NOT NULL, title VARCHAR, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chat_message (id VARCHAR PRIMARY KEY, conversation_id VARCHAR NOT NULL, role VARCHAR NOT NULL, content VARCHAR NOT NULL, tools JSON, model_tier VARCHAR, model_provider VARCHAR, model_id VARCHAR, route_reason VARCHAR, input_tokens BIGINT, output_tokens BIGINT, worked_ms BIGINT, created_at TIMESTAMPTZ NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS chat_message_conversation_idx ON chat_message (conversation_id)',
  'CREATE INDEX IF NOT EXISTS chat_conversation_user_idx ON chat_conversation (user_id)',
];

function fieldColumn(name, field, { creating }) {
  const type = TYPES[field.type] ?? 'VARCHAR';
  // Constraints can only be declared when the table is created; later additions stay nullable.
  const constraints = creating ? `${field.unique ? ' UNIQUE' : ''}${field.required ? ' NOT NULL' : ''}` : '';
  return `${quoteName(field.fieldName || name)} ${type}${constraints}`;
}

export function authTables(options) {
  return Object.entries(getSchema(options)).filter(([, table]) => !table.disableMigrations);
}

export function createStatements(options) {
  const tables = authTables(options).map(([name, table]) => `CREATE TABLE IF NOT EXISTS ${quoteName(name)} (${['"id" VARCHAR PRIMARY KEY', ...Object.entries(table.fields).map(([field, spec]) => fieldColumn(field, spec, { creating: true }))].join(', ')})`);
  // Foreign keys are indexed but not constrained: DuckDB cannot cascade deletes.
  const indexes = authTables(options).flatMap(([name, table]) => Object.entries(table.fields).filter(([, spec]) => spec.references && !spec.unique).map(([field, spec]) => `CREATE INDEX IF NOT EXISTS ${quoteName(`${name}_${spec.fieldName || field}_idx`)} ON ${quoteName(name)} (${quoteName(spec.fieldName || field)})`));
  return [...tables, ...indexes, ...CHAT_TABLES];
}

// Columns added by a newer Better Auth or plugin version on an existing table.
export function addColumnStatements(options) {
  return authTables(options).flatMap(([name, table]) => Object.entries(table.fields).map(([field, spec]) => `ALTER TABLE ${quoteName(name)} ADD COLUMN IF NOT EXISTS ${fieldColumn(field, spec, { creating: false })}`));
}

export async function migrateAppDatabase(query, options) {
  const statements = [...createStatements(options), ...addColumnStatements(options)];
  for (const statement of statements) await query(statement);
  return statements.length;
}
