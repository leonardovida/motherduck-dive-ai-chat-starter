import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO, CHAT_MODELS, FOLLOW_UP_MODEL, MODEL_KEYS, chatConfigured, defaultModelKey, defaultProvider, enabledModelKeys, modelCatalog, resolveModel, routerEnabled, tierModel, utilityModel } from '../lib/chat-models.mjs';
import { languageModel } from '../lib/model-providers.mjs';

test('the catalog offers auto plus luna, sol and astra', () => {
  assert.deepEqual(MODEL_KEYS, ['luna', 'sol', 'astra']);
  assert.equal(CHAT_MODELS.luna.id, 'gpt-6-luna');
  assert.equal(CHAT_MODELS.sol.id, 'gpt-6.1-sol');
  assert.equal(CHAT_MODELS.astra.id, 'gpt-6-astra');
  assert.equal(FOLLOW_UP_MODEL, CHAT_MODELS.luna);
  assert.deepEqual(modelCatalog({}), { models: [AUTO, 'luna', 'sol', 'astra'], defaultModel: AUTO });
  assert.deepEqual(modelCatalog({ CHAT_ROUTER: 'off' }), { models: ['luna', 'sol', 'astra'], defaultModel: 'luna' });
  assert.deepEqual(modelCatalog({ CHAT_MODELS: 'sol' }), { models: ['sol'], defaultModel: 'sol' });
});

test('env limits the picker and picks the default', () => {
  assert.deepEqual(enabledModelKeys({ OPENAI_CHAT_MODELS: 'sol, ASTRA, bogus' }), ['sol', 'astra']);
  assert.deepEqual(enabledModelKeys({ CHAT_MODELS: 'luna', OPENAI_CHAT_MODELS: 'sol' }), ['luna']);
  assert.deepEqual(enabledModelKeys({ OPENAI_CHAT_MODELS: 'bogus' }), MODEL_KEYS);
  assert.equal(defaultModelKey({ OPENAI_MODEL: 'gpt-6.1-sol' }), 'sol');
  assert.equal(defaultModelKey({ OPENAI_MODEL: 'astra', OPENAI_CHAT_MODELS: 'luna,sol' }), 'luna');
  assert.equal(defaultModelKey({ CHAT_DEFAULT_MODEL: 'auto', CHAT_MODELS: 'luna,sol' }), AUTO);
  assert.equal(defaultModelKey({ CHAT_DEFAULT_MODEL: 'auto', CHAT_MODELS: 'sol' }), 'sol');
});

test('unknown or disabled keys fall back to the default tier', () => {
  assert.equal(resolveModel('gpt-4o', { CHAT_ROUTER: 'off' }).key, 'luna');
  assert.equal(resolveModel('astra', { OPENAI_CHAT_MODELS: 'luna,sol' }).key, 'luna');
  assert.equal(resolveModel('sol', {}).id, 'gpt-6.1-sol');
  assert.equal(resolveModel(AUTO, {}).key, 'luna');
});

test('the provider follows CHAT_PROVIDER, then whichever key is present', () => {
  assert.equal(defaultProvider({}), 'openai');
  assert.equal(defaultProvider({ ANTHROPIC_API_KEY: 'k' }), 'anthropic');
  assert.equal(defaultProvider({ OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }), 'openai');
  assert.equal(defaultProvider({ OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', CHAT_PROVIDER: 'Anthropic' }), 'anthropic');
  assert.deepEqual(MODEL_KEYS.map(key => tierModel(key, { ANTHROPIC_API_KEY: 'k' }).id), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
});

test('one tier can use another provider or model', () => {
  const env = { OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', CHAT_MODEL_LUNA: 'anthropic:claude-haiku-5-5', CHAT_MODEL_ASTRA: 'gpt-6-astra-pro' };
  assert.deepEqual([tierModel('luna', env).provider, tierModel('luna', env).id], ['anthropic', 'claude-haiku-5-5']);
  assert.deepEqual([tierModel('sol', env).provider, tierModel('sol', env).id], ['openai', 'gpt-6.1-sol']);
  assert.deepEqual([tierModel('astra', env).provider, tierModel('astra', env).id], ['openai', 'gpt-6-astra-pro']);
  assert.equal(tierModel('sol', env).reasoning, 'medium');
  assert.equal(utilityModel(env).provider, 'anthropic');
});

test('tiers whose provider has no key are hidden once any provider is configured', () => {
  const env = { ANTHROPIC_API_KEY: 'k', CHAT_PROVIDER: 'anthropic', CHAT_MODEL_ASTRA: 'openai:gpt-6-astra' };
  assert.deepEqual(enabledModelKeys(env), ['luna', 'sol']);
  assert.equal(chatConfigured(env), true);
  assert.equal(chatConfigured({}), false);
  assert.equal(routerEnabled({ ...env, CHAT_MODELS: 'luna' }), false);
});

test('provider models are built for the configured provider and id', () => {
  const anthropic = languageModel(tierModel('sol', { ANTHROPIC_API_KEY: 'test-key' }), { ANTHROPIC_API_KEY: 'test-key' });
  assert.equal(anthropic.modelId, 'claude-sonnet-5-5');
  assert.match(anthropic.provider, /^anthropic/);
  const openai = languageModel(tierModel('luna', { OPENAI_API_KEY: 'test-key' }), { OPENAI_API_KEY: 'test-key' });
  assert.equal(openai.modelId, 'gpt-6-luna');
  assert.match(openai.provider, /^openai\.responses/);
});
