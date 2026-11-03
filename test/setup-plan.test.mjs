import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setupPlan } from '../lib/setup-plan.mjs';

const env = {
  DIVE_OVERVIEW_ID: '11111111-1111-4111-8111-111111111111',
  MOTHERDUCK_EMBED_USERNAME: 'private-reader', MOTHERDUCK_EMBED_TOKEN: 'private-embed',
  MOTHERDUCK_CHAT_TOKEN: 'private-chat', DIVE_OVERVIEW_CHAT_DATABASE: 'private_database', OPENAI_API_KEY: 'private-openai',
};

test('an empty agent setup lists the exact required credential and setting names', () => {
  const plan = setupPlan({ env: {} });
  assert.equal(plan.configurationReady, false);
  assert.equal(plan.connectionsVerified, false);
  assert.deepEqual(plan.requirements.filter(x => x.kind === 'secret').map(x => x.name).sort(), ['MOTHERDUCK_CHAT_TOKEN', 'MOTHERDUCK_EMBED_TOKEN', 'OPENAI_API_KEY']);
  assert.equal(plan.requirements.find(x => x.name === 'MOTHERDUCK_PG_HOST').required, false);
  assert.ok(plan.blockers[0].names.includes('DIVE_OVERVIEW_CHAT_DATABASE'));
  assert.ok(plan.requirements.every(x => x.present === false));
});

test('configured values are never returned and offline readiness is not live verification', () => {
  const plan = setupPlan({ env });
  assert.equal(plan.configurationReady, true);
  assert.equal(plan.connectionsVerified, false);
  for (const value of Object.values(env)) assert.equal(JSON.stringify(plan).includes(value), false);
  assert.equal(setupPlan({ env: { ...env, DIVE_OVERVIEW_ID: 'bad' } }).configurationReady, false);
  assert.equal(setupPlan({ env: { ...env, DIVE_OVERVIEW_CHAT_DATABASE: 'bad.database' } }).configurationReady, false);
});

test('a selected Dive uses its configured resource and database variable names', () => {
  const plan = setupPlan({ env: {}, diveKey: 'explorer' });
  assert.equal(plan.dive, 'explorer');
  assert.ok(plan.requirements.some(x => x.name === 'DIVE_EXPLORER_CHAT_DATABASE'));
  assert.equal(plan.requirements.find(x => x.name === 'DIVE_EXPLORER_SHARE_URL').kind, 'private_setting');
  assert.match(plan.nextCommands[0], /--dive=explorer/);
  assert.throws(() => setupPlan({ diveKey: 'unknown' }), /Unknown Dive key/);
});

test('production requires generated sign-in secrets and preserves the target in next steps', () => {
  const plan = setupPlan({ env: { ...env, VERCEL: '1' }, production: true });
  assert.equal(plan.configurationReady, false);
  assert.deepEqual(plan.blockers[0].names, ['DEMO_PASSWORD', 'SESSION_SECRET']);
  assert.match(plan.nextCommands[0], /--production/);
  assert.equal(setupPlan({ env: { ...env, DEMO_PASSWORD: 'password', SESSION_SECRET: 'short' }, production: true }).configurationReady, false);
  assert.equal(setupPlan({ env: { ...env, DEMO_PASSWORD: 'password', SESSION_SECRET: 'x'.repeat(32), VERCEL: '1' }, production: true }).configurationReady, true);
  assert.ok(setupPlan({ env, production: true }).blockers[0].names.includes('AUTH_TRUSTED_IP_HEADER'));
});

test('invalid version pins never silently select the latest Dive', () => {
  for (const pin of ['v3', '0', '-2', '1.5', '999999999999999999999999999999']) {
    const plan = setupPlan({ env: { ...env, DIVE_OVERVIEW_VERSION: pin } });
    assert.equal(plan.configurationReady, false);
    assert.ok(plan.blockers.some(b => b.code === 'invalid_version' && b.names.includes('DIVE_OVERVIEW_VERSION')));
  }
});

test('CLI emits parseable JSON, loads local config and preserves injected values', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'starter-setup-test-'));
  const script = fileURLToPath(new URL('../scripts/check-setup.mjs', import.meta.url));
  const run = (args, extra = {}) => spawnSync(process.execPath, [script, ...args], { cwd, env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });
  try {
    const empty = run(['--json', '--require-chat']);
    assert.equal(empty.status, 1);
    assert.equal(JSON.parse(empty.stdout).ok, false);
    writeFileSync(join(cwd, '.env.local'), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'));
    const valid = run(['--json', '--require-chat']);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).configurationReady, true);
    assert.equal(JSON.parse(valid.stdout).connectionsVerified, false);
    for (const value of Object.values(env)) assert.equal(valid.stdout.includes(value), false);
    const invalid = run(['--json', '--require-chat'], { DIVE_OVERVIEW_ID: 'bad-injected-id' });
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).configurationReady, false);
    const unknown = run(['--json', '--dive=unknown']);
    assert.equal(unknown.status, 1);
    assert.equal(JSON.parse(unknown.stderr).ok, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('invalid configuration imports produce a redacted JSON error rather than a stack trace', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'starter-invalid-config-test-'));
  try {
    mkdirSync(join(cwd, 'scripts')); mkdirSync(join(cwd, 'lib'));
    copyFileSync(fileURLToPath(new URL('../scripts/check-setup.mjs', import.meta.url)), join(cwd, 'scripts/check-setup.mjs'));
    writeFileSync(join(cwd, 'lib/setup-check.mjs'), "throw new Error('sensitive-config-value');");
    const result = spawnSync(process.execPath, ['scripts/check-setup.mjs', '--json'], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: 'invalid_config' });
    assert.equal((result.stdout + result.stderr).includes('sensitive-config-value'), false);
    assert.equal(result.stderr.includes(' at '), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('accounts mode and Anthropic change the requirements an agent is asked for', () => {
  const anthropic = setupPlan({ env: { ...env, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: 'private-anthropic' } });
  assert.ok(anthropic.requirements.some(x => x.name === 'ANTHROPIC_API_KEY' && x.present));
  assert.ok(!anthropic.requirements.some(x => x.name === 'OPENAI_API_KEY'));
  const accounts = setupPlan({ env: { ...env, MOTHERDUCK_APP_TOKEN: 'private-app' }, production: true });
  assert.equal(accounts.signIn, 'accounts');
  assert.ok(!accounts.requirements.some(x => x.name === 'DEMO_PASSWORD'));
  assert.deepEqual(accounts.blockers[0].names, ['SESSION_SECRET', 'APP_URL', 'AUTH_TRUSTED_IP_HEADER']);
  assert.match(accounts.nextCommands[0], /db:migrate/);
  assert.equal(setupPlan({ env: { ...env, MOTHERDUCK_APP_TOKEN: 'private-app', SESSION_SECRET: 'x'.repeat(32), VERCEL: '1' }, production: true }).configurationReady, true);
});
