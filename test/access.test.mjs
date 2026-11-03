import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGroups, diveIdentity, groupFromRow, parseDiveAccess, parseGroupResources } from '../lib/groups.mjs';
import { canManagePeople, getViewer, publicViewer, viewerFromUser } from '../lib/viewer.mjs';
import { applyPlan, desiredGrants, manualSql, planSync, syncAccess } from '../lib/access-sync.mjs';
import { createMotherDuckAdmin, quoteIdent } from '../lib/motherduck-admin.mjs';
import { createSetupStore, setupUrl } from '../lib/account-setup.mjs';
import { createStatements } from '../lib/app-db-schema.mjs';
import { authOptions } from '../lib/auth.mjs';

const SHARE_A = 'md:_share/acme_data/0123456789abcdef0123456789abcdef';
const SHARE_DEMO = 'md:_share/demo_data/fedcba9876543210fedcba9876543210';
const dives = [
  { key: 'overview', username: 'embed_sa', resources: [], chat: { token: 't', database: 'sample_data' } },
  { key: 'explorer', username: 'embed_sa', resources: [{ alias: 'demo', url: SHARE_DEMO }], chat: { token: 't', database: 'demo' } },
];
const acme = { id: 'g-acme', name: 'Acme', dives: ['explorer'], chat: true, serviceAccount: 'acme_viewer', resources: { explorer: [{ alias: 'demo', url: SHARE_A }] } };
const finance = { id: 'g-fin', name: 'Finance', dives: ['overview'], chat: false, serviceAccount: null, resources: {} };

test('an empty Dive list means none, so unticking every Dive no longer grants all of them', () => {
  assert.equal(parseDiveAccess(null), '*');
  assert.equal(parseDiveAccess(undefined), '*');
  assert.equal(parseDiveAccess('*'), '*');
  assert.deepEqual(parseDiveAccess(''), []);
  assert.deepEqual(parseDiveAccess('overview, explorer,overview,BAD KEY'), ['overview', 'explorer']);
  assert.deepEqual(viewerFromUser({ id: 'u', diveAccess: '' }).dives, []);
});

test('group access adds to personal access, and one data group sets the MotherDuck identity', () => {
  const own = viewerFromUser({ id: 'u1', diveAccess: '', chatAccess: false });
  const viewer = applyGroups(own, [{ ...finance, manager: true }, acme]);
  assert.deepEqual(viewer.dives.sort(), ['explorer', 'overview']);
  assert.equal(viewer.chat, true);
  assert.deepEqual(viewer.managerOf, ['g-fin']);
  assert.equal(viewer.dataGroup.serviceAccount, 'acme_viewer');
  assert.equal(canManagePeople(viewer), true);
  assert.deepEqual(publicViewer(viewer).groups, ['Finance', 'Acme']);
  assert.equal(applyGroups(viewerFromUser({ id: 'u2', diveAccess: 'overview' }), [{ ...acme, dives: '*' }]).dives, '*');
});

test('a data group replaces the Dive identity and databases by alias, and chat follows the alias', () => {
  const viewer = applyGroups(viewerFromUser({ id: 'u', diveAccess: '' }), [acme]);
  const explorer = diveIdentity(dives[1], viewer);
  assert.equal(explorer.username, 'acme_viewer');
  assert.deepEqual(explorer.resources, [{ alias: 'demo', url: SHARE_A }]);
  assert.deepEqual(explorer.chat, { database: 'demo', serviceAccount: 'acme_viewer' });
  assert.equal(explorer.chat.token, undefined, 'the shared chat token is never reused for a group');
  // Overview's chat database is not attached for the group, so chat stays off there.
  assert.equal(diveIdentity(dives[0], viewer).chat, null);
  // Without a data group the Dive's own configuration is used unchanged.
  assert.equal(diveIdentity(dives[1], viewerFromUser({ id: 'x' })).username, 'embed_sa');
});

