import { appQuery } from './app-db.mjs';
import { getAuth, ssoProviders } from './auth.mjs';
import { createGroupStore, formatDiveAccess, MOTHERDUCK_USER } from './groups.mjs';
import { createSetupStore, hasSingleSignOn, setupUrl } from './account-setup.mjs';

// People management shared by administrators and group managers. Administrators see everyone;
// a manager sees the people in the groups they manage, and changes only those who belong to
// nothing else and are neither administrators nor managers themselves.
export const USERNAME = /^[a-z0-9_.]{2,40}$/;
export const MAX_IMPORT = 200;
export const MAX_LISTED = 1000;
// Why a person was disabled, so a group manager can re-enable only people a manager disabled.
export const BANNED_BY = { admin: 'Disabled by an administrator', manager: 'Disabled by a group manager' };
const COLUMNS = 'id, name, email, username, "displayUsername", role, banned, "banReason", "diveAccess", "chatAccess", "motherduckUser", "lastSignInAt", "createdAt", "updatedAt"';
const isAdminRole = role => String(role ?? '').split(',').map(item => item.trim()).includes('admin');
// The Postgres endpoint needs a type on parameters inside a list, hence the optional cast.
const placeholders = (values, from = 1, cast = '') => values.map((_, index) => `$${index + from}${cast}`).join(', ');

