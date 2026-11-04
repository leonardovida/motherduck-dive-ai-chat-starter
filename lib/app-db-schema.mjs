import { getSchema } from 'better-auth/db';

// DuckDB DDL for the app store. Better Auth's own migrator introspects Postgres catalog functions
// that MotherDuck does not have, so the tables are generated here from Better Auth's schema.
// Statements are idempotent: run `npm run db:migrate` after every upgrade.
const TYPES = { string: 'VARCHAR', boolean: 'BOOLEAN', date: 'TIMESTAMPTZ', number: 'BIGINT', json: 'JSON', 'string[]': 'VARCHAR[]', 'number[]': 'BIGINT[]' };
export const quoteName = name => `"${String(name).replaceAll('"', '""')}"`;

// The app's own tables. Each is declared once: `npm run db:migrate` creates it, and adds any
// column a newer version declares to an existing table (added columns stay nullable).
const APP_TABLES = {
  chat_conversation: {
    key: 'id VARCHAR PRIMARY KEY',
    columns: {
      user_id: 'VARCHAR NOT NULL', user_label: 'VARCHAR', dive_key: 'VARCHAR NOT NULL', title: 'VARCHAR',
      // In a public demo every visitor shares one account, so a conversation also belongs to a session.
      session_id: 'VARCHAR',
      created_at: 'TIMESTAMPTZ NOT NULL', updated_at: 'TIMESTAMPTZ NOT NULL',
    },
  },
  // Questions and answers. reply_to links an answer to its question. A question keeps the asker's
  // groups and the Dive state; an answer keeps its outcome, model, usage and rating. topic and
  // data_gap are set when an administrator groups questions into topics.
  chat_message: {
    key: 'id VARCHAR PRIMARY KEY',
    columns: {
      conversation_id: 'VARCHAR NOT NULL', role: 'VARCHAR NOT NULL', content: 'VARCHAR NOT NULL', reply_to: 'VARCHAR', status: 'VARCHAR',
      tools: 'JSON', model_tier: 'VARCHAR', model_provider: 'VARCHAR', model_id: 'VARCHAR', route_reason: 'VARCHAR',
      input_tokens: 'BIGINT', output_tokens: 'BIGINT', worked_ms: 'BIGINT',
      feedback: 'INTEGER', feedback_at: 'TIMESTAMPTZ', feedback_reason: 'VARCHAR', feedback_note: 'VARCHAR',
      dive_state: 'JSON', group_names: 'JSON', group_ids: 'JSON', topic: 'VARCHAR', data_gap: 'BOOLEAN', classified_at: 'TIMESTAMPTZ',
      created_at: 'TIMESTAMPTZ NOT NULL',
    },
  },
  // Groups (monthly_token_cap is the AI chat allowance in tokens; empty means no limit), the
  // MotherDuck grants the app made, and one-time password setup links.
  access_group: {
    key: 'id VARCHAR PRIMARY KEY',
    columns: { name: 'VARCHAR NOT NULL', description: 'VARCHAR', dive_access: 'VARCHAR NOT NULL', chat_access: 'BOOLEAN NOT NULL', service_account: 'VARCHAR', resources: 'JSON', monthly_token_cap: 'BIGINT', created_at: 'TIMESTAMPTZ NOT NULL', updated_at: 'TIMESTAMPTZ NOT NULL' },
  },
  access_group_member: {
    key: 'PRIMARY KEY (group_id, user_id)',
    columns: { group_id: 'VARCHAR NOT NULL', user_id: 'VARCHAR NOT NULL', manager: 'BOOLEAN NOT NULL', created_at: 'TIMESTAMPTZ NOT NULL' },
  },
  md_access_grant: {
    key: 'PRIMARY KEY (grantee, share_url)',
    columns: { grantee: 'VARCHAR NOT NULL', grantee_kind: 'VARCHAR NOT NULL', share_url: 'VARCHAR NOT NULL', alias: 'VARCHAR', share_name: 'VARCHAR', state: 'VARCHAR NOT NULL', granted_by_app: 'BOOLEAN NOT NULL', attached_by_app: 'BOOLEAN NOT NULL', detail: 'VARCHAR', updated_at: 'TIMESTAMPTZ NOT NULL' },
  },
  account_setup: {
    key: 'token_hash VARCHAR PRIMARY KEY',
    columns: { user_id: 'VARCHAR NOT NULL', created_by: 'VARCHAR', expires_at: 'TIMESTAMPTZ NOT NULL', used_at: 'TIMESTAMPTZ' },
  },
  // One access sync at a time across server instances (lib/access-sync.mjs).
  app_lock: { key: 'name VARCHAR PRIMARY KEY', columns: { holder: 'VARCHAR NOT NULL', again: 'BOOLEAN NOT NULL', expires_at: 'TIMESTAMPTZ NOT NULL' } },
  // Scheduled jobs that must run once, such as the weekly digest.
  app_job: { key: 'name VARCHAR PRIMARY KEY', columns: { ran_at: 'TIMESTAMPTZ NOT NULL' } },
  // Who changed what in the admin portal, newest first.
  audit_event: {
    key: 'id VARCHAR PRIMARY KEY',
    columns: { created_at: 'TIMESTAMPTZ NOT NULL', actor_id: 'VARCHAR', actor_label: 'VARCHAR', action: 'VARCHAR NOT NULL', target_id: 'VARCHAR', target_label: 'VARCHAR', detail: 'JSON' },
  },
  // Non-secret settings an administrator saves in the portal, one JSON value per name
  // (lib/model-settings.mjs). Credentials never go here.
  app_setting: { key: 'name VARCHAR PRIMARY KEY', columns: { value: 'JSON NOT NULL', updated_at: 'TIMESTAMPTZ NOT NULL', updated_by: 'VARCHAR' } },
};