test('group rows and database overrides are validated when read', () => {
  assert.deepEqual(parseGroupResources('{"explorer":[{"alias":"demo","url":"md:_share/x/abc"},{"alias":"bad alias","url":"md:y"},{"alias":"z","url":"https://evil"}],"Bad":[{"alias":"a","url":"md:a"}]}'), { explorer: [{ alias: 'demo', url: 'md:_share/x/abc' }] });
  assert.deepEqual(parseGroupResources('not json'), {});
  const group = groupFromRow({ id: 'g', name: 'G', dive_access: '', chat_access: true, service_account: '', resources: null, member_count: '3' });
  assert.deepEqual(group.dives, []);
  assert.equal(group.serviceAccount, null);
  assert.equal(group.memberCount, 3);
});

test('a failed group lookup leaves the person with no Dives rather than the wrong data', async () => {
  const auth = { api: { getSession: async () => ({ user: { id: 'u', role: 'user', diveAccess: '*' }, session: { id: 's' } }) } };
  const env = { MOTHERDUCK_APP_TOKEN: 't' };
  const broken = { forUser: async () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); } };
  const locked = await getViewer({ cookie: 'ok' }, env, auth, { groups: broken });
  assert.deepEqual(locked.dives, []);
  assert.equal(locked.chat, false);
  const member = await getViewer({ cookie: 'ok' }, env, auth, { groups: { forUser: async () => [acme] } });
  assert.equal(member.dataGroup.serviceAccount, 'acme_viewer');
});

test('wanted grants follow people, groups and the Dives they can open', () => {
  const users = [
    { id: 'maya', diveAccess: 'explorer', motherduckUser: 'maya@example.com' },
    { id: 'gone', diveAccess: '*', motherduckUser: 'gone@example.com', banned: true },
    { id: 'lena', diveAccess: '', chatAccess: false },
    { id: 'nomd', diveAccess: '*' },
  ];
  const memberships = [{ userId: 'lena', groupId: 'g-acme', manager: false }];
  const want = desiredGrants({ users, groups: [acme, finance], memberships, dives });
  assert.deepEqual(want.map(item => [item.grantee, item.kind, item.url, item.alias]), [
    ['acme_viewer', 'service_account', SHARE_A, 'demo'],
    ['maya@example.com', 'user', SHARE_DEMO, 'demo'],
  ]);
});

test('the plan grants what is missing and removes only rows the app recorded', () => {
  const desired = [{ grantee: 'acme_viewer', kind: 'service_account', url: SHARE_A, alias: 'demo' }, { grantee: 'maya', kind: 'user', url: SHARE_DEMO, alias: 'demo' }];
  const recorded = [
    { grantee: 'maya', share_url: SHARE_DEMO, alias: 'demo', state: 'synced' },
    { grantee: 'old', share_url: SHARE_DEMO, alias: 'demo', state: 'synced', granted_by_app: true, share_name: 'demo_share' },
  ];
  const plan = planSync(desired, recorded);
  assert.deepEqual(plan.grant.map(item => item.grantee), ['acme_viewer']);
  assert.deepEqual(plan.revoke.map(row => row.grantee), ['old']);
  assert.equal(plan.unchanged, 1);
  const sql = manualSql(plan);
  assert.match(sql, /GRANT READ ON SHARE <name of md:_share\/acme_data\/[0-9a-f]+> TO USER "acme_viewer";/);
  assert.match(sql, /ATTACH IF NOT EXISTS 'md:_share\/acme_data\/[0-9a-f]+' AS "demo";/);
  assert.match(sql, /REVOKE READ ON SHARE "demo_share" FROM USER "old";/);
  assert.equal(manualSql({ grant: [], revoke: [] }), '');
  assert.equal(quoteIdent('we"ird'), '"we""ird"');
});

function fakeMotherDuck({ shares = {}, existingGrants = [] } = {}) {
  const log = [];
  const owner = async (sql) => {
    log.push(['owner', sql]);
    const url = /url = '([^']+)'/.exec(sql)?.[1];
    if (url) return shares[url] ? [shares[url]] : [];
    if (sql.startsWith('SHOW GRANTS')) return existingGrants;
    return [];
  };
  return {
    log, configured: () => true,
    asOwner: run => run(owner),
    asServiceAccount: (username, run) => run(async sql => { log.push([username, sql]); return []; }),
  };
}
const memoryGrants = () => {
  const rows = new Map();
  return { rows, list: async () => [...rows.values()], save: async row => { rows.set(`${row.grantee}\n${row.share_url}`, row); }, remove: async (g, u) => { rows.delete(`${g}\n${u}`); } };
};

