// Security checks on routes: cron bearer auth, admin and manager access, conversation ownership,
// cleanup when a person is removed, and the content security policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cronAuthorized } from '../lib/cron.mjs';
import { requireAdmin } from '../lib/admin-api.mjs';
import { fakeAccounts, withEnv } from './helpers.mjs';

const ACCOUNTS = { MOTHERDUCK_APP_TOKEN: 'unit-test', PUBLIC_DEMO: undefined, CHAT_HISTORY: undefined };
const USERS = {
  admin: { id: 'a1', name: 'Ada', username: 'ada', role: 'admin', diveAccess: '*', chatAccess: true },
  manager: { id: 'm1', name: 'Max', username: 'max', role: 'user', diveAccess: '', chatAccess: false },
  ann: { id: 'u-ann', name: 'Ann', username: 'ann', role: 'user', diveAccess: '*', chatAccess: true },
  bob: { id: 'u-bob', name: 'Bob', username: 'bob', role: 'user', diveAccess: '*', chatAccess: true },
};
const CONVERSATION = 'conv-12345678';

// What the fake app database answers: Max manages Acme and is a plain member of Other, and
// Ann owns one conversation.
function rows(sql, values) {
  if (sql.includes('FROM access_group_member m JOIN access_group g') && values[0] === 'm1') {
    return [
      { id: 'g-acme', name: 'Acme', dive_access: 'overview', chat_access: true, manager: true },
      { id: 'g-other', name: 'Other', dive_access: '', chat_access: false, manager: false },
    ];
  }
  if (sql.startsWith('SELECT id, user_id, user_label, dive_key') && values[0] === CONVERSATION) return [{ id: CONVERSATION, user_id: 'u-ann', dive_key: 'overview', title: 'Sales', session_id: null }];
  if (sql.includes('FROM chat_message WHERE conversation_id')) return [{ id: 'q1', role: 'user', content: 'Hi' }, { id: 'r1', role: 'assistant', content: 'Hello', model_tier: 'luna', status: 'answered', feedback: 0, worked_ms: 12 }];
  return [];
}

