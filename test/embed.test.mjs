import test from 'node:test';
import assert from 'node:assert/strict';
import embed from '../api/embed.mjs';
import dives from '../api/dives.mjs';
import { COOKIE, signSession } from '../lib/security.mjs';
import { request, response, withEnv } from './helpers.mjs';

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const ID = '11111111-1111-4111-8111-111111111111';
const signedIn = (extra = {}) => ({ cookie: `${COOKIE}=${signSession(SECRET)}`, ...extra });
const CONNECTED = { SESSION_SECRET: SECRET, DIVE_OVERVIEW_ID: ID, DIVE_OVERVIEW_VERSION: '7', DIVE_OVERVIEW_SHARE_URL: 'md:_share/demo/abc', MOTHERDUCK_EMBED_USERNAME: 'reader', MOTHERDUCK_EMBED_TOKEN: 'fixture-embed-token' };

test('embed and Dive list require a session', async () => {
  await withEnv({ SESSION_SECRET: SECRET }, async () => {
    for (const handler of [embed, dives]) {
      const res = response(); await handler(request('GET', { url: '/api/embed?dive=overview' }), res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.data.error, 'authentication_required');
      assert.equal(res.headers['Cache-Control'], 'private, no-store');
    }
  });
});

test('an unconfigured Dive returns 503 with the missing env names only', async () => {
  await withEnv({ SESSION_SECRET: SECRET, DIVE_OVERVIEW_ID: undefined, MOTHERDUCK_EMBED_TOKEN: undefined, MOTHERDUCK_EMBED_USERNAME: undefined, DIVE_OVERVIEW_SHARE_URL: undefined }, async () => {
    const res = response(); await embed(request('GET', { url: '/api/embed?dive=overview', headers: signedIn() }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.data.error, 'embedding_not_configured');
    assert.deepEqual(res.data.missing, ['DIVE_OVERVIEW_ID', 'MOTHERDUCK_EMBED_USERNAME', 'MOTHERDUCK_EMBED_TOKEN']);
  });
});

test('unknown Dives and themes are rejected', async () => {
  await withEnv(CONNECTED, async () => {
    const unknown = response(); await embed(request('GET', { url: '/api/embed?dive=nope', headers: signedIn() }), unknown);
    assert.equal(unknown.statusCode, 400);
    const theme = response(); await embed(request('GET', { url: '/api/embed?dive=overview&theme=neon', headers: signedIn() }), theme);
    assert.equal(theme.statusCode, 400);
    const crossOrigin = response(); await embed(request('POST', { body: { dive: 'overview' }, headers: signedIn({ origin: 'https://attacker.test' }) }), crossOrigin);
    assert.equal(crossOrigin.statusCode, 403);
  });
});

test('the upstream request uses server config, sanitized state and the theme', async () => {
  await withEnv(CONNECTED, async () => {
    const originalFetch = globalThis.fetch;
    let observed;
    globalThis.fetch = async (url, options) => {
      observed = { url, auth: options.headers.Authorization, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ session: 'session-value' }), { status: 200 });
    };
    try {
      const res = response();
      await embed(request('POST', { body: { dive: 'overview', theme: 'dark', state: { filter: 'a', 'bad key': 1, app_embedded: false } }, headers: signedIn() }), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.data, { session: 'session-value', expires_in: 86400 });
      assert.equal(observed.url, `https://api.motherduck.com/v1/dives/${ID}/embed-session`);
      assert.equal(observed.auth, 'Bearer fixture-embed-token');
      assert.deepEqual(observed.body, {
        username: 'reader',
        version: 7,
        session_hint: 'embedded-dive-chat-overview',
        required_resources: [],
        initial_state: { filter: 'a', app_theme: 'dark', app_embedded: true },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('upstream failures do not leak details', async () => {
  await withEnv(CONNECTED, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('upstream detail', { status: 500 });
    const log = console.error; console.error = () => {};
    try {
      const res = response(); await embed(request('GET', { url: '/api/embed?dive=overview', headers: signedIn() }), res);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.data, { error: 'embed_unavailable' });
    } finally {
      globalThis.fetch = originalFetch; console.error = log;
    }
  });
});

test('the Dive list hides usernames, shares and tokens', async () => {
  await withEnv({ ...CONNECTED, MOTHERDUCK_CHAT_TOKEN: 'fixture-chat-token', DIVE_OVERVIEW_CHAT_DATABASE: 'demo_db', OPENAI_API_KEY: 'fixture-openai' }, async () => {
    const res = response(); await dives(request('GET', { headers: signedIn() }), res);
    assert.equal(res.statusCode, 200);
    const [overview, explorer] = res.data.dives;
    assert.equal(overview.connected, true);
    assert.equal(overview.chatEnabled, true);
    assert.equal(explorer.connected, false);
    assert.equal(explorer.chatEnabled, false);
    const body = JSON.stringify(res.data);
    for (const secret of ['reader', 'md:_share', 'fixture-embed-token', 'fixture-chat-token', 'fixture-openai']) assert.equal(body.includes(secret), false, secret);
  });
});