test('applying grants, attaches for service accounts, and never revokes access the app did not give', async () => {
  const md = fakeMotherDuck({
    shares: { [SHARE_A]: { name: 'acme_share', access: 'RESTRICTED' }, [SHARE_DEMO]: { name: 'demo_share', access: 'ORGANIZATION' } },
    existingGrants: [],
  });
  const grants = memoryGrants();
  const plan = {
    grant: [{ grantee: 'acme_viewer', kind: 'service_account', url: SHARE_A, alias: 'demo' }, { grantee: 'maya', kind: 'user', url: SHARE_DEMO, alias: 'demo' }],
    revoke: [
      { grantee: 'old', grantee_kind: 'user', share_url: SHARE_A, alias: 'demo', share_name: 'acme_share', granted_by_app: true, attached_by_app: false },
      { grantee: 'had_it', grantee_kind: 'user', share_url: SHARE_A, alias: 'demo', share_name: 'acme_share', granted_by_app: false, attached_by_app: false },
    ],
  };
  const result = await applyPlan(plan, { md, grants });
  assert.deepEqual(result, { synced: 2, failed: 0, revoked: 2 });
  const sql = md.log.map(([who, text]) => `${who}: ${text}`);
  assert.ok(sql.includes('owner: GRANT READ ON SHARE "acme_share" TO USER "acme_viewer"'));
  assert.ok(sql.includes(`acme_viewer: ATTACH IF NOT EXISTS '${SHARE_A}' AS "demo"`));
  assert.ok(!sql.some(line => line.includes('TO USER "maya"')), 'an organization-wide share needs no grant');
  assert.ok(sql.includes('owner: REVOKE READ ON SHARE "acme_share" FROM USER "old"'));
  assert.ok(!sql.some(line => line.includes('FROM USER "had_it"')), 'access the app did not give is left alone');
  const saved = grants.rows.get(`acme_viewer\n${SHARE_A}`);
  assert.equal(saved.state, 'synced');
  assert.equal(saved.granted_by_app, true);
  assert.equal(saved.attached_by_app, true);
});

test('an existing grant is recorded as not the app\'s, and an unowned share fails with a clear reason', async () => {
  const md = fakeMotherDuck({ shares: { [SHARE_A]: { name: 'acme_share', access: 'RESTRICTED' } }, existingGrants: [{ grantee_name: 'maya', grantee_type: 'USER' }] });
  const grants = memoryGrants();
  await applyPlan({ grant: [{ grantee: 'maya', kind: 'user', url: SHARE_A, alias: 'demo' }, { grantee: 'maya', kind: 'user', url: SHARE_DEMO, alias: 'demo' }], revoke: [] }, { md, grants });
  assert.ok(!md.log.some(([, text]) => text.startsWith('GRANT')));
  assert.equal(grants.rows.get(`maya\n${SHARE_A}`).granted_by_app, false);
  const failed = grants.rows.get(`maya\n${SHARE_DEMO}`);
  assert.equal(failed.state, 'failed');
  assert.match(failed.detail, /does not own this share/);
});

test('without the admin token the sync records waiting grants and changes nothing in MotherDuck', async () => {
  const tables = { user: [{ id: 'maya', diveAccess: 'explorer', motherduckUser: 'maya' }], md_access_grant: [] };
  const query = async (text, values = []) => {
    if (text.startsWith('SELECT id, name, username')) return tables.user;
    if (text.includes('FROM access_group g')) return [];
    if (text.includes('FROM access_group_member m JOIN "user"')) return [];
    if (text.startsWith('SELECT grantee')) return tables.md_access_grant;
    if (text.startsWith('INSERT INTO md_access_grant')) { tables.md_access_grant.push({ grantee: values[0], share_url: values[2], state: values[5] }); return []; }
    return [];
  };
  const md = { configured: () => false, asOwner: () => { throw new Error('must not connect'); } };
  const result = await syncAccess({ query, md, dives });
  assert.equal(result.mode, 'manual');
  assert.equal(result.pending, 1);
  assert.match(result.sql, /TO USER "maya"/);
  assert.deepEqual(tables.md_access_grant.map(row => row.state), ['pending']);
});

