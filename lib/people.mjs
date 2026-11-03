import { appQuery } from './app-db.mjs';
import { getAuth } from './auth.mjs';
import { createGroupStore, formatDiveAccess, MOTHERDUCK_USER } from './groups.mjs';
import { createSetupStore, setupUrl } from './account-setup.mjs';

// People management shared by administrators and group managers. Administrators see everyone;
// a manager sees and changes only the non-administrators in the groups they manage.
export const USERNAME = /^[a-z0-9_.]{2,40}$/;
export const MAX_IMPORT = 200;
const COLUMNS = 'id, name, email, username, "displayUsername", role, banned, "diveAccess", "chatAccess", "motherduckUser", "createdAt", "updatedAt"';
const isAdminRole = role => String(role ?? '').split(',').map(item => item.trim()).includes('admin');

export function createPeopleService(query = appQuery, { auth = () => getAuth(), groups = createGroupStore(query), setup = createSetupStore(query) } = {}) {
  async function inScope(scope, userId) {
    if (scope.all) return true;
    const [row] = await query('SELECT role FROM "user" WHERE id = $1', [userId]);
    if (!row || isAdminRole(row.role)) return false;
    for (const groupId of scope.groups) if (await groups.isMember(groupId, userId)) return true;
    return false;
  }
  return {
    inScope,
    async list(scope) {
      const [users, memberships, allGroups] = await Promise.all([query(`SELECT ${COLUMNS} FROM "user" ORDER BY "createdAt" DESC LIMIT 1000`), groups.memberships(), groups.list()]);
      const visible = scope.all ? users : users.filter(user => !isAdminRole(user.role) && memberships.some(item => item.userId === user.id && scope.groups.includes(item.groupId)));
      return {
        users: visible.map(user => ({ ...user, groups: memberships.filter(item => item.userId === user.id && (scope.all || scope.groups.includes(item.groupId))).map(({ groupId, manager }) => ({ id: groupId, manager })) })),
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
      access ??= group ? { dives: [], chat: false } : { dives: '*', chat: true };
      const results = [];
      for (const person of people.slice(0, MAX_IMPORT)) {
        const username = String(person.username ?? '').trim().toLowerCase();
        const result = { username };
        try {
          if (!USERNAME.test(username)) throw new Error('invalid_username');
          if (person.password && (person.password.length < 12 || person.password.length > 256)) throw new Error('invalid_password');
          const email = String(person.email ?? '').trim().toLowerCase() || `${username}@accounts.invalid`;
          if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('invalid_email');
          if ((await query('SELECT 1 AS found FROM "user" WHERE username = $1 OR email = $2', [username, email])).length) throw new Error('already_exists');
          const { user } = await auth().api.createUser({ body: { email, name: String(person.name ?? '').trim().slice(0, 120) || username, role: role === 'admin' ? 'admin' : 'user', ...(person.password ? { password: person.password } : {}), data: { username, displayUsername: username } } });
          // Only administrators link people to MotherDuck usernames.
          const ownMd = String(person.motherduckUser ?? '').trim();
          await query('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = $2, "motherduckUser" = $3 WHERE id = $4',
            [formatDiveAccess(access.dives), Boolean(access.chat), scope.all && MOTHERDUCK_USER.test(ownMd) ? ownMd : null, user.id]);
          if (group) {
            const other = group.serviceAccount ? await groups.otherDataGroup(user.id, group.id) : null;
            if (!other) await groups.addMember(group.id, user.id, Boolean(manager));
          }
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
    async setupLink(userId, { viewer, origin }) {
      const { token, expiresAt } = await setup.create(userId, viewer.id);
      return { setupUrl: setupUrl(token, origin), expiresAt };
    },
    // Disabling ends every session at once; the access sync then removes MotherDuck grants.
    async setBanned(userId, banned) {
      const ctx = await auth().$context;
      await ctx.internalAdapter.updateUser(userId, { banned, ...(banned ? {} : { banReason: null, banExpires: null }) });
      if (banned) await ctx.internalAdapter.deleteUserSessions(userId);
    },
  };
}
