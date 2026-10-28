import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../api/auth.mjs';
import { COOKIE, DEV_PASSWORD, SESSION_SECONDS, configuredPassword, passwordMatches, sameOrigin, sanitizeState, sessionSecret, signSession, validSession } from '../lib/security.mjs';
import { request, response, withEnv } from './helpers.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
let ip = 0;
// Each call gets its own address so the login throttle never interferes.
const login = (password, headers = {}) => ({ ...request('POST', { body: { password }, headers }), socket: { remoteAddress: `10.0.0.${++ip}` } });

test('without DEMO_PASSWORD, development accepts the default and shows the hint', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined, SESSION_SECRET: undefined }, async () => {
    assert.equal(configuredPassword(), DEV_PASSWORD);
    const status = response(); await auth(request('GET'), status);
    assert.equal(status.data.devPassword, DEV_PASSWORD);
    assert.equal(status.data.appTitle, 'Dive workspace');
    const ok = response(); await auth(login(DEV_PASSWORD), ok);
    assert.equal(ok.statusCode, 200);
    assert.match(ok.headers['Set-Cookie'], new RegExp(`^${COOKIE}=[^;]+; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}$`));
  });
});

test('production refuses sign-in until DEMO_PASSWORD and a long SESSION_SECRET are set', async () => {
  for (const env of [
    { DEMO_PASSWORD: undefined, SESSION_SECRET: SECRET },
    { DEMO_PASSWORD: 'set-password', SESSION_SECRET: undefined },
    { DEMO_PASSWORD: 'set-password', SESSION_SECRET: 'too-short' },
  ]) {
    await withEnv({ NODE_ENV: 'production', ...env }, async () => {
      const res = response(); await auth(login(env.DEMO_PASSWORD || DEV_PASSWORD), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.data.error, 'auth_not_configured');
      assert.equal(res.headers['Set-Cookie'], undefined);
      const status = response(); await auth(request('GET'), status);
      assert.equal(status.data.devPassword, undefined, 'no hint in production');
    });
  }
});

test('production signs in with the configured password only', async () => {
  await withEnv({ NODE_ENV: 'production', DEMO_PASSWORD: 'correct horse', SESSION_SECRET: SECRET, APP_TITLE: 'Acme demo', AUTH_TRUSTED_IP_HEADER: 'x-real-ip' }, async () => {
    const denied = response(); await auth(login(DEV_PASSWORD), denied);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.headers['Set-Cookie'], undefined);
    const ok = response(); await auth(login('correct horse'), ok);
    assert.equal(ok.statusCode, 200);
    const value = ok.headers['Set-Cookie'].split(';')[0].slice(COOKIE.length + 1);
    assert.equal(validSession(value, SECRET), true);
    const status = response(); await auth(request('GET', { headers: { cookie: `${COOKIE}=${value}` } }), status);
    assert.deepEqual(status.data, { authenticated: true, appTitle: 'Acme demo' });
  });
});

test('production cannot silently fall back to a shared client bucket', async () => {
  await withEnv({ NODE_ENV: 'production', VERCEL: '1', AUTH_TRUSTED_IP_HEADER: undefined, DEMO_PASSWORD: 'correct', SESSION_SECRET: SECRET }, async () => {
    const missing = response(); await auth(request('POST', { body: { password: 'correct' } }), missing);
    assert.equal(missing.statusCode, 503);
    const valid = response(); await auth(request('POST', { body: { password: 'correct' }, headers: { 'x-forwarded-for': '198.51.100.90' } }), valid);
    assert.equal(valid.statusCode, 200);
  });
});

test('cross-origin sign-in and sign-out are rejected; sign-out clears the cookie', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined }, async () => {
    for (const method of ['POST', 'DELETE']) {
      const res = response(); await auth(request(method, { body: { password: DEV_PASSWORD }, headers: { origin: 'https://attacker.test' } }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.headers['Set-Cookie'], undefined);
    }
    const out = response(); await auth(request('DELETE'), out);
    assert.match(out.headers['Set-Cookie'], /Max-Age=0/);
  });
});

test('repeated failures are throttled', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined }, async () => {
    const headers = { 'x-forwarded-for': '192.0.2.50' };
    let last;
    for (let i = 0; i < 11; i++) { last = response(); await auth(request('POST', { body: { password: 'wrong' }, headers }), last); }
    assert.equal(last.statusCode, 429);
  });
});

test('rotating untrusted forwarded headers cannot bypass failed-password throttling', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined, AUTH_TRUSTED_IP_HEADER: undefined }, async () => {
    let res;
    for (let i = 0; i < 11; i++) {
      res = response();
      await auth({ ...request('POST', { body: { password: 'wrong' }, headers: { 'x-forwarded-for': `198.51.100.${i}` } }), socket: { remoteAddress: '192.0.2.60' } }, res);
    }
    assert.equal(res.statusCode, 429);
  });
});

test('successful sign-ins do not consume the failed-password limit', async () => {
  await withEnv({ NODE_ENV: 'development', DEMO_PASSWORD: undefined }, async () => {
    for (let i = 0; i < 20; i++) {
      const res = response();
      await auth({ ...request('POST', { body: { password: DEV_PASSWORD } }), socket: { remoteAddress: '192.0.2.61' } }, res);
      assert.equal(res.statusCode, 200);
    }
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

test('same-origin allows plain http only for local development', () => {
  const req = (origin, host) => ({ headers: { origin, host } });
  assert.equal(sameOrigin(req('https://demo.test', 'demo.test'), {}), true);
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