test('MotherDuck REST calls send the admin token only to MotherDuck and keep error text short and redacted', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/tokens')) return { ok: true, json: async () => ({ token: 'sa-token', id: 'tok-1', expire_at: new Date(Date.now() + 3600000).toISOString() }) };
    return { ok: false, status: 403, json: async () => ({ error: { message: 'denied for token eyJhbGciOi.secret.part' } }) };
  };
  const md = createMotherDuckAdmin({ MOTHERDUCK_ADMIN_TOKEN: 'admin-secret' }, { fetcher });
  assert.equal(await md.readToken('acme_viewer'), 'sa-token');
  assert.equal(await md.readToken('acme_viewer'), 'sa-token', 'tokens are reused until close to expiry');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.motherduck.com/v1/users/acme_viewer/tokens');
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'dive-app-chat', ttl: 3600, token_type: 'read_scaling' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer admin-secret');
  await assert.rejects(md.createServiceAccount('acme_viewer'), error => error.code === 'http_403' && error.detail.includes('<redacted>') && !error.detail.includes('secret.part'));
  await assert.rejects(createMotherDuckAdmin({}, { fetcher }).readToken('x'), error => error.code === 'admin_not_configured');
});

test('setup links store only a hash, work once, and set the password through Better Auth', async () => {
  const rows = [];
  const users = [{ id: 'u1', name: 'Lena', username: 'lena', displayUsername: 'lena', banned: false }];
  const query = async (text, values = []) => {
    if (text.startsWith('DELETE FROM account_setup')) { for (const row of rows.filter(r => r.user_id === values[0] && !r.used_at)) rows.splice(rows.indexOf(row), 1); return []; }
    if (text.startsWith('INSERT INTO account_setup')) { rows.push({ token_hash: values[0], user_id: values[1], expires_at: values[3], used_at: null }); return []; }
    if (text.startsWith('SELECT u.id')) {
      const row = rows.find(r => r.token_hash === values[0] && !r.used_at && r.expires_at > values[1]);
      return row ? users.filter(user => user.id === row.user_id && !user.banned) : [];
    }
    if (text.startsWith('UPDATE account_setup')) { const row = rows.find(r => r.token_hash === values[1] && !r.used_at); if (!row) return []; row.used_at = values[0]; return [{ user_id: row.user_id }]; }
    return [];
  };
  const calls = [];
  const ctx = { password: { hash: async value => `hashed:${value}` }, internalAdapter: {
    findAccounts: async () => [], linkAccount: async account => calls.push(['link', account.password]),
    updatePassword: async () => calls.push(['update']), deleteUserSessions: async id => calls.push(['signout', id]),
  } };
  const store = createSetupStore(query, { auth: () => ({ $context: Promise.resolve(ctx) }) });
  const { token, expiresAt } = await store.create('u1', 'admin');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!rows.some(row => row.token_hash === token), 'the token itself is never stored');
  assert.ok(expiresAt > new Date(Date.now() + 6 * 86400000));
  assert.deepEqual(await store.peek(token), { userId: 'u1', name: 'Lena', username: 'lena' });
  assert.equal(await store.peek('x'.repeat(43)), null);
  assert.equal((await store.redeem(token, 'a-long-enough-password')).username, 'lena');
  assert.deepEqual(calls, [['link', 'hashed:a-long-enough-password'], ['signout', 'u1']]);
  assert.equal(await store.redeem(token, 'another-long-password'), null, 'a link works once');
  const second = await store.create('u1', 'admin');
  const third = await store.create('u1', 'admin');
  assert.equal(await store.peek(second.token), null, 'a new link replaces the previous one');
  assert.ok(await store.peek(third.token));
  assert.equal(setupUrl('abc', 'https://dives.example.com/'), `${setupUrl('abc', 'https://dives.example.com')}`);
  assert.match(setupUrl('abc', 'https://dives.example.com'), /\/#setup=abc$/);
});

test('the migration creates the group, grant and setup tables and the MotherDuck username column', () => {
  const sql = createStatements(authOptions({ SESSION_SECRET: 'unit-test-secret-with-at-least-32-characters' })).join('\n');
  for (const table of ['access_group', 'access_group_member', 'md_access_grant', 'account_setup']) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} `));
  assert.match(sql, /"motherduckUser" VARCHAR/);
});
