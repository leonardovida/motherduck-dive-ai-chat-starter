import pg from 'pg';
import { motherDuckConnection } from './pg-connection.mjs';
import { motherDuckApi } from './motherduck-api.mjs';

// Optional MotherDuck administration for the access sync. MOTHERDUCK_ADMIN_TOKEN belongs to an
// Admin who owns the shares behind the Dives. With it the app grants and revokes share access,
// attaches shares for group service accounts, creates those service accounts, and mints their
// short-lived read-only chat tokens. Without it the admin portal shows the SQL to run instead.
//
// The token never reaches the browser, logs or the app database. Errors are reduced to fixed
// codes plus a short, redacted MotherDuck message.
export const adminConfigured = (env = process.env) => Boolean(String(env.MOTHERDUCK_ADMIN_TOKEN ?? '').trim());
export const SHARE_URL = /^md:_share\/[A-Za-z0-9_-]{1,100}\/[0-9a-f-]{32,36}$/i;

export const quoteIdent = name => `"${String(name).replaceAll('"', '""')}"`;
export const quoteLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
export const redact = text => String(text ?? '').replace(/eyJ[\w.-]+/g, '<redacted>').replace(/(token|password)=[^\s&]+/gi, '$1=<redacted>').slice(0, 200);

export class MotherDuckError extends Error {
  constructor(code, detail = '') { super(code); this.code = code; this.detail = redact(detail); }
}

function connection(token, env) {
  // "md:" opens the account's workspace, so ATTACH persists for that account.
  return motherDuckConnection({ env, token, database: 'md:', name: 'dive-ai-chat-starter-access', queryTimeout: 30000 });
}

export function createMotherDuckAdmin(env = process.env, { fetcher = fetch, Client = pg.Client } = {}) {
  const adminToken = () => {
    const token = String(env.MOTHERDUCK_ADMIN_TOKEN ?? '').trim();
    if (!token) throw new MotherDuckError('admin_not_configured');
    return token;
  };
  async function rest(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetcher(`${motherDuckApi(env)}${path}`, {
        method, headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error instanceof MotherDuckError) throw error;
      throw new MotherDuckError('motherduck_unreachable');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new MotherDuckError(`http_${response.status}`, data?.error?.message ?? data?.message ?? '');
    return data;
  }
  async function session(token, run) {
    const client = new Client(connection(token, env));
    client.on?.('error', () => {});
    try {
      await client.connect();
      return await run(async (text) => (await client.query(text)).rows);
    } catch (error) {
      if (error instanceof MotherDuckError) throw error;
      throw new MotherDuckError('sql_failed', error?.message);
    } finally { await client.end().catch(() => {}); }
  }
  const tokenCache = new Map();
  return {
    configured: () => adminConfigured(env),
    createServiceAccount: username => rest('/users', { method: 'POST', body: { username, description: 'Created by the Dive app access sync' } }),
    async createToken(username, { ttl, type, name }) {
      const result = await rest(`/users/${encodeURIComponent(username)}/tokens`, { method: 'POST', body: { name, ttl, token_type: type } });
      if (typeof result?.token !== 'string' || !result.token) throw new MotherDuckError('token_missing');
      return { token: result.token, id: result.id, expiresAt: result.expire_at ? Date.parse(result.expire_at) : Date.now() + ttl * 1000 };
    },
    deleteToken: (username, id) => rest(`/users/${encodeURIComponent(username)}/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // SQL as the owner of the shares (the admin token's account).
    asOwner: run => session(adminToken(), run),
    // SQL as a service account, through a five-minute token that is deleted afterwards.
    async asServiceAccount(username, run) {
      const minted = await this.createToken(username, { ttl: 300, type: 'read_write', name: 'dive-app-access-sync' });
      try { return await session(minted.token, run); }
      finally { await this.deleteToken(username, minted.id).catch(() => {}); }
    },
    // Read-only chat tokens for a data group's service account, reused until five minutes before
    // they expire. read_scaling tokens cannot write, the same guarantee as the shared chat token.
    // Concurrent first requests share one mint.
    async readToken(username) {
      const cached = tokenCache.get(username);
      if (cached?.pending) return (await cached.pending).token;
      if (cached && cached.expiresAt - Date.now() > 300000) return cached.token;
      const pending = this.createToken(username, { ttl: 3600, type: 'read_scaling', name: 'dive-app-chat' });
      tokenCache.set(username, { pending });
      try {
        const minted = await pending;
        tokenCache.set(username, minted);
        return minted.token;
      } catch (error) {
        tokenCache.delete(username);
        throw error;
      }
    },
  };
}

let shared;
export const motherDuckAdmin = (env = process.env) => (env === process.env ? (shared ??= createMotherDuckAdmin(env)) : createMotherDuckAdmin(env));
