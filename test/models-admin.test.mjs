// Drives the real /api/admin/models route with a stand-in session and app database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFakeOpenAICompatible } from './fake-openai-compatible.mjs';

const OPENROUTER_KEY = 'sk-or-v1-fixture-openrouter-credential-0123456789';
const COMPAT_KEY = 'fixture-self-hosted-secret-value';
const fake = await startFakeOpenAICompatible();
const rejecting = await startFakeOpenAICompatible({ status: 401, errorBody: { error: { message: `Invalid key ${COMPAT_KEY} sent with Authorization: Bearer ${COMPAT_KEY}` } } });
test.after(async () => { await fake.close(); await rejecting.close(); });

for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CHAT_PROVIDER', 'CHAT_MODELS', 'PUBLIC_DEMO']) delete process.env[name];
Object.assign(process.env, {
  SESSION_SECRET: 'unit-test-secret-with-at-least-32-characters',
  MOTHERDUCK_APP_TOKEN: 'fixture-app-token',
  OPENROUTER_API_KEY: OPENROUTER_KEY,
  OPENAI_COMPATIBLE_BASE_URL: rejecting.url,
  OPENAI_COMPATIBLE_API_KEY: COMPAT_KEY,
});

// Sessions by cookie, and an app database that keeps app_setting and audit_event in memory.
const db = { setting: null, audit: [] };
globalThis.__diveChatAuth = { api: { getSession: async ({ headers }) => {
  const cookie = headers.get('cookie');
  if (cookie === 'admin') return { session: { id: 's-admin' }, user: { id: 'u-admin', username: 'ada', role: 'admin' } };
  if (cookie === 'viewer') return { session: { id: 's-viewer' }, user: { id: 'u-viewer', username: 'val', role: 'user' } };
  return null;
} } };
globalThis.__diveChatAppPool = { query: async (text, values = []) => {
  if (text.startsWith('SELECT value, updated_at, updated_by FROM app_setting')) return { rows: db.setting ? [db.setting] : [] };
  if (text.startsWith('INSERT INTO app_setting')) { db.setting = { value: values[1], updated_at: values[2], updated_by: values[3] }; return { rows: [] }; }
  if (text.startsWith('DELETE FROM app_setting')) { db.setting = null; return { rows: [] }; }
  if (text.startsWith('INSERT INTO audit_event')) { db.audit.push({ action: values[4], actor: values[3], detail: values[7] }); return { rows: [] }; }
  return { rows: [] };
} };

const { GET, PUT, POST, DELETE } = await import('../app/api/admin/models/route.js');
const { tierModel, enabledModelKeys } = await import('../lib/chat-models.mjs');
const call = (handler, { cookie = 'admin', origin = 'https://demo.test', method = 'GET', body } = {}) => handler(new Request('https://demo.test/api/admin/models', {
  method, headers: { host: 'demo.test', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
}));
const settings = {
  tiers: {
    luna: { provider: 'openai-compatible', model: 'local-model', options: { baseURL: fake.url } },
    astra: { provider: 'openrouter', model: 'anthropic/claude-opus-5.5' },
  },
  enabled: ['luna', 'astra'],
};

test('only signed-in admins can read the Models tab, and no secret value is returned', async () => {
  assert.equal((await call(GET, { cookie: null })).status, 401);
  const viewer = await call(GET, { cookie: 'viewer' });
  assert.equal(viewer.status, 403);
  assert.deepEqual(await viewer.json(), { error: 'admin_required' });
  const response = await call(GET);
  assert.equal(response.status, 200);
  const text = await response.text();
  for (const secret of [OPENROUTER_KEY, COMPAT_KEY, 'fixture-app-token', rejecting.url]) assert.ok(!text.includes(secret), 'secrets and env URLs stay on the server');
  const body = JSON.parse(text);
  const openrouter = body.providers.find(provider => provider.id === 'openrouter');
  assert.deepEqual(openrouter.env.find(item => item.name === 'OPENROUTER_API_KEY'), { name: 'OPENROUTER_API_KEY', set: true, secret: true, optional: false });
  assert.equal(body.settings, null);
  assert.equal(body.tiers[0].effective.source, 'default');
});

test('writes need an admin, the same origin and no public demo', async () => {
  assert.equal((await call(PUT, { cookie: 'viewer', method: 'PUT', body: { settings } })).status, 403);
  const cross = await call(PUT, { origin: 'https://attacker.test', method: 'PUT', body: { settings } });
  assert.equal(cross.status, 403);
  assert.deepEqual(await cross.json(), { error: 'origin_not_allowed' });
  assert.equal((await call(DELETE, { origin: 'https://attacker.test', method: 'DELETE' })).status, 403);
  assert.equal((await call(POST, { origin: 'https://attacker.test', method: 'POST', body: { tier: 'luna' } })).status, 403);
  process.env.PUBLIC_DEMO = 'true';
  try {
    for (const [handler, method, body] of [[PUT, 'PUT', { settings }], [DELETE, 'DELETE'], [POST, 'POST', { tier: 'luna' }]]) {
      const response = await call(handler, { method, body });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'demo_read_only' });
    }
  } finally { delete process.env.PUBLIC_DEMO; }
  assert.equal(db.setting, null);
  assert.equal(db.audit.length, 0);
});

