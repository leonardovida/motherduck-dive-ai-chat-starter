import test from 'node:test';
import assert from 'node:assert/strict';
import { createFailureLimiter, loginClientKey } from '../lib/login-limit.mjs';

test('forwarded addresses are ignored unless an explicitly trusted single-IP header is configured', () => {
  const headers = new Headers({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' });
  assert.equal(loginClientKey(headers, {}), 'shared');
  assert.equal(loginClientKey(headers, { VERCEL: '1' }), '198.51.100.1');
  assert.equal(loginClientKey(headers, { AUTH_TRUSTED_IP_HEADER: 'x-real-ip' }), '198.51.100.2');
  assert.equal(loginClientKey(headers, { AUTH_TRUSTED_IP_HEADER: 'X-Real-IP' }), '198.51.100.2', 'header names are case-insensitive');
  assert.equal(loginClientKey(new Headers({ 'x-real-ip': '198.51.100.2, 1.2.3.4' }), { AUTH_TRUSTED_IP_HEADER: 'x-real-ip' }), 'shared');
  assert.equal(loginClientKey(new Headers(), { AUTH_TRUSTED_IP_HEADER: 'x-real-ip' }), 'shared');
  assert.equal(loginClientKey(headers, { AUTH_TRUSTED_IP_HEADER: 'bad header!' }), 'shared');
});

test('successful local shared-mode sign-ins do not reset someone else\'s failures', () => {
  const limiter = createFailureLimiter({ limit: 1 });
  limiter.failed('shared'); limiter.succeeded('shared');
  assert.equal(limiter.blocked('shared'), true);
});

test('the limiter retains blocked clients at capacity and admits new clients after expiry', () => {
  let now = 1000;
  const limiter = createFailureLimiter({ limit: 2, maxKeys: 2, windowMs: 100, now: () => now });
  limiter.failed('a'); limiter.failed('a'); limiter.failed('b');
  assert.equal(limiter.blocked('a'), true);
  assert.equal(limiter.blocked('c'), true);
  limiter.failed('c');
  assert.equal(limiter.blocked('a'), true, 'new addresses cannot evict a blocked client');
  limiter.succeeded('b');
  assert.equal(limiter.blocked('c'), false);
  now = 1100;
  assert.equal(limiter.blocked('a'), false);
});

test('a limiter that evicts forgets the oldest bucket when full, instead of refusing everyone new', () => {
  const limiter = createFailureLimiter({ limit: 1, maxKeys: 2, evict: true });
  limiter.failed('a'); limiter.failed('b');
  assert.equal(limiter.blocked('c'), false, 'a new account can still try');
  limiter.failed('c');
  assert.equal(limiter.blocked('a'), false, 'the oldest bucket made room');
  assert.equal(limiter.blocked('c'), true);
});
