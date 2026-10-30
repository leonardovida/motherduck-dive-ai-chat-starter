import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAllowsAuthRoute, publicDemo } from '../lib/public-demo.mjs';
import { modelCatalog, resolveModel } from '../lib/chat-models.mjs';
import { getViewer } from '../lib/viewer.mjs';

test('public demo mode is off unless PUBLIC_DEMO=true', () => {
  assert.equal(publicDemo({}), false);
  assert.equal(publicDemo({ PUBLIC_DEMO: 'yes' }), false);
  assert.equal(publicDemo({ PUBLIC_DEMO: ' TRUE ' }), true);
});

test('demo visitors can sign in, sign out and read, but not change accounts', () => {
  for (const [method, path] of [['POST', '/sign-in/username'], ['POST', '/sign-out'], ['GET', '/get-session'], ['GET', '/admin/list-users'], ['GET', '/callback/sso']]) {
    assert.equal(demoAllowsAuthRoute(method, path), true, `${method} ${path}`);
  }
  for (const [method, path] of [['POST', '/change-password'], ['POST', '/update-user'], ['POST', '/delete-user'], ['POST', '/revoke-sessions'], ['POST', '/admin/set-user-password'], ['POST', '/admin/create-user'], ['POST', '/admin/remove-user'], ['POST', '/admin/impersonate-user'], ['POST', '/admin/ban-user'], ['GET', '/delete-user/callback'], ['GET', '/admin/list-users/../x'], ['DELETE', '/sign-out']]) {
    assert.equal(demoAllowsAuthRoute(method, path), false, `${method} ${path}`);
  }
});

test('a public demo lists switched-off models so the picker can grey them out', () => {
  const env = { OPENAI_API_KEY: 'k', CHAT_MODELS: 'luna', PUBLIC_DEMO: 'true' };
  assert.deepEqual(modelCatalog(env), { models: ['luna'], defaultModel: 'luna', unavailable: ['auto', 'sol', 'astra'] });
  assert.equal(resolveModel('astra', env).id, 'gpt-6-luna');
  assert.equal(resolveModel('auto', env).id, 'gpt-6-luna');
  assert.equal('unavailable' in modelCatalog({ OPENAI_API_KEY: 'k', CHAT_MODELS: 'luna' }), false);
});

test('account viewers carry their session id, so a shared demo account is limited per visitor', async () => {
  const fakeAuth = { api: { getSession: async () => ({ session: { id: 's1' }, user: { id: 'u1', role: 'admin' } }) } };
  assert.equal((await getViewer({ cookie: 'ok' }, { MOTHERDUCK_APP_TOKEN: 't' }, fakeAuth)).sessionId, 's1');
});

test('the account endpoint refuses changes in a public demo before reaching the database', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { MOTHERDUCK_APP_TOKEN: 'unit-test', PUBLIC_DEMO: 'true', SESSION_SECRET: 'unit-test-secret-with-at-least-32-characters' });
  try {
    const { POST } = await import('../app/api/account/[...all]/route.js');
    const response = await POST(new Request('https://demo.test/api/account/change-password', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'demo_read_only' });
  } finally {
    for (const key of ['MOTHERDUCK_APP_TOKEN', 'PUBLIC_DEMO', 'SESSION_SECRET']) if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
  }
});
