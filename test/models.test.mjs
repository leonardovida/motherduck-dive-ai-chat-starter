import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MODELS, FOLLOW_UP_MODEL, MODEL_KEYS, defaultModelKey, enabledModelKeys, modelCatalog, resolveModel } from '../lib/chat-models.mjs';

test('the catalog offers luna, sol and astra', () => {
  assert.deepEqual(MODEL_KEYS, ['luna', 'sol', 'astra']);
  assert.equal(CHAT_MODELS.luna.id, 'gpt-6-luna');
  assert.equal(CHAT_MODELS.sol.id, 'gpt-6.1-sol');
  assert.equal(CHAT_MODELS.astra.id, 'gpt-6-astra');
  assert.equal(FOLLOW_UP_MODEL, CHAT_MODELS.luna);
  assert.deepEqual(modelCatalog({}), { models: ['luna', 'sol', 'astra'], defaultModel: 'luna' });
});

test('env limits the picker and picks the default', () => {
  assert.deepEqual(enabledModelKeys({ OPENAI_CHAT_MODELS: 'sol, ASTRA, bogus' }), ['sol', 'astra']);
  assert.deepEqual(enabledModelKeys({ OPENAI_CHAT_MODELS: 'bogus' }), MODEL_KEYS);
  assert.equal(defaultModelKey({ OPENAI_MODEL: 'gpt-6.1-sol' }), 'sol');
  assert.equal(defaultModelKey({ OPENAI_MODEL: 'astra', OPENAI_CHAT_MODELS: 'luna,sol' }), 'luna');
});

test('unknown or disabled keys fall back to the default tier', () => {
  assert.equal(resolveModel('gpt-4o', {}).key, 'luna');
  assert.equal(resolveModel('astra', { OPENAI_CHAT_MODELS: 'luna,sol' }).key, 'luna');
  assert.equal(resolveModel('sol', {}).id, 'gpt-6.1-sol');
});
