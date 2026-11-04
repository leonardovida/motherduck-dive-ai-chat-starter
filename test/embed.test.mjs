import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, signSession } from '../lib/security.mjs';
import { withEnv } from './helpers.mjs';

const embed = await import('../app/api/embed/route.js');
const dives = await import('../app/api/dives/route.js');

const SECRET = 'unit-test-secret-with-at-least-32-characters';
const ID = '11111111-1111-4111-8111-111111111111';
const SITE = { host: 'demo.test', origin: 'https://demo.test' };
const signedIn = (extra = {}) => ({ ...SITE, cookie: `${COOKIE}=${signSession(SECRET)}`, ...extra });
const postEmbed = (body, headers = signedIn()) => embed.POST(new Request('https://demo.test/api/embed', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const CONNECTED = { SESSION_SECRET: SECRET, DIVE_OVERVIEW_ID: ID, DIVE_OVERVIEW_VERSION: '7', MOTHERDUCK_EMBED_USERNAME: 'reader', MOTHERDUCK_EMBED_TOKEN: 'fixture-embed-token' };

test('the routes export only the methods they serve', () => {
  const methods = route => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter(method => typeof route[method] === 'function');
  assert.deepEqual(methods(embed), ['POST']);
  assert.deepEqual(methods(dives), ['GET']);
});

test('embed and Dive list require a session', async () => {
  await withEnv({ SESSION_SECRET: SECRET }, async () => {
    for (const res of [await postEmbed({ dive: 'overview' }, SITE), await dives.GET(new Request('https://demo.test/api/dives'))]) {
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error, 'authentication_required');
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
    }
  });
});

test('an unconfigured Dive returns 503 with the missing env names only', async () => {
  await withEnv({ SESSION_SECRET: SECRET, DIVE_OVERVIEW_ID: undefined, MOTHERDUCK_EMBED_TOKEN: undefined, MOTHERDUCK_EMBED_USERNAME: undefined, }, async () => {
    const res = await postEmbed({ dive: 'overview' });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.error, 'embedding_not_configured');
    assert.deepEqual(data.missing, ['DIVE_OVERVIEW_ID', 'MOTHERDUCK_EMBED_USERNAME', 'MOTHERDUCK_EMBED_TOKEN']);
  });
});

test('unknown Dives, themes, cross-origin posts and bad bodies are rejected', async () => {
  await withEnv(CONNECTED, async () => {
    assert.equal((await postEmbed({ dive: 'nope' })).status, 400);
    assert.equal((await postEmbed({ dive: 'overview', theme: 'neon' })).status, 400);
    const crossOrigin = await postEmbed({ dive: 'overview' }, signedIn({ origin: 'https://attacker.test' }));
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error, 'origin_not_allowed');
    assert.equal((await postEmbed('{')).status, 400);
    assert.equal((await postEmbed({ dive: 'overview' }, signedIn({ 'content-type': 'text/plain' }))).status, 400);
    const large = await postEmbed({ dive: 'overview', state: { big: 'x'.repeat(17000) } });
    assert.equal(large.status, 413);
    assert.equal((await large.json()).error, 'request_too_large');
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
      const res = await postEmbed({ dive: 'overview', theme: 'dark', state: { filter: 'a', 'bad key': 1, app_embedded: false } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(await res.json(), { session: 'session-value', expires_in: 86400 });
      assert.equal(observed.url, `https://api.motherduck.com/v1/dives/${ID}/embed-session`);
      assert.equal(observed.auth, 'Bearer fixture-embed-token');
      assert.deepEqual(observed.body, {
        username: 'reader',
        version: 7,
        session_name: 'embedded-dive-chat-overview',
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
      const res = await postEmbed({ dive: 'overview' });
      assert.equal(res.status, 502);
      assert.deepEqual(await res.json(), { error: 'embed_unavailable' });
    } finally {
      globalThis.fetch = originalFetch; console.error = log;
    }
  });
});

test('embed renewal respects a shorter upstream lifetime', async () => {
  await withEnv(CONNECTED, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ session: 'opaque', expires_in: 120 });
    try {
      assert.equal((await (await postEmbed({ dive: 'overview' })).json()).expires_in, 120);
    } finally { globalThis.fetch = original; }
  });
});

test('MOTHERDUCK_API_URL redirects the session request, trailing slash and all', async () => {
  await withEnv({ ...CONNECTED, MOTHERDUCK_API_URL: 'http://127.0.0.1:9/ ' }, async () => {
    const original = globalThis.fetch;
    let seen;
    globalThis.fetch = async url => { seen = String(url); return Response.json({ session: 'opaque' }); };
    try {
      assert.equal((await postEmbed({ dive: 'overview' })).status, 200);
      assert.equal(seen, `http://127.0.0.1:9/v1/dives/${ID}/embed-session`);
    } finally { globalThis.fetch = original; }
  });
});

test('the Dive list hides usernames, shares and tokens', async () => {
  await withEnv({ ...CONNECTED, MOTHERDUCK_CHAT_TOKEN: 'fixture-chat-token', DIVE_OVERVIEW_CHAT_DATABASE: 'demo_db', OPENAI_API_KEY: 'fixture-openai' }, async () => {
    const res = await dives.GET(new Request('https://demo.test/api/dives', { headers: signedIn() }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const data = await res.json();
    const [overview, explorer] = data.dives;
    assert.equal(overview.connected, true);
    assert.equal(overview.chatEnabled, true);
    assert.equal(explorer.connected, false);
    assert.equal(explorer.chatEnabled, false);
    const body = JSON.stringify(data);
    for (const secret of ['reader', 'md:_share', 'fixture-embed-token', 'fixture-chat-token', 'fixture-openai']) assert.equal(body.includes(secret), false, secret);
  });
});
