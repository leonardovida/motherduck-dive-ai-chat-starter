import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_KEYS, chatConfigured, defaultProvider, enabledModelKeys, tierModel, utilityModel } from '../lib/chat-models.mjs';
import { languageModel } from '../lib/model-providers.mjs';
import { DEFAULT_MODELS, keyDestinationAllowed } from '../lib/provider-registry.mjs';
import { cachedModelSettings, createModelSettingsStore, modelSettingsOf, parseModelSettings, refreshModelSettings, setCachedModelSettings, withModelSettings } from '../lib/model-settings.mjs';
import { sanitizeProviderError } from '../lib/model-test.mjs';

test('every provider resolves its default tiers and builds a model without a network call', () => {
  const envs = {
    openrouter: { OPENROUTER_API_KEY: 'k' },
    azure: { AZURE_API_KEY: 'k', AZURE_RESOURCE_NAME: 'my-resource' },
    bedrock: { AWS_BEARER_TOKEN_BEDROCK: 'k', AWS_REGION: 'us-east-1' },
    vertex: { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_CLIENT_EMAIL: 'chat@my-project.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'k' },
    'openai-compatible': { OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1', OPENAI_COMPATIBLE_MODEL: 'llama3.1:8b' },
  };
  const sdk = { openrouter: 'openrouter.chat', azure: 'azure.responses', bedrock: 'amazon-bedrock', vertex: 'google.vertex.chat', 'openai-compatible': 'openaiCompatible.chat' };
  for (const [provider, env] of Object.entries(envs)) {
    assert.equal(defaultProvider(env), provider, `${provider} is detected from its own variables`);
    assert.equal(chatConfigured(env), true, provider);
    for (const key of MODEL_KEYS) {
      const model = tierModel(key, env);
      assert.equal(model.id, provider === 'openai-compatible' ? 'llama3.1:8b' : DEFAULT_MODELS[provider][key]);
      const built = languageModel(model, env);
      assert.equal(built.provider, sdk[provider]);
      assert.equal(built.modelId, model.id);
    }
  }
  assert.equal(tierModel('sol', envs.bedrock).id, 'global.anthropic.claude-sonnet-5-5');
  assert.equal(tierModel('astra', envs.vertex).id, 'gemini-4-argon');
  assert.equal(tierModel('sol', envs['openai-compatible']).reasoning, undefined, 'self-hosted tiers send no reasoning setting');
  assert.equal(tierModel('sol', envs.bedrock).reasoning, 'medium');
  assert.match(languageModel({ provider: 'vertex', id: 'claude-sonnet-5-5', options: {} }, envs.vertex).provider, /anthropic/);
  assert.equal(languageModel({ provider: 'azure', id: 'my-deployment', options: { api: 'chat' } }, envs.azure).provider, 'azure.chat');
});

test('existing OpenAI or Anthropic deployments are unchanged by the new providers', () => {
  // Another provider's credentials do not take over while OpenAI or Anthropic keys are present.
  const openai = { OPENAI_API_KEY: 'k', OPENROUTER_API_KEY: 'k', AWS_BEARER_TOKEN_BEDROCK: 'k', AWS_REGION: 'us-east-1' };
  assert.deepEqual(MODEL_KEYS.map(key => [tierModel(key, openai).provider, tierModel(key, openai).id]), [['openai', 'gpt-6-luna'], ['openai', 'gpt-6.1-sol'], ['openai', 'gpt-6-astra']]);
  assert.equal(defaultProvider({ ANTHROPIC_API_KEY: 'k', AZURE_API_KEY: 'k', AZURE_RESOURCE_NAME: 'r' }), 'anthropic');
  // Ambient AWS keys alone (as on many AWS runtimes) do not select Bedrock.
  assert.equal(defaultProvider({ AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-1' }), 'openai');
  assert.equal(defaultProvider({ CHAT_PROVIDER: 'amazon-bedrock' }), 'bedrock');
  const nova = tierModel('luna', { OPENAI_API_KEY: 'k', CHAT_MODEL_LUNA: 'bedrock:us.amazon.nova-micro-v1:0' });
  assert.deepEqual([nova.provider, nova.id], ['bedrock', 'us.amazon.nova-micro-v1:0']);
  assert.equal(tierModel('luna', { CHAT_PROVIDER: 'self-hosted', OPENAI_COMPATIBLE_BASE_URL: 'http://h/v1', CHAT_MODEL_LUNA: 'qwen3:8b' }).id, 'qwen3:8b', 'an Ollama tag with ":" stays a model id');
  assert.equal(utilityModel({ OPENAI_API_KEY: 'k' }).id, 'gpt-6-luna');
  const utility = utilityModel({ OPENAI_API_KEY: 'k', CHAT_MODEL_UTILITY: 'anthropic:claude-haiku-5-5' });
  assert.deepEqual([utility.provider, utility.id], ['anthropic', 'claude-haiku-5-5']);
});

test('a self-hosted endpoint needs a model, and Bedrock and Vertex need a region or project', () => {
  assert.equal(chatConfigured({ OPENAI_COMPATIBLE_BASE_URL: 'http://h/v1' }), false);
  assert.equal(chatConfigured({ CHAT_PROVIDER: 'bedrock', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's' }), false);
  assert.equal(chatConfigured({ CHAT_PROVIDER: 'bedrock', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'eu-west-1' }), true);
  assert.equal(chatConfigured({ CHAT_PROVIDER: 'vertex', GOOGLE_APPLICATION_CREDENTIALS: '/k.json' }), false);
  assert.equal(chatConfigured({ CHAT_PROVIDER: 'vertex', GOOGLE_VERTEX_ADC: 'true', GOOGLE_VERTEX_PROJECT: 'my-project' }), true);
});

test('settings validation refuses unknown providers, unsafe URLs, unknown fields and secrets', () => {
  const tier = (provider, model, options) => ({ tiers: { luna: { provider, model, ...(options ? { options } : {}) } } });
  const code = input => { try { parseModelSettings(input); return 'ok'; } catch (error) { return error.code; } };
  assert.equal(code(tier('openai-compatible', 'llama3.1:8b', { baseURL: 'http://10.0.0.5:8000/v1/' })), 'ok');
  assert.equal(parseModelSettings(tier('openai-compatible', 'm', { baseURL: 'http://h:8000/v1/' })).tiers.luna.options.baseURL, 'http://h:8000/v1');
  assert.equal(code(tier('gemini', 'm')), 'unknown_provider');
  assert.equal(code(tier('openai-compatible', 'm', { baseURL: 'javascript:alert(1)' })), 'url_must_be_http');
  assert.equal(code(tier('openai-compatible', 'm', { baseURL: 'not a url' })), 'invalid_url');
  assert.equal(code(tier('openai-compatible', 'm', { baseURL: 'https://u:p@h/v1' })), 'url_has_credentials');
  assert.equal(code(tier('openai-compatible', 'm', { baseURL: 'https://h/v1?api-key=1' })), 'url_has_query');
  assert.equal(code(tier('openai', 'gpt-6-luna', { baseURL: 'https://h/v1' })), 'field_not_allowed', 'native providers take endpoints from env only');
  assert.equal(code(tier('bedrock', 'm', { region: 'us-east-1; rm' })), 'invalid_region');
  assert.equal(code(tier('vertex', 'm', { project: 'Bad Project' })), 'invalid_project');
  assert.equal(code(tier('azure', 'm', { resourceName: 'r', baseURL: 'https://r.openai.azure.com/openai' })), 'azure_resource_or_url');
  assert.equal(code(tier('openrouter', 'model with spaces')), 'invalid_model_id');
  assert.equal(code({ tiers: { luna: { provider: 'openrouter', model: 'm', apiKey: 'x' } } }), 'invalid_settings');
  assert.equal(code({ tiers: {}, secretAccessKey: 'x' }), 'invalid_settings');
  for (const secret of ['sk-ant-api03-abcdefghijklmnop', 'AKIAABCDEFGHIJKLMNOP', '-----BEGIN PRIVATE KEY-----', 'AIzaSyA1234567890abcdefghijklmnopqrstuv']) {
    assert.equal(code(tier('openai-compatible', 'm', { baseURL: `https://h/${secret}` })), 'looks_like_secret', secret);
  }
  assert.equal(code({ enabled: [] }), 'invalid_settings');
  assert.deepEqual(parseModelSettings({ enabled: ['astra', 'luna'] }), { tiers: {}, enabled: ['luna', 'astra'] });
  assert.deepEqual(parseModelSettings(tier('bedrock', 'global.anthropic.claude-haiku-5-5', { region: '' })).tiers.luna.options, {}, 'empty fields fall back to env');
});

test('precedence: saved settings, then environment variables, then built-in defaults', () => {
  const env = { OPENAI_API_KEY: 'k', OPENROUTER_API_KEY: 'k', CHAT_MODEL_SOL: 'openai:gpt-6-sol-pro', CHAT_MODELS: 'luna,sol' };
  const saved = withModelSettings(env, { tiers: { luna: { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', options: {} } }, enabled: ['luna', 'sol', 'astra'] });
  assert.deepEqual([tierModel('luna', saved).provider, tierModel('luna', saved).id, tierModel('luna', saved).source], ['openrouter', 'anthropic/claude-haiku-5.5', 'settings']);
  assert.deepEqual([tierModel('sol', saved).id, tierModel('sol', saved).source], ['gpt-6-sol-pro', 'environment']);
  assert.deepEqual([tierModel('astra', saved).id, tierModel('astra', saved).source], ['gpt-6-astra', 'default']);
  assert.deepEqual(enabledModelKeys(saved), ['luna', 'sol', 'astra'], 'saved tiers override CHAT_MODELS');
  assert.deepEqual(enabledModelKeys(env), ['luna', 'sol']);
  assert.equal(utilityModel(saved).provider, 'openrouter', 'the utility model follows the cheapest tier unless set');
  assert.equal(utilityModel(withModelSettings(env, { tiers: {}, utility: { provider: 'anthropic', model: 'claude-haiku-5-5', options: {} } })).provider, 'anthropic');
  // A saved tier whose provider has no credentials is hidden like any other.
  assert.deepEqual(enabledModelKeys(withModelSettings(env, { tiers: { astra: { provider: 'bedrock', model: 'x', options: {} } }, enabled: ['luna', 'sol', 'astra'] })), ['luna', 'sol']);
  // The cache applies only to the live process environment, never to explicit env objects.
  setCachedModelSettings({ tiers: { luna: { provider: 'anthropic', model: 'claude-haiku-5-5', options: {} } } });
  try {
    assert.equal(modelSettingsOf(env), null);
    assert.equal(tierModel('luna', env).provider, 'openai');
    assert.equal(tierModel('luna').provider, 'anthropic');
  } finally { setCachedModelSettings(null); }
});

test('settings are read from the app database only in accounts mode, with a short cache', async () => {
  let reads = 0;
  const value = JSON.stringify({ tiers: { sol: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } });
  const store = createModelSettingsStore(async () => { reads += 1; return [{ value, updated_at: new Date(), updated_by: 'ada' }]; });
  assert.equal(await refreshModelSettings({ env: {}, store }), null, 'without accounts mode only env applies');
  assert.equal(reads, 0);
  const env = { MOTHERDUCK_APP_TOKEN: 't' };
  assert.equal((await refreshModelSettings({ env, store, force: true })).tiers.sol.model, 'claude-sonnet-5-5');
  await refreshModelSettings({ env, store });
  assert.equal(reads, 1, 'served from the cache');
  const broken = createModelSettingsStore(async () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); });
  assert.equal((await refreshModelSettings({ env, store: broken, force: true })).tiers.sol.model, 'claude-sonnet-5-5', 'a failed read keeps the last good settings');
  const missing = createModelSettingsStore(async () => { throw new Error('Catalog Error: Table with name app_setting does not exist!'); });
  assert.equal(await missing.get(), null, 'before db:migrate there are no settings');
  const tampered = createModelSettingsStore(async () => [{ value: JSON.stringify({ tiers: { luna: { provider: 'evil', model: 'x' } } }) }]);
  assert.equal(await tampered.get(), null, 'rows that no longer validate are ignored');
  assert.ok(cachedModelSettings());
  await refreshModelSettings({ env: {} });
  assert.equal(cachedModelSettings(), null);
});

test('provider error text is scrubbed of credentials before it reaches the portal', () => {
  const env = {
    OPENROUTER_API_KEY: 'sk-or-v1-0123456789abcdef', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\n-----END PRIVATE KEY-----', MY_SERVICE_TOKEN: 'custom-token-value-123',
  };
  const message = [
    'Unauthorized: key sk-or-v1-0123456789abcdef is invalid.',
    'Signature mismatch for wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.',
    'Headers: Authorization: Bearer abc.def.ghi; x-api-key=plain-value',
    'URL https://user:pw@gateway.example.com/v1/chat?api-key=zzz failed.',
    'Leaked MIIEvQIBADANBgkqhkiG9w0BAQEFAASC and custom-token-value-123 and AKIAIOSFODNN7EXAMPLE.',
  ].join(' ');
  const clean = sanitizeProviderError(new Error(message), env);
  for (const secret of ['sk-or-v1-0123456789abcdef', 'wJalrXUtnFEMI', 'abc.def.ghi', 'plain-value', 'user:pw', 'zzz', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'custom-token-value-123', 'AKIAIOSFODNN7EXAMPLE']) {
    assert.ok(!clean.includes(secret), `${secret} is removed: ${clean}`);
  }
  assert.match(clean, /^Unauthorized: key \[redacted\] is invalid/);
  assert.ok(sanitizeProviderError(new Error('x'.repeat(1000))).length <= 300);
});

test('a key from the environment is sent only to its own endpoint', () => {
  assert.equal(keyDestinationAllowed('openrouter', 'https://openrouter.ai/api/v1', {}), true);
  assert.equal(keyDestinationAllowed('openrouter', 'https://collector.example.com/v1', {}), false);
  assert.equal(keyDestinationAllowed('openrouter', 'https://gw.example.com/v1', { OPENROUTER_BASE_URL: 'https://gw.example.com/api' }), true);
  assert.equal(keyDestinationAllowed('openai-compatible', 'http://vllm:8000/v1', { OPENAI_COMPATIBLE_BASE_URL: 'http://vllm:8000/v1' }), true);
  assert.equal(keyDestinationAllowed('openai-compatible', 'http://other:8000/v1', { OPENAI_COMPATIBLE_BASE_URL: 'http://vllm:8000/v1' }), false);
  assert.equal(keyDestinationAllowed('openai-compatible', 'http://vllm:8000/v1', {}), false);
  assert.equal(keyDestinationAllowed('azure', 'https://my-res.services.ai.azure.com/openai/v1', {}), true);
  assert.equal(keyDestinationAllowed('azure', 'https://evil.example.com/openai', {}), false);
  assert.equal(keyDestinationAllowed('azure', 'http://my-res.openai.azure.com/openai', {}), false);
  assert.equal(keyDestinationAllowed('azure', undefined, {}), true);
});

test('setup asks for the default provider\'s variable names', async () => {
  const { setupRequirements } = await import('../lib/provider-registry.mjs');
  assert.deepEqual(setupRequirements('openai').map(item => item.name), ['OPENAI_API_KEY']);
  assert.deepEqual(setupRequirements('bedrock', {}).map(item => item.name), ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION']);
  assert.deepEqual(setupRequirements('bedrock', { AWS_ACCESS_KEY_ID: 'a' }).map(item => item.name), ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION']);
  assert.deepEqual(setupRequirements('openai-compatible').filter(item => item.required).map(item => item.name), ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL']);
});