test('invalid settings are refused with a reason, and nothing is stored', async () => {
  const cases = [
    [{ tiers: { luna: { provider: 'mystery', model: 'x' } } }, 'unknown_provider'],
    [{ tiers: { luna: { provider: 'openai-compatible', model: 'm', options: { baseURL: 'ftp://host/v1' } } } }, 'url_must_be_http'],
    [{ tiers: { luna: { provider: 'openai-compatible', model: 'm', options: { baseURL: 'https://user:pass@host/v1' } } } }, 'url_has_credentials'],
    [{ tiers: { luna: { provider: 'openai-compatible', model: 'm', options: { baseURL: 'https://host/v1?key=abc' } } } }, 'url_has_query'],
    [{ tiers: { luna: { provider: 'openrouter', model: 'm', options: { apiKey: 'nope' } } } }, 'invalid_settings'],
    [{ tiers: { luna: { provider: 'openai', model: 'sk-proj-abcdefghijklmnopqrstuvwxyz' } } }, 'looks_like_secret'],
  ];
  for (const [input, error] of cases) {
    const response = await call(PUT, { method: 'PUT', body: { settings: input } });
    assert.equal(response.status, 400, error);
    assert.equal((await response.json()).error, error);
  }
  assert.equal(db.setting, null);
});

test('saving applies at once, wins over the environment, and is audited', async () => {
  const response = await call(PUT, { method: 'PUT', body: { settings } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.enabled, ['luna', 'astra']);
  assert.equal(body.tiers[0].effective.source, 'settings');
  assert.equal(body.tiers[1].effective.source, 'default', 'tiers left out follow the environment');
  assert.ok(JSON.parse(db.setting.value).tiers.luna);
  assert.equal(db.setting.updated_by, 'ada');
  assert.deepEqual(db.audit.at(-1).action, 'models.updated');
  assert.ok(!db.audit.at(-1).detail.includes(fake.url), 'the audit entry names providers and models only');
  // The chat reads the cached settings without a restart.
  assert.equal(tierModel('luna').provider, 'openai-compatible');
  assert.equal(tierModel('astra').id, 'anthropic/claude-opus-5.5');
  assert.deepEqual(enabledModelKeys(), ['luna', 'astra']);
});

test('Test checks a saved tier or a draft, and never echoes a credential', async () => {
  const saved = await (await call(POST, { method: 'POST', body: { tier: 'luna' } })).json();
  assert.equal(saved.ok, true);
  assert.equal(saved.toolCall, true);
  assert.equal(fake.seen.at(-1).headers.authorization, undefined, 'the env key is not sent to a URL set only in the portal');

  const failed = await (await call(POST, { method: 'POST', body: { tier: 'sol', config: { provider: 'openai-compatible', model: 'local-model' } } })).json();
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 401);
  assert.equal(rejecting.seen.at(-1).headers.authorization, `Bearer ${COMPAT_KEY}`, 'the env key goes to the env URL');
  assert.ok(!JSON.stringify(failed).includes(COMPAT_KEY));
  assert.match(failed.hint, /credentials/);

  const missing = await (await call(POST, { method: 'POST', body: { tier: 'sol', config: { provider: 'bedrock', model: 'global.anthropic.claude-sonnet-5-5' } } })).json();
  assert.equal(missing.ok, false);
  assert.match(missing.error, /AWS_BEARER_TOKEN_BEDROCK/);
  assert.equal((await call(POST, { method: 'POST', body: { tier: 'sol', config: { provider: 'nope', model: 'x' } } })).status, 400);
});

test('reset forgets the saved settings and is audited', async () => {
  const response = await call(DELETE, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings, null);
  assert.equal(db.setting, null);
  assert.equal(db.audit.at(-1).action, 'models.reset');
  assert.equal(tierModel('luna').provider, 'openrouter', 'back to the environment: OPENROUTER_API_KEY is detected');
});