const request = (path, { method = 'GET', who, origin = 'https://demo.test', body } = {}) => new Request(`https://demo.test${path}`, {
  method,
  headers: { host: 'demo.test', ...(origin ? { origin } : {}), ...(who ? { cookie: who } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// Runs fn in accounts mode against the fakes, with extra env.
async function inAccounts(env, fn) {
  const fake = fakeAccounts({ users: USERS, rows });
  try { return await withEnv({ ...ACCOUNTS, ...env }, () => fn(fake)); } finally { fake.restore(); }
}

const errorOf = async response => (await response?.json())?.error;

test('the cron bearer check needs a CRON_SECRET of 16 characters and the exact token', () => {
  const call = (authorization, env) => cronAuthorized(new Request('https://demo.test/api/cron/x', { headers: authorization ? { authorization } : {} }), env);
  const secret = 'cron-secret-0123456789';
  assert.equal(call('Bearer ', {}), false, 'no CRON_SECRET');
  assert.equal(call('Bearer undefined', {}), false);
  assert.equal(call('Bearer short-secret', { CRON_SECRET: 'short-secret' }), false, 'shorter than 16 characters');
  assert.equal(call(`Bearer ${secret.slice(0, -1)}x`, { CRON_SECRET: secret }), false, 'wrong token');
  assert.equal(call(secret, { CRON_SECRET: secret }), false, 'no Bearer prefix');
  assert.equal(call(`Bearer ${secret}x`, { CRON_SECRET: secret }), false);
  assert.equal(call(undefined, { CRON_SECRET: secret }), false);
  assert.equal(call(`Bearer ${secret}`, { CRON_SECRET: secret }), true);
});

test('both cron routes refuse anyone without the token and run for the scheduler', async () => {
  const secret = 'cron-secret-0123456789';
  const routes = { daily: 'accounts_not_configured', digest: 'conversations_not_saved' };
  for (const [name, skipped] of Object.entries(routes)) {
    const { GET } = await import(`../app/api/cron/${name}/route.js`);
    const call = authorization => GET(new Request(`https://demo.test/api/cron/${name}`, { headers: authorization ? { authorization } : {} }));
    await withEnv({ CRON_SECRET: undefined, MOTHERDUCK_APP_TOKEN: undefined }, async () => {
      assert.equal((await call('Bearer ')).status, 404, `${name}: no secret`);
    });
    await withEnv({ CRON_SECRET: 'short-secret', MOTHERDUCK_APP_TOKEN: undefined }, async () => {
      assert.equal((await call('Bearer short-secret')).status, 404, `${name}: short secret`);
    });
    await withEnv({ CRON_SECRET: secret, MOTHERDUCK_APP_TOKEN: undefined }, async () => {
      const wrong = await call('Bearer cron-secret-wrong-token');
      assert.equal(wrong.status, 404, `${name}: wrong token`);
      assert.deepEqual(await wrong.json(), { error: 'not_found' });
      assert.equal(wrong.headers.get('cache-control'), 'private, no-store');
      const right = await call(`Bearer ${secret}`);
      assert.equal(right.status, 200, `${name}: right token`);
      assert.deepEqual(await right.json(), { skipped });
    });
  }
});

test('admin routes need a signed-in administrator', async () => {
  await inAccounts({}, async () => {
    assert.equal((await requireAdmin(request('/api/admin/audit'))).response.status, 401);
    for (const who of ['ann', 'manager']) {
      const { response } = await requireAdmin(request('/api/admin/audit', { who }));
      assert.equal(response.status, 403, who);
      assert.equal(await errorOf(response), 'admin_required');
    }
    const { response, viewer, scope } = await requireAdmin(request('/api/admin/audit', { who: 'admin' }));
    assert.equal(response, undefined);
    assert.equal(viewer.id, 'a1');
    assert.deepEqual(scope, { all: true, groups: [] });
  });
});

test('people routes also answer to group managers, scoped to the groups they manage', async () => {
  await inAccounts({}, async () => {
    const plain = await requireAdmin(request('/api/admin/people', { who: 'ann' }), { managers: true });
    assert.equal(await errorOf(plain.response), 'admin_required', 'someone who manages nothing is refused');
    const { response, scope } = await requireAdmin(request('/api/admin/people', { who: 'manager' }), { managers: true });
    assert.equal(response, undefined);
    assert.deepEqual(scope, { all: false, groups: ['g-acme'] }, 'a group they only belong to is not in scope');
  });
});

test('a manager listing people sees only the members of the groups they manage', async () => {
  const { GET } = await import('../app/api/admin/people/route.js');
  await inAccounts({}, async fake => {
    const response = await GET(request('/api/admin/people', { who: 'manager' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).scope, 'manager');
    const listing = fake.queries.find(query => query.text.includes('FROM "user" WHERE id IN (SELECT user_id FROM access_group_member WHERE group_id IN'));
    assert.deepEqual(listing.values, ['g-acme']);
    assert.equal(fake.queries.some(query => /FROM "user" ORDER BY/.test(query.text)), false, 'never the full list');
  });
});

test('admin and manager writes need the same origin', async () => {
  await inAccounts({}, async () => {
    for (const [who, options] of [['admin', { write: true }], ['manager', { write: true, managers: true }]]) {
      for (const origin of ['https://attacker.test', 'http://demo.test', '']) {
        const { response } = await requireAdmin(request('/api/admin/people', { method: 'POST', who, origin }), options);
        assert.equal(response.status, 403, `${who} from ${origin || 'no origin'}`);
        assert.equal(await errorOf(response), 'origin_not_allowed');
      }
      assert.equal((await requireAdmin(request('/api/admin/people', { method: 'POST', who }), options)).response, undefined);
    }
    // Reads do not need an Origin header.
    assert.equal((await requireAdmin(request('/api/admin/audit', { who: 'admin', origin: '' }))).response, undefined);
  });
});

test('a public demo shows admin screens but refuses every admin write', async () => {
  await inAccounts({ PUBLIC_DEMO: 'true' }, async () => {
    for (const [who, options] of [['admin', {}], ['manager', { managers: true }]]) {
      assert.equal((await requireAdmin(request('/api/admin/people', { who }), options)).response, undefined, `${who} can read`);
      const { response } = await requireAdmin(request('/api/admin/people', { method: 'POST', who }), { ...options, write: true });
      assert.equal(response.status, 403);
      assert.equal(await errorOf(response), 'demo_read_only');
    }
  });
});

test('people can read and delete only their own conversations', async () => {
  const { GET, DELETE } = await import('../app/api/chat/conversations/[id]/route.js');
  const params = { params: Promise.resolve({ id: CONVERSATION }) };
  const deletes = fake => fake.queries.filter(query => query.text.startsWith('DELETE'));
  await inAccounts({}, async fake => {
    const own = await GET(request(`/api/chat/conversations/${CONVERSATION}`, { who: 'ann' }), params);
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'private, no-store');
    const { conversation } = await own.json();
    assert.deepEqual([conversation.id, conversation.messages.map(message => message.text)], [CONVERSATION, ['Hi', 'Hello']]);

    // Someone else's conversation looks exactly like one that does not exist.
    for (const response of [
      await GET(request(`/api/chat/conversations/${CONVERSATION}`, { who: 'bob' }), params),
      await DELETE(request(`/api/chat/conversations/${CONVERSATION}`, { method: 'DELETE', who: 'bob' }), params),
    ]) {
      assert.equal(response.status, 404);
      assert.equal(await errorOf(response), 'not_found');
    }
    assert.equal((await GET(request(`/api/chat/conversations/${CONVERSATION}`), params)).status, 401);
    assert.deepEqual(deletes(fake), [], 'nothing was deleted for Bob');

    const deleted = await DELETE(request(`/api/chat/conversations/${CONVERSATION}`, { method: 'DELETE', who: 'ann' }), params);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true });
    assert.ok(deletes(fake).some(query => query.text === 'DELETE FROM chat_conversation WHERE id = $1' && query.values[0] === CONVERSATION));
  });
});

test('deleting a conversation needs the same origin and is refused in a public demo', async () => {
  const { DELETE } = await import('../app/api/chat/conversations/[id]/route.js');
  const params = { params: Promise.resolve({ id: CONVERSATION }) };
  await inAccounts({}, async fake => {
    for (const origin of ['https://attacker.test', '']) {
      const response = await DELETE(request(`/api/chat/conversations/${CONVERSATION}`, { method: 'DELETE', who: 'ann', origin }), params);
      assert.equal(response.status, 403);
      assert.equal(await errorOf(response), 'origin_not_allowed');
    }
    assert.equal(fake.queries.length, 0, 'refused before reading anything');
  });
  await inAccounts({ PUBLIC_DEMO: 'true' }, async fake => {
    const response = await DELETE(request(`/api/chat/conversations/${CONVERSATION}`, { method: 'DELETE', who: 'ann' }), params);
    assert.equal(response.status, 403);
    assert.equal(await errorOf(response), 'demo_read_only');
    assert.equal(fake.queries.length, 0);
  });
});

test('removing a person also removes their group memberships and setup links', async () => {
  const { POST } = await import('../app/api/account/[...all]/route.js');
  const remove = (who, userId) => POST(request('/api/account/admin/remove-user', { method: 'POST', who, body: { userId } }));
  const cleanup = fake => fake.queries.filter(query => /^DELETE FROM (access_group_member|account_setup) WHERE user_id = \$1$/.test(query.text));
  await inAccounts({}, async fake => {
    assert.equal((await remove('admin', 'u-bob')).status, 200);
    assert.deepEqual(cleanup(fake).map(query => [query.text.split(' ')[2], query.values]), [['access_group_member', ['u-bob']], ['account_setup', ['u-bob']]]);
  });
  // When Better Auth refuses the removal, the person keeps everything.
  const fake = fakeAccounts({ users: USERS, rows, handler: async () => Response.json({ code: 'FORBIDDEN' }, { status: 403 }) });
  try {
    await withEnv(ACCOUNTS, async () => {
      assert.equal((await remove('admin', 'u-bob')).status, 403);
      assert.deepEqual(cleanup(fake), []);
    });
  } finally { fake.restore(); }
});

test('the content security policy carries a fresh nonce and forbids framing', async () => {
  const { proxy } = await import('../proxy.js');
  const policy = () => {
    const response = proxy(new Request('https://demo.test/'));
    const csp = response.headers.get('content-security-policy');
    return { csp, nonce: csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1], forwarded: response.headers.get('x-middleware-request-x-nonce') };
  };
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const first = policy(), second = policy();
    assert.ok(first.nonce && first.nonce.length >= 24, 'a nonce is present');
    assert.equal(first.forwarded, first.nonce, 'the page receives the same nonce');
    assert.notEqual(first.nonce, second.nonce, 'every response gets its own nonce');
    assert.match(first.csp, /(^|; )frame-ancestors 'none'(;|$)/);
    assert.match(first.csp, /(^|; )object-src 'none'(;|$)/);
    assert.doesNotMatch(first.csp, /unsafe-eval/);
  });
  await withEnv({ NODE_ENV: 'test' }, async () => assert.doesNotMatch(policy().csp, /unsafe-eval/));
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { csp } = policy();
    assert.match(csp, /script-src [^;]*'unsafe-eval'/, 'only development allows eval');
    assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/);
  });
});

test('the daily run deletes messages past CHAT_RETENTION_DAYS before syncing access', async () => {
  const secret = 'cron-secret-0123456789';
  const { GET } = await import('../app/api/cron/daily/route.js');
  const call = () => GET(new Request('https://demo.test/api/cron/daily', { headers: { authorization: `Bearer ${secret}` } }));
  await inAccounts({ CRON_SECRET: secret, CHAT_RETENTION_DAYS: '7', MOTHERDUCK_ADMIN_TOKEN: undefined }, async fake => {
    const response = await call();
    assert.equal((await response.json()).retention, 'purged');
    const purge = fake.queries.find(item => item.text.startsWith('DELETE FROM chat_message WHERE created_at <'));
    assert.ok(purge, 'old messages are deleted');
    assert.ok(Date.now() - purge.values[0].getTime() >= 7 * 86400000 - 1000);
  });
  await inAccounts({ CRON_SECRET: secret, CHAT_RETENTION_DAYS: undefined, MOTHERDUCK_ADMIN_TOKEN: undefined }, async fake => {
    assert.equal((await (await call()).json()).retention, 'off');
    assert.ok(!fake.queries.some(item => item.text.startsWith('DELETE FROM chat_message')));
  });
});
