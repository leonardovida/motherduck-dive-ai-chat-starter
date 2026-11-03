import pg from 'pg';

// The app store holds accounts, sessions and saved conversations in one MotherDuck database,
// reached through the Postgres endpoint with a read-write token scoped to that database.
// It is separate from the read-only chat identity, which can never write.
export const DEFAULT_APP_DATABASE = 'dive_chat_app';
const DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export const appStoreConfigured = (env = process.env) => Boolean(String(env.MOTHERDUCK_APP_TOKEN ?? '').trim());

export function appDatabase(env = process.env) {
  const name = String(env.APP_DATABASE ?? '').trim() || DEFAULT_APP_DATABASE;
  if (!DATABASE_NAME.test(name)) throw new Error('APP_DATABASE must be a plain database name such as dive_chat_app.');
  return name;
}

export function appConnection(env = process.env, database = appDatabase(env)) {
  return {
    host: env.MOTHERDUCK_PG_HOST || 'pg.us-east-1-aws.motherduck.com', port: 5432, user: 'postgres', password: env.MOTHERDUCK_APP_TOKEN, database,
    ssl: { rejectUnauthorized: true }, application_name: 'dive-ai-chat-starter-app', connectionTimeoutMillis: 15000, query_timeout: 15000, keepAlive: true,
  };
}

// Route bundles can load this module more than once, so the pool lives on globalThis.
export function appPool(env = process.env) {
  if (!appStoreConfigured(env)) throw new Error('app_store_not_configured');
  globalThis.__diveChatAppPool ??= new pg.Pool({ ...appConnection(env), max: 4, idleTimeoutMillis: 10000 });
  globalThis.__diveChatAppPool.on?.('error', () => {});
  return globalThis.__diveChatAppPool;
}

export const appQuery = async (text, values = [], env = process.env) => (await appPool(env).query(text, values)).rows;
