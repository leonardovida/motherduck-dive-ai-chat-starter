import pg from 'pg';
import { motherDuckConnection } from './pg-connection.mjs';

// The app store holds accounts, sessions and saved conversations in one MotherDuck database,
// reached through the Postgres endpoint with a read-write token scoped to that database.
// It is separate from the read-only chat identity, which can never write.
export const DEFAULT_APP_DATABASE = 'dive_chat_app';
const DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

// SHARED_PASSWORD_ADMIN=true keeps the one shared password as a built-in administrator sign-in,
// next to personal accounts that administrator creates in the portal (lib/auth.mjs
// sharedAdminAccounts). For a demo where the presenter acts as the administrator. In this mode
// the store may use the embed token when no app token is set, and it creates and migrates itself
// on first use.
export const sharedAdmin = (env = process.env) => String(env.SHARED_PASSWORD_ADMIN ?? '').trim().toLowerCase() === 'true';
const appToken = (env = process.env) => String(env.MOTHERDUCK_APP_TOKEN ?? '').trim() || (sharedAdmin(env) ? String(env.MOTHERDUCK_EMBED_TOKEN ?? '').trim() : '');
export const appStoreConfigured = (env = process.env) => Boolean(appToken(env));

export function appDatabase(env = process.env) {
  const name = String(env.APP_DATABASE ?? '').trim() || DEFAULT_APP_DATABASE;
  if (!DATABASE_NAME.test(name)) throw new Error('APP_DATABASE must be a plain database name such as dive_chat_app.');
  return name;
}

export function appConnection(env = process.env, database = appDatabase(env)) {
  return motherDuckConnection({ env, token: appToken(env), database, name: 'dive-ai-chat-starter-app' });
}

// Route bundles can load this module more than once, so the pool lives on globalThis.
export function appPool(env = process.env) {
  if (!appStoreConfigured(env)) throw new Error('app_store_not_configured');
  if (!globalThis.__diveChatAppPool) {
    globalThis.__diveChatAppPool = new pg.Pool({ ...appConnection(env), max: 4, idleTimeoutMillis: 10000 });
    // An idle client that drops is replaced on the next query; listen once so it cannot crash the server.
    globalThis.__diveChatAppPool.on?.('error', () => {});
  }
  return globalThis.__diveChatAppPool;
}

// The app database is brought up to date on first use, in every mode: the check is one query per
// server instance, and the additive migration (lib/app-db-schema.mjs, the same statements as
// `npm run db:migrate`) runs only when the newest view, or the newest column of chat_queries, is
// missing. So a database migrated by an earlier release keeps saving answers after an upgrade.
// Shared-password admin has no setup step at all, so there the database itself is also created.
// A failure is remembered for STORE_RETRY_MS, so while MotherDuck is unreachable each request fails
// at once (sign-in says it is unavailable) instead of waiting for its own connection timeout.
export const STORE_RETRY_MS = 30000;
export async function ensureAppStore(env = process.env, { Client = pg.Client, now = Date.now } = {}) {
  const failed = globalThis.__diveChatAppFailed;
  if (!globalThis.__diveChatAppReady && failed && now() - failed.at < STORE_RETRY_MS) throw failed.error;
  globalThis.__diveChatAppReady ??= (async () => {
    if (sharedAdmin(env)) {
      const probe = new Client(appConnection(env));
      try { await probe.connect(); }
      catch (error) {
        if (error.code !== '3D000') throw error;
        const bootstrap = new Client(appConnection(env, 'my_db'));
        try { await bootstrap.connect(); await bootstrap.query(`CREATE DATABASE IF NOT EXISTS ${appDatabase(env)}`); }
        finally { await bootstrap.end().catch(() => {}); }
      } finally { await probe.end().catch(() => {}); }
    }
    const pool = appPool(env);
    const schema = await import('./app-db-schema.mjs');
    const { rows } = await pool.query(`SELECT 1 FROM duckdb_columns() WHERE database_name = current_database() AND table_name = 'chat_queries' AND column_name = '${schema.CHAT_QUERIES_MARKER}' LIMIT 1`);
    if (rows.length) return;
    const { authOptions } = await import('./auth.mjs');
    await schema.migrateAppDatabase(text => pool.query(text), authOptions(env));
  })().then(() => { globalThis.__diveChatAppFailed = undefined; }, error => {
    globalThis.__diveChatAppReady = undefined;
    globalThis.__diveChatAppFailed = { at: now(), error };
    throw error;
  });
  return globalThis.__diveChatAppReady;
}

// Accounts mode: the database is the operator's (`npm run db:migrate`), so a failed upgrade is
// logged once per attempt and the request goes on, rather than taking down sign-in or chat.
// Shared-password admin: the store may not exist yet, so its failure is the request's failure.
let loggedFailure = null;
async function readyAppStore(env) {
  if (sharedAdmin(env)) return ensureAppStore(env);
  if (!appStoreConfigured(env)) return;
  try { await ensureAppStore(env); }
  catch (error) {
    if (error === loggedFailure) return;
    loggedFailure = error;
    console.error('app_store_upgrade_failed', error?.code ?? error?.name, String(error?.message ?? '').split('\n')[0].slice(0, 200));
  }
}

// The database Better Auth is given. Every connection Better Auth opens first waits for the
// first-use check above; after that it is an already settled promise. Better Auth treats any
// object with connect() as a Postgres pool.
export function authDatabase(env = process.env) {
  return {
    connect: async () => { await readyAppStore(env); return appPool(env).connect(); },
    end: () => appPool(env).end(),
    on() {},
  };
}

export const appQuery = async (text, values = [], env = process.env) => {
  await readyAppStore(env);
  return (await appPool(env).query(text, values)).rows;
};
