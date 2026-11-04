import { randomUUID } from 'node:crypto';
import { appQuery } from './app-db.mjs';

// Groups give several people the same access at once: a team inside the company, or one
// customer of a company that shares its Dives. Access is additive: a person sees the Dives
// granted to them plus those of every group they belong to.
//
// A group may also carry a MotherDuck service account. Members of such a group (a "data group")
// open every Dive and ask every question as that service account, optionally against the
// group's own databases, so MotherDuck itself keeps one customer's data from another. Because
// every member shares that account, a data group's members get exactly the group's Dives and
// chat: one member's own access or other groups must never widen what the account can read.
export const GROUP_ID = /^[a-zA-Z0-9_-]{8,64}$/;
export const SERVICE_ACCOUNT = /^[a-z][a-z0-9_]{2,62}$/;
// MotherDuck usernames can include dots, dashes, plus signs and @; they are always quoted in SQL.
export const MOTHERDUCK_USER = /^[A-Za-z0-9_.+@-]{1,128}$/;
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const DIVE_KEY = /^[a-z][a-z0-9-]{0,39}$/;

export const isAdminRole = role => String(role ?? '').split(',').map(item => item.trim()).includes('admin');

export function parseDiveAccess(raw) {
  // Access fails closed: a missing value means no Dives, like an empty one. New people get the
  // column default ('*') when their account is created.
  const text = String(raw ?? '').trim();
  if (text === '*') return '*';
  return [...new Set(text.split(',').map(key => key.trim()).filter(key => DIVE_KEY.test(key)))];
}
export const formatDiveAccess = dives => (dives === '*' ? '*' : [...new Set(dives)].join(','));

