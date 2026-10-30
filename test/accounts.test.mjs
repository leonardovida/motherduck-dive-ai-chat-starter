import test from 'node:test';
import assert from 'node:assert/strict';
import { accountsEnabled, authOptions, emailDomainAllowed, publicSsoProviders, ssoProviders } from '../lib/auth.mjs';
import { addColumnStatements, createStatements } from '../lib/app-db-schema.mjs';
import { canSeeDive, getViewer, parseDiveAccess, viewerFromUser } from '../lib/viewer.mjs';
import { appDatabase } from '../lib/app-db.mjs';
import { COOKIE, signSession } from '../lib/security.mjs';
import { requireAdmin } from '../lib/admin-api.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';

test('accounts mode turns on with the app token; the database name is validated', () => {
  assert.equal(accountsEnabled({}), false);
  assert.equal(accountsEnabled({ MOTHERDUCK_APP_TOKEN: 'token' }), true);
  assert.equal(appDatabase({}), 'dive_chat_app');
  assert.equal(appDatabase({ APP_DATABASE: 'team_chat' }), 'team_chat');
  assert.throws(() => appDatabase({ APP_DATABASE: 'x; DROP' }), /plain database name/);
});

test('SSO buttons come from env, and only ids and labels reach the browser', () => {
  assert.deepEqual(ssoProviders({}), []);
  const env = { SSO_CLIENT_ID: 'id', SSO_CLIENT_SECRET: 'shh', SSO_ISSUER: 'https://idp.example.com/', SSO_LABEL: 'Acme SSO', GITHUB_CLIENT_ID: 'gh', GITHUB_CLIENT_SECRET: 'shh', MICROSOFT_CLIENT_ID: 'ms', MICROSOFT_CLIENT_SECRET: 'shh', MICROSOFT_TENANT_ID: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' };
  const providers = ssoProviders(env);
  assert.deepEqual(providers.map(provider => provider.id), ['sso', 'microsoft-entra-id', 'github']);
  assert.equal(providers[0].config.discoveryUrl, 'https://idp.example.com/.well-known/openid-configuration');
  assert.deepEqual(publicSsoProviders(env), [{ id: 'sso', label: 'Acme SSO' }, { id: 'microsoft-entra-id', label: 'Microsoft' }, { id: 'github', label: 'GitHub' }]);
  assert.ok(!JSON.stringify(publicSsoProviders(env)).includes('shh'));
});

test('SSO creates accounts only for allowed domains; otherwise admins create them', () => {
  assert.equal(emailDomainAllowed('a@acme.com', {}), false);
  assert.equal(emailDomainAllowed('a@ACME.com', { AUTH_ALLOWED_EMAIL_DOMAINS: 'acme.com, acme.io' }), true);
  assert.equal(emailDomainAllowed('a@evil.com', { AUTH_ALLOWED_EMAIL_DOMAINS: 'acme.com' }), false);
  const closed = authOptions({ SSO_CLIENT_ID: 'id', SSO_CLIENT_SECRET: 's', SSO_ISSUER: 'https://idp.example.com', SESSION_SECRET: SECRET });
  const generic = closed.plugins.find(plugin => plugin.id === 'generic-oauth');
  assert.ok(generic, 'generic OIDC plugin is enabled');
  assert.equal(closed.emailAndPassword.disableSignUp, true);
  assert.equal(closed.advanced.database.validateSchema, false);
});

test('the DuckDB schema covers Better Auth, the access fields and saved conversations', () => {
  const statements = createStatements(authOptions({ SESSION_SECRET: SECRET }));
  const user = statements.find(statement => statement.startsWith('CREATE TABLE IF NOT EXISTS "user"'));
  for (const column of ['"username" VARCHAR UNIQUE', '"role" VARCHAR', '"banned" BOOLEAN', '"diveAccess" VARCHAR', '"chatAccess" BOOLEAN', '"email" VARCHAR UNIQUE NOT NULL']) assert.ok(user.includes(column), column);
  assert.ok(statements.some(statement => statement.startsWith('CREATE TABLE IF NOT EXISTS "session"')));
  assert.ok(statements.some(statement => statement.startsWith('CREATE TABLE IF NOT EXISTS chat_message')));
  assert.ok(!statements.join(' ').includes('REFERENCES'), 'DuckDB cannot cascade, so references are indexes only');
  assert.ok(statements.some(statement => /CREATE INDEX IF NOT EXISTS "session_userId_idx"/.test(statement)));
  assert.ok(addColumnStatements(authOptions({ SESSION_SECRET: SECRET })).every(statement => !/UNIQUE|NOT NULL/.test(statement)));
});

test('viewer access: all Dives by default, a list when set, nothing when banned', () => {
  assert.equal(parseDiveAccess(undefined), '*');
  assert.deepEqual(parseDiveAccess('overview, explorer,Bad Key'), ['overview', 'explorer']);
  const viewer = viewerFromUser({ id: 'u', name: 'Bob', username: 'bob', role: 'user', diveAccess: 'overview', chatAccess: false });
  assert.deepEqual([viewer.isAdmin, viewer.chat, canSeeDive(viewer, 'overview'), canSeeDive(viewer, 'explorer')], [false, false, true, false]);
  assert.equal(viewerFromUser({ id: 'u', role: 'user,admin' }).isAdmin, true);
  assert.equal(viewerFromUser({ id: 'u', banned: true }), null);
});

test('password mode keeps one shared viewer and has no admin portal', async () => {
  const env = { SESSION_SECRET: SECRET };
  assert.equal(await getViewer({}, env), null);
  const viewer = await getViewer({ cookie: `${COOKIE}=${signSession(SECRET)}` }, env);
  assert.deepEqual([viewer.mode, viewer.isAdmin, viewer.dives], ['password', false, '*']);
  const { response } = await requireAdmin(new Request('https://demo.test/api/admin/conversations'));
  assert.equal(response.status, 404);
});

test('accounts mode reads the session from Better Auth', async () => {
  const fakeAuth = { api: { getSession: async ({ headers }) => (headers.get('cookie') === 'ok' ? { user: { id: 'u1', name: 'Ann', username: 'ann', role: 'admin' } } : null) } };
  const env = { MOTHERDUCK_APP_TOKEN: 't' };
  assert.equal((await getViewer({ cookie: 'ok' }, env, fakeAuth)).isAdmin, true);
  assert.equal(await getViewer({ cookie: 'nope' }, env, fakeAuth), null);
  const failing = { api: { getSession: async () => { throw new Error('db down'); } } };
  assert.equal(await getViewer({ cookie: 'ok' }, env, failing), null);
});

test('sensitive routes can bypass the session cookie cache', async () => {
  const seen = [];
  const fakeAuth = { api: { getSession: async options => { seen.push(options.query); return { user: { id: 'u1', role: 'user' } }; } } };
  await getViewer({ cookie: 'ok' }, { MOTHERDUCK_APP_TOKEN: 't' }, fakeAuth);
  await getViewer({ cookie: 'ok' }, { MOTHERDUCK_APP_TOKEN: 't' }, fakeAuth, { fresh: true });
  assert.deepEqual(seen, [undefined, { disableCookieCache: true }]);
});
