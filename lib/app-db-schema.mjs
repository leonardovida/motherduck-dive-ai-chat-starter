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
  // Question tracking: the asker's groups and Dive state on each question, and the outcome and
  // feedback on each answer. reply_to links an answer to its question.
  'ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS reply_to VARCHAR',
  'ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS status VARCHAR',
  'ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS feedback INTEGER',
  'ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ',
  'ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS dive_state JSON',
  'ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS group_names JSON',
  // One row per question with its answer, for the admin Questions tab and for direct SQL.
  // Answers saved before reply_to existed pair with the next message in the conversation.
  `CREATE OR REPLACE VIEW chat_questions AS
   WITH ordered AS (
     SELECT m.*, lead(m.id) OVER w AS next_id, lead(m.role) OVER w AS next_role
       FROM chat_message m WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at, m.role DESC)
   )
   SELECT q.id AS question_id, q.conversation_id, c.user_id, c.user_label, c.dive_key, q.content AS question, q.created_at AS asked_at,
          q.dive_state, q.group_names,
          a.id AS answer_id, a.content AS answer,
          CASE WHEN a.id IS NULL THEN 'unanswered'
               WHEN a.status IS NOT NULL THEN a.status
               WHEN a.content = '[The answer failed.]' THEN 'failed'
               WHEN a.content = '[Stopped before an answer.]' THEN 'stopped'
               ELSE 'answered' END AS status,
          a.feedback, a.model_tier, a.model_provider, a.model_id, a.route_reason, a.input_tokens, a.output_tokens, a.worked_ms,
          json_array_length(a.tools)::INTEGER AS tool_calls, a.created_at AS answered_at
     FROM ordered q
     JOIN chat_conversation c ON c.id = q.conversation_id
     LEFT JOIN chat_message a ON a.role = 'assistant' AND (a.reply_to = q.id OR (a.reply_to IS NULL AND q.next_role = 'assistant' AND a.id = q.next_id))
    WHERE q.role = 'user'`,
];

// Groups, the MotherDuck grants the app made, and one-time password setup links.
const ACCESS_TABLES = [
  `CREATE TABLE IF NOT EXISTS access_group (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, description VARCHAR, dive_access VARCHAR NOT NULL, chat_access BOOLEAN NOT NULL, service_account VARCHAR, resources JSON, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS access_group_member (group_id VARCHAR NOT NULL, user_id VARCHAR NOT NULL, manager BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (group_id, user_id))`,
  'CREATE INDEX IF NOT EXISTS access_group_member_user_idx ON access_group_member (user_id)',
  `CREATE TABLE IF NOT EXISTS md_access_grant (grantee VARCHAR NOT NULL, grantee_kind VARCHAR NOT NULL, share_url VARCHAR NOT NULL, alias VARCHAR, share_name VARCHAR, state VARCHAR NOT NULL, granted_by_app BOOLEAN NOT NULL, attached_by_app BOOLEAN NOT NULL, detail VARCHAR, updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (grantee, share_url))`,
  `CREATE TABLE IF NOT EXISTS account_setup (token_hash VARCHAR PRIMARY KEY, user_id VARCHAR NOT NULL, created_by VARCHAR, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ)`,
  // One access sync at a time across server instances (lib/access-sync.mjs).
  `CREATE TABLE IF NOT EXISTS app_lock (name VARCHAR PRIMARY KEY, holder VARCHAR NOT NULL, again BOOLEAN NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`,
  // Who changed what in the admin portal, newest first.
  `CREATE TABLE IF NOT EXISTS audit_event (id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, actor_id VARCHAR, actor_label VARCHAR, action VARCHAR NOT NULL, target_id VARCHAR, target_label VARCHAR, detail JSON)`,
  'CREATE INDEX IF NOT EXISTS audit_event_created_idx ON audit_event (created_at)',
];

// Non-secret app settings an administrator saves in the portal, one JSON value per name
// (lib/model-settings.mjs). Credentials never go here.
const SETTING_TABLES = [
  'CREATE TABLE IF NOT EXISTS app_setting (name VARCHAR PRIMARY KEY, value JSON NOT NULL, updated_at TIMESTAMPTZ NOT NULL, updated_by VARCHAR)',
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
  return [...tables, ...indexes, ...CHAT_TABLES, ...ACCESS_TABLES, ...SETTING_TABLES];
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
