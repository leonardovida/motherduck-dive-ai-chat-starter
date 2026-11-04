// deploy/cron.mjs: the scheduled job the AWS, Google Cloud and Azure deployments run from the
// app image. It must call the same routes as vercel.json, in the way the routes expect, and
// fail loudly without printing CRON_SECRET.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTES, callCronRoute } from '../deploy/cron.mjs';
import { cronAuthorized } from '../lib/cron.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SECRET = 'cron-test-secret-0123456789';
const ENV = { APP_URL: 'https://app.example.test', CRON_SECRET: SECRET };

function fakeFetch(status = 200, body = '{"mode":"automatic"}', headers = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(status === 204 || (status >= 300 && status < 400) ? null : body, { status, headers });
  };
  return { calls, impl };
}

test('calls exactly the routes vercel.json schedules, and each route exists with a GET handler', () => {
  const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons.map(cron => cron.path);
  assert.deepEqual([...ROUTES].sort(), [...crons].sort());
  for (const route of ROUTES) {
    const file = new URL(`../app${route}/route.js`, import.meta.url);
    assert.ok(existsSync(file), `${route} has a route file`);
    assert.match(readFileSync(file, 'utf8'), /export async function GET\(/);
  }
});

test('sends a GET with the bearer token the routes accept', async () => {
  const { calls, impl } = fakeFetch();
  const result = await callCronRoute('/api/cron/daily', ENV, impl);
  assert.equal(result.ok, true);
  assert.equal(result.message, '/api/cron/daily 200 {"mode":"automatic"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://app.example.test/api/cron/daily');
  assert.equal(calls[0].init.method ?? 'GET', 'GET');
  assert.equal(calls[0].init.redirect, 'manual');
  const request = new Request(calls[0].url, { headers: calls[0].init.headers });
  assert.equal(cronAuthorized(request, { CRON_SECRET: SECRET }), true);
});

test('accepts APP_URL with trailing slashes, and rejects a path, http or a missing value', async () => {
  for (const APP_URL of ['https://app.example.test/', 'https://app.example.test//', ' https://app.example.test ']) {
    const { calls, impl } = fakeFetch();
    assert.equal((await callCronRoute('/api/cron/digest', { ...ENV, APP_URL }, impl)).ok, true, APP_URL);
    assert.equal(calls[0].url, 'https://app.example.test/api/cron/digest');
  }
  for (const APP_URL of [undefined, '', 'http://app.example.test', 'https://app.example.test/app', 'https://app.example.test?x=1', 'app.example.test']) {
    const { calls, impl } = fakeFetch();
    const result = await callCronRoute('/api/cron/daily', { ...ENV, APP_URL }, impl);
    assert.equal(result.ok, false, String(APP_URL));
    assert.match(result.message, /APP_URL/);
    assert.equal(calls.length, 0);
  }
});

test('refuses unknown routes and short or missing secrets before calling anything', async () => {
  const { calls, impl } = fakeFetch();
  for (const [route, env] of [[undefined, ENV], ['/api/cron/other', ENV], ['/api/cron/daily', { ...ENV, CRON_SECRET: 'short' }], ['/api/cron/daily', { APP_URL: ENV.APP_URL }]]) {
    assert.equal((await callCronRoute(route, env, impl)).ok, false);
  }
  assert.equal(calls.length, 0);
});

test('fails on an error status, a redirect or a network error, without printing the secret', async () => {
  for (const status of [404, 502]) {
    const result = await callCronRoute('/api/cron/daily', ENV, fakeFetch(status, '{"error":"x"}').impl);
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(`^/api/cron/daily ${status} `));
  }
  const redirected = await callCronRoute('/api/cron/daily', ENV, fakeFetch(307, '', { location: 'https://elsewhere.example.test/' }).impl);
  assert.equal(redirected.ok, false);
  assert.match(redirected.message, /307 redirected/);
  const failing = async () => { throw Object.assign(new TypeError(`fetch failed for ${SECRET}`), { cause: { code: 'ENOTFOUND' } }); };
  const network = await callCronRoute('/api/cron/daily', ENV, failing);
  assert.equal(network.ok, false);
  assert.equal(network.message, '/api/cron/daily failed: TypeError (ENOTFOUND)');
  for (const result of [redirected, network]) assert.doesNotMatch(result.message, new RegExp(SECRET));
});

test('does not follow a real redirect, and times out', async t => {
  let hits = 0;
  const server = createServer((request, response) => {
    hits++;
    if (request.url === '/api/cron/daily') { response.writeHead(308, { location: '/elsewhere' }); response.end(); return; }
    if (request.url === '/api/cron/digest') return; // never answers
    response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html>sign in</html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const local = `http://127.0.0.1:${server.address().port}`;
  // The script requires https; send its request to the local http server instead.
  const viaLocal = (url, init) => fetch(url.replace(ENV.APP_URL, local), init);
  const redirected = await callCronRoute('/api/cron/daily', ENV, viaLocal);
  assert.equal(redirected.ok, false);
  assert.match(redirected.message, /^\/api\/cron\/daily 308 redirected/);
  assert.equal(hits, 1);
  const slow = await callCronRoute('/api/cron/digest', { ...ENV, CRON_TIMEOUT_MS: '50' }, viaLocal);
  assert.equal(slow.ok, false);
  assert.match(slow.message, /failed: (TimeoutError|AbortError)/);
});

test('the command exits 1 with a message on stderr when it cannot run', async () => {
  const run = env => new Promise(resolve => execFile(process.execPath, ['deploy/cron.mjs', '/api/cron/daily'], { cwd: ROOT, env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
  const noUrl = await run({ CRON_SECRET: SECRET });
  assert.equal(noUrl.code, 1);
  assert.match(noUrl.stderr, /APP_URL must be/);
  assert.doesNotMatch(noUrl.stdout + noUrl.stderr, new RegExp(SECRET));
  const unreachable = await run({ APP_URL: 'https://127.0.0.1:9', CRON_SECRET: SECRET, CRON_TIMEOUT_MS: '2000' });
  assert.equal(unreachable.code, 1);
  assert.match(unreachable.stderr, /^\/api\/cron\/daily failed: /);
  assert.doesNotMatch(unreachable.stdout + unreachable.stderr, new RegExp(SECRET));
});

test('CRON_TARGET_URL replaces APP_URL for the call, and may be a private http address', async () => {
  const { calls, impl } = fakeFetch();
  const result = await callCronRoute('/api/cron/daily', { ...ENV, CRON_TARGET_URL: 'http://internal-lb.example.test/' }, impl);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'http://internal-lb.example.test/api/cron/daily');
  for (const bad of ['internal-lb', 'ftp://internal-lb', 'http://internal-lb/path']) {
    const refused = await callCronRoute('/api/cron/daily', { ...ENV, CRON_TARGET_URL: bad }, impl);
    assert.equal(refused.ok, false, bad);
    assert.match(refused.message, /CRON_TARGET_URL/);
  }
  assert.equal(calls.length, 1, 'nothing is called with an invalid target');
});
