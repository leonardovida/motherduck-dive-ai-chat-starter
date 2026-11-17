import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_RETRY_MS, appStoreConfigured, ensureAppStore, sharedAdmin } from '../lib/app-db.mjs';
import { accountsAvailable, accountsEnabled, getAuth, sharedAdminAccounts } from '../lib/auth.mjs';
import { conversationOwner, recordingEnabled } from '../lib/conversations.mjs';
import { COOKIE, signSession } from '../lib/security.mjs';
import { getViewer, publicViewer } from '../lib/viewer.mjs';
import { requireAdmin } from '../lib/admin-api.mjs';
import { SYNC_OFF, requestSync } from '../lib/access-sync.mjs';
import { withEnv } from './helpers.mjs';
import { cookieJar, createMemoryStore } from './memory-store.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const base = { SESSION_SECRET: SECRET, DEMO_PASSWORD: 'a-shared-password' };
const signedIn = () => new Headers({ cookie: `__Host-dive_session=${signSession(SECRET)}` });
const noSession = { api: { getSession: async () => null } };
const sharedCookie = () => `${COOKIE}=${signSession(SECRET)}`;

// Shared-password admin with the real Better Auth over an in-memory store (test/memory-store.mjs):
// people are created, sign in and sign out as they do in the app, through the app's routes.
const HYBRID = { ...base, SHARED_PASSWORD_ADMIN: 'true', MOTHERDUCK_EMBED_TOKEN: 'embed', MOTHERDUCK_APP_TOKEN: undefined, PUBLIC_DEMO: undefined, CHAT_HISTORY: undefined, APP_URL: 'https://demo.test', VERCEL_PROJECT_PRODUCTION_URL: undefined, AUTH_TRUSTED_IP_HEADER: undefined };
const PASSWORD = 'a-long-password-1';
const TOKEN_COOKIE = '__Secure-dive_chat.session_token';
async function inHybrid(fn, env = {}) {
  const store = createMemoryStore();
  return withEnv({ ...HYBRID, ...env }, async () => {
    store.install();
    try { return await fn(store); } finally { store.restore(); }
  });
}
const request = (path, { method = 'GET', cookie, origin = 'https://demo.test', body, headers = {} } = {}) => new Request(`https://demo.test${path}`, {
  method,
  headers: { host: 'demo.test', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
// A person made as the portal makes them, with a password unless password is null.
async function person(username, { role = 'user', password = PASSWORD } = {}) {
  const { user } = await getAuth().api.createUser({ body: { email: `${username}@accounts.invalid`, name: username, role, ...(password ? { password } : {}), data: { username, displayUsername: username } } });
  return user;
}
async function signIn(jar, username, password = PASSWORD) {
  const { POST } = await import('../app/api/account/[...all]/route.js');
  return jar.take(await POST(request('/api/account/sign-in/username', { method: 'POST', cookie: jar.header(), body: { username, password } })));
}
async function signInShared(jar, password = base.DEMO_PASSWORD) {
  const { POST } = await import('../app/api/auth/route.js');
  return jar.take(await POST(request('/api/auth', { method: 'POST', cookie: jar.header(), body: { password } })));
}
const view = cookie => getViewer(new Headers(cookie ? { cookie } : {}), process.env, undefined, { fresh: true });
const personal = jar => jar.names().filter(name => name.includes('dive_chat.'));
const audited = store => store.tables.audit_event.map(row => [row.actor_id, row.action]);
const syncs = store => store.app.filter(query => /app_lock/.test(query.text));
const refusal = async response => [response.status, (await response.json()).error];
const params = id => ({ params: Promise.resolve({ id }) });

test('shared-password admin needs the setting and a store token, and keeps accounts mode proper off', () => {
  assert.equal(sharedAdmin(base), false);
  assert.equal(appStoreConfigured({ ...base, MOTHERDUCK_EMBED_TOKEN: 'embed' }), false, 'the embed token is not an app token by default');
  const shared = { ...base, SHARED_PASSWORD_ADMIN: 'true', MOTHERDUCK_EMBED_TOKEN: 'embed' };
  assert.equal(appStoreConfigured(shared), true);
  assert.equal(accountsEnabled(shared), false, 'the shared password keeps working');
  assert.deepEqual([sharedAdminAccounts(shared), accountsAvailable(shared)], [true, true], 'personal accounts exist next to it');
  assert.deepEqual([sharedAdminAccounts(base), accountsAvailable(base)], [false, false]);
  assert.deepEqual([sharedAdminAccounts({ ...base, SHARED_PASSWORD_ADMIN: 'true' }), accountsAvailable({ ...base, SHARED_PASSWORD_ADMIN: 'true' })], [false, false], 'no store, no accounts');
  assert.deepEqual([sharedAdminAccounts({ MOTHERDUCK_APP_TOKEN: 'app' }), accountsAvailable({ MOTHERDUCK_APP_TOKEN: 'app' })], [false, true]);
  assert.equal(recordingEnabled(shared), true);
  assert.equal(recordingEnabled({ ...shared, CHAT_HISTORY: 'off' }), false);
  assert.equal(recordingEnabled({ ...base, SHARED_PASSWORD_ADMIN: 'true' }), false, 'nothing to save into without a token');
  // An app token alone is still accounts mode.
  assert.equal(accountsEnabled({ ...base, MOTHERDUCK_APP_TOKEN: 'app' }), true);
  assert.equal(accountsEnabled({ ...base, MOTHERDUCK_APP_TOKEN: 'app', SHARED_PASSWORD_ADMIN: 'true' }), false);
});

test('everyone with the shared password is an administrator, one browser session apart from another', async () => {
  const shared = { ...base, SHARED_PASSWORD_ADMIN: 'true', MOTHERDUCK_EMBED_TOKEN: 'embed' };
  assert.equal(await getViewer(new Headers(), shared, noSession), null, 'still needs the password');
  const headers = signedIn();
  const viewer = await getViewer(headers, shared, noSession);
  assert.equal(viewer.isAdmin, true);
  assert.equal(viewer.mode, 'password');
  assert.equal(viewer.chat, true);
  assert.equal(viewer.dives, '*');
  assert.match(viewer.sessionId, /^[0-9a-f]{32}$/);
  assert.equal((await getViewer(headers, shared, noSession)).sessionId, viewer.sessionId, 'stable for one sign-in');
  assert.deepEqual(conversationOwner(viewer), { userId: 'shared', sessionId: viewer.sessionId }, 'past conversations stay with the session that asked');
  const shown = publicViewer(viewer);
  assert.deepEqual([shown.isAdmin, shown.canManage, shown.sharedAdmin, shown.mode], [true, true, true, 'password']);
  assert.ok(!JSON.stringify(shown).includes(viewer.sessionId));
  // Without the setting the same sign-in is a plain viewer.
  const plain = await getViewer(headers, base);
  assert.equal(plain.isAdmin, false);
  assert.equal(publicViewer(plain).sharedAdmin, undefined);
  assert.deepEqual(conversationOwner(plain), { userId: 'shared', sessionId: null });
});

test('Better Auth waits for the store to be created and migrated before its first query', async () => {
  const { betterAuth } = await import('better-auth');
  const { authOptions } = await import('../lib/auth.mjs');
  const { authDatabase } = await import('../lib/app-db.mjs');
  const env = { ...base, SHARED_PASSWORD_ADMIN: 'true', MOTHERDUCK_EMBED_TOKEN: 'embed' };
  const sent = [];
  let ready;
  globalThis.__diveChatAppReady = new Promise(resolve => { ready = resolve; });
  globalThis.__diveChatAppPool = { on() {}, connect: async () => ({ query: async sql => { sent.push(sql); return { rows: [], command: 'SELECT', rowCount: 0 }; }, release() {} }) };
  try {
    const ctx = await betterAuth(authOptions(env, authDatabase(env))).$context;
    const lookup = ctx.internalAdapter.findUserById('u-1');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(sent, [], 'nothing is sent before the store is ready');
    ready();
    assert.equal(await lookup, null);
    assert.match(sent[0], /from "user" where "user"\."id" = \$1/);
  } finally { delete globalThis.__diveChatAppReady; delete globalThis.__diveChatAppPool; }
});

test('a browser holds one identity: each sign-in ends the other', async () => {
  await inHybrid(async store => {
    const ann = await person('ann');
    const jar = cookieJar();
    assert.equal((await signInShared(jar)).status, 200);
    assert.deepEqual(jar.names(), [COOKIE]);
    assert.equal((await view(jar.header())).id, 'shared');
    // Signing in as a person expires the administrator's cookie in the same response.
    assert.equal((await signIn(jar, 'ann')).status, 200);
    assert.ok(!jar.has(COOKIE) && jar.has(TOKEN_COOKIE), jar.names().join());
    const ann1 = await view(jar.header());
    assert.deepEqual([ann1.id, ann1.isAdmin, ann1.mode, ann1.shared], [ann.id, false, 'accounts', undefined]);
    assert.deepEqual(conversationOwner(ann1), { userId: ann.id, sessionId: null }, 'their own past conversations');
    assert.deepEqual([publicViewer(ann1).sharedAdmin, publicViewer(ann1).canManage], [undefined, false]);
    // A wrong shared password changes nothing.
    assert.equal((await signInShared(jar, 'not-the-password')).status, 401);
    assert.ok(jar.has(TOKEN_COOKIE) && !jar.has(COOKIE));
    // The shared password ends the person's session, on the server as well.
    assert.equal(store.tables.session.length, 1);
    assert.equal((await signInShared(jar)).status, 200);
    assert.deepEqual([jar.names(), store.tables.session.length], [[COOKIE], 0]);
    assert.equal((await view(jar.header())).id, 'shared');
  });
});

test('a personal session that ended, was disabled or cannot be read never becomes the administrator', async () => {
  await inHybrid(async store => {
    const ann = await person('ann');
    const ada = await person('ada', { role: 'admin' });
    const jar = cookieJar();
    await signIn(jar, 'ann');
    const both = () => `${sharedCookie()}; ${jar.header()}`;
    assert.equal((await view(sharedCookie())).id, 'shared', 'the shared cookie alone is the administrator');
    assert.equal(await view(`${COOKIE}=forged.value`), null, 'a cookie that was not signed is nobody');
    assert.equal((await view(both())).id, ann.id, 'with both cookies, the person decides');
    const adaJar = cookieJar();
    await signIn(adaJar, 'ada');
    assert.deepEqual([(await view(adaJar.header())).id, (await view(adaJar.header())).isAdmin], [ada.id, true], 'an account made administrator in the portal');
    const { GET } = await import('../app/api/auth/route.js');
    const lost = async why => {
      assert.equal(await view(both()), null, why);
      assert.equal((await requireAdmin(request('/api/admin/people', { cookie: both() }))).response.status, 401, why);
      const body = await (await GET(request('/api/auth', { cookie: both() }))).json();
      assert.notEqual(body.user?.sharedAdmin, true, why);
      assert.notEqual(body.user?.isAdmin, true, why);
    };
    const row = store.tables.user.find(user => user.id === ann.id);
    row.banned = true;
    await lost('disabled');
    row.banned = false;
    store.tables.session = [];
    await lost('signed out elsewhere, expired, or ended by an administrator');
    for (const cookie of [`${TOKEN_COOKIE}=garbage`, 'dive_chat.session_token=x.y', `${TOKEN_COOKIE}=${'a'.repeat(32)}.${'b'.repeat(44)}`]) {
      assert.equal(await view(`${sharedCookie()}; ${cookie}`), null, cookie);
    }
    // The store cannot be reached: the person cannot be read, and is nobody.
    await signIn(jar, 'ann');
    assert.equal((await view(both())).id, ann.id);
    globalThis.__diveChatAppReady = undefined;
    globalThis.__diveChatAppFailed = { at: Date.now(), error: Object.assign(new Error('unreachable'), { code: 'ETIMEDOUT' }) };
    assert.equal(await view(both()), null);
    assert.equal((await view(sharedCookie())).id, 'shared', 'the administrator alone needs no database');
  });
});

test('the admin guard: the shared administrator manages people and groups, and a person who is not an administrator is refused everywhere', async () => {
  await inHybrid(async store => {
    const ann = await person('ann');
    const ada = await person('ada', { role: 'admin' });
    const annJar = cookieJar(), adaJar = cookieJar();
    await signIn(annJar, 'ann');
    await signIn(adaJar, 'ada');
    for (const path of ['/api/admin/people', '/api/admin/groups', '/api/admin/groups/g-1/members', `/api/admin/users/${ann.id}/access`, `/api/admin/users/${ann.id}/setup-link`, `/api/admin/users/${ann.id}/status`]) {
      const { response, viewer, scope } = await requireAdmin(request(path, { method: 'POST', cookie: sharedCookie() }), { write: true, managers: true });
      assert.equal(response, undefined, path);
      assert.deepEqual([viewer.id, scope], ['shared', { all: true, groups: [] }], path);
    }
    // MotherDuck's side of the portal is off for the whole mode, whoever asks.
    for (const path of ['/api/admin/access-sync', '/api/admin/digest', '/api/admin/groups/g-1/service-account']) {
      for (const cookie of [sharedCookie(), adaJar.header()]) assert.equal((await requireAdmin(request(path, { method: 'POST', cookie }), { write: true })).response.status, 404, path);
    }
    assert.equal((await requireAdmin(request('/api/admin/people'))).response.status, 401);
    assert.equal((await requireAdmin(request('/api/admin/people', { cookie: adaJar.header() }))).viewer.id, ada.id);
    // A person, also one whose browser still sends an old shared-password cookie.
    for (const cookie of [annJar.header(), `${sharedCookie()}; ${annJar.header()}`]) {
      for (const path of ['/api/admin/people', '/api/admin/groups', `/api/admin/users/${ada.id}/access`]) {
        assert.equal((await requireAdmin(request(path, { method: 'POST', cookie }), { write: true, managers: true })).response.status, 403, path);
      }
      // The three account actions the shared administrator runs without Better Auth stay Better Auth's for a person.
      const { POST } = await import('../app/api/account/[...all]/route.js');
      for (const [path, body] of [['/admin/set-role', { userId: ann.id, role: 'admin' }], ['/admin/set-user-password', { userId: ada.id, newPassword: 'taken-over-password' }], ['/admin/remove-user', { userId: ada.id }]]) {
        const response = await POST(request(`/api/account${path}`, { method: 'POST', cookie, body }));
        assert.ok([401, 403].includes(response.status), `${path} answered ${response.status}`);
      }
    }
    assert.deepEqual([store.tables.user.find(user => user.id === ann.id).role, store.tables.user.some(user => user.id === ada.id)], ['user', true]);
    assert.equal((await signIn(cookieJar(), 'ada')).status, 200, 'the password did not change');
    assert.deepEqual(audited(store), []);
    for (const origin of ['https://attacker.test', '']) {
      const { response } = await requireAdmin(request('/api/admin/people', { method: 'POST', cookie: sharedCookie(), origin }), { write: true, managers: true });
      assert.equal(response.status, 403, `origin ${origin || 'missing'}`);
    }
  });
  // Unset, the same cookie is a plain shared-password viewer with no portal.
  await inHybrid(async () => {
    assert.equal((await requireAdmin(request('/api/admin/people', { cookie: sharedCookie() }))).response.status, 404);
  }, { SHARED_PASSWORD_ADMIN: undefined });
});

test('a public demo with shared-password admin shows the portal but changes nothing', async () => {
  await inHybrid(async store => {
    const ann = await person('ann');
    const { POST } = await import('../app/api/account/[...all]/route.js');
    const setup = await import('../app/api/account-setup/route.js');
    const people = await import('../app/api/admin/people/route.js');
    for (const path of ['/admin/set-role', '/admin/set-user-password', '/admin/remove-user', '/admin/ban-user']) {
      const response = await POST(request(`/api/account${path}`, { method: 'POST', cookie: sharedCookie(), body: { userId: ann.id, role: 'admin', newPassword: 'a-new-password-123' } }));
      assert.deepEqual(await refusal(response), [403, 'demo_read_only'], path);
    }
    assert.deepEqual(await refusal(await POST(request('/api/account/is-username-available', { method: 'POST', body: { username: 'ann' } }))), [403, 'demo_read_only']);
    assert.equal((await requireAdmin(request('/api/admin/people', { cookie: sharedCookie() }), { managers: true })).viewer.id, 'shared', 'every screen opens');
    assert.deepEqual(await refusal((await requireAdmin(request('/api/admin/people', { method: 'POST', cookie: sharedCookie() }), { write: true })).response), [403, 'demo_read_only']);
    assert.deepEqual(await refusal(await people.POST(request('/api/admin/people', { method: 'POST', cookie: sharedCookie(), body: { people: [{ username: 'mo' }] } }))), [403, 'demo_read_only']);
    assert.deepEqual(await refusal(await setup.POST(request('/api/account-setup', { method: 'POST', body: { token: 'a'.repeat(43), password: 'a-new-password-123' } }))), [403, 'demo_read_only']);
    assert.deepEqual([store.tables.user.length, store.tables.user[0].role, audited(store)], [1, 'user', []]);
    // Signing in still works, and still ends the shared sign-in in that browser.
    const jar = cookieJar(sharedCookie());
    assert.equal((await signIn(jar, 'ann')).status, 200);
    assert.ok(!jar.has(COOKIE) && jar.has(TOKEN_COOKIE));
  }, { PUBLIC_DEMO: 'true' });
});

test('the shared administrator adds people, and a setup link it made works in a browser that then holds only the person', async () => {
  await inHybrid(async store => {
    const people = await import('../app/api/admin/people/route.js');
    const setup = await import('../app/api/account-setup/route.js');
    const jar = cookieJar();
    await signInShared(jar);
    const response = await people.POST(request('/api/admin/people', { method: 'POST', cookie: jar.header(), body: { people: [{ username: 'lena', name: 'Lena' }, { username: 'max', password: 'a-long-enough-password' }] } }));
    assert.equal(response.status, 200);
    const { results } = await response.json();
    assert.deepEqual(results.map(result => [result.username, Boolean(result.id), Boolean(result.setupUrl)]), [['lena', true, true], ['max', true, false]]);
    assert.match(results[0].setupUrl, /^https:\/\/demo\.test\/#setup=[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(store.tables.user.map(user => [user.username, user.role]), [['lena', 'user'], ['max', 'user']], 'viewers unless made administrators');
    assert.deepEqual(store.tables.account_setup.map(row => [row.user_id, row.created_by]), [[results[0].id, 'shared']], 'the link names the shared administrator as its creator');
    // Entries name the shared sign-in and its browser session, so two presenters can be told apart.
    const sessionTag = (await view(jar.header())).sessionId.slice(0, 8);
    assert.deepEqual(audited(store), [['shared', 'person.created'], ['shared', 'person.created']]);
    assert.deepEqual([...new Set(store.tables.audit_event.map(row => row.actor_label))], [`Shared sign-in ${sessionTag}`]);
    const token = results[0].setupUrl.split('#setup=')[1];
    const stored = JSON.stringify({ tables: store.tables, app: store.app });
    assert.ok(!stored.includes('a-long-enough-password') && !stored.includes(token), 'neither the password nor the link token is stored');

    const send = body => setup.POST(request('/api/account-setup', { method: 'POST', cookie: jar.header(), body }));
    assert.deepEqual(await (await send({ token })).json(), { username: 'lena', name: 'Lena' });
    const chosen = jar.take(await send({ token, password: 'lenas-own-password' }));
    assert.equal(chosen.status, 200);
    assert.ok(!jar.has(COOKIE), 'choosing a password ends the administrator sign-in in this browser');
    assert.equal((await signIn(jar, 'lena', 'lenas-own-password')).status, 200);
    const lena = await view(jar.header());
    assert.deepEqual([lena.username, lena.isAdmin, lena.mode, lena.chat, lena.dives], ['lena', false, 'accounts', true, '*']);
    assert.deepEqual(await refusal(await send({ token, password: 'another-password-1' })), [404, 'setup_link_invalid'], 'used once');

    // Turning the setting off retires the links the shared administrator made.
    const more = await people.POST(request('/api/admin/people', { method: 'POST', cookie: sharedCookie(), body: { people: [{ username: 'noor' }] } }));
    const other = (await more.json()).results[0].setupUrl.split('#setup=')[1];
    assert.equal((await send({ token: other })).status, 200);
    await withEnv({ SHARED_PASSWORD_ADMIN: undefined, MOTHERDUCK_APP_TOKEN: 'app' }, async () => {
      delete globalThis.__diveChatAuth;
      assert.deepEqual(await refusal(await send({ token: other })), [404, 'setup_link_invalid']);
      assert.deepEqual(await refusal(await send({ token: other, password: 'noors-own-password' })), [404, 'setup_link_invalid']);
    });
    delete globalThis.__diveChatAuth;
    assert.equal(store.tables.account.some(row => row.userId === store.tables.user.find(user => user.username === 'noor').id), false);
    assert.deepEqual(syncs(store), [], 'no access sync was started');
  });
});

test('the shared administrator sets roles and passwords and removes people without a Better Auth session', async () => {
  await inHybrid(async store => {
    const ann = await person('ann');
    const ada = await person('ada', { role: 'admin' });
    const bo = await person('bo', { password: null });
    const { POST } = await import('../app/api/account/[...all]/route.js');
    const send = (path, body, options = {}) => POST(request(`/api/account${path}`, { method: 'POST', cookie: sharedCookie(), body, ...options }));
    const row = id => store.tables.user.find(user => user.id === id);
    assert.equal((await send('/admin/set-role', { userId: ann.id, role: 'admin' })).status, 200);
    assert.equal(row(ann.id).role, 'admin');
    // A first password for someone who never had one.
    assert.equal((await send('/admin/set-user-password', { userId: bo.id, newPassword: 'bos-new-password-1' })).status, 200);
    assert.equal((await signIn(cookieJar(), 'bo', 'bos-new-password-1')).status, 200);
    // A reset ends every session and any unused setup link.
    const annJar = cookieJar();
    await signIn(annJar, 'ann');
    store.tables.account_setup.push({ token_hash: 'h', user_id: ann.id, created_by: 'shared', expires_at: new Date(Date.now() + 86400000), used_at: null });
    assert.equal((await send('/admin/set-user-password', { userId: ann.id, newPassword: 'anns-new-password-1' })).status, 200);
    assert.deepEqual([store.tables.session.filter(session => session.userId === ann.id).length, store.tables.account_setup.length], [0, 0]);
    assert.equal(await view(annJar.header()), null);
    assert.equal((await signIn(cookieJar(), 'ann')).status, 401, 'the old password no longer works');
    assert.equal((await signIn(cookieJar(), 'ann', 'anns-new-password-1')).status, 200);
    assert.equal((await send('/admin/remove-user', { userId: ann.id })).status, 200);
    assert.equal(row(ann.id), undefined);
    assert.ok(store.app.some(query => query.text === 'DELETE FROM access_group_member WHERE user_id = $1' && query.values[0] === ann.id));
    assert.deepEqual(audited(store), [['shared', 'person.role_changed'], ['shared', 'person.password_set'], ['shared', 'person.password_set'], ['shared', 'person.removed']]);
    // Refused with a reason the portal shows, and nothing changes or is recorded.
    for (const [path, body, status, reason, options] of [
      ['/admin/set-role', { userId: ada.id, role: 'owner' }, 400, 'invalid_role'],
      ['/admin/set-role', { userId: 'u-nobody', role: 'user' }, 404, 'not_found'],
      ['/admin/set-user-password', { userId: ada.id, newPassword: 'too-short' }, 400, 'invalid_password'],
      ['/admin/remove-user', { userId: 'x'.repeat(65) }, 404, 'not_found'],
      ['/admin/remove-user', { userId: ada.id }, 403, 'origin_not_allowed', { origin: 'https://attacker.test' }],
      ['/admin/impersonate-user', { userId: ada.id }, 403, 'not_available_for_shared_password'],
      ['/admin/ban-user', { userId: ada.id }, 403, 'not_available_for_shared_password'],
    ]) {
      const response = await send(path, body, options);
      assert.deepEqual([response.status, (await response.json()).message], [status, reason], path);
    }
    assert.deepEqual([row(ada.id).role, row(ada.id).banned ?? false, store.tables.session.some(session => session.impersonatedBy)], ['admin', false, false]);
    assert.equal(audited(store).length, 4);
    // A personal administrator still goes through Better Auth's own endpoint and checks.
    const adaJar = cookieJar();
    await signIn(adaJar, 'ada');
    assert.equal((await send('/admin/set-role', { userId: bo.id, role: 'admin' }, { cookie: adaJar.header() })).status, 200);
    assert.equal(row(bo.id).role, 'admin');
    assert.deepEqual(audited(store).at(-1), [ada.id, 'person.role_changed']);
    assert.deepEqual(syncs(store), []);
  });
});

test('MotherDuck stays off with shared-password admin: no usernames, no service accounts, no access sync', async () => {
  await inHybrid(async store => {
    const ann = await person('ann');
    await person('ada', { role: 'admin' });
    const adaJar = cookieJar();
    await signIn(adaJar, 'ada');
    // A data group left from an earlier accounts-mode database.
    store.tables.access_group.push({ id: 'g-data', name: 'Data team', description: '', dive_access: '*', chat_access: true, service_account: 'svc_data', resources: null, monthly_token_cap: null });
    const people = await import('../app/api/admin/people/route.js');
    const access = await import('../app/api/admin/users/[id]/access/route.js');
    const groups = await import('../app/api/admin/groups/route.js');
    const group = await import('../app/api/admin/groups/[id]/route.js');
    const members = await import('../app/api/admin/groups/[id]/members/route.js');
    const serviceAccount = await import('../app/api/admin/groups/[id]/service-account/route.js');
    const OFF = 'motherduck_off_with_shared_password';
    // The shared administrator, and an administrator with their own account.
    for (const cookie of [sharedCookie(), adaJar.header()]) {
      const listed = await (await people.GET(request('/api/admin/people', { cookie }))).json();
      assert.deepEqual([listed.mdGrants, listed.mdAutomatic], [false, false], 'the portal hides the fields');
      assert.deepEqual(await refusal(await people.POST(request('/api/admin/people', { method: 'POST', cookie, body: { people: [{ username: 'mo', motherduckUser: 'mo@example.com' }] } }))), [400, OFF]);
      assert.deepEqual(await refusal(await people.POST(request('/api/admin/people', { method: 'POST', cookie, body: { people: [{ username: 'mo' }], groupId: 'g-data' } }))), [409, OFF]);
      assert.deepEqual(await refusal(await access.PATCH(request(`/api/admin/users/${ann.id}/access`, { method: 'PATCH', cookie, body: { dives: '*', chat: true, motherduckUser: 'ann@example.com' } }), params(ann.id))), [400, OFF]);
      assert.deepEqual(await refusal(await groups.POST(request('/api/admin/groups', { method: 'POST', cookie, body: { name: 'Readers', dives: '*', chat: true, serviceAccount: 'svc_readers' } }))), [400, OFF]);
      assert.deepEqual(await refusal(await group.PATCH(request('/api/admin/groups/g-data', { method: 'PATCH', cookie, body: { name: 'Data team', dives: '*', chat: true, serviceAccount: 'svc_data' } }), params('g-data'))), [400, OFF]);
      assert.deepEqual(await refusal(await members.PUT(request('/api/admin/groups/g-data/members', { method: 'PUT', cookie, body: { userId: ann.id } }), params('g-data'))), [409, OFF]);
      assert.deepEqual(await refusal(await serviceAccount.POST(request('/api/admin/groups/g-data/service-account', { method: 'POST', cookie }), params('g-data'))), [404, 'accounts_not_configured']);
    }
    assert.deepEqual([store.tables.user.some(user => user.username === 'mo'), store.tables.user.find(user => user.id === ann.id).motherduckUser ?? null], [false, null]);
    assert.ok(!store.app.some(query => /INSERT INTO access_group_member/.test(query.text)));
    // Access without MotherDuck still changes, unlinking an old MotherDuck username is allowed,
    // and nothing starts an access sync.
    const changed = await access.PATCH(request(`/api/admin/users/${ann.id}/access`, { method: 'PATCH', cookie: sharedCookie(), body: { dives: ['overview'], chat: false, motherduckUser: '' } }), params(ann.id));
    assert.equal(changed.status, 200);
    assert.deepEqual(await (await access.PATCH(request(`/api/admin/users/${ann.id}/access`, { method: 'PATCH', cookie: sharedCookie(), body: { dives: '*', chat: true } }), params(ann.id))).json(), { access: { dives: '*', chat: true } });
    assert.equal((await people.POST(request('/api/admin/people', { method: 'POST', cookie: sharedCookie(), body: { people: [{ username: 'mo' }] } }))).status, 200);
    assert.equal((await groups.POST(request('/api/admin/groups', { method: 'POST', cookie: sharedCookie(), body: { name: 'Readers', dives: '*', chat: true } }))).status, 200);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(syncs(store), [], 'no sync ran or was scheduled');
    assert.deepEqual(await requestSync({ query: () => assert.fail('a sync read the store') }), SYNC_OFF, 'whoever asks');
  });
});

test('Better Auth endpoints the app does not use are refused, in every mode', async () => {
  for (const env of [{}, { SHARED_PASSWORD_ADMIN: undefined, MOTHERDUCK_APP_TOKEN: 'app' }]) {
    await inHybrid(async () => {
      await person('ann');
      const { POST } = await import('../app/api/account/[...all]/route.js');
      const jar = cookieJar();
      await signIn(jar, 'ann');
      assert.deepEqual(await refusal(await POST(request('/api/account/is-username-available', { method: 'POST', body: { username: 'ann' } }))), [403, 'not_allowed'], 'it would tell anyone which usernames exist');
      assert.deepEqual(await refusal(await POST(request('/api/account/update-user', { method: 'POST', cookie: jar.header(), body: { name: 'Ada' } }))), [403, 'not_allowed']);
    }, env);
  }
});

test('the sign-in page offers both sign-ins, and signing out ends both or neither', async () => {
  const { GET, POST, DELETE } = await import('../app/api/auth/route.js');
  await inHybrid(async store => {
    await person('ann');
    let body = await (await GET(request('/api/auth'))).json();
    assert.deepEqual([body.mode, body.sharedPassword, body.authenticated], ['accounts', true, false]);
    body = await (await GET(request('/api/auth', { cookie: sharedCookie() }))).json();
    assert.deepEqual([body.authenticated, body.user.isAdmin, body.user.canManage, body.user.sharedAdmin, body.user.mode], [true, true, true, true, 'password']);
    const jar = cookieJar();
    await signIn(jar, 'ann');
    body = await (await GET(request('/api/auth', { cookie: jar.header() }))).json();
    assert.deepEqual([body.user.username, body.user.isAdmin, body.user.sharedAdmin, body.user.mode], ['ann', false, undefined, 'accounts']);
    const signedInNow = await POST(request('/api/auth', { method: 'POST', body: { password: base.DEMO_PASSWORD } }));
    assert.equal(signedInNow.status, 200);
    assert.match(signedInNow.headers.get('set-cookie'), new RegExp(`^${COOKIE}=[^;]+\\.[^;]+; .*HttpOnly`));

    // Better Auth cannot end the session: nothing changes, and the page says so.
    const auth = getAuth();
    const signOut = auth.api.signOut;
    const both = `${sharedCookie()}; ${jar.header()}`;
    for (const broken of [async () => { throw new Error('database unavailable'); }, async () => new Response(null, { status: 500 })]) {
      auth.api.signOut = broken;
      const out = await DELETE(request('/api/auth', { method: 'DELETE', cookie: both }));
      assert.deepEqual([...await refusal(out), out.headers.getSetCookie().length], [503, 'sign_out_failed', 0]);
      const shared = await POST(request('/api/auth', { method: 'POST', cookie: jar.header(), body: { password: base.DEMO_PASSWORD } }));
      assert.deepEqual([...await refusal(shared), shared.headers.getSetCookie().length], [503, 'sign_in_unavailable', 0], 'the person stays the only sign-in');
    }
    assert.equal(store.tables.session.length, 1);
    auth.api.signOut = signOut;
    const out = await DELETE(request('/api/auth', { method: 'DELETE', cookie: both }));
    assert.equal(out.status, 200);
    const cleared = out.headers.getSetCookie();
    assert.ok(cleared.some(cookie => cookie.startsWith(`${COOKIE}=;`) && cookie.includes('Max-Age=0')), 'the shared cookie goes');
    assert.ok(cleared.some(cookie => cookie.startsWith(`${TOKEN_COOKIE}=;`) && /Max-Age=0/i.test(cookie)), 'and the personal session with it');
    assert.equal(store.tables.session.length, 0);
    // With no personal cookie, signing out never reaches Better Auth.
    auth.api.signOut = () => assert.fail('signed out of Better Auth without a session');
    assert.equal((await DELETE(request('/api/auth', { method: 'DELETE', cookie: sharedCookie() }))).headers.getSetCookie().length, 1);
    assert.equal((await DELETE(request('/api/auth', { method: 'DELETE', cookie: both, origin: 'https://attacker.test' }))).status, 403);
    auth.api.signOut = signOut;
  });
  // The shared password keeps its per-client failure limit as the administrator sign-in.
  await inHybrid(async () => {
    const attempt = password => POST(request('/api/auth', { method: 'POST', body: { password }, headers: { 'x-test-ip': '203.0.113.77' } }));
    for (let index = 0; index < 10; index++) assert.equal((await attempt('wrong-password')).status, 401);
    assert.equal((await attempt(base.DEMO_PASSWORD)).status, 429);
  }, { AUTH_TRUSTED_IP_HEADER: 'x-test-ip' });
  // Accounts mode proper still has no shared password, and plain password mode no accounts to end.
  await inHybrid(async () => {
    assert.equal((await (await GET(request('/api/auth'))).json()).sharedPassword, undefined);
    assert.equal((await POST(request('/api/auth', { method: 'POST', body: { password: base.DEMO_PASSWORD } }))).status, 409);
  }, { SHARED_PASSWORD_ADMIN: undefined, MOTHERDUCK_APP_TOKEN: 'app' });
  await inHybrid(async () => {
    const out = await DELETE(request('/api/auth', { method: 'DELETE', cookie: `${sharedCookie()}; ${TOKEN_COOKIE}=x` }));
    assert.deepEqual([out.status, out.headers.getSetCookie().length], [200, 1]);
    assert.equal((await (await GET(request('/api/auth'))).json()).mode, 'password');
  }, { SHARED_PASSWORD_ADMIN: undefined });
});

test('an unreachable store fails fast for 30 seconds, then is tried again', async () => {
  let clock = 0, down = true;
  const opened = [];
  class Client {
    constructor(config) { this.database = config.database; }
    async connect() { opened.push(this.database); if (down) throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); }
    async query(sql) { opened.push(sql); }
    async end() {}
  }
  const options = { Client, now: () => clock };
  delete globalThis.__diveChatAppReady; delete globalThis.__diveChatAppFailed;
  globalThis.__diveChatAppPool = { on() {}, query: async () => ({ rows: [{ found: 1 }] }) };
  try {
    await assert.rejects(ensureAppStore(HYBRID, options), { code: 'ETIMEDOUT' });
    clock = STORE_RETRY_MS - 1;
    down = false;
    await assert.rejects(ensureAppStore(HYBRID, options), { code: 'ETIMEDOUT' }, 'the failure is remembered');
    assert.equal(opened.length, 1, 'and no connection is tried meanwhile');
    clock = STORE_RETRY_MS;
    await ensureAppStore(HYBRID, options);
    assert.deepEqual([opened.length, globalThis.__diveChatAppFailed], [2, undefined]);
    await ensureAppStore(HYBRID, options);
    assert.equal(opened.length, 2, 'checked once per server instance');
    // A database that does not exist yet is created first.
    delete globalThis.__diveChatAppReady;
    opened.length = 0;
    let missing = true;
    class FirstRun extends Client { async connect() { opened.push(this.database); if (missing) { missing = false; throw Object.assign(new Error('missing'), { code: '3D000' }); } } }
    await ensureAppStore(HYBRID, { ...options, Client: FirstRun });
    assert.deepEqual(opened, ['dive_chat_app', 'my_db', 'CREATE DATABASE IF NOT EXISTS dive_chat_app']);
  } finally { delete globalThis.__diveChatAppReady; delete globalThis.__diveChatAppFailed; delete globalThis.__diveChatAppPool; }
  // While it fails, a personal sign-in is refused with a status the page shows as unavailable (not
  // as a wrong password, which would count towards the account's limit); the shared password still works.
  await inHybrid(async () => {
    await person('ann');
    globalThis.__diveChatAppReady = undefined;
    globalThis.__diveChatAppFailed = { at: Date.now(), error: Object.assign(new Error('unreachable'), { code: 'ETIMEDOUT' }) };
    const jar = cookieJar();
    const refused = await signIn(jar, 'ann');
    assert.ok(![200, 401, 403, 429].includes(refused.status), `answered ${refused.status}`);
    assert.deepEqual(personal(jar), []);
    assert.equal((await signInShared(jar)).status, 200);
    globalThis.__diveChatAppReady = Promise.resolve();
    globalThis.__diveChatAppFailed = undefined;
    assert.equal((await signIn(jar, 'ann')).status, 200);
    assert.ok(!jar.has(COOKIE));
  });
});
