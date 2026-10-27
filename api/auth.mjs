import { COOKIE, DEV_PASSWORD, SESSION_SECONDS, authenticated, configuredPassword, passwordMatches, readBody, sameOrigin, send, sessionSecret, signSession, usingDevPassword } from '../lib/security.mjs';
import { DEFAULT_APP_TITLE } from '../src/lib/app-meta.mjs';

const attempts = new Map();
const WINDOW = 10 * 60 * 1000;
function throttle(request) {
  const ip = String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  if (attempts.size > 1000) for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  let entry = attempts.get(ip);
  if (!entry || entry.until < now) { entry = { count: 0, until: now + WINDOW }; attempts.set(ip, entry); }
  entry.count++;
  return entry.count > 10;
}

const appTitle = () => String(process.env.APP_TITLE || DEFAULT_APP_TITLE).slice(0, 80);

export default async function handler(request, response) {
  if (request.method === 'GET') {
    return send(response, 200, { authenticated: authenticated(request), appTitle: appTitle(), ...(usingDevPassword() ? { devPassword: DEV_PASSWORD } : {}) });
  }
  if (!['POST', 'DELETE'].includes(request.method)) return send(response, 405, { error: 'method_not_allowed' });
  if (!sameOrigin(request)) return send(response, 403, { error: 'origin_not_allowed' });
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return send(response, 200, { authenticated: false });
  }
  const password = configuredPassword(), secret = sessionSecret();
  if (!password || !secret) return send(response, 503, { error: 'auth_not_configured' });
  if (throttle(request)) {
    response.setHeader('Retry-After', '600');
    return send(response, 429, { error: 'too_many_attempts' });
  }
  let body;
  try { body = await readBody(request); } catch { return send(response, 400, { error: 'invalid_body' }); }
  if (!passwordMatches(body?.password, password)) return send(response, 401, { error: 'invalid_password' });
  response.setHeader('Set-Cookie', `${COOKIE}=${signSession(secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  return send(response, 200, { authenticated: true });
}
