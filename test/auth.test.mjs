import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, DEV_PASSWORD, SESSION_SECONDS, configuredPassword, passwordMatches, sameOrigin, sanitizeState, sessionSecret, signSession, validSession } from '../lib/security.mjs';
import { fakeAccounts, withEnv } from './helpers.mjs';

const route = await import('../app/api/auth/route.js');
const { GET, POST, DELETE } = route;

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const SITE = { host: 'demo.test', origin: 'https://demo.test' };
const get = (headers = {}) => GET(new Request('https://demo.test/api/auth', { headers: { ...SITE, ...headers } }));
const post = (body, headers = {}) => POST(new Request('https://demo.test/api/auth', { method: 'POST', headers: { ...SITE, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const signOut = (headers = {}) => DELETE(new Request('https://demo.test/api/auth', { method: 'DELETE', headers: { ...SITE, ...headers } }));
// The throttle keys on the trusted proxy header, as production does. Each call gets its own
// address unless a test names one, so the throttle never interferes between tests.
const TRUSTED = { AUTH_TRUSTED_IP_HEADER: 'x-real-ip' };
let ip = 0;
const login = (password, address = `10.0.0.${++ip}`) => post({ password }, { 'x-real-ip': address });
const COOKIE_SET = new RegExp(`^${COOKIE}=[^;]+; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}$`);

test('the route serves GET, POST and DELETE only', () => {
  assert.deepEqual(['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'HEAD', 'OPTIONS'].filter(method => typeof route[method] === 'function'), ['GET', 'POST', 'DELETE']);
});

test('without DEMO_PASSWORD, development accepts the default and shows the hint', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined, SESSION_SECRET: undefined, APP_TITLE: undefined, ...TRUSTED }, async () => {
    assert.equal(configuredPassword(), DEV_PASSWORD);
    const status = await get();
    assert.equal(status.headers.get('cache-control'), 'private, no-store');
    const data = await status.json();
    assert.equal(data.devPassword, DEV_PASSWORD);
    assert.equal(data.appTitle, 'Dive workspace');
    const ok = await login(DEV_PASSWORD);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('set-cookie'), COOKIE_SET);
  });
});

test('production refuses sign-in until DEMO_PASSWORD and a long SESSION_SECRET are set', async () => {
  for (const env of [
    { DEMO_PASSWORD: undefined, SESSION_SECRET: SECRET },
    { DEMO_PASSWORD: 'set-password', SESSION_SECRET: undefined },
    { DEMO_PASSWORD: 'set-password', SESSION_SECRET: 'too-short' },
  ]) {
    await withEnv({ NODE_ENV: 'production', ...TRUSTED, ...env }, async () => {
      const res = await login(env.DEMO_PASSWORD || DEV_PASSWORD);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error, 'auth_not_configured');
      assert.equal(res.headers.get('set-cookie'), null);
      assert.equal((await (await get()).json()).devPassword, undefined, 'no hint in production');
    });
  }
});

test('production signs in with the configured password only', async () => {
  await withEnv({ NODE_ENV: 'production', DEMO_PASSWORD: 'correct horse', SESSION_SECRET: SECRET, APP_TITLE: 'Acme demo', ...TRUSTED }, async () => {
    const denied = await login(DEV_PASSWORD);
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error, 'invalid_password');
    assert.equal(denied.headers.get('set-cookie'), null);
    const ok = await login('correct horse');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { authenticated: true });
    assert.match(ok.headers.get('set-cookie'), COOKIE_SET);
    const value = ok.headers.get('set-cookie').split(';')[0].slice(COOKIE.length + 1);
    assert.equal(validSession(value, SECRET), true);
    assert.deepEqual(await (await get({ cookie: `${COOKIE}=${value}` })).json(), { mode: 'password', authenticated: true, appTitle: 'Acme demo' });
  });
});

test('production cannot silently fall back to a shared client bucket', async () => {
  await withEnv({ NODE_ENV: 'production', VERCEL: '1', AUTH_TRUSTED_IP_HEADER: undefined, DEMO_PASSWORD: 'correct', SESSION_SECRET: SECRET }, async () => {
    assert.equal((await post({ password: 'correct' })).status, 503);
    assert.equal((await post({ password: 'correct' }, { 'x-forwarded-for': '198.51.100.90' })).status, 200);
  });
  await withEnv({ NODE_ENV: 'production', VERCEL: undefined, ...TRUSTED, DEMO_PASSWORD: 'correct', SESSION_SECRET: SECRET }, async () => {
    assert.equal((await post({ password: 'correct' }, { 'x-real-ip': 'not-an-ip' })).status, 503);
  });
});