const APP_INDEXES = [
  'CREATE INDEX IF NOT EXISTS chat_message_conversation_idx ON chat_message (conversation_id)',
  'CREATE INDEX IF NOT EXISTS chat_conversation_user_idx ON chat_conversation (user_id)',
  'CREATE INDEX IF NOT EXISTS access_group_member_user_idx ON access_group_member (user_id)',
  'CREATE INDEX IF NOT EXISTS audit_event_created_idx ON audit_event (created_at)',
];

// One row per question with its answer, for the admin Questions tab and for direct SQL.
const CHAT_QUESTIONS_VIEW = `CREATE OR REPLACE VIEW chat_questions AS
   SELECT q.id AS question_id, q.conversation_id, c.user_id, c.user_label, c.dive_key, q.content AS question, q.created_at AS asked_at,
          q.dive_state, q.group_names, q.group_ids, q.topic, q.data_gap, q.classified_at,
          a.id AS answer_id, a.content AS answer, CASE WHEN a.id IS NULL THEN 'unanswered' ELSE a.status END AS status,
          a.feedback, a.feedback_reason, a.feedback_note, a.model_tier, a.model_provider, a.model_id, a.route_reason, a.input_tokens, a.output_tokens, a.worked_ms,
          json_array_length(a.tools)::INTEGER AS tool_calls, a.created_at AS answered_at
     FROM chat_message q
     JOIN chat_conversation c ON c.id = q.conversation_id
     LEFT JOIN chat_message a ON a.reply_to = q.id AND a.role = 'assistant'
    WHERE q.role = 'user'`;

// A composite key is a table constraint; a single-column key is the first column.
const tableDefinition = ({ key, columns }) => (key.startsWith('PRIMARY KEY')
  ? [...Object.entries(columns).map(([column, type]) => `${column} ${type}`), key]
  : [key, ...Object.entries(columns).map(([column, type]) => `${column} ${type}`)]).join(', ');
// Required columns exist from the table's creation, so only nullable ones are ever added later.
const appTableStatements = () => Object.entries(APP_TABLES).flatMap(([name, table]) => [
  `CREATE TABLE IF NOT EXISTS ${name} (${tableDefinition(table)})`,
  ...Object.entries(table.columns).filter(([, type]) => !/NOT NULL/i.test(type)).map(([column, type]) => `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${column} ${type}`),
]);

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
  return [...tables, ...indexes, ...appTableStatements(), ...APP_INDEXES, CHAT_QUESTIONS_VIEW];
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