export function createPeopleService(query = appQuery, { auth = () => getAuth(), groups = createGroupStore(query), setup = createSetupStore(query, { groups }) } = {}) {
  const inScope = (scope, userId) => (scope.all ? Promise.resolve(true) : groups.managerReaches(scope.groups, userId));
  return {
    inScope,
    async list(scope) {
      const [users, memberships, allGroups, invites, sso] = await Promise.all([
        scope.all
          ? query(`SELECT ${COLUMNS} FROM "user" ORDER BY "createdAt" DESC LIMIT ${MAX_LISTED + 1}`)
          : scope.groups.length ? query(`SELECT ${COLUMNS} FROM "user" WHERE id IN (SELECT user_id FROM access_group_member WHERE group_id IN (${placeholders(scope.groups)})) ORDER BY "createdAt" DESC LIMIT ${MAX_LISTED + 1}`, scope.groups) : [],
        groups.memberships(), groups.list(), setup.pending().catch(() => []),
        query('SELECT DISTINCT "userId" FROM account WHERE "providerId" <> $1', ['credential']).catch(() => []),
      ]);
      const inviteFor = new Map(invites.map(row => [row.user_id, row.expires_at]));
      const ssoUsers = new Set(sso.map(row => row.userId));
      const visible = scope.all ? users : users.filter(user => !isAdminRole(user.role));
      const membershipsOf = new Map();
      for (const item of memberships) membershipsOf.set(item.userId, [...(membershipsOf.get(item.userId) ?? []), item]);
      // The same rule as groups.managerReaches, computed from rows already loaded.
      const manageable = user => scope.all || (membershipsOf.get(user.id) ?? []).every(item => !item.manager && scope.groups.includes(item.groupId));
      return {
        users: visible.slice(0, MAX_LISTED).map(user => ({
          ...user, manageable: manageable(user), sso: ssoUsers.has(user.id), inviteExpiresAt: inviteFor.get(user.id) ?? null,
          groups: (membershipsOf.get(user.id) ?? []).filter(item => scope.all || scope.groups.includes(item.groupId)).map(({ groupId, manager }) => ({ id: groupId, manager })),
        })),
        truncated: visible.length > MAX_LISTED,
        groups: scope.all ? allGroups : allGroups.filter(group => scope.groups.includes(group.id)),
      };
    },
    // Creates up to MAX_IMPORT people. Each row succeeds or fails on its own, and people
    // without a password get a setup link instead.
    async create({ people, role = 'user', access, groupId, manager = false }, { scope, viewer, origin }) {
      if (!scope.all) {
        if (!groupId || !scope.groups.includes(groupId)) throw Object.assign(new Error('group_not_managed'), { status: 403 });
        role = 'user'; manager = false;
        // People a manager adds see what the group grants and nothing more.
        access = { dives: [], chat: false };
      }
      const group = groupId ? await groups.get(groupId) : null;
      if (groupId && !group) throw Object.assign(new Error('group_not_found'), { status: 404 });
      // Someone added to a group starts with only that group's access unless told otherwise.
      // A group with a service account always decides on its own, so nothing is left to fall
      // back to if the person later leaves it.
      access ??= group ? { dives: [], chat: false } : { dives: '*', chat: true };
      if (group?.serviceAccount) access = { dives: [], chat: false };
      // One lookup for every username and email in the list, rather than one per person.
      const batch = people.slice(0, MAX_IMPORT);
      const names = batch.map(person => String(person.username ?? '').trim().toLowerCase());
      const emails = batch.map((person, index) => String(person.email ?? '').trim().toLowerCase() || `${names[index]}@accounts.invalid`);
      const taken = new Set((await query(`SELECT lower(username) AS username, lower(email) AS email FROM "user" WHERE lower(username) IN (${placeholders(names, 1, '::VARCHAR')}) OR lower(email) IN (${placeholders(emails, names.length + 1, '::VARCHAR')})`, [...names, ...emails]))
        .flatMap(row => [`u:${row.username}`, `e:${row.email}`]));
      const results = [];
      for (const person of batch) {
        const username = String(person.username ?? '').trim().toLowerCase();
        const result = { username };
        try {
          if (!USERNAME.test(username)) throw new Error('invalid_username');
          if (person.password && (person.password.length < 12 || person.password.length > 256)) throw new Error('invalid_password');
          const given = String(person.email ?? '').trim().toLowerCase();
          const email = given || `${username}@accounts.invalid`;
          if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('invalid_email');
          if (taken.has(`u:${username}`) || taken.has(`e:${email}`)) throw new Error('already_exists');
          taken.add(`u:${username}`).add(`e:${email}`);
          const { user } = await auth().api.createUser({ body: { email, name: String(person.name ?? '').trim().slice(0, 120) || username, role: role === 'admin' ? 'admin' : 'user', ...(person.password ? { password: person.password } : {}), data: { username, displayUsername: username } } });
          // Only administrators link people to MotherDuck usernames. An email an administrator
          // typed counts as verified, so single sign-on with that email links to this account;
          // a manager's never does, so a manager cannot pre-claim someone else's sign-in.
          const ownMd = String(person.motherduckUser ?? '').trim();
          await query('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = $2, "motherduckUser" = $3, "emailVerified" = $4 WHERE id = $5',
            [formatDiveAccess(access.dives), Boolean(access.chat), scope.all && MOTHERDUCK_USER.test(ownMd) ? ownMd : null, Boolean(scope.all && given), user.id]);
          if (group) await groups.addMember(group.id, user.id, Boolean(manager));
          result.id = user.id;
          if (!person.password) {
            const { token, expiresAt } = await setup.create(user.id, viewer.id);
            result.setupUrl = setupUrl(token, origin);
            result.expiresAt = expiresAt;
          }
        } catch (error) {
          result.error = ['invalid_username', 'invalid_password', 'invalid_email', 'already_exists'].includes(error.message) ? error.message : 'create_failed';
          if (result.error === 'create_failed') console.error('person_create_failed', error?.body?.code ?? error?.code ?? error?.name);
        }
        results.push(result);
      }
      return results;
    },
    // A manager's setup link would add a password next to someone's single sign-on, so only
    // administrators can make one for people who sign in that way.
    // The same goes for someone whose email an administrator entered while single sign-on is on:
    // their first SSO sign-in would link to the account and keep the manager's password.
    async setupLink(userId, { viewer, origin, scope }) {
      if (!scope.all) {
        const [row] = await query('SELECT "emailVerified" FROM "user" WHERE id = $1', [userId]);
        if (await hasSingleSignOn(query, userId) || (row?.emailVerified && ssoProviders().length)) throw Object.assign(new Error('single_sign_on_user'), { status: 409 });
      }
      const { token, expiresAt } = await setup.create(userId, viewer.id);
      return { setupUrl: setupUrl(token, origin), expiresAt };
    },
    // Disabling ends every session and unused setup link at once; the access sync then removes
    // MotherDuck grants. A manager cannot re-enable someone an administrator disabled.
    async setBanned(userId, banned, { scope }) {
      const ctx = await auth().$context;
      if (!scope.all) {
        // Disabling again would overwrite an administrator's reason, so it is refused as well.
        const [row] = await query('SELECT banned, "banReason" FROM "user" WHERE id = $1', [userId]);
        if (row?.banned && row.banReason !== BANNED_BY.manager) throw Object.assign(new Error('disabled_by_admin'), { status: 403 });
        if (row?.banned && banned) return;
      }
      await ctx.internalAdapter.updateUser(userId, banned ? { banned, banReason: scope.all ? BANNED_BY.admin : BANNED_BY.manager } : { banned, banReason: null, banExpires: null });
      if (banned) { await ctx.internalAdapter.deleteUserSessions(userId); await setup.revokeFor(userId); }
    },
    revokeSetupLinks: userId => setup.revokeFor(userId),
  };
}
