import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../dives.config.mjs';
import { getDive, listDives, publicDive, resolveDive, validateConfig } from '../lib/dives.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const base = { key: 'sales', title: 'Sales', diveIdEnv: 'DIVE_SALES_ID' };

test('the shipped config is valid and lists two placeholder Dives', () => {
  assert.equal(validateConfig(config), config);
  assert.deepEqual(config.map(d => d.key), ['overview', 'explorer']);
  const overview = getDive('overview', { DIVE_OVERVIEW_ID: ID, MOTHERDUCK_EMBED_USERNAME: 'reader', MOTHERDUCK_EMBED_TOKEN: 'fixture' });
  assert.equal(overview.connected, true, 'the included no-data Dive must not require a data share');
  assert.deepEqual(overview.resources, []);
});

test('invalid entries fail with a pointed message', () => {
  const cases = [
    [[], /at least one Dive/],
    [[{ ...base, key: 'Bad Key' }], /key must match/],
    [[base, base], /duplicate key/],
    [[{ ...base, title: '' }], /title is required/],
    [[{ ...base, icon: 'rocket' }], /icon must be one of/],
    [[{ ...base, diveId: ID }], /exactly one of diveId or diveIdEnv/],
    [[{ key: 'x', title: 'X', diveId: 'not-a-uuid' }], /diveId must be a UUID/],
    [[{ ...base, diveIdEnv: 'lowercase' }], /diveIdEnv must be an env var name/],
    [[{ ...base, version: 0 }], /version must be a positive integer/],
    [[{ ...base, resources: [{ alias: 'demo' }] }], /exactly one of url or urlEnv/],
    [[{ ...base, resources: [{ alias: 'demo', url: 's3://x' }] }], /must start with md:/],
    [[{ ...base, resources: [{ alias: 'a b', urlEnv: 'X' }] }], /alias/],
    [[{ ...base, chat: { tokenEnv: 'T' } }], /chat needs tokenEnv and databaseEnv/],
    [[{ ...base, starters: Array(7).fill('q') }], /starters/],
    [[{ ...base, linkHosts: ['https://example.com'] }], /linkHosts must be hostnames/],
  ];
  for (const [entries, message] of cases) assert.throws(() => validateConfig(entries), message);
});

test('a Dive without env values reports missing names, never values', () => {
  const dive = resolveDive({ ...base, resources: [{ urlEnv: 'DIVE_SALES_SHARE', alias: 'demo' }] }, {});
  assert.equal(dive.connected, false);
  assert.deepEqual(dive.missing, ['DIVE_SALES_ID', 'MOTHERDUCK_EMBED_USERNAME', 'MOTHERDUCK_EMBED_TOKEN', 'DIVE_SALES_SHARE']);
  assert.equal(dive.chat, null);
});

test('a configured Dive resolves ids, version, resources and chat', () => {
  const env = { DIVE_SALES_ID: ID, DIVE_SALES_VERSION: '7', MOTHERDUCK_EMBED_USERNAME: 'reader', MOTHERDUCK_EMBED_TOKEN: 'token-value', DIVE_SALES_SHARE: 'md:_share/x/y', CHAT_TOKEN: 'chat-token', CHAT_DB: 'sales_db', OPENAI_API_KEY: 'k' };
  const dive = resolveDive({ ...base, versionEnv: 'DIVE_SALES_VERSION', resources: [{ urlEnv: 'DIVE_SALES_SHARE', alias: 'demo' }], chat: { tokenEnv: 'CHAT_TOKEN', databaseEnv: 'CHAT_DB' } }, env);
  assert.equal(dive.connected, true);
  assert.equal(dive.version, 7);
  assert.deepEqual(dive.resources, [{ alias: 'demo', url: 'md:_share/x/y' }]);
  assert.deepEqual(dive.chat, { token: 'chat-token', database: 'sales_db' });
  const exposed = JSON.stringify(publicDive(dive, env));
  for (const secret of ['token-value', 'chat-token', 'reader', 'md:_share/x/y']) assert.equal(exposed.includes(secret), false, secret);
  assert.equal(publicDive(dive, env).chatEnabled, true);
  assert.equal(publicDive(dive, {}).chatEnabled, false, 'chat needs OPENAI_API_KEY too');
});

test('an invalid Dive id from env keeps the Dive disconnected', () => {
  const dive = resolveDive(base, { DIVE_SALES_ID: 'nope', MOTHERDUCK_EMBED_USERNAME: 'r', MOTHERDUCK_EMBED_TOKEN: 't' });
  assert.equal(dive.connected, false);
  assert.equal(dive.url, null);
});

test('lookups by key only return configured Dives', () => {
  assert.equal(listDives({}).length, 2);
  assert.equal(getDive('overview', {}).key, 'overview');
  assert.equal(getDive('../etc', {}), null);
});
