import { createHash, randomBytes } from 'node:crypto';
import { appQuery } from './app-db.mjs';
import { appBaseURL, getAuth } from './auth.mjs';
import { createGroupStore } from './groups.mjs';

// One-time links that let a new person choose their own password, so administrators never
// have to send one. Only a SHA-256 of the token is stored; the link itself is shown once.
// The token travels in the URL fragment (#setup=...), which browsers never send to a server
// or put in a Referer header.
export const SETUP_DAYS = 7;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = token => createHash('sha256').update(token).digest('hex');

export const setupUrl = (token, origin) => `${(appBaseURL() || origin || '').replace(/\/$/, '')}/#setup=${token}`;

const isAdminRole = role => String(role ?? '').split(',').map(item => item.trim()).includes('admin');
export const hasSingleSignOn = async (query, userId) => (await query('SELECT 1 AS found FROM account WHERE "userId" = $1 AND "providerId" <> $2 LIMIT 1', [userId, 'credential'])).length > 0;

export function createSetupStore(query = appQuery, { auth = () => getAuth(), groups = createGroupStore(query) } = {}) {
  // A link is only as good as its creator's right to make it, checked again when it is used: an
  // administrator who still is one, or a group manager who still runs every group the person is
  // in, for someone who has since become neither an administrator nor a single sign-on user.
  async function creatorMayAct(createdBy, userId) {
    if (!createdBy) return true; // made from the command line
    const [creator] = await query('SELECT role, banned FROM "user" WHERE id = $1', [createdBy]);
    if (!creator || creator.banned) return false;
    if (isAdminRole(creator.role)) return true;
    return await groups.managerReaches(await groups.managedBy(createdBy), userId) && !await hasSingleSignOn(query, userId);
  }
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
      const [row] = await query('SELECT u.id, u.name, u."displayUsername", u.username, s.created_by FROM account_setup s JOIN "user" u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.used_at IS NULL AND s.expires_at > $2 AND (u.banned IS NULL OR u.banned = false)', [digest(token), now]);
      if (!row || !await creatorMayAct(row.created_by, row.id)) return null;
      return { userId: row.id, name: row.name, username: row.displayUsername || row.username };
    },
    // Unused links stop working, for example when the person is disabled or leaves a group.
    revokeFor: userId => query('DELETE FROM account_setup WHERE user_id = $1 AND used_at IS NULL', [userId]),
    // Who has an unused link, and until when, for the People list.
    async pending() {
      return query('SELECT user_id, max(expires_at) AS expires_at FROM account_setup WHERE used_at IS NULL GROUP BY user_id');
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