test('cross-origin sign-in and sign-out are rejected; sign-out clears the cookie', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined, ...TRUSTED }, async () => {
    for (const res of [await post({ password: DEV_PASSWORD }, { origin: 'https://attacker.test', 'x-real-ip': '10.1.0.1' }), await signOut({ origin: 'https://attacker.test' }), await signOut({ origin: '' })]) {
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, 'origin_not_allowed');
      assert.equal(res.headers.get('set-cookie'), null);
    }
    const out = await signOut();
    assert.equal(out.status, 200);
    assert.deepEqual(await out.json(), { authenticated: false });
    assert.equal(out.headers.get('set-cookie'), `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  });
});

test('sign-in bodies must be small JSON', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined, ...TRUSTED }, async () => {
    const headers = { 'x-real-ip': '10.2.0.1' };
    assert.equal((await post('{', headers)).status, 400);
    assert.equal((await post({ password: DEV_PASSWORD }, { ...headers, 'content-type': 'text/plain' })).status, 400);
    const large = await post({ password: 'x'.repeat(17000) }, headers);
    assert.equal(large.status, 413);
    assert.equal((await large.json()).error, 'request_too_large');
  });
});

test('accounts mode signs in through Better Auth instead', async () => {
  const fake = fakeAccounts({ users: { ok: { id: 'u1', name: 'Ann', username: 'ann', role: 'user', diveAccess: '*', chatAccess: true } } });
  try {
    await withEnv({ MOTHERDUCK_APP_TOKEN: 'unit-test', PUBLIC_DEMO: undefined, CHAT_HISTORY: undefined }, async () => {
      const res = await post({ password: DEV_PASSWORD });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error, 'use_account_sign_in');
      const anonymous = await (await get()).json();
      assert.deepEqual([anonymous.mode, anonymous.authenticated, anonymous.user], ['accounts', false, undefined]);
      const signedIn = await (await get({ cookie: 'ok' })).json();
      assert.deepEqual([signedIn.authenticated, signedIn.user.username, signedIn.recording], [true, 'ann', true]);
    });
  } finally { fake.restore(); }
});

test('repeated failures from one trusted address are throttled; other addresses are not', async () => {
  await withEnv({ NODE_ENV: 'production', DEMO_PASSWORD: 'correct', SESSION_SECRET: SECRET, ...TRUSTED }, async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login('wrong', '192.0.2.50')).status, 401);
    const blocked = await login('correct', '192.0.2.50');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '600');
    assert.equal((await blocked.json()).error, 'too_many_attempts');
    assert.equal(blocked.headers.get('set-cookie'), null);
    assert.equal((await login('correct', '192.0.2.51')).status, 200);
  });
});

test('rotating untrusted forwarded headers cannot bypass failed-password throttling', async () => {
  await withEnv({ NODE_ENV: 'production', DEMO_PASSWORD: 'correct', SESSION_SECRET: SECRET, VERCEL: undefined, ...TRUSTED }, async () => {
    let res;
    for (let i = 0; i < 11; i++) res = await post({ password: 'wrong' }, { 'x-real-ip': '192.0.2.60', 'x-forwarded-for': `198.51.100.${i}` });
    assert.equal(res.status, 429);
  });
});

test('successful sign-ins do not consume the failed-password limit', async () => {
  await withEnv({ NODE_ENV: 'production', DEMO_PASSWORD: 'correct', SESSION_SECRET: SECRET, ...TRUSTED }, async () => {
    for (let i = 0; i < 20; i++) assert.equal((await login('correct', '192.0.2.61')).status, 200);
  });
});

test('password comparison is constant-time over hashes and rejects odd input', () => {
  assert.equal(passwordMatches('secret', 'secret'), true);
  assert.equal(passwordMatches('secret', 'Secret'), false);
  assert.equal(passwordMatches('s', 'a much longer expected password'), false);
  for (const input of [undefined, null, '', 42, 'x'.repeat(257)]) assert.equal(passwordMatches(input, 'secret'), false);
  assert.equal(passwordMatches('secret', ''), false);
});

test('sessions reject tampering, expiry and other keys', () => {
  const now = 1800000000000;
  const value = signSession(SECRET, now);
  assert.equal(validSession(value, SECRET, now), true);
  const [body, signature] = value.split('.');
  assert.equal(validSession(`${body}x.${signature}`, SECRET, now), false);
  assert.equal(validSession(`${value}.extra`, SECRET, now), false);
  assert.equal(validSession(value, SECRET, now + SESSION_SECONDS * 1000), false);
  assert.equal(validSession(value, 'another-secret-with-at-least-32-characters', now), false);
  assert.equal(validSession(value, 'short', now), false);
});

test('the dev session secret is random, shared and absent in production', () => {
  assert.equal(sessionSecret({ NODE_ENV: 'production' }), null);
  const dev = sessionSecret({ NODE_ENV: 'development' });
  assert.equal(dev.length >= 32, true);
  assert.equal(sessionSecret({ NODE_ENV: 'development' }), dev);
});

test('same-origin allows plain http only for local development, from Headers or a Request', () => {
  const req = (origin, host) => new Headers({ ...(origin ? { origin } : {}), host });
  assert.equal(sameOrigin(req('https://demo.test', 'demo.test'), {}), true);
  assert.equal(sameOrigin(new Request('https://demo.test/', { headers: { origin: 'https://demo.test', host: 'demo.test' } }), {}), true);
  assert.equal(sameOrigin(req('http://localhost:3000', 'localhost:3000'), {}), true);
  assert.equal(sameOrigin(req('http://localhost:3000', 'localhost:3000'), { NODE_ENV: 'production' }), false);
  assert.equal(sameOrigin(req('http://demo.test', 'demo.test'), {}), false);
  assert.equal(sameOrigin(req('https://evil.test', 'demo.test'), {}), false);
  assert.equal(sameOrigin(req(undefined, 'demo.test'), {}), false);
});

test('Dive state is limited to plain JSON with simple keys', () => {
  assert.deepEqual(sanitizeState({ ok: 1, 'bad key': 2, 'a.b-c_d': [1] }), { ok: 1, 'a.b-c_d': [1] });
  assert.deepEqual(sanitizeState([1, 2]), {});
  assert.deepEqual(sanitizeState({ big: 'x'.repeat(9000) }), {});
});
