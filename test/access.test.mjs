import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGroups, diveIdentity, groupFromRow, parseDiveAccess, parseGroupResources } from '../lib/groups.mjs';
import { canManagePeople, getViewer, publicViewer, viewerFromUser } from '../lib/viewer.mjs';
import { applyPlan, confirmManualSql, desiredGrants, manualSql, planSync, requestSync, syncAccess } from '../lib/access-sync.mjs';
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
  const team = applyGroups(own, [{ ...finance, manager: true }, { ...finance, id: 'g-ops', name: 'Ops', dives: ['explorer'], chat: true }]);
  assert.deepEqual(team.dives.sort(), ['explorer', 'overview']);
  assert.equal(team.chat, true);
  const viewer = applyGroups(own, [{ ...finance, manager: true }, acme]);
  // Every member of a data group shares its service account, so the group alone decides.
  assert.deepEqual(viewer.dives, ['explorer']);
  assert.equal(viewer.chat, true);
  assert.deepEqual(viewer.managerOf, ['g-fin']);
  assert.equal(viewer.dataGroup.serviceAccount, 'acme_viewer');
  assert.equal(canManagePeople(viewer), true);
  assert.deepEqual(publicViewer(viewer).groups, ['Finance', 'Acme']);
  assert.equal(applyGroups(viewerFromUser({ id: 'u2', diveAccess: 'overview' }), [{ ...finance, dives: '*' }]).dives, '*');
  assert.deepEqual(applyGroups(viewerFromUser({ id: 'u3', diveAccess: '*', chatAccess: true }), [{ ...acme, chat: false }]).dives, ['explorer'], 'personal access never widens a data group');
});

test('a data group\'s service account gets only the group\'s Dives, whatever its members have on their own', () => {
  const users = [{ id: 'lena', diveAccess: '*', chatAccess: true, motherduckUser: 'lena@example.com' }];
  const memberships = [{ userId: 'lena', groupId: 'g-acme', manager: false }, { userId: 'lena', groupId: 'g-fin', manager: false }];
  const want = desiredGrants({ users, groups: [{ ...acme, resources: {} }, { ...finance, dives: ['explorer'] }], memberships, dives });
  assert.deepEqual(want.map(item => [item.grantee, item.url]), [['acme_viewer', SHARE_DEMO]], 'nothing for lena herself, and nothing extra for the account');
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

function fakeMotherDuck({ shares = {}, existingGrants = [], attached = {} } = {}) {
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
    asServiceAccount: (username, run) => run(async sql => {
      log.push([username, sql]);
      const alias = /database_name = '([^']+)'/.exec(sql)?.[1];
      return alias && (attached[username] ?? []).includes(alias) ? [{ database_name: alias }] : [];
    }),
  };
}
const memoryGrants = () => {
  const rows = new Map();
  return { rows, list: async () => [...rows.values()], save: async row => { rows.set(`${row.grantee}\n${row.share_url}`, row); }, remove: async (g, u) => { rows.delete(`${g}\n${u}`); } };
};

