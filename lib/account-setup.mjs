import { createHash, randomBytes } from 'node:crypto';
import { appQuery } from './app-db.mjs';
import { appBaseURL, getAuth } from './auth.mjs';

// One-time links that let a new person choose their own password, so administrators never
// have to send one. Only a SHA-256 of the token is stored; the link itself is shown once.
// The token travels in the URL fragment (#setup=...), which browsers never send to a server
// or put in a Referer header.
export const SETUP_DAYS = 7;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = token => createHash('sha256').update(token).digest('hex');

export const setupUrl = (token, origin) => `${(appBaseURL() || origin || '').replace(/\/$/, '')}/#setup=${token}`;

export function createSetupStore(query = appQuery, { auth = () => getAuth() } = {}) {
  return {
    // Replaces any earlier unused link for the same person.
    async create(userId, createdBy, now = new Date()) {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + SETUP_DAYS * 86400000);
      await query('DELETE FROM account_setup WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await query('INSERT INTO account_setup (token_hash, user_id, created_by, expires_at) VALUES ($1, $2, $3, $4)', [digest(token), userId, createdBy ?? null, expiresAt]);
      return { token, expiresAt };
    },
    async peek(token, now = new Date()) {
      if (!TOKEN.test(token ?? '')) return null;
      const [row] = await query('SELECT u.id, u.name, u."displayUsername", u.username FROM account_setup s JOIN "user" u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.used_at IS NULL AND s.expires_at > $2 AND (u.banned IS NULL OR u.banned = false)', [digest(token), now]);
      return row ? { userId: row.id, name: row.name, username: row.displayUsername || row.username } : null;
    },
    // Claims the link first, so two tabs cannot both use it, then sets the password and signs
    // the person out everywhere else.
    async redeem(token, password, now = new Date()) {
      const person = await this.peek(token, now);
      if (!person) return null;
      const claimed = await query('UPDATE account_setup SET used_at = $1 WHERE token_hash = $2 AND used_at IS NULL RETURNING user_id', [now, digest(token)]);
      if (!claimed.length) return null;
      const ctx = await auth().$context;
      const hash = await ctx.password.hash(password);
      const accounts = await ctx.internalAdapter.findAccounts(person.userId);
      if (accounts.some(account => account.providerId === 'credential')) await ctx.internalAdapter.updatePassword(person.userId, hash);
      else await ctx.internalAdapter.linkAccount({ providerId: 'credential', accountId: person.userId, password: hash, userId: person.userId });
      await ctx.internalAdapter.deleteUserSessions(person.userId);
      return person;
    },
  };
}
