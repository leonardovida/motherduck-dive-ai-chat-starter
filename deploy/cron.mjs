// Calls one of the app's scheduled routes, the same ones vercel.json "crons" calls on Vercel.
// The AWS, Google Cloud and Azure deployments run it as a short scheduled job from the app's
// own image, so CRON_SECRET stays in the platform's secret manager:
//
//   node deploy/cron.mjs /api/cron/daily
//
// It reads APP_URL and CRON_SECRET from the environment, prints the status and the route's
// JSON result (which holds no secrets), and exits 1 when the call fails.
const ROUTES = new Set(['/api/cron/daily', '/api/cron/digest']);
const route = process.argv[2];
const base = String(process.env.APP_URL ?? '').replace(/\/$/, '');
const secret = String(process.env.CRON_SECRET ?? '');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!ROUTES.has(route)) fail(`Usage: node deploy/cron.mjs ${[...ROUTES].join(' | ')}`);
if (!/^https:\/\/[^/]+$/.test(base)) fail('APP_URL must be the app\'s public https address.');
if (secret.length < 16) fail('CRON_SECRET must be set (16 or more characters).');

const timeout = Number(process.env.CRON_TIMEOUT_MS) || 330_000;
try {
  const response = await fetch(`${base}${route}`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(timeout),
  });
  const body = (await response.text()).slice(0, 500);
  console.log(`${route} ${response.status} ${body}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  fail(`${route} failed: ${error?.name ?? 'Error'}`);
}