test('applying grants, attaches for service accounts, and never revokes access the app did not give', async () => {
  const md = fakeMotherDuck({
    shares: { [SHARE_A]: { name: 'acme_share', access: 'RESTRICTED' }, [SHARE_DEMO]: { name: 'demo_share', access: 'ORGANIZATION' } },
    existingGrants: [{ grantee_name: 'old', grantee_type: 'user' }, { grantee_name: 'had_it', grantee_type: 'user' }],
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
  assert.ok(sql.indexOf('owner: REVOKE READ ON SHARE "acme_share" FROM USER "old"') < sql.indexOf('owner: GRANT READ ON SHARE "acme_share" TO USER "acme_viewer"'), 'removals run before grants');
});

test('an alias moved to another share is detached first, and an alias the account already had is never claimed', async () => {
  const md = fakeMotherDuck({ shares: { [SHARE_A]: { name: 'acme_share', access: 'RESTRICTED' }, [SHARE_DEMO]: { name: 'demo_share', access: 'RESTRICTED' } }, existingGrants: [{ grantee_name: 'acme_viewer', grantee_type: 'user' }] });
  const grants = memoryGrants();
  const old = { grantee: 'acme_viewer', grantee_kind: 'service_account', share_url: SHARE_DEMO, alias: 'demo', share_name: 'demo_share', granted_by_app: true, attached_by_app: true, state: 'synced' };
  await applyPlan({ grant: [{ grantee: 'acme_viewer', kind: 'service_account', url: SHARE_A, alias: 'demo' }], revoke: [old] }, { md, grants });
  const sql = md.log.map(([who, text]) => `${who}: ${text}`);
  assert.ok(sql.indexOf('acme_viewer: DETACH DATABASE IF EXISTS "demo"') < sql.indexOf(`acme_viewer: ATTACH IF NOT EXISTS '${SHARE_A}' AS "demo"`));
  assert.ok(!sql.some(line => line.includes('GRANT READ ON SHARE "acme_share"')), 'a grant the account already holds is not made twice');
  assert.equal(grants.rows.get(`acme_viewer\n${SHARE_A}`).granted_by_app, false);

  const md2 = fakeMotherDuck({ shares: { [SHARE_A]: { name: 'acme_share', access: 'ORGANIZATION' } }, attached: { acme_viewer: ['demo'] } });
  const grants2 = memoryGrants();
  await applyPlan({ grant: [{ grantee: 'acme_viewer', kind: 'service_account', url: SHARE_A, alias: 'demo' }], revoke: [] }, { md: md2, grants: grants2 });
  assert.ok(!md2.log.some(([, text]) => text.startsWith('ATTACH')));
  assert.equal(grants2.rows.get(`acme_viewer\n${SHARE_A}`).attached_by_app, false, 'never detached later');
});

test('a removal checks the grant is still there, so a grant someone already removed is not an error', async () => {
  const md = fakeMotherDuck({ shares: {}, existingGrants: [] });
  const grants = memoryGrants();
  const result = await applyPlan({ grant: [], revoke: [{ grantee: 'old', grantee_kind: 'user', share_url: SHARE_A, alias: 'demo', share_name: 'acme_share', granted_by_app: true }] }, { md, grants });
  assert.deepEqual(result, { synced: 0, failed: 0, revoked: 1 });
  assert.ok(!md.log.some(([, text]) => text.startsWith('REVOKE')));
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

function manualDatabase(users) {
  const tables = { user: users, md_access_grant: new Map() };
  const query = async (text, values = []) => {
    if (text.startsWith('SELECT id, name, username')) return tables.user;
    if (text.includes('FROM access_group g')) return [];
    if (text.includes('FROM access_group_member m JOIN "user"')) return [];
    if (text.startsWith('SELECT grantee')) return [...tables.md_access_grant.values()];
    if (text.startsWith('INSERT INTO md_access_grant')) {
      const [grantee, grantee_kind, share_url, alias, share_name, state, granted_by_app, attached_by_app, detail] = values;
      tables.md_access_grant.set(`${grantee}\n${share_url}`, { grantee, grantee_kind, share_url, alias, share_name, state, granted_by_app, attached_by_app, detail });
      return [];
    }
    if (text.startsWith('DELETE FROM md_access_grant WHERE grantee')) { tables.md_access_grant.delete(`${values[0]}\n${values[1]}`); return []; }
    if (text.startsWith('UPDATE md_access_grant')) { const done = [...tables.md_access_grant.values()].filter(row => row.state === values[2]); for (const row of done) row.state = values[0]; return done; }
    if (text.startsWith('DELETE FROM md_access_grant WHERE state')) { const gone = [...tables.md_access_grant.values()].filter(row => row.state === values[0]); for (const row of gone) tables.md_access_grant.delete(`${row.grantee}\n${row.share_url}`); return gone; }
    return [];
  };
  return { tables, query };
}

test('without the admin token the sync records waiting grants and changes nothing in MotherDuck', async () => {
  const { tables, query } = manualDatabase([{ id: 'maya', diveAccess: 'explorer', motherduckUser: 'maya' }]);
  const md = { configured: () => false, asOwner: () => { throw new Error('must not connect'); } };
  const result = await syncAccess({ query, md, dives });
  assert.equal(result.mode, 'manual');
  assert.equal(result.pending, 1);
  assert.match(result.sql, /TO USER "maya"/);
  assert.deepEqual([...tables.md_access_grant.values()].map(row => row.state), ['pending']);
});

test('in manual mode taking access away lists the REVOKE, and marking the SQL done settles both', async () => {
  const { tables, query } = manualDatabase([{ id: 'maya', diveAccess: 'explorer', motherduckUser: 'maya' }]);
  const md = { configured: () => false };
  await syncAccess({ query, md, dives });
  const seen = [{ grantee: 'maya', url: SHARE_DEMO }];
  assert.deepEqual(await confirmManualSql([{ grantee: 'someone_else', url: SHARE_DEMO }], { query, dives }), { granted: 0, removed: 0 }, 'only changes the admin saw are settled');
  await confirmManualSql(seen, { query, dives });
  assert.equal([...tables.md_access_grant.values()][0].state, 'synced', 'the owner ran the GRANT');
  tables.user[0].banned = true;
  const result = await syncAccess({ query, md, dives });
  assert.equal(result.removing, 1);
  assert.match(result.sql, /REVOKE READ ON SHARE <name of md:_share\/demo_data\/[0-9a-f]+> FROM USER "maya";/);
  assert.equal([...tables.md_access_grant.values()][0].state, 'removing', 'kept until the owner says it is done');
  assert.match((await syncAccess({ query, md, dives })).sql, /REVOKE/, 'the REVOKE stays listed until confirmed');
  await confirmManualSql(seen, { query, dives });
  assert.equal(tables.md_access_grant.size, 0);
});

test('one sync runs at a time across instances, and a change during a run is folded into one more run', async () => {
  const lease = { holder: null, again: false };
  const lock = {
    acquire: async holder => (lease.holder ? false : ((lease.holder = holder), true)),
    markAgain: async () => (lease.holder ? ((lease.again = true), true) : false),
    takeAgain: async holder => (lease.holder === holder && lease.again ? ((lease.again = false), true) : false),
    renew: async holder => lease.holder === holder,
    release: async holder => (lease.holder === holder && !lease.again ? ((lease.holder = null), true) : false),
    abandon: async () => { lease.holder = null; },
  };
  lease.holder = 'other-instance';
  assert.deepEqual(await requestSync({ lock }), { mode: 'queued' });
  assert.equal(lease.again, true, 'the running instance is asked to run again');
  lease.holder = null; lease.again = false;
  let runs = 0;
  const { query } = manualDatabase([]);
  const counting = async (text, values) => { if (text.startsWith('SELECT id, name, username')) { runs += 1; if (runs === 1) lease.again = true; } return query(text, values); };
  const result = await requestSync({ lock, query: counting, md: { configured: () => false }, dives });
  assert.equal(result.mode, 'manual');
  assert.equal(runs, 2);
  assert.equal(lease.holder, null, 'the lease is released');
  // A run that loses its lease (it expired and another instance took it) stops instead of looping.
  runs = 0;
  const stolen = async (text, values) => { if (text.startsWith('SELECT id, name, username')) { runs += 1; lease.holder = 'someone-else'; } return query(text, values); };
  await requestSync({ lock, query: stolen, md: { configured: () => false }, dives });
  assert.equal(runs, 1);
  assert.equal(lease.holder, 'someone-else', 'the other instance keeps its lease');
});

test('two aliases can swap shares: both are detached before either is attached again', async () => {
  const X = SHARE_A, Y = SHARE_DEMO;
  const md = fakeMotherDuck({ shares: { [X]: { name: 'x', access: 'ORGANIZATION' }, [Y]: { name: 'y', access: 'ORGANIZATION' } } });
  const grants = memoryGrants();
  const previous = new Map([
    [`sa\n${X}`, { grantee: 'sa', grantee_kind: 'service_account', share_url: X, alias: 'a', attached_by_app: true, state: 'synced' }],
    [`sa\n${Y}`, { grantee: 'sa', grantee_kind: 'service_account', share_url: Y, alias: 'b', attached_by_app: true, state: 'synced' }],
  ]);
  await applyPlan({ grant: [{ grantee: 'sa', kind: 'service_account', url: Y, alias: 'a' }, { grantee: 'sa', kind: 'service_account', url: X, alias: 'b' }], revoke: [] }, { md, grants, previous });
  const sql = md.log.filter(([who]) => who === 'sa').map(([, text]) => text).filter(text => /^(ATTACH|DETACH)/.test(text));
  assert.deepEqual(sql, ['DETACH DATABASE IF EXISTS "b"', 'DETACH DATABASE IF EXISTS "a"', `ATTACH IF NOT EXISTS '${Y}' AS "a"`, `ATTACH IF NOT EXISTS '${X}' AS "b"`]);
  assert.ok([...grants.rows.values()].every(row => row.attached_by_app));
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

// A tiny app database for the manager rules: users, memberships and linked sign-in accounts.
function peopleDatabase({ users, members, accounts = [] }) {
  return async (text, values = []) => {
    if (text.startsWith('SELECT role FROM "user"')) return users.filter(user => user.id === values[0]);
    if (text.startsWith('SELECT role, banned FROM "user"')) return users.filter(user => user.id === values[0]);
    if (text.startsWith('SELECT group_id, manager FROM access_group_member')) return members.filter(row => row.user_id === values[0]);
    if (text.startsWith('SELECT group_id FROM access_group_member')) return members.filter(row => row.user_id === values[0] && row.manager);
    if (text.startsWith('SELECT 1 AS found FROM account')) return accounts.filter(row => row.userId === values[0] && row.providerId !== values[1]);
    if (text.startsWith('SELECT banned, "banReason"')) return users.filter(user => user.id === values[0]);
    if (text.startsWith('SELECT "emailVerified"')) return users.filter(user => user.id === values[0]);
    return [];
  };
}

test('a group manager reaches only people who belong to nothing but the groups they manage', async () => {
  const { createGroupStore } = await import('../lib/groups.mjs');
  const query = peopleDatabase({
    users: [{ id: 'lena', role: 'user' }, { id: 'jules', role: 'user' }, { id: 'both', role: 'user' }, { id: 'boss', role: 'admin' }, { id: 'peer', role: 'user' }],
    members: [
      { user_id: 'lena', group_id: 'g-acme', manager: true }, { user_id: 'jules', group_id: 'g-acme', manager: false },
      { user_id: 'both', group_id: 'g-acme', manager: false }, { user_id: 'both', group_id: 'g-globex', manager: false },
      { user_id: 'boss', group_id: 'g-acme', manager: false }, { user_id: 'peer', group_id: 'g-acme', manager: true },
    ],
  });
  const groups = createGroupStore(query);
  assert.deepEqual(await groups.managedBy('lena'), ['g-acme']);
  assert.equal(await groups.managerReaches(['g-acme'], 'jules'), true);
  assert.equal(await groups.managerReaches(['g-acme'], 'both'), false, 'also in another customer\'s group');
  assert.equal(await groups.managerReaches(['g-acme'], 'boss'), false, 'administrators stay out of reach');
  assert.equal(await groups.managerReaches(['g-acme'], 'peer'), false, 'another manager stays out of reach');
  assert.equal(await groups.managerReaches(['g-acme'], 'nobody'), false);
});

test('a manager\'s setup link stops working once the person is out of the manager\'s reach or uses single sign-on', async () => {
  const users = [{ id: 'lena', role: 'user', banned: false }, { id: 'jules', role: 'user', banned: false, name: 'Jules', username: 'jules' }];
  const members = [{ user_id: 'lena', group_id: 'g-acme', manager: true }, { user_id: 'jules', group_id: 'g-acme', manager: false }];
  const accounts = [];
  const base = peopleDatabase({ users, members, accounts });
  const query = async (text, values) => (text.startsWith('SELECT u.id') ? [{ id: 'jules', name: 'Jules', username: 'jules', created_by: 'lena' }] : base(text, values));
  const store = createSetupStore(query);
  const token = 'a'.repeat(43);
  assert.ok(await store.peek(token));
  members.push({ user_id: 'jules', group_id: 'g-globex', manager: false });
  assert.equal(await store.peek(token), null, 'joined another customer\'s group');
  members.pop();
  accounts.push({ userId: 'jules', providerId: 'okta' });
  assert.equal(await store.peek(token), null, 'a manager never adds a password beside single sign-on');
  accounts.pop();
  users[0].banned = true;
  assert.equal(await store.peek(token), null, 'the manager was disabled');
  users[0].banned = false; users[1].role = 'admin';
  assert.equal(await store.peek(token), null, 'the person became an administrator');
});

test('a manager cannot re-enable someone an administrator disabled, and cannot make setup links for single sign-on users', async () => {
  const { BANNED_BY, createPeopleService } = await import('../lib/people.mjs');
  const users = [{ id: 'jules', role: 'user', banReason: BANNED_BY.admin }];
  const query = peopleDatabase({ users, members: [], accounts: [{ userId: 'jules', providerId: 'okta' }] });
  const updates = [];
  const ctx = { internalAdapter: { updateUser: async (id, data) => updates.push([id, data]), deleteUserSessions: async () => {} } };
  const people = createPeopleService(query, { auth: () => ({ $context: Promise.resolve(ctx) }), setup: { revokeFor: async () => {}, create: async () => ({ token: 't', expiresAt: new Date() }) } });
  const manager = { all: false, groups: ['g-acme'] };
  users[0].banned = true;
  await assert.rejects(people.setBanned('jules', false, { scope: manager }), error => error.message === 'disabled_by_admin');
  await assert.rejects(people.setBanned('jules', true, { scope: manager }), error => error.message === 'disabled_by_admin', 'banning again would overwrite the reason');
  assert.equal(updates.length, 0);
  users[0].banned = false;
  await people.setBanned('jules', true, { scope: manager });
  assert.equal(updates[0][1].banReason, BANNED_BY.manager);
  users[0].banned = true; users[0].banReason = BANNED_BY.manager;
  await people.setBanned('jules', false, { scope: manager });
  assert.equal(updates[1][1].banned, false);
  await assert.rejects(people.setupLink('jules', { viewer: { id: 'lena' }, scope: manager, origin: 'https://x' }), error => error.message === 'single_sign_on_user');
  assert.ok((await people.setupLink('jules', { viewer: { id: 'boss' }, scope: { all: true }, origin: 'https://x' })).setupUrl);
});

test('single sign-on puts verified emails from a mapped domain into its group, and can start everyone else with nothing', async () => {
  const { domainGroups, newAccountDefaults, allowedEmailDomains } = await import('../lib/auth.mjs');
  const env = { AUTH_DOMAIN_GROUPS: 'acme.com=Acme, not a domain=X, globex.co.uk = Globex Ltd', AUTH_ALLOWED_EMAIL_DOMAINS: 'example.com' };
  assert.deepEqual([...domainGroups(env)], [['acme.com', 'Acme'], ['globex.co.uk', 'Globex Ltd']]);
  assert.deepEqual(allowedEmailDomains(env).sort(), ['acme.com', 'example.com', 'globex.co.uk']);
  assert.deepEqual(newAccountDefaults({ email: 'a@acme.com', emailVerified: true }, env), { group: 'Acme', data: { diveAccess: '', chatAccess: false } });
  assert.equal(newAccountDefaults({ email: 'a@acme.com', emailVerified: false }, env), null, 'an unverified email creates no account');
  assert.equal(newAccountDefaults({ email: 'a@other.com', emailVerified: true }, env), null, 'a domain that is not allowed creates no account');
  assert.deepEqual(newAccountDefaults({ email: 'a@example.com', emailVerified: true }, env).data, { diveAccess: '*', chatAccess: true });
  assert.deepEqual(newAccountDefaults({ email: 'a@example.com', emailVerified: true }, { ...env, AUTH_NEW_ACCOUNT_ACCESS: 'none' }).data, { diveAccess: '', chatAccess: false });
});

test('only identity providers the deployer controls are trusted to vouch for an email', async () => {
  const { trustedSsoProviders, newAccountDefaults } = await import('../lib/auth.mjs');
  const entra = tenant => ({ MICROSOFT_CLIENT_ID: 'c', MICROSOFT_CLIENT_SECRET: 's', MICROSOFT_TENANT_ID: tenant });
  assert.deepEqual(trustedSsoProviders(entra('0b4f2c1e-1234-4abc-9def-0123456789ab')), ['microsoft-entra-id']);
  const generic = { SSO_CLIENT_ID: 'c', SSO_CLIENT_SECRET: 's', SSO_ISSUER: 'https://idp.example.com' };
  assert.deepEqual(trustedSsoProviders(generic), []);
  assert.deepEqual(trustedSsoProviders({ ...generic, SSO_TRUSTED: 'true' }), ['sso']);
  assert.deepEqual(trustedSsoProviders({ GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GITHUB_CLIENT_ID: 'c', GITHUB_CLIENT_SECRET: 's' }), [], 'Google and GitHub send their own verified flag');
  const env = { ...entra('0b4f2c1e-1234-4abc-9def-0123456789ab'), AUTH_ALLOWED_EMAIL_DOMAINS: 'example.com' };
  assert.ok(newAccountDefaults({ email: 'a@example.com', emailVerified: false }, env, 'microsoft-entra-id'), 'a single-tenant Entra email counts as verified');
  assert.equal(newAccountDefaults({ email: 'a@example.com', emailVerified: false }, env, 'google'), null);
});

test('adding a list of people looks up every username and email once and refuses repeats', async () => {
  const { createPeopleService } = await import('../lib/people.mjs');
  const lookups = [], created = [];
  const query = async (text, values) => {
    if (text.includes('lower(username) IN')) { lookups.push({ text, values }); return [{ username: 'ada', email: 'ada@example.com' }]; }
    return [];
  };
  const auth = () => ({ api: { createUser: async ({ body }) => { created.push(body.data.username); return { user: { id: `id-${body.data.username}` } }; } } });
  const people = createPeopleService(query, { auth, groups: {}, setup: { create: async () => ({ token: 't', expiresAt: new Date() }) } });
  const results = await people.create({ people: [{ username: 'Ada' }, { username: 'grace' }, { username: 'grace' }, { username: 'linus', email: 'ADA@example.com' }], access: { dives: '*', chat: true } }, { scope: { all: true }, viewer: { id: 'admin' }, origin: 'https://app.test' });
  assert.equal(lookups.length, 1);
  assert.match(lookups[0].text, /IN \(\$1::VARCHAR, \$2::VARCHAR, \$3::VARCHAR, \$4::VARCHAR\) OR lower\(email\) IN \(\$5::VARCHAR/);
  assert.deepEqual(results.map(result => result.error ?? 'ok'), ['already_exists', 'ok', 'already_exists', 'already_exists']);
  assert.deepEqual(created, ['grace']);
});