// Per-Dive database overrides for a data group: { diveKey: [{ alias, url }] }.
export function parseGroupResources(raw) {
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return {}; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, list] of Object.entries(value)) {
    if (!DIVE_KEY.test(key) || !Array.isArray(list)) continue;
    const entries = list.filter(item => ALIAS.test(item?.alias ?? '') && /^md:[^\s'"]{1,300}$/.test(item?.url ?? '')).map(({ alias, url }) => ({ alias, url }));
    if (entries.length) out[key] = entries.slice(0, 20);
  }
  return out;
}

export function groupFromRow(row) {
  return {
    id: row.id, name: row.name, description: row.description ?? '',
    dives: parseDiveAccess(row.dive_access), chat: row.chat_access !== false,
    serviceAccount: row.service_account || null, resources: parseGroupResources(row.resources),
    monthlyTokenCap: row.monthly_token_cap == null ? null : Number(row.monthly_token_cap),
    ...(row.manager != null ? { manager: Boolean(row.manager) } : {}),
    ...(row.member_count != null ? { memberCount: Number(row.member_count) } : {}),
  };
}

const unionDives = (a, b) => (a === '*' || b === '*' ? '*' : [...new Set([...a, ...b])]);

// Folds group memberships into a viewer built from the person's own row.
export function applyGroups(viewer, memberships = []) {
  if (!viewer) return viewer;
  // At most one data group per person is enforced when members are added; ties break by id
  // so the identity can never flip between requests.
  const data = memberships.filter(group => group.serviceAccount).sort((a, b) => a.id.localeCompare(b.id))[0];
  let dives = viewer.dives, chat = viewer.chat;
  if (data) ({ dives, chat } = data);
  else for (const group of memberships) { dives = unionDives(dives, group.dives); chat = chat || group.chat; }
  return {
    ...viewer, dives, chat,
    groups: memberships.map(group => ({ id: group.id, name: group.name, manager: Boolean(group.manager), monthlyTokenCap: group.monthlyTokenCap ?? null })),
    managerOf: memberships.filter(group => group.manager).map(group => group.id),
    dataGroup: data ? { id: data.id, name: data.name, serviceAccount: data.serviceAccount, resources: data.resources } : null,
  };
}

// The MotherDuck identity and databases one viewer uses for one Dive. Without a data group this
// is the Dive's own configuration. With one, the group's service account replaces the shared
// one, and the group's databases replace (or add to) the Dive's by alias.
export function diveIdentity(dive, viewer) {
  const group = viewer?.dataGroup;
  if (!group) return { username: dive.username, resources: dive.resources, chat: dive.chat, serviceAccount: null };
  const overrides = group.resources?.[dive.key] ?? [];
  const resources = [...dive.resources.filter(resource => !overrides.some(item => item.alias === resource.alias)), ...overrides];
  // The group's service account holds no long-lived chat token. Chat reads the Dive's chat
  // database under the same alias, attached to that service account by the access sync.
  const database = dive.chat?.database;
  const chat = database && resources.some(resource => resource.alias === database) ? { database, serviceAccount: group.serviceAccount } : null;
  return { username: group.serviceAccount, resources, chat, serviceAccount: group.serviceAccount };
}

export function createGroupStore(query = appQuery) {
  const now = () => new Date();
  return {
    async forUser(userId) {
      const rows = await query('SELECT g.*, m.manager FROM access_group_member m JOIN access_group g ON g.id = m.group_id WHERE m.user_id = $1 ORDER BY g.name', [userId]);
      return rows.map(groupFromRow);
    },
    async list() {
      const rows = await query('SELECT g.*, (SELECT count(*) FROM access_group_member m JOIN "user" u ON u.id = m.user_id WHERE m.group_id = g.id) AS member_count FROM access_group g ORDER BY g.name');
      return rows.map(groupFromRow);
    },
    async get(id) {
      const [row] = await query('SELECT * FROM access_group WHERE id = $1', [id]);
      return row ? groupFromRow(row) : null;
    },
    async memberships() {
      return (await query('SELECT m.group_id, m.user_id, m.manager FROM access_group_member m JOIN "user" u ON u.id = m.user_id')).map(row => ({ groupId: row.group_id, userId: row.user_id, manager: Boolean(row.manager) }));
    },
    async create({ name, description = '', dives, chat, serviceAccount = null, resources = {}, monthlyTokenCap = null }) {
      const id = randomUUID(), at = now();
      await query('INSERT INTO access_group (id, name, description, dive_access, chat_access, service_account, resources, created_at, updated_at, monthly_token_cap) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)',
        [id, name, description, formatDiveAccess(dives), chat, serviceAccount, JSON.stringify(resources), at, monthlyTokenCap]);
      return id;
    },
    async update(id, { name, description = '', dives, chat, serviceAccount = null, resources = {}, monthlyTokenCap = null }) {
      const rows = await query('UPDATE access_group SET name = $1, description = $2, dive_access = $3, chat_access = $4, service_account = $5, resources = $6, updated_at = $7, monthly_token_cap = $8 WHERE id = $9 RETURNING id',
        [name, description, formatDiveAccess(dives), chat, serviceAccount, JSON.stringify(resources), now(), monthlyTokenCap, id]);
      return rows.length > 0;
    },
    async remove(id) {
      await query('DELETE FROM access_group_member WHERE group_id = $1', [id]);
      return (await query('DELETE FROM access_group WHERE id = $1 RETURNING id', [id])).length > 0;
    },
    // Joining a group with a service account clears the person's own access: the group decides
    // what they see while they are in it, and leaving it must not fall back to the shared
    // identity's Dives, which may hold the deploying company's own data.
    async addMember(groupId, userId, manager = false) {
      await query('INSERT INTO access_group_member (group_id, user_id, manager, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, user_id) DO UPDATE SET manager = EXCLUDED.manager', [groupId, userId, manager, now()]);
      const [group] = await query('SELECT service_account FROM access_group WHERE id = $1', [groupId]);
      if (group?.service_account) await query('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = false WHERE id = $2', ['', userId]);
    },
    // When a group gains a service account, its members' own access no longer applies (see addMember).
    clearMembersOwnAccess: groupId => query('UPDATE "user" SET "diveAccess" = $1, "chatAccess" = false WHERE id IN (SELECT user_id FROM access_group_member WHERE group_id = $2)', ['', groupId]),
    async removeMember(groupId, userId) {
      return (await query('DELETE FROM access_group_member WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [groupId, userId])).length > 0;
    },
    // A person may belong to one data group only, so their MotherDuck identity is never ambiguous.
    async otherDataGroup(userId, exceptGroupId) {
      const [row] = await query('SELECT g.name FROM access_group_member m JOIN access_group g ON g.id = m.group_id WHERE m.user_id = $1 AND g.id <> $2 AND g.service_account IS NOT NULL LIMIT 1', [userId, exceptGroupId]);
      return row?.name ?? null;
    },
    async membersInOtherDataGroups(groupId) {
      return (await query('SELECT DISTINCT m.user_id FROM access_group_member m JOIN access_group_member o ON o.user_id = m.user_id AND o.group_id <> m.group_id JOIN access_group g ON g.id = o.group_id WHERE m.group_id = $1 AND g.service_account IS NOT NULL', [groupId])).map(row => row.user_id);
    },
    async isMember(groupId, userId) {
      return (await query('SELECT 1 AS found FROM access_group_member WHERE group_id = $1 AND user_id = $2', [groupId, userId])).length > 0;
    },
    // Two groups sharing one service account would read each other's data.
    async serviceAccountTaken(serviceAccount, exceptGroupId = '') {
      return (await query('SELECT 1 AS found FROM access_group WHERE service_account = $1 AND id <> $2 LIMIT 1', [serviceAccount, exceptGroupId])).length > 0;
    },
    async byName(name) {
      const [row] = await query('SELECT * FROM access_group WHERE lower(name) = lower($1) ORDER BY id LIMIT 1', [name]);
      return row ? groupFromRow(row) : null;
    },
    // A group manager may act on a person only when every group that person belongs to is one
    // the manager runs, and the person is neither an administrator nor a manager. Someone who is
    // also in another customer's group, or who manages a group, stays with the administrators.
    async managerReaches(managedGroupIds, userId) {
      const [user] = await query('SELECT role FROM "user" WHERE id = $1', [userId]);
      if (!user || isAdminRole(user.role)) return false;
      const rows = await query('SELECT group_id, manager FROM access_group_member WHERE user_id = $1', [userId]);
      return rows.length > 0 && rows.every(row => !row.manager && managedGroupIds.includes(row.group_id));
    },
    async managedBy(userId) {
      return (await query('SELECT group_id FROM access_group_member WHERE user_id = $1 AND manager = true', [userId])).map(row => row.group_id);
    },
  };
}
