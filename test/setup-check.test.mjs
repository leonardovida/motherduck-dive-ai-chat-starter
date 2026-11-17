import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSetup } from '../lib/setup-check.mjs';

const env = {
  DIVE_OVERVIEW_ID: '11111111-1111-4111-8111-111111111111',
  MOTHERDUCK_EMBED_USERNAME: 'private-reader', MOTHERDUCK_EMBED_TOKEN: 'private-embed',
  MOTHERDUCK_CHAT_TOKEN: 'private-chat', DIVE_OVERVIEW_CHAT_DATABASE: 'private_database', OPENAI_API_KEY: 'private-openai',
};

test('offline setup reports missing names without making requests', async () => {
  const result = await checkSetup({ env: {}, fetcher: () => assert.fail('offline check made a request') });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /DIVE_OVERVIEW_ID.*MOTHERDUCK_EMBED_USERNAME.*MOTHERDUCK_EMBED_TOKEN/);
});

test('live setup verifies embed, database and model access without printing credentials', async () => {
  const calls = [];
  const result = await checkSetup({ env, live: true,
    fetcher: async (url, options) => {
      calls.push(url);
      if (url.includes('embed-session')) {
        assert.equal(JSON.parse(options.body).username, env.MOTHERDUCK_EMBED_USERNAME);
        return Response.json({ session: 'opaque-private-session' });
      }
      return Response.json({ id: 'model' });
    },
    read: async (chat, run, actualEnv) => {
      assert.equal(chat.database, env.DIVE_OVERVIEW_CHAT_DATABASE);
      assert.equal(actualEnv, env);
      await run(async sql => { assert.equal(sql, 'SELECT 1 AS setup_check'); return [{ setup_check: 1 }]; });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  const output = result.lines.join('\n');
  for (const value of [...Object.values(env), 'opaque-private-session']) assert.equal(output.includes(value), false);
});

test('live checks verify the configured Dive version and the provider endpoint used by chat', async () => {
  const urls = [];
  const result = await checkSetup({ env: { ...env, DIVE_OVERVIEW_VERSION: '7', OPENAI_BASE_URL: 'https://proxy.example/v1/' }, live: true,
    fetcher: async (url, options) => {
      urls.push(url);
      if (url.includes('embed-session')) { assert.equal(JSON.parse(options.body).version, 7); return Response.json({ session: 'opaque' }); }
      return Response.json({ id: 'model' });
    }, read: async () => [],
  });
  assert.equal(result.ok, true);
  assert.equal(urls[1], 'https://proxy.example/v1/models/gpt-6-luna');
});

test('live setup identifies a 404 account/Dive mismatch and suppresses provider errors', async () => {
  const result = await checkSetup({ env, live: true,
    fetcher: async () => new Response('private-provider-body', { status: 404 }),
    read: async () => { throw new Error('private-database-and-token'); },
  });
  assert.equal(result.ok, false);
  const output = result.lines.join('\n');
  assert.match(output, /exact service-account username/);
  assert.match(output, /MOTHERDUCK_PG_HOST region/);
  assert.equal(output.includes('private-'), false);
});

test('embed-only setup succeeds while partially configured chat needs attention', async () => {
  const embedOnly = { ...env, OPENAI_API_KEY: undefined, MOTHERDUCK_CHAT_TOKEN: undefined, DIVE_OVERVIEW_CHAT_DATABASE: undefined };
  assert.equal((await checkSetup({ env: embedOnly })).ok, true);
  assert.equal((await checkSetup({ env: embedOnly, requireChat: true })).ok, false);
  assert.equal((await checkSetup({ env: { ...embedOnly, OPENAI_API_KEY: 'key' } })).ok, false);
  assert.equal((await checkSetup({ env: { ...env, NODE_ENV: 'production' } })).ok, false);
});

test('shared-password admin creates and checks the app database live, and needs APP_URL in production', async () => {
  const hybrid = { ...env, SHARED_PASSWORD_ADMIN: 'true', DEMO_PASSWORD: 'private-password' };
  const offline = await checkSetup({ env: hybrid, ensureStore: () => assert.fail('offline check touched the store'), appRead: () => assert.fail('offline check read the store') });
  assert.equal(offline.ok, true);
  assert.match(offline.lines.join('\n'), /Shared-password admin is on/);
  assert.doesNotMatch(offline.lines.join('\n'), /admin:create/);
  const reachable = { fetcher: async () => Response.json({ session: 's', id: 'model' }), read: async () => {} };
  const calls = [];
  const live = await checkSetup({ env: hybrid, live: true, ...reachable,
    ensureStore: async actual => { calls.push(['ensure', actual === hybrid]); },
    appRead: async (sql, values, actual) => { calls.push([sql, actual === hybrid]); return []; } });
  assert.deepEqual(calls, [['ensure', true], ['SELECT count(*) FROM "user"', true]], 'created and migrated first, then read');
  assert.match(live.lines.join('\n'), /OK App database: reachable, created and migrated/);
  const down = await checkSetup({ env: hybrid, live: true, ...reachable,
    ensureStore: async () => { throw Object.assign(new Error('password authentication failed for private-embed'), { code: '28P01' }); }, appRead: async () => [] });
  assert.equal(down.ok, false);
  assert.match(down.lines.join('\n'), /FIX App database: unreachable or not writable/);
  assert.equal(down.lines.join('\n').includes('private-'), false, 'no error text or token is printed');
  // Production: the shared password, a session secret, a proxy header and the address people open.
  const production = { ...hybrid, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), AUTH_TRUSTED_IP_HEADER: 'x-real-ip' };
  const noUrl = await checkSetup({ env: production });
  assert.equal(noUrl.ok, false);
  assert.match(noUrl.lines.join('\n'), /FIX Production accounts need APP_URL/);
  assert.equal((await checkSetup({ env: { ...production, APP_URL: 'https://dives.example.com' } })).ok, true);
  assert.equal((await checkSetup({ env: { ...production, VERCEL_PROJECT_PRODUCTION_URL: 'dives.example.com' } })).ok, true, 'Vercel is detected');
  assert.equal((await checkSetup({ env: { ...production, APP_URL: 'https://dives.example.com', DEMO_PASSWORD: '' } })).ok, false, 'the shared password is still required');
});
