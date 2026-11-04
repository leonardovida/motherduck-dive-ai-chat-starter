// Calls one of the app's scheduled routes, the same ones vercel.json "crons" calls on Vercel.
// The AWS, Google Cloud and Azure deployments run it as a short scheduled job from the app's
// own image, so CRON_SECRET stays in the platform's secret manager:
//
//   node deploy/cron.mjs /api/cron/daily
//
// It reads APP_URL and CRON_SECRET from the environment, prints the status and the route's
// JSON result (which holds no secrets), and exits 1 when the call fails. CRON_TARGET_URL, when
// set, is called instead of APP_URL: the AWS stack points it at the internal load balancer, so
// a long daily run is not cut off by CloudFront's 120-second origin timeout. It may be http,
// because that traffic stays inside the deployment's private network. A redirect counts as a
// failure: following it could drop the bearer token or land on a page that is not the route.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ROUTES = ['/api/cron/daily', '/api/cron/digest'];
const DEFAULT_TIMEOUT_MS = 330_000;

export async function callCronRoute(route, env = process.env, fetchImpl = globalThis.fetch) {
  if (!ROUTES.includes(route)) return { ok: false, message: `Usage: node deploy/cron.mjs ${ROUTES.join(' | ')}` };
  const target = String(env.CRON_TARGET_URL ?? '').trim().replace(/\/+$/, '');
  const base = target || String(env.APP_URL ?? '').trim().replace(/\/+$/, '');
  if (target && !/^https?:\/\/[^/?#\s]+$/i.test(target)) return { ok: false, message: 'CRON_TARGET_URL must be an http or https address, without a path.' };
  if (!target && !/^https:\/\/[^/?#\s]+$/i.test(base)) return { ok: false, message: 'APP_URL must be the app\'s public https address, without a path.' };
  const secret = String(env.CRON_SECRET ?? '');
  if (secret.length < 16) return { ok: false, message: 'CRON_SECRET must be set (16 or more characters).' };
  const timeout = Number(env.CRON_TIMEOUT_MS) > 0 ? Number(env.CRON_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  try {
    const response = await fetchImpl(`${base}${route}`, {
      headers: { authorization: `Bearer ${secret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, message: `${route} ${response.status} redirected. Set APP_URL to the address the app answers on directly.` };
    }
    const body = (await response.text()).slice(0, 500);
    return { ok: response.ok, message: `${route} ${response.status} ${body}` };
  } catch (error) {
    const code = error?.cause?.code ? ` (${error.cause.code})` : '';
    return { ok: false, message: `${route} failed: ${error?.name ?? 'Error'}${code}` };
  }
}

function isMain() {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
}

if (isMain()) {
  const result = await callCronRoute(process.argv[2]);
  (result.ok ? console.log : console.error)(result.message);
  process.exitCode = result.ok ? 0 : 1;
}
